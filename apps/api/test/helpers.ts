import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

export const PASSWORD = process.env.SEED_DEMO_PASSWORD!;

export interface Session {
  cookies: string[];
  csrf: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object, headers?: Record<string, string>) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  /** multipart POST with one file field named `file`. */
  upload: (url: string, file: Buffer, filename: string, fields?: Record<string, string>) => request.Test;
}

export async function login(http: ReturnType<INestApplication['getHttpServer']>, username: string): Promise<Session> {
  const res = await request(http).post('/api/v1/auth/login').send({ username, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status}`);
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]!);
  const csrf = cookies.find((c) => c.startsWith('sru_csrf='))!.split('=')[1]!;
  const withAuth = (t: request.Test) => t.set('Cookie', cookies.join('; ')).set('X-CSRF-Token', csrf);
  return {
    cookies,
    csrf,
    get: (url) => withAuth(request(http).get(url)),
    post: (url, body = {}, headers = {}) => withAuth(request(http).post(url)).set(headers).send(body),
    patch: (url, body = {}) => withAuth(request(http).patch(url)).send(body),
    upload: (url, file, filename, fields = {}) => {
      let t = withAuth(request(http).post(url));
      for (const [k, v] of Object.entries(fields)) t = t.field(k, v);
      return t.attach('file', file, filename);
    },
  };
}

export const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86400_000).toISOString();

/** A tiny but genuinely PNG-signed buffer; `seed` makes the bytes (and SHA-256) unique. */
export const fakePng = (seed: string) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`IHDR-${seed}-${Date.now()}`)]);
