import type { INestApplication } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/main';
import { LineService } from '../src/notifications/line.service';
import { NotificationDispatcher } from '../src/notifications/notification-dispatcher';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { iso, login, PASSWORD, type Session } from './helpers';

/**
 * Venues, equipment and notifications (spec §4.12, §4.13 — P5b) over real HTTP + PostgreSQL:
 * catalogue scope, booking conflicts (exclusion constraint + stock trigger under concurrent
 * approvals), separation of duties, event cancellation; audit-driven notifications (in-app, e-mail
 * outbox, LINE linking via signed webhook), dedupe, preferences, reminders and the admin log.
 */
const LINE_SECRET = 'e2e-line-channel-secret';
process.env.LINE_CHANNEL_SECRET = LINE_SECRET;

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let dispatcher: NotificationDispatcher;
let notifications: NotificationsService;
let line: LineService;

let central: Session;
let sciAdmin: Session;
let manager: Session;
let student: Session;
let sysadmin: Session;
const tag = randomUUID().slice(0, 6).toUpperCase();
let sciOrgId: string;
let roomId: string;
let autoRoomId: string;
let itemId: string;
let eventId: string;

const day = (d: number, h: number) => {
  const t = new Date(Date.now() + d * 86400_000);
  t.setUTCHours(h, 0, 0, 0);
  return t.toISOString();
};
const dispatch = () => dispatcher.runOnce({ settleMs: 0 });
const inbox = async (s: Session) => (await s.get('/api/v1/me/notifications?perPage=100')).body as { data: { type: string; title: string; body: string }[]; meta: { unread: number } };
const sign = (body: string) => createHmac('sha256', LINE_SECRET).update(body).digest('base64');

beforeAll(async () => {
  if (!PASSWORD) throw new Error('SEED_DEMO_PASSWORD must be set for e2e tests');
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  prisma = app.get(PrismaService);
  dispatcher = app.get(NotificationDispatcher);
  notifications = app.get(NotificationsService);
  line = app.get(LineService);
  [central, sciAdmin, manager, student, sysadmin] = await Promise.all(['central', 'sci.admin', 'sci.manager', 'student', 'sysadmin'].map((u) => login(http, u)));
  sciOrgId = (await prisma.organization.findFirstOrThrow({ where: { code: 'SCI' } })).id;
  await dispatch(); // drain facts left by other suites so counts below are about this suite
});

afterAll(async () => {
  await app?.close();
});

describe('venue catalogue', () => {
  it('unit admins manage only their own unit; central rooms need ALL scope', async () => {
    const room = { code: `E2E-${tag}`, nameTh: `ห้องทดสอบ ${tag}`, venueType: 'MEETING_ROOM', capacity: 50, organizationId: sciOrgId };
    expect((await manager.post('/api/v1/venues', room)).status).toBe(403);
    expect((await sciAdmin.post('/api/v1/venues', { ...room, organizationId: null })).status).toBe(403);
    const res = await sciAdmin.post('/api/v1/venues', room);
    expect(res.status).toBe(201);
    roomId = res.body.data.id;
    expect((await sciAdmin.post('/api/v1/venues', room)).status).toBe(409); // duplicate code
    const auto = await central.post('/api/v1/venues', { code: `E2E-A-${tag}`, nameTh: 'ห้องอนุมัติอัตโนมัติ', venueType: 'MEETING_ROOM', capacity: 10, autoApprove: true });
    expect(auto.status).toBe(201);
    autoRoomId = auto.body.data.id;
  });

  it('lists venues with filters and availability', async () => {
    const list = await manager.get(`/api/v1/venues?search=${tag}&minCapacity=40`);
    expect(list.body.data.map((v: { id: string }) => v.id)).toEqual([roomId]);
    const av = await manager.get(`/api/v1/venues/availability?from=${encodeURIComponent(day(3, 2))}&to=${encodeURIComponent(day(3, 4))}`);
    expect(av.status).toBe(200);
    expect(av.body.data.find((v: { id: string }) => v.id === roomId)).toMatchObject({ free: true, pending: 0 });
  });
});

