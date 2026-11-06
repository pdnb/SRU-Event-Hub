import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { MailService } from '../src/common/mail.service';
import { createApp } from '../src/main';

/** Self sign-up + e-mail verification (P3b). SMTP is not configured in tests → mails land in the outbox. */
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let mail: MailService;
const email = `signup-${randomUUID().slice(0, 8)}@example.com`;
const password = 'Coordinator#2569';
const tokenFrom = (text: string) => /#token=([A-Za-z0-9_-]+)/.exec(text)?.[1];

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  mail = app.get(MailService);
});

afterAll(async () => {
  await app?.close();
});

describe('self sign-up', () => {
  it('is advertised on /auth/providers', async () => {
    expect((await request(http).get('/api/v1/auth/providers')).body.data.selfRegistration).toBe(true);
  });

  it('rejects university addresses (they use Google SSO) and short passwords', async () => {
    expect((await request(http).post('/api/v1/auth/register').send({ email: 'someone@sru.ac.th', password, displayName: 'บุคลากร' })).body.error.code).toBe('USE_SSO');
    expect((await request(http).post('/api/v1/auth/register').send({ email, password: 'short', displayName: 'ครู' })).status).toBe(422);
  });

  it('creates an unverified account and e-mails a verification link', async () => {
    const res = await request(http).post('/api/v1/auth/register').send({ email, password, displayName: 'ครูผู้ประสาน ทดสอบ', phone: '0812345678' });
    expect(res.status).toBe(202);
    const sent = mail.outbox.filter((m) => m.to === email);
    expect(sent).toHaveLength(1);
    expect(tokenFrom(sent[0]!.text)).toBeTruthy();
  });

  it('cannot log in before verifying (clear error once the password is right)', async () => {
    const bad = await request(http).post('/api/v1/auth/login').send({ username: email, password: 'Wrong#password1' });
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    const res = await request(http).post('/api/v1/auth/login').send({ username: email, password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('signing up again with the same address gives the same answer (no enumeration) and no extra mail within 2 min', async () => {
    const before = mail.outbox.length;
    const res = await request(http).post('/api/v1/auth/register').send({ email, password: 'Another#pass2569', displayName: 'x x' });
    expect(res.status).toBe(202);
    expect(mail.outbox.length).toBe(before);
  });

  it('verifies with the link once; then the user can log in and create a participant organization', async () => {
    const token = tokenFrom(mail.outbox.filter((m) => m.to === email)[0]!.text)!;
    expect((await request(http).post('/api/v1/auth/verify-email').send({ token: 'x'.repeat(40) })).body.error.code).toBe('INVALID_TOKEN');
    const ok = await request(http).post('/api/v1/auth/verify-email').send({ token });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ verified: true, email });
    expect((await request(http).post('/api/v1/auth/verify-email').send({ token })).status).toBe(400);

    const res = await request(http).post('/api/v1/auth/login').send({ username: email, password });
    expect(res.status).toBe(200);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]!);
    const csrf = cookies.find((c) => c.startsWith('sru_csrf='))!.split('=')[1]!;
    const org = await request(http)
      .post('/api/v1/participant-orgs')
      .set('Cookie', cookies.join('; '))
      .set('X-CSRF-Token', csrf)
      .send({ nameTh: 'โรงเรียนผู้สมัครเอง', orgType: 'SCHOOL' });
    expect(org.status).toBe(201);
  });
});
