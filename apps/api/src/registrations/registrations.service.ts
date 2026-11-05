import { HttpStatus, Injectable, Logger, StreamableFile } from '@nestjs/common';
import type { RegistrationDto } from '@sru/shared-types';
import { formatThaiDateTime, sanitizeSpreadsheetCell } from '@sru/shared-utils';
import ExcelJS from 'exceljs';
import { createHash, randomBytes } from 'node:crypto';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { Paginated } from '../common/pagination';
import { SequenceService } from '../common/sequence.service';
import type { AuthUser } from '../auth/auth.types';
import { isRegistrationOpen } from '../events/event-state';
import { EventsService } from '../events/events.service';
import { Prisma, Registration, RegistrationStatus } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import {
  AnswerDto,
  CreateRegistrationDto,
  ExportQueryDto,
  RegistrationQueryDto,
} from './registrations.dto';

export const CONSENT_VERSION = '2569-1';
const SEAT_HOLDING: RegistrationStatus[] = ['PENDING_PAYMENT', 'CONFIRMED'];
const ACTIVE: RegistrationStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'WAITLISTED'];
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface LockedEvent {
  id: string;
  status: string;
  capacity: number | null;
  seats_taken: number;
  allow_waitlist: boolean;
  allow_guest_registration: boolean;
  allow_self_cancel: boolean;
  is_paid: boolean;
  registration_open_at: Date | null;
  registration_close_at: Date | null;
  end_at: Date;
  deleted_at: Date | null;
}

@Injectable()
export class RegistrationsService {
  private readonly logger = new Logger(RegistrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly events: EventsService,
  ) {}

