import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/main';

/**
 * End-to-end tests over real HTTP + PostgreSQL. Requires `pnpm infra:up`,
 * migrations and the demo seed (SEED_DEMO_PASSWORD in apps/api/.env).
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD!;
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;

interface Session {
  cookies: string[];
  csrf: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object, headers?: Record<string, string>) => request.Test;
  patch: (url: string, body?: object) => request.Test;
}

async function login(username: string): Promise<Session> {
  const res = await request(http).post('/api/v1/auth/login').send({ username, password: PASSWORD });
  expect(res.status).toBe(200);
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]!);
  const csrf = cookies.find((c) => c.startsWith('sru_csrf='))!.split('=')[1]!;
  const withAuth = (t: request.Test) => t.set('Cookie', cookies.join('; ')).set('X-CSRF-Token', csrf);
  return {
    cookies,
    csrf,
    get: (url) => withAuth(request(http).get(url)),
    post: (url, body = {}, headers = {}) => withAuth(request(http).post(url)).set(headers).send(body),
    patch: (url, body = {}) => withAuth(request(http).patch(url)).send(body),
  };
}

const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86400_000).toISOString();

beforeAll(async () => {
  if (!PASSWORD) throw new Error('SEED_DEMO_PASSWORD must be set for e2e tests');
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});

afterAll(async () => {
  await app?.close();
});

describe('auth', () => {
  it('rejects wrong passwords with a generic message', async () => {
    const res = await request(http).post('/api/v1/auth/login').send({ username: 'student', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'INVALID_CREDENTIALS' } });
  });

  it('logs in with httpOnly cookies and returns profile + permissions', async () => {
    const s = await login('sci.manager');
    expect(s.cookies.some((c) => c.startsWith('sru_at='))).toBe(true);
    const me = await s.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).toContain('event:create');
    expect(me.body.data.permissions).not.toContain('user:create');
  });

  it('rejects cookie-authenticated writes without the CSRF header', async () => {
    const s = await login('sci.manager');
    const res = await request(http).post('/api/v1/events').set('Cookie', s.cookies.join('; ')).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const s = await login('student');
    const rt = s.cookies.find((c) => c.startsWith('sru_rt='))!;
    const cookie = [rt, `sru_csrf=${s.csrf}`].join('; ');
    const first = await request(http).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-CSRF-Token', s.csrf);
    expect(first.status).toBe(200);
    const reuse = await request(http).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-CSRF-Token', s.csrf);
    expect(reuse.status).toBe(401);
    // the rotated (new) token is now revoked as well
    const newRt = ([] as string[]).concat(first.headers['set-cookie']).map((c) => c.split(';')[0]!).find((c) => c.startsWith('sru_rt='))!;
    const after = await request(http).post('/api/v1/auth/refresh').set('Cookie', [newRt, `sru_csrf=${s.csrf}`].join('; ')).set('X-CSRF-Token', s.csrf);
    expect(after.status).toBe(401);
  });

  it('enforces permissions on the backend', async () => {
    const s = await login('student');
    expect((await s.get('/api/v1/users')).status).toBe(403);
    expect((await s.post('/api/v1/events', {})).status).toBe(403);
  });
});

describe('event lifecycle with approval workflow', () => {
  let manager: Session;
  let eventId: string;

  beforeAll(async () => {
    manager = await login('sci.manager');
  });

  // Keep the demo portal clean: cancelled events are not publicly listed.
  afterAll(async () => {
    if (eventId) await manager.post(`/api/v1/events/${eventId}/cancel`, { reason: 'ข้อมูลทดสอบอัตโนมัติ (e2e)' });
  });

  it('creates a draft event with a running code', async () => {
    const orgs = await request(http).get('/api/v1/organizations');
    const sci = orgs.body.data.find((o: { code: string }) => o.code === 'SCI');
    const res = await manager.post('/api/v1/events', {
      titleTh: `กิจกรรมทดสอบ E2E ${randomUUID().slice(0, 8)}`,
      organizationId: sci.id,
      startAt: iso(10),
      endAt: iso(10.2),
      registrationOpenAt: iso(-1),
      registrationCloseAt: iso(9),
      capacity: 3,
      allowGuestRegistration: true,
      allowWaitlist: true,
      registrationFields: [
        { key: 'shirt', labelTh: 'ขนาดเสื้อ', fieldType: 'SELECT', isRequired: true, options: [{ value: 'M', labelTh: 'M' }, { value: 'L', labelTh: 'L' }] },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^EVT-\d{4}-\d{6}$/);
    eventId = res.body.data.id;
  });

  it('cannot be published before approval', async () => {
    const res = await manager.post(`/api/v1/events/${eventId}/publish`);
    expect(res.status).toBe(409);
  });

  it('runs the configured steps: org head → central approver (finance step skipped for free events)', async () => {
    expect((await manager.post(`/api/v1/events/${eventId}/submit`)).status).toBe(200);

    // proposer cannot approve own event (separation of duties)
    const central = await login('executive');
    const early = await central.post(`/api/v1/events/${eventId}/approve`);
    expect(early.status).toBe(403); // not the approver of step 1

    const dean = await login('sci.dean');
    const pending = await dean.get('/api/v1/approvals/pending');
    expect(pending.body.data.some((p: { event: { id: string } }) => p.event.id === eventId)).toBe(true);
    const s1 = await dean.post(`/api/v1/events/${eventId}/approve`, { comment: 'เห็นควรอนุมัติ' });
    expect(s1.status).toBe(200);
    expect(s1.body.data.requestStatus).toBe('PENDING');

    const s3 = await central.post(`/api/v1/events/${eventId}/approve`);
    expect(s3.status).toBe(200);
    expect(s3.body.data.requestStatus).toBe('APPROVED');

    const history = await manager.get(`/api/v1/events/${eventId}/approval-history`);
    expect(history.body.data[0].actions.map((a: { action: string }) => a.action)).toEqual(['SUBMIT', 'APPROVE', 'APPROVE']);
  });

  it('publishes and appears on the public portal as open', async () => {
    expect((await manager.post(`/api/v1/events/${eventId}/publish`)).status).toBe(200);
    const pub = await request(http).get(`/api/v1/public/events/${eventId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.registrationOpen).toBe(true);
    expect(pub.body.data.budget).toBeNull();
  });

  describe('registration', () => {
    const body = (email: string) => ({
      participantTypeCode: 'EXTERNAL',
      firstName: 'ทดสอบ',
      lastName: 'ระบบ',
      email,
      answers: [{ key: 'shirt', value: 'M' }],
      pdpaConsent: true,
    });

    it('requires an Idempotency-Key and replays retries without double-booking', async () => {
      const url = `/api/v1/events/${eventId}/registrations`;
      expect((await request(http).post(url).send(body('a@example.com'))).status).toBe(400);

      const key = randomUUID();
      const first = await request(http).post(url).set('Idempotency-Key', key).send(body('a@example.com'));
      expect(first.status).toBe(201);
      expect(first.body.data.status).toBe('CONFIRMED');
      const retry = await request(http).post(url).set('Idempotency-Key', key).send(body('a@example.com'));
      expect(retry.status).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.body.data.id).toBe(first.body.data.id);
    });

    it('validates organizer-defined fields', async () => {
      const res = await request(http)
        .post(`/api/v1/events/${eventId}/registrations`)
        .set('Idempotency-Key', randomUUID())
        .send({ ...body('b@example.com'), answers: [{ key: 'shirt', value: 'XXL' }] });
      expect(res.status).toBe(422);
      expect(res.body.error.details.shirt).toBeDefined();
    });

    it('rejects duplicate e-mail for the same event (case-insensitive)', async () => {
      const res = await request(http).post(`/api/v1/events/${eventId}/registrations`).set('Idempotency-Key', randomUUID()).send(body('A@Example.com'));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_REGISTRATION');
    });

    it('never overbooks under concurrency; extra registrants are waitlisted', async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          request(http).post(`/api/v1/events/${eventId}/registrations`).set('Idempotency-Key', randomUUID()).send(body(`c${i}@example.com`)),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      const confirmed = results.filter((r) => r.body.data.status === 'CONFIRMED').length;
      const waitlisted = results.filter((r) => r.body.data.status === 'WAITLISTED').length;
      expect(confirmed).toBe(2); // capacity 3, one already taken
      expect(waitlisted).toBe(10);
      const ev = await manager.get(`/api/v1/events/${eventId}`);
      expect(ev.body.data.seatsTaken).toBe(3);
    });

    it('cancel by token releases the seat and promotes the first waitlisted registrant', async () => {
      const reg = await request(http).post(`/api/v1/events/${eventId}/registrations`).set('Idempotency-Key', randomUUID()).send(body('late@example.com'));
      expect(reg.body.data.status).toBe('WAITLISTED');

      const list = await manager.get(`/api/v1/events/${eventId}/registrations?status=CONFIRMED&perPage=100`);
      expect(list.body.meta.statusCounts.CONFIRMED).toBe(3);

      // the first registrant cancels via their lookup token
      const first = await request(http)
        .post(`/api/v1/events/${eventId}/registrations`)
        .set('Idempotency-Key', randomUUID())
        .send(body('token-user@example.com'));
      expect(first.body.data.status).toBe('WAITLISTED');
      const lookup = await request(http).post('/api/v1/public/registrations/lookup').send({ referenceNo: first.body.data.referenceNo, token: first.body.data.accessToken });
      expect(lookup.status).toBe(200);
      expect(lookup.body.data.waitlistPosition).toBe(12);

      const confirmedReg = list.body.data[0];
      const cancel = await manager.post(`/api/v1/registrations/${confirmedReg.id}/cancel`, { reason: 'ทดสอบ' });
      expect(cancel.status).toBe(200);
      expect(cancel.body.data.promotedFromWaitlist).toBe(1);
      const ev = await manager.get(`/api/v1/events/${eventId}`);
      expect(ev.body.data.seatsTaken).toBe(3);
    });

    it('exports registrations as xlsx', async () => {
      const res = await manager.get(`/api/v1/events/${eventId}/registrations/export?format=xlsx`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
    });
  });
});
