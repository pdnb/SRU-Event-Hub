import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { iso, login, PASSWORD, type Session } from './helpers';

/**
 * Reports and dashboard tasks (spec §4.14 — P5c): data scope (a unit sees only its events, the
 * executive sees all), exact per-event metrics, period filters, finance permission, Excel export,
 * and the "waiting for you" counts matching what each role can act on.
 */
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let manager: Session;
let saManager: Session;
let executive: Session;
let staff: Session;
let student: Session;
let sciAdmin: Session;
let dean: Session;
let eventId: string;
let sciOrgId: string;
const tag = randomUUID().slice(0, 8);
const regIds: string[] = [];
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  if (!PASSWORD) throw new Error('SEED_DEMO_PASSWORD must be set for e2e tests');
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  prisma = app.get(PrismaService);
  [manager, saManager, executive, staff, student, sciAdmin, dean] = await Promise.all(['sci.manager', 'sa.manager', 'executive', 'staff', 'student', 'sci.admin', 'sci.dean'].map((u) => login(http, u)));
  sciOrgId = (await prisma.organization.findFirstOrThrow({ where: { code: 'SCI' } })).id;
});

afterAll(async () => {
  await app?.close();
});

describe('setup', () => {
  it('runs an SCI event: 4 confirmed, 3 checked in, then it ends', async () => {
    const res = await manager.post('/api/v1/events', {
      titleTh: `รายงาน E2E ${tag}`, organizationId: sciOrgId, startAt: iso(30 / 1440), endAt: iso(0.2), registrationOpenAt: iso(-1), registrationCloseAt: iso(20 / 1440), capacity: 50, allowGuestRegistration: true,
    });
    eventId = res.body.data.id;
    expect((await manager.post(`/api/v1/events/${eventId}/submit`)).status).toBe(200);

    // While it waits for approval, the approver sees it as a task.
    const tasks = await dean.get('/api/v1/dashboard/tasks');
    expect(tasks.body.data.find((t: { key: string }) => t.key === 'approvals')?.count).toBeGreaterThanOrEqual(1);

    for (const u of [dean, executive]) expect((await u.post(`/api/v1/events/${eventId}/approve`, { comment: 'ok' })).status).toBe(200);
    expect((await manager.post(`/api/v1/events/${eventId}/publish`)).status).toBe(200);
    for (const n of ['a', 'b', 'c', 'd']) {
      const r = await request(http).post(`/api/v1/events/${eventId}/registrations`).set('Idempotency-Key', randomUUID()).send({ participantTypeCode: 'EXTERNAL', firstName: 'รายงาน', lastName: n, email: `rp-${tag}-${n}@example.com`, affiliation: `โรงเรียนรายงาน ${tag}`, pdpaConsent: true });
      expect(r.status).toBe(201);
      regIds.push(r.body.data.id);
    }
    for (const id of regIds.slice(0, 3)) expect((await staff.post(`/api/v1/events/${eventId}/checkin/manual`, { registrationId: id })).status).toBe(200);
    // The event took place (moved into the past, still inside the current fiscal year).
    const start = new Date(Date.now() - 3 * 3600_000);
    await prisma.event.update({ where: { id: eventId }, data: { startAt: start, endAt: new Date(Date.now() - 3600_000), status: 'COMPLETED' } });
  });
});

