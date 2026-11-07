import { request } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const USERS = ['sci.manager', 'sci.dean', 'executive', 'sci.admin', 'student'] as const;
export const AUTH_DIR = join(__dirname, '.auth');

/**
 * Logs every demo user in once per run and saves the session (cookies) to e2e/.auth/<user>.json.
 * Login is rate-limited (10/min per IP), so tests reuse these sessions instead of logging in.
 */
export default async function globalSetup() {
  const api = (process.env.E2E_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) throw new Error('SEED_DEMO_PASSWORD must be set (repository .env) for browser e2e tests');
  mkdirSync(AUTH_DIR, { recursive: true });
  for (const username of USERS) {
    const ctx = await request.newContext();
    const res = await ctx.post(`${api}/api/v1/auth/login`, { data: { username, password } });
    if (res.status() !== 200) throw new Error(`login ${username} failed: ${res.status()} ${(await res.text()).slice(0, 200)}`);
    writeFileSync(join(AUTH_DIR, `${username}.json`), JSON.stringify(await ctx.storageState()));
    await ctx.dispose();
  }
}