describe('venue bookings', () => {
  let a: string;
  let b: string;

  it('two overlapping requests can wait; approving both at once lets exactly one through', async () => {
    const r1 = await manager.post('/api/v1/venue-bookings', { venueId: roomId, startAt: day(3, 2), endAt: day(3, 4), purpose: 'ประชุมกรรมการ' });
    const r2 = await student.post('/api/v1/venue-bookings', { venueId: roomId, startAt: day(3, 3), endAt: day(3, 5), purpose: 'x' });
    expect(r2.status).toBe(403); // students have no venue:view
    const r3 = await central.post('/api/v1/venue-bookings', { venueId: roomId, startAt: day(3, 3), endAt: day(3, 5), purpose: 'อบรม' });
    expect([r1.status, r3.status]).toEqual([201, 201]);
    a = r1.body.data.id;
    b = r3.body.data.id;
    expect(r1.body.data.status).toBe('PENDING');

    const results = await Promise.all([sciAdmin.post(`/api/v1/venue-bookings/${a}/approve`, {}), sciAdmin.post(`/api/v1/venue-bookings/${b}/approve`, {})]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('VENUE_CONFLICT');
    expect(await prisma.venueBooking.count({ where: { venueId: roomId, status: 'APPROVED' } })).toBe(1);
  });

  it('a new request for a taken slot is refused up front', async () => {
    const res = await manager.post('/api/v1/venue-bookings', { venueId: roomId, startAt: day(3, 2), endAt: day(3, 3) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VENUE_CONFLICT');
    const adjacent = await manager.post('/api/v1/venue-bookings', { venueId: roomId, startAt: day(3, 5), endAt: day(3, 6) });
    expect(adjacent.status).toBe(201); // [start, end) — touching intervals do not clash
  });

  it('the requester cannot decide their own request; rejection needs a reason', async () => {
    const own = await sciAdmin.post('/api/v1/venue-bookings', { venueId: roomId, startAt: day(4, 2), endAt: day(4, 3), purpose: 'ของตนเอง' });
    expect((await sciAdmin.post(`/api/v1/venue-bookings/${own.body.data.id}/approve`, {})).status).toBe(403);
    expect((await central.post(`/api/v1/venue-bookings/${own.body.data.id}/reject`, { note: 'x' })).status).toBe(422);
    expect((await central.post(`/api/v1/venue-bookings/${own.body.data.id}/reject`, { note: 'ใช้ห้องอื่นแทน' })).status).toBe(200);
    expect((await manager.post(`/api/v1/venue-bookings/${own.body.data.id}/approve`, {})).status).toBe(403); // no venue:approve
  });

  it('auto-approve rooms are approved immediately when free', async () => {
    const res = await manager.post('/api/v1/venue-bookings', { venueId: autoRoomId, startAt: day(5, 2), endAt: day(5, 3) });
    expect(res.body.data.status).toBe('APPROVED');
  });

  it('the requester can cancel; approvers see pending requests in their scope', async () => {
    const pending = await sciAdmin.get('/api/v1/venue-bookings?view=approve&perPage=100');
    expect(pending.body.data.some((x: { venue: { id: string } }) => x.venue.id === roomId)).toBe(true);
    const mine = await manager.get('/api/v1/venue-bookings?view=mine&perPage=100');
    const p = mine.body.data.find((x: { status: string; venue: { id: string } }) => x.status === 'PENDING' && x.venue.id === roomId);
    expect((await student.post(`/api/v1/venue-bookings/${p.id}/cancel`, {})).status).toBe(403);
    expect((await manager.post(`/api/v1/venue-bookings/${p.id}/cancel`, { note: 'ไม่ใช้แล้ว' })).status).toBe(200);
  });

  it('the database itself refuses an overlapping approval', async () => {
    const approved = await prisma.venueBooking.findFirstOrThrow({ where: { venueId: roomId, status: 'APPROVED' } });
    await expect(
      prisma.venueBooking.create({ data: { venueId: roomId, startAt: approved.startAt, endAt: approved.endAt, status: 'APPROVED', requestedById: approved.requestedById } }),
    ).rejects.toThrow();
  });
});

describe('equipment bookings', () => {
  it('approved quantities never exceed stock, even with concurrent approvals', async () => {
    const item = await sciAdmin.post('/api/v1/resources', { code: `EQ-${tag}`, nameTh: 'กล้องถ่ายภาพ', resourceType: 'อุปกรณ์ถ่ายภาพ', quantity: 3, organizationId: sciOrgId });
    expect(item.status).toBe(201);
    itemId = item.body.data.id;
    expect((await manager.post('/api/v1/resource-bookings', { resourceId: itemId, quantity: 4, startAt: day(3, 2), endAt: day(3, 4) })).status).toBe(409);
    const r1 = await manager.post('/api/v1/resource-bookings', { resourceId: itemId, quantity: 2, startAt: day(3, 2), endAt: day(3, 4) });
    const r2 = await central.post('/api/v1/resource-bookings', { resourceId: itemId, quantity: 2, startAt: day(3, 3), endAt: day(3, 5) });
    expect([r1.status, r2.status]).toEqual([201, 201]);
    const results = await Promise.all([r1, r2].map((r) => sciAdmin.post(`/api/v1/resource-bookings/${r.body.data.id}/approve`, {})));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('RESOURCE_UNAVAILABLE');

    const av = await manager.get(`/api/v1/resources/${itemId}/availability?from=${encodeURIComponent(day(3, 3))}&to=${encodeURIComponent(day(3, 4))}`);
    expect(av.body.data).toMatchObject({ quantity: 3, used: 2, available: 1 });
    // a non-overlapping slot is fully available
    const later = await manager.get(`/api/v1/resources/${itemId}/availability?from=${encodeURIComponent(day(3, 6))}&to=${encodeURIComponent(day(3, 7))}`);
    expect(later.body.data.available).toBe(3);
  });

  it('stock cannot be lowered below what is already approved', async () => {
    const res = await sciAdmin.patch(`/api/v1/resources/${itemId}`, { code: `EQ-${tag}`, nameTh: 'กล้องถ่ายภาพ', resourceType: 'อุปกรณ์ถ่ายภาพ', quantity: 1, organizationId: sciOrgId });
    expect(res.status).toBe(409);
  });

  it('the stock trigger rejects an over-allocation written directly', async () => {
    const b = await prisma.resourceBooking.findFirstOrThrow({ where: { resourceId: itemId, status: 'APPROVED' } });
    await expect(prisma.resourceBooking.create({ data: { resourceId: itemId, quantity: 2, startAt: b.startAt, endAt: b.endAt, status: 'APPROVED' } })).rejects.toThrow(/RESOURCE_STOCK/);
  });
});

describe('notifications', () => {
  it('approval requests reach the approver once, even when dispatched repeatedly', async () => {
    const res = await manager.post('/api/v1/events', {
      titleTh: `สัมมนาแจ้งเตือน ${tag}`, organizationId: sciOrgId, startAt: iso(5), endAt: iso(5.2), registrationOpenAt: iso(-1), registrationCloseAt: iso(4), capacity: 30, allowGuestRegistration: true,
    });
    expect(res.status).toBe(201);
    eventId = res.body.data.id;
    expect((await manager.post(`/api/v1/events/${eventId}/submit`)).status).toBe(200);
    await dispatch();
    await dispatch();
    const dean = await login(http, 'sci.dean');
    const items = (await inbox(dean)).data.filter((n) => n.type === 'APPROVAL_PENDING' && n.title.includes(tag));
    expect(items).toHaveLength(1);

    expect((await dean.post(`/api/v1/events/${eventId}/approve`, { comment: 'ok' })).status).toBe(200);
    await dispatch();
    const exec = await login(http, 'executive');
    expect((await inbox(exec)).data.some((n) => n.type === 'APPROVAL_PENDING' && n.title.includes(tag))).toBe(true);
    expect((await exec.post(`/api/v1/events/${eventId}/approve`, { comment: 'ok' })).status).toBe(200);
    await dispatch();
    expect((await inbox(manager)).data.some((n) => n.type === 'APPROVAL_DECIDED' && n.title.includes(tag))).toBe(true);
    expect((await manager.post(`/api/v1/events/${eventId}/publish`)).status).toBe(200);
  });

  it('registrations notify the registrant: in-app for members, e-mail for everyone', async () => {
    const mine = await student.post(`/api/v1/events/${eventId}/registrations`, { participantTypeCode: 'STUDENT', firstName: 'นักศึกษา', lastName: 'แจ้งเตือน', email: `n-${tag}@example.com`, pdpaConsent: true }, { 'Idempotency-Key': randomUUID() });
    expect(mine.status).toBe(201);
    const guestEmail = `guest-${tag.toLowerCase()}@example.com`;
    const g = await request(http).post(`/api/v1/events/${eventId}/registrations`).set('Idempotency-Key', randomUUID()).send({ participantTypeCode: 'EXTERNAL', firstName: 'แขก', lastName: 'ทดสอบ', email: guestEmail, pdpaConsent: true });
    expect(g.status).toBe(201);
    await dispatch();
    const box = await inbox(student);
    expect(box.data.some((n) => n.type === 'REGISTRATION_CONFIRMED' && n.title.includes(tag))).toBe(true);
    expect(box.meta.unread).toBeGreaterThan(0);
    const mail = await prisma.notificationLog.findMany({ where: { channel: 'EMAIL', recipient: { in: [guestEmail, `n-${tag.toLowerCase()}@example.com`] } } });
    expect(mail.map((m) => m.recipient).sort()).toEqual([`n-${tag.toLowerCase()}@example.com`, guestEmail].sort());
    expect(mail.find((m) => m.recipient === guestEmail)!.body).toContain(g.body.data.referenceNo);
  });

  it('delivers the outbox (no SMTP in tests → logged, marked sent with a note)', async () => {
    await notifications.deliverDue(500);
    const row = await prisma.notificationLog.findFirstOrThrow({ where: { recipient: `guest-${tag.toLowerCase()}@example.com` } });
    expect(row.status).toBe('SENT');
    expect(row.attempts).toBe(1);
    expect(row.error).toContain('SMTP');
  });

  it('booking requests reach the unit approvers; decisions reach the requester', async () => {
    const r = await manager.post('/api/v1/venue-bookings', { venueId: roomId, startAt: day(6, 2), endAt: day(6, 3), purpose: `แจ้งเตือน ${tag}` });
    await dispatch();
    expect((await inbox(sciAdmin)).data.some((n) => n.type === 'BOOKING_PENDING' && n.body.includes(tag))).toBe(true);
    expect((await inbox(manager)).data.some((n) => n.type === 'BOOKING_PENDING' && n.body.includes(tag))).toBe(false); // not to the requester
    await sciAdmin.post(`/api/v1/venue-bookings/${r.body.data.id}/reject`, { note: 'ห้องปิดปรับปรุง' });
    await dispatch();
    const decided = (await inbox(manager)).data.find((n) => n.type === 'BOOKING_DECIDED' && n.body.includes('ห้องปิดปรับปรุง'));
    expect(decided).toBeTruthy();
  });

  it('marks read one / all', async () => {
    const first = (await student.get('/api/v1/me/notifications?unread=true')).body.data[0];
    expect((await student.post(`/api/v1/me/notifications/${first.id}/read`)).body.data.updated).toBe(1);
    await student.post('/api/v1/me/notifications/read-all');
    expect((await student.get('/api/v1/me/notifications/unread-count')).body.data.unread).toBe(0);
  });

  it('links LINE through a signed webhook and then also notifies over LINE', async () => {
    const { code } = (await student.post('/api/v1/me/line/link-code')).body.data;
    expect(code).toMatch(/^\d{8}$/);
    const lineUserId = `U${randomUUID().replace(/-/g, '')}`;
    const body = JSON.stringify({ events: [{ type: 'message', replyToken: 'r1', source: { userId: lineUserId }, message: { type: 'text', text: code } }] });
    const bad = await request(http).post('/api/v1/public/line/webhook').set('Content-Type', 'application/json').set('X-Line-Signature', sign(body + ' ')).send(body);
    expect(bad.status).toBe(401);
    const ok = await request(http).post('/api/v1/public/line/webhook').set('Content-Type', 'application/json').set('X-Line-Signature', sign(body)).send(body);
    expect(ok.status).toBe(200);
    expect((await student.get('/api/v1/me/notification-preferences')).body.data.lineLinked).toBe(true);
    // the code is single-use
    await request(http).post('/api/v1/public/line/webhook').set('Content-Type', 'application/json').set('X-Line-Signature', sign(body)).send(body);
    expect(line.outbox.at(-1)!.text).toContain('ไม่ถูกต้อง');

    const sid = (await prisma.user.findFirstOrThrow({ where: { username: 'student' } })).id;
    await notifications.notify({ code: 'EVENT_REMINDER', dedupe: `e2e:${tag}:line`, recipients: [{ userId: sid }], vars: { eventTitle: `LINE ${tag}` } });
    await notifications.deliverDue(500);
    expect(line.outbox.some((m) => m.to === lineUserId && m.text.includes(`LINE ${tag}`))).toBe(true);
  });

  it('respects e-mail preference', async () => {
    await student.put('/api/v1/me/notification-preferences', { email: false });
    const sid = (await prisma.user.findFirstOrThrow({ where: { username: 'student' } })).id;
    await notifications.notify({ code: 'EVENT_REMINDER', dedupe: `e2e:${tag}:pref`, recipients: [{ userId: sid }], vars: { eventTitle: 'x' } });
    expect(await prisma.notificationLog.count({ where: { dedupeKey: { startsWith: `e2e:${tag}:pref` }, channel: 'EMAIL' } })).toBe(0);
    expect(await prisma.notification.count({ where: { dedupeKey: `e2e:${tag}:pref:${sid}` } })).toBe(1);
    await student.put('/api/v1/me/notification-preferences', { email: true });
  });

  it('sends the day-before reminder once', async () => {
    await prisma.event.update({ where: { id: eventId }, data: { startAt: new Date(Date.now() + 3 * 3600_000), endAt: new Date(Date.now() + 6 * 3600_000) } });
    await prisma.registration.updateMany({ where: { eventId }, data: { createdAt: new Date(Date.now() - 5 * 3600_000) } });
    await dispatcher.reminders();
    await dispatcher.reminders();
    const regs = await prisma.registration.findMany({ where: { eventId }, select: { id: true } });
    const reminders = await prisma.notificationLog.count({ where: { templateCode: 'EVENT_REMINDER', dedupeKey: { startsWith: 'reminder:' }, OR: regs.map((r) => ({ dedupeKey: { startsWith: `reminder:${r.id}:` } })) } });
    expect(reminders).toBe(regs.length * 1 + 1); // one e-mail each + LINE for the linked student
  });

  it('cancelling an event releases its bookings and tells registrants', async () => {
    const booking = await manager.post('/api/v1/venue-bookings', { venueId: autoRoomId, eventId, startAt: day(7, 2), endAt: day(7, 3) });
    expect(booking.body.data.status).toBe('APPROVED');
    expect((await manager.post(`/api/v1/events/${eventId}/cancel`, { reason: 'วิทยากรติดภารกิจ' })).status).toBe(200);
    expect((await prisma.venueBooking.findUniqueOrThrow({ where: { id: booking.body.data.id } })).status).toBe('CANCELLED');
    await dispatch();
    expect((await inbox(student)).data.some((n) => n.type === 'EVENT_CANCELLED' && n.body.includes('วิทยากรติดภารกิจ'))).toBe(true);
  });

  it('admins see the delivery log; others cannot; failed rows can be retried', async () => {
    expect((await student.get('/api/v1/notification-logs')).status).toBe(403);
    const logs = await sysadmin.get(`/api/v1/notification-logs?search=${tag.toLowerCase()}`);
    expect(logs.status).toBe(200);
    expect(logs.body.meta.counts).toBeTruthy();
    const row = await prisma.notificationLog.create({ data: { channel: 'EMAIL', templateCode: 'EVENT_REMINDER', recipient: `fail-${tag}@example.com`, body: 'x', status: 'FAILED', attempts: 5 } });
    expect((await sysadmin.post(`/api/v1/notification-logs/${row.id}/retry`)).status).toBe(200);
    expect((await prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('QUEUED');
  });

  it('templates can be overridden per channel', async () => {
    const t = await sysadmin.put('/api/v1/notification-templates/EVENT_REMINDER/IN_APP', { subject: 'เตือน {eventTitle} (ปรับแล้ว)', body: 'ข้อความใหม่' });
    expect(t.status).toBe(200);
    // cached for up to a minute in the service — read through a fresh render by clearing the cache
    (notifications as unknown as { overrides: null }).overrides = null;
    const sid = (await prisma.user.findFirstOrThrow({ where: { username: 'student' } })).id;
    await notifications.notify({ code: 'EVENT_REMINDER', dedupe: `e2e:${tag}:tpl`, recipients: [{ userId: sid }], vars: { eventTitle: 'ABC' } });
    expect((await prisma.notification.findUniqueOrThrow({ where: { dedupeKey: `e2e:${tag}:tpl:${sid}` } })).title).toBe('เตือน ABC (ปรับแล้ว)');
    await prisma.notificationTemplate.delete({ where: { code_channel: { code: 'EVENT_REMINDER', channel: 'IN_APP' } } });
  });
});
