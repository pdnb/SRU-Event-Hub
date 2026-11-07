import { expect, request, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTH_DIR, type USERS } from './global-setup';

export const API = (process.env.E2E_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
type DemoUser = (typeof USERS)[number];

const state = (username: DemoUser) => JSON.parse(readFileSync(join(AUTH_DIR, `${username}.json`), 'utf8')) as { cookies: { name: string; value: string }[] };

/** An API client using a demo user's saved session (cookies + CSRF header), for test setup. */
export async function apiAs(username: DemoUser): Promise<APIRequestContext> {
  const s = state(username);
  const csrf = s.cookies.find((c) => c.name === 'sru_csrf')!.value;
  return request.newContext({ baseURL: `${API}/api/v1/`, storageState: join(AUTH_DIR, `${username}.json`), extraHTTPHeaders: { 'X-CSRF-Token': csrf } });
}

/** Signs the browser context in with the saved session (cookies are per host, so :3000 sends them to :4000 too). */
export async function loginBrowser(context: BrowserContext, username: DemoUser) {
  await context.addCookies(state(username).cookies as Parameters<BrowserContext['addCookies']>[0]);
}

const iso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

/** Creates, approves and publishes an SCI event open for guest registration. */
export async function publishedEvent(title: string) {
  const manager = await apiAs('sci.manager');
  const orgs = (await (await manager.get('organizations')).json()).data as { id: string; code: string }[];
  const sci = orgs.find((o) => o.code === 'SCI')!;
  const created = await manager.post('events', {
    data: { titleTh: title, organizationId: sci.id, startAt: iso(7 * 1440), endAt: iso(7 * 1440 + 180), registrationOpenAt: iso(-60), registrationCloseAt: iso(6 * 1440), capacity: 30, allowGuestRegistration: true, venueText: 'ห้องประชุม 201' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const event = (await created.json()).data as { id: string; code: string };
  expect((await manager.post(`events/${event.id}/submit`)).status()).toBe(200);
  for (const u of ['sci.dean', 'executive'] as const) {
    const a = await apiAs(u);
    expect((await a.post(`events/${event.id}/approve`, { data: { comment: 'ok' } })).status()).toBe(200);
    await a.dispose();
  }
  expect((await manager.post(`events/${event.id}/publish`)).status()).toBe(200);
  await manager.dispose();
  return event;
}

/** Collects React hydration errors and uncaught exceptions on the page. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Hydration|did not match/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}