describe('reports', () => {
  it('requires report:view', async () => {
    expect((await student.get('/api/v1/reports/overview')).status).toBe(403);
    expect((await staff.get('/api/v1/reports/overview')).status).toBe(403);
  });

  it('per-event metrics are exact', async () => {
    const res = await manager.get(`/api/v1/reports/events?search=${tag}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: eventId, confirmed: 4, attended: 3, attendanceRate: 75, collected: 0, certificates: 0, responses: 0, satisfaction: null, organizationName: 'คณะวิทยาศาสตร์และเทคโนโลยี' });
  });

  it('a unit sees only its own events; the executive sees every unit', async () => {
    expect((await saManager.get(`/api/v1/reports/events?search=${tag}`)).body.data).toHaveLength(0);
    expect((await executive.get(`/api/v1/reports/events?search=${tag}`)).body.data).toHaveLength(1);
    const sci = await manager.get('/api/v1/reports/overview');
    const orgs: { id: string }[] = sci.body.data.byOrganization;
    const allowed = new Set((await prisma.$queryRaw<{ id: string }[]>`WITH RECURSIVE t AS (SELECT id FROM organizations WHERE id = ${sciOrgId}::uuid UNION SELECT o.id FROM organizations o JOIN t ON o.parent_id = t.id) SELECT id::text FROM t`).map((r) => r.id));
    expect(orgs.every((o) => allowed.has(o.id))).toBe(true);
    const all = await executive.get('/api/v1/reports/overview');
    expect(all.body.data.kpis.events).toBeGreaterThanOrEqual(sci.body.data.kpis.events);
  });

  it('overview includes the event in KPIs, the monthly trend and breakdowns', async () => {
    const res = await manager.get(`/api/v1/reports/overview?organizationId=${sciOrgId}`);
    const d = res.body.data;
    expect(d.kpis.confirmed).toBeGreaterThanOrEqual(4);
    expect(d.kpis.attended).toBeGreaterThanOrEqual(3);
    expect(d.kpis.uniqueParticipants).toBeGreaterThanOrEqual(4);
    const month = new Date(Date.now() - 3 * 3600_000 + 7 * 3600_000).toISOString().slice(0, 7); // Asia/Bangkok month
    expect(d.trend.find((t: { month: string }) => t.month === month)?.confirmed).toBeGreaterThanOrEqual(4);
    expect(d.byParticipantType.find((t: { name: string }) => t.name === 'บุคคลภายนอก')).toBeTruthy();
  });

  it('a period without the event does not count it', async () => {
    const res = await manager.get(`/api/v1/reports/events?search=${tag}&fiscalYear=2565`);
    expect(res.body.data).toHaveLength(0);
    expect((await manager.get('/api/v1/reports/overview?from=2026-01-01T00:00:00Z&to=2025-01-01T00:00:00Z')).status).toBe(422);
  });

  it('participants: unique people and top affiliations', async () => {
    const res = await manager.get(`/api/v1/reports/participants?organizationId=${sciOrgId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.topAffiliations.some((a: { name: string; people: number }) => a.name === `โรงเรียนรายงาน ${tag}` && a.people === 4)).toBe(true);
  });

  it('finance needs payment:view as well', async () => {
    expect((await manager.get('/api/v1/reports/finance')).status).toBe(200);
    const fin = (await executive.get('/api/v1/reports/finance')).body.data;
    expect(fin.totals).toHaveProperty('net');
    expect(fin.outstanding).toHaveProperty('slipsPending');
  });

  it('exports Excel (audited)', async () => {
    const x = await manager.get(`/api/v1/reports/events/export?search=${tag}`).buffer(true).parse(binary);
    expect(x.status).toBe(200);
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect(await prisma.auditLog.count({ where: { action: 'report.export', actorId: (await prisma.user.findFirstOrThrow({ where: { username: 'sci.manager' } })).id } })).toBeGreaterThan(0);
  });
});

describe('dashboard tasks', () => {
  it('shows each role only what it can act on', async () => {
    const venue = await prisma.venue.findFirstOrThrow({ where: { code: 'SCI-LAB1' } });
    const b = await manager.post('/api/v1/venue-bookings', { venueId: venue.id, startAt: iso(40), endAt: iso(40.1), purpose: `แดชบอร์ด ${tag}` });
    expect(b.status).toBe(201);
    const admin = (await sciAdmin.get('/api/v1/dashboard/tasks')).body.data as { key: string; count: number; href: string }[];
    expect(admin.find((t) => t.key === 'bookings')?.count).toBeGreaterThanOrEqual(1);
    expect(admin.find((t) => t.key === 'bookings')?.href).toBe('/admin/venues?tab=approve');
    // the requester is not asked to approve their own request
    expect(((await manager.get('/api/v1/dashboard/tasks')).body.data as { key: string }[]).some((t) => t.key === 'bookings')).toBe(false);
    // a student has nothing to do in the back office
    expect((await student.get('/api/v1/dashboard/tasks')).body.data).toEqual([]);
    // finished event with registrants and no certificate template → reminder for the organiser
    expect(((await manager.get('/api/v1/dashboard/tasks')).body.data as { key: string }[]).some((t) => t.key === 'certificates')).toBe(true);
    await manager.post(`/api/v1/venue-bookings/${b.body.data.id}/cancel`, {});
  });
});
