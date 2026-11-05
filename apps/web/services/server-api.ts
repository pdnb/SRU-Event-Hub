import 'server-only';
import type { EventDetailDto, EventSummaryDto, PageMeta } from '@sru/shared-types';

/** Server-side base URL: inside Docker the API is reached directly, not through Nginx. */
const BASE = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

async function get<T>(path: string, revalidate = 30): Promise<{ data: T; meta?: PageMeta } | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { next: { revalidate } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (await res.json()) as { data: T; meta?: PageMeta };
  } catch (e) {
    console.error('[server-api]', path, e);
    return null;
  }
}

export const serverApi = {
  events: (qs: string) => get<EventSummaryDto[]>(`/public/events?${qs}`),
  event: (idOrCode: string) => get<EventDetailDto>(`/public/events/${encodeURIComponent(idOrCode)}`, 15),
};