  /**
   * Register for an event.
   *
   * Concurrency: the event row is locked with SELECT … FOR UPDATE for the
   * (short) duration of the transaction, so seat checks and the seats_taken
   * increment are serialised per event – overbooking is impossible. The DB
   * CHECK (seats_taken <= capacity) is a second line of defence, and the
   * partial unique index on (event_id, email_normalized) rejects duplicates
   * even under concurrent submissions. Idempotency-Key handles client retries.
   */
  async register(eventId: string, dto: CreateRegistrationDto, user: AuthUser | undefined, meta: RequestMeta) {
    const email = dto.email.trim().toLowerCase();
    const fields = await this.prisma.registrationField.findMany({
      where: { eventId, isActive: true },
      include: { options: true },
    });
    const answers = this.validateAnswers(fields, dto.answers ?? []);
    const participantType = await this.resolveParticipantType(eventId, dto.participantTypeCode);
    const accessToken = randomBytes(24).toString('base64url');

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const [ev] = await tx.$queryRaw<LockedEvent[]>`
            SELECT id::text, status::text, capacity, seats_taken, allow_waitlist, allow_guest_registration,
                   allow_self_cancel, is_paid, registration_open_at, registration_close_at, end_at, deleted_at
            FROM events WHERE id = ${eventId}::uuid FOR UPDATE`;
          if (!ev || ev.deleted_at) throw Errors.notFound('กิจกรรม');
          if (
            !isRegistrationOpen({
              status: ev.status as never,
              registrationOpenAt: ev.registration_open_at,
              registrationCloseAt: ev.registration_close_at,
              endAt: ev.end_at,
            })
          ) {
            throw new AppError('REGISTRATION_CLOSED', 'กิจกรรมนี้ยังไม่เปิดหรือปิดรับสมัครแล้ว', HttpStatus.CONFLICT);
          }
          if (!user && !ev.allow_guest_registration) {
            throw new AppError('LOGIN_REQUIRED', 'กิจกรรมนี้ต้องเข้าสู่ระบบก่อนลงทะเบียน', HttpStatus.UNAUTHORIZED);
          }
          if (ev.is_paid) {
            // Payment orders, transfers and on-site payment arrive with the payment module (Phase 2).
            throw new AppError('PAID_REGISTRATION_UNAVAILABLE', 'ยังไม่เปิดให้ลงทะเบียนกิจกรรมที่มีค่าใช้จ่ายผ่านระบบ', HttpStatus.CONFLICT);
          }

          const seats = 1;
          const hasSeat = ev.capacity === null || ev.seats_taken + seats <= ev.capacity;
          if (!hasSeat && !ev.allow_waitlist) {
            throw new AppError('EVENT_FULL', 'ที่นั่งเต็มแล้ว', HttpStatus.CONFLICT);
          }
          const status: RegistrationStatus = hasSeat ? 'CONFIRMED' : 'WAITLISTED';
          if (hasSeat) {
            await tx.$executeRaw`UPDATE events SET seats_taken = seats_taken + ${seats} WHERE id = ${eventId}::uuid`;
          }

          const referenceNo = await this.seq.next(tx, 'REG');
          const reg = await tx.registration.create({
            data: {
              eventId,
              referenceNo,
              userId: user?.id ?? null,
              participantTypeId: participantType.id,
              status,
              source: 'WEB',
              prefix: dto.prefix,
              firstName: dto.firstName.trim(),
              lastName: dto.lastName.trim(),
              email: dto.email.trim(),
              emailNormalized: email,
              phone: dto.phone || null,
              studentOrStaffCode: dto.studentOrStaffCode,
              affiliation: dto.affiliation,
              program: dto.program,
              seats,
              consentAt: new Date(),
              consentVersion: CONSENT_VERSION,
              confirmedAt: status === 'CONFIRMED' ? new Date() : null,
              accessTokenHash: sha256(accessToken),
              createdById: user?.id ?? null,
              answers: { create: answers },
            },
          });
          if (status === 'WAITLISTED') {
            await tx.waitingList.create({ data: { eventId, registrationId: reg.id } });
          }
          await this.audit.log(
            { actorId: user?.id, action: 'registration.create', entityType: 'registration', entityId: reg.id, after: { referenceNo, status, eventId }, meta },
            tx,
          );
          return reg;
        },
        { timeout: 10_000 },
      );
      const waitlistPosition = result.status === 'WAITLISTED' ? await this.waitlistPosition(result.id) : null;
      // The access token is returned exactly once; only its hash is stored.
      return { ...this.toDto(result, dto.participantTypeCode, waitlistPosition), accessToken };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError('DUPLICATE_REGISTRATION', 'อีเมลนี้ลงทะเบียนกิจกรรมนี้ไว้แล้ว', HttpStatus.CONFLICT);
      }
      throw e;
    }
  }

  async cancelById(id: string, reason: string | undefined, user: AuthUser, meta: RequestMeta) {
    const reg = await this.prisma.registration.findUnique({ where: { id }, include: { event: true } });
    if (!reg) throw Errors.notFound('การลงทะเบียน');
    const isOwner = reg.userId === user.id;
    if (!isOwner) {
      await this.access.assertOrg(user, 'registration:update', reg.event.organizationId);
    } else if (!reg.event.allowSelfCancel) {
      throw Errors.forbidden('กิจกรรมนี้ไม่อนุญาตให้ยกเลิกด้วยตนเอง');
    }
    return this.cancel(reg.id, reason, user.id, meta);
  }

  async cancelByToken(referenceNo: string, token: string, reason: string | undefined, meta: RequestMeta) {
    const reg = await this.findByToken(referenceNo, token);
    const event = await this.prisma.event.findUniqueOrThrow({ where: { id: reg.eventId } });
    if (!event.allowSelfCancel) throw Errors.forbidden('กิจกรรมนี้ไม่อนุญาตให้ยกเลิกด้วยตนเอง');
    return this.cancel(reg.id, reason, null, meta);
  }

  /** Cancels, releases the seat and promotes from the waitlist — all in one transaction. */
  private async cancel(id: string, reason: string | undefined, actorId: string | null, meta: RequestMeta) {
    const promoted = await this.prisma.$transaction(async (tx) => {
      const [reg] = await tx.$queryRaw<{ id: string; event_id: string; status: RegistrationStatus; seats: number }[]>`
        SELECT id::text, event_id::text, status, seats FROM registrations WHERE id = ${id}::uuid FOR UPDATE`;
      if (!reg) throw Errors.notFound('การลงทะเบียน');
      if (!ACTIVE.includes(reg.status)) throw Errors.invalidState('การลงทะเบียนนี้ถูกยกเลิกหรือสิ้นสุดแล้ว');

      // Lock the event row before touching seats (same lock order as register → no deadlocks).
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${reg.event_id}::uuid FOR UPDATE`;
      await tx.registration.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null, version: { increment: 1 } },
      });
      await tx.waitingList.deleteMany({ where: { registrationId: id } });

      let promotedIds: string[] = [];
      if (SEAT_HOLDING.includes(reg.status)) {
        await tx.$executeRaw`UPDATE events SET seats_taken = seats_taken - ${reg.seats} WHERE id = ${reg.event_id}::uuid`;
        promotedIds = await this.promoteWaitlist(tx, reg.event_id);
      }
      await this.audit.log(
        { actorId, action: 'registration.cancel', entityType: 'registration', entityId: id, before: { status: reg.status }, after: { status: 'CANCELLED', promoted: promotedIds }, reason, meta },
        tx,
      );
      return promotedIds;
    });
    if (promoted.length) this.logger.log({ promoted }, 'Promoted from waitlist');
    // Phase 2: enqueue "ได้รับสิทธิ์จากรายชื่อสำรอง" notifications via BullMQ.
    return { cancelled: true, promotedFromWaitlist: promoted.length };
  }

  /** FIFO promotion while seats are available. Caller must hold the event row lock. */
  private async promoteWaitlist(tx: Tx, eventId: string): Promise<string[]> {
    const promoted: string[] = [];
    for (;;) {
      const [ev] = await tx.$queryRaw<{ capacity: number | null; seats_taken: number }[]>`
        SELECT capacity, seats_taken FROM events WHERE id = ${eventId}::uuid`;
      const next = await tx.waitingList.findFirst({
        where: { eventId, promotedAt: null, registration: { status: 'WAITLISTED' } },
        orderBy: { createdAt: 'asc' },
        include: { registration: { select: { seats: true } } },
      });
      if (!ev || !next) break;
      if (ev.capacity !== null && ev.seats_taken + next.registration.seats > ev.capacity) break;

      await tx.$executeRaw`UPDATE events SET seats_taken = seats_taken + ${next.registration.seats} WHERE id = ${eventId}::uuid`;
      await tx.registration.update({
        where: { id: next.registrationId },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), version: { increment: 1 } },
      });
      await tx.waitingList.update({ where: { id: next.id }, data: { promotedAt: new Date() } });
      promoted.push(next.registrationId);
    }
    return promoted;
  }

  async lookupByToken(referenceNo: string, token: string) {
    const reg = await this.findByToken(referenceNo, token);
    const full = await this.prisma.registration.findUniqueOrThrow({
      where: { id: reg.id },
      include: {
        participantType: true,
        event: { select: { id: true, code: true, titleTh: true, startAt: true, endAt: true, venueText: true, allowSelfCancel: true } },
      },
    });
    return {
      ...this.toDto(full, full.participantType.code, await this.waitlistPosition(full.id)),
      event: full.event,
    };
  }

  async listForEvent(eventId: string, q: RegistrationQueryDto, user: AuthUser) {
    const event = await this.events.findOrThrow(eventId);
    await this.access.assertOrg(user, 'registration:view', event.organizationId);
    const where: Prisma.RegistrationWhereInput = {
      eventId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.participantTypeId ? { participantTypeId: q.participantTypeId } : {}),
      ...(q.search
        ? {
            OR: [
              { firstName: { contains: q.search, mode: 'insensitive' } },
              { lastName: { contains: q.search, mode: 'insensitive' } },
              { emailNormalized: { contains: q.search.toLowerCase() } },
              { referenceNo: q.search.toUpperCase() },
              { studentOrStaffCode: q.search },
            ],
          }
        : {}),
    };
    const [rows, total, counts] = await this.prisma.$transaction([
      this.prisma.registration.findMany({ where, include: { participantType: true }, skip: q.skip, take: q.perPage, orderBy: { createdAt: q.order } }),
      this.prisma.registration.count({ where }),
      this.prisma.registration.groupBy({ by: ['status'], where: { eventId }, _count: { _all: true }, orderBy: { status: 'asc' } }),
    ]);
    const page = Paginated.of(rows.map((r) => this.toDto(r, r.participantType.code, null)), total, q);
    return Object.assign(page, {
      meta: { ...page.meta, statusCounts: Object.fromEntries(counts.map((c) => [c.status, (c._count as { _all: number })._all])) },
    });
  }

  async export(eventId: string, q: ExportQueryDto, user: AuthUser, meta: RequestMeta) {
    const event = await this.events.findOrThrow(eventId);
    await this.access.assertOrg(user, 'registration:export', event.organizationId);
    const fields = await this.prisma.registrationField.findMany({ where: { eventId, isActive: true }, orderBy: { sortOrder: 'asc' }, include: { options: true } });
    const rows = await this.prisma.registration.findMany({
      where: { eventId, ...(q.status ? { status: q.status } : {}) },
      include: { participantType: true, answers: { include: { option: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const header = ['ลำดับ', 'เลขอ้างอิง', 'สถานะ', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'อีเมล', 'โทรศัพท์', 'รหัสนักศึกษา/บุคลากร', 'หน่วยงาน/คณะ', 'หลักสูตร/สาขา', 'ประเภทผู้เข้าร่วม', 'วันที่ลงทะเบียน', ...fields.map((f) => f.labelTh)];
    const data = rows.map((r, i) => [
      i + 1, r.referenceNo, r.status, r.prefix ?? '', r.firstName, r.lastName, r.email, r.phone ?? '', r.studentOrStaffCode ?? '',
      r.affiliation ?? '', r.program ?? '', r.participantType.nameTh, formatThaiDateTime(r.createdAt),
      ...fields.map((f) => r.answers.filter((a) => a.fieldId === f.id).map((a) => a.option?.labelTh ?? a.valueText ?? '').join(', ')),
    ].map(sanitizeSpreadsheetCell));

    await this.audit.log({ actorId: user.id, action: 'registration.export', entityType: 'event', entityId: eventId, after: { format: q.format, rows: rows.length }, meta });
    const base = `registrations-${event.code}`;

    if (q.format === 'csv') {
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = '﻿' + [header, ...data].map((line) => line.map(esc).join(',')).join('\r\n');
      return new StreamableFile(Buffer.from(csv, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${base}.csv"` });
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SRU Event Hub';
    const ws = wb.addWorksheet('ผู้ลงทะเบียน');
    ws.addRow(header).font = { bold: true, name: 'Sarabun' };
    data.forEach((d) => ws.addRow(d));
    ws.columns.forEach((c) => (c.width = 18));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return new StreamableFile(buf, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${base}.xlsx"`,
    });
  }

  async mine(user: AuthUser) {
    const rows = await this.prisma.registration.findMany({
      where: { userId: user.id },
      include: {
        participantType: true,
        event: { select: { id: true, code: true, titleTh: true, startAt: true, endAt: true, venueText: true, status: true, allowSelfCancel: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({ ...this.toDto(r, r.participantType.code, null), event: r.event }));
  }

  // ───────────── helpers ─────────────

  private async findByToken(referenceNo: string, token: string) {
    const reg = await this.prisma.registration.findUnique({ where: { referenceNo } });
    // Same error for "not found" and "wrong token" so references can't be enumerated.
    if (!reg?.accessTokenHash || reg.accessTokenHash !== sha256(token)) {
      throw new AppError('NOT_FOUND', 'ไม่พบข้อมูลการลงทะเบียน', HttpStatus.NOT_FOUND);
    }
    return reg;
  }

  private async resolveParticipantType(eventId: string, code: string) {
    const allowed = await this.prisma.eventParticipantType.findMany({ where: { eventId }, include: { participantType: true } });
    const pt = allowed.length
      ? allowed.find((a) => a.participantType.code === code)?.participantType
      : await this.prisma.participantType.findFirst({ where: { code, isActive: true } });
    if (!pt) throw Errors.validation('ประเภทผู้เข้าร่วมนี้ไม่สามารถลงทะเบียนกิจกรรมนี้ได้');
    return pt;
  }

  private validateAnswers(
    fields: Prisma.RegistrationFieldGetPayload<{ include: { options: true } }>[],
    answers: AnswerDto[],
  ): Prisma.RegistrationAnswerCreateWithoutRegistrationInput[] {
    const byKey = new Map(answers.map((a) => [a.key, a.value]));
    const errors: Record<string, string> = {};
    const out: Prisma.RegistrationAnswerCreateWithoutRegistrationInput[] = [];

    for (const f of fields) {
      const raw = byKey.get(f.key);
      const values = (Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw]).map((v) => String(v).trim()).filter(Boolean);
      if (!values.length) {
        if (f.isRequired) errors[f.key] = `กรุณากรอก ${f.labelTh}`;
        continue;
      }
      const multi = f.fieldType === 'MULTISELECT' || f.fieldType === 'CHECKBOX';
      if (!multi && values.length > 1) {
        errors[f.key] = 'เลือกได้เพียงค่าเดียว';
        continue;
      }
      if (f.options.length) {
        for (const v of values) {
          const opt = f.options.find((o) => o.value === v);
          if (!opt) errors[f.key] = 'ตัวเลือกไม่ถูกต้อง';
          else out.push({ field: { connect: { id: f.id } }, option: { connect: { id: opt.id } } });
        }
        continue;
      }
      const v = values[0]!;
      const max = f.maxLength ?? (f.fieldType === 'TEXTAREA' ? 5000 : 500);
      if (v.length > max) errors[f.key] = `ยาวเกิน ${max} ตัวอักษร`;
      else if (f.fieldType === 'NUMBER' && !/^-?\d+(\.\d+)?$/.test(v)) errors[f.key] = 'ต้องเป็นตัวเลข';
      else if (f.fieldType === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[f.key] = 'อีเมลไม่ถูกต้อง';
      else if (f.fieldType === 'PHONE' && !/^0\d{8,9}$/.test(v)) errors[f.key] = 'เบอร์โทรศัพท์ไม่ถูกต้อง';
      else if (f.fieldType === 'DATE' && Number.isNaN(Date.parse(v))) errors[f.key] = 'วันที่ไม่ถูกต้อง';
      else out.push({ field: { connect: { id: f.id } }, valueText: v });
    }
    const unknown = answers.filter((a) => !fields.some((f) => f.key === a.key)).map((a) => a.key);
    if (unknown.length) errors._unknown = `ไม่รู้จักฟิลด์: ${unknown.join(', ')}`;
    if (Object.keys(errors).length) throw Errors.validation('ข้อมูลแบบฟอร์มไม่ถูกต้อง', errors);
    return out;
  }

  private async waitlistPosition(registrationId: string): Promise<number | null> {
    const w = await this.prisma.waitingList.findUnique({ where: { registrationId } });
    if (!w || w.promotedAt) return null;
    const ahead = await this.prisma.waitingList.count({
      where: { eventId: w.eventId, promotedAt: null, createdAt: { lt: w.createdAt }, registration: { status: 'WAITLISTED' } },
    });
    return ahead + 1;
  }

  private toDto(r: Registration, participantTypeCode: string, waitlistPosition: number | null): RegistrationDto {
    return {
      id: r.id,
      eventId: r.eventId,
      referenceNo: r.referenceNo,
      status: r.status,
      fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
      email: r.email,
      phone: r.phone,
      participantTypeCode,
      createdAt: r.createdAt.toISOString(),
      waitlistPosition,
    };
  }
}
