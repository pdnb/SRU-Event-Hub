'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { isNetworkError } from '@/features/finance/offline-cash';
import { api } from '@/services/api';

/**
 * Offline check-in (same approach as FIN-12 at the cash point).
 *
 * While online the desk keeps a roster of the event's registrants with the SHA-256 of each QR token
 * (never the token itself). When the network drops, a scanned QR is hashed in the browser and
 * matched against the roster, and the check-in is queued locally with its own client key and the
 * time it happened. When the network returns, the queue is replayed through /checkin/sync; the
 * client key makes a replay that already reached the server count once.
 *
 * Privacy: the roster holds names and reference numbers only, per event, and can be cleared from
 * the desk. It is refreshed every 5 minutes while online.
 */

export interface OfflineRegistrant {
  id: string;
  referenceNo: string;
  fullName: string;
  status: string;
  participantType: string;
  affiliation: string | null;
  groupNo: string | null;
  tokenHash: string;
  checkedInAt: string | null;
}
interface Pack {
  generatedAt: string;
  truncated: boolean;
  registrants: OfflineRegistrant[];
}
export interface QueuedCheckin {
  clientKey: string;
  registrationId: string;
  fullName: string;
  referenceNo: string;
  occurredAt: string;
  locationId?: string;
  scheduleId?: string;
  state: 'pending' | 'failed';
  error?: string;
}

const packKey = (id: string) => `sru-checkin-pack:${id}`;
const queueKey = (id: string) => `sru-checkin-queue:${id}`;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / blocked: offline mode is simply unavailable */
  }
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Same rules as the server's parseQr: "SRU1.<22 chars>" or the bare token. */
export function tokenFromQr(raw: string): string | null {
  const s = raw.trim();
  const t = s.toUpperCase().startsWith('SRU1.') ? s.slice(5) : s;
  return /^[A-Za-z0-9_-]{22}$/.test(t) ? t : null;
}

export const newClientKey = () => `ck-${crypto.randomUUID()}`;

export function useOfflineCheckin(eventId: string, enabled: boolean) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [stored, setStored] = useState<Pack | null>(() => (typeof window === 'undefined' ? null : load<Pack | null>(packKey(eventId), null)));
  const [queue, setQueue] = useState<QueuedCheckin[]>(() => (typeof window === 'undefined' ? [] : load<QueuedCheckin[]>(queueKey(eventId), [])));
  const [syncing, setSyncing] = useState(false);

  const writeQueue = useCallback(
    (next: QueuedCheckin[]) => {
      setQueue(next);
      save(queueKey(eventId), next.length ? next : null);
    },
    [eventId],
  );

  const fresh = useQuery({
    queryKey: ['checkin-offline-pack', eventId],
    enabled: enabled && online,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const p = await api.get<Pack>(`/events/${eventId}/checkin/offline-pack`);
      save(packKey(eventId), p);
      return p;
    },
  });
  const pack = fresh.data ?? stored;

  /** Looks a scanned code up in the local roster. */
  const lookup = useCallback(
    async (code: string) => {
      const token = tokenFromQr(code);
      if (!token || !pack) return null;
      const hash = await sha256Hex(token);
      return pack.registrants.find((r) => r.tokenHash === hash) ?? null;
    },
    [pack],
  );

  const alreadyQueued = useCallback((registrationId: string) => queue.some((q) => q.registrationId === registrationId), [queue]);

  const enqueue = useCallback(
    (r: OfflineRegistrant, point: { locationId?: string; scheduleId?: string }) => {
      const item: QueuedCheckin = { clientKey: newClientKey(), registrationId: r.id, fullName: r.fullName, referenceNo: r.referenceNo, occurredAt: new Date().toISOString(), ...point, state: 'pending' };
      writeQueue([...load<QueuedCheckin[]>(queueKey(eventId), []), item]);
      return item;
    },
    [eventId, writeQueue],
  );

  const sync = useCallback(async () => {
    const items = load<QueuedCheckin[]>(queueKey(eventId), []);
    const pending = items.filter((i) => i.state === 'pending');
    if (!pending.length) return { synced: 0, failed: items.filter((i) => i.state === 'failed').length };
    setSyncing(true);
    try {
      const res = await api.post<{ results: { clientKey: string; outcome?: string; error?: { message: string } }[] }>(`/events/${eventId}/checkin/sync`, {
        items: pending.map(({ clientKey, registrationId, occurredAt, locationId, scheduleId }) => ({ clientKey, registrationId, occurredAt, locationId, scheduleId })),
      });
      const byKey = new Map(res.results.map((r) => [r.clientKey, r]));
      const next = items
        .map((i) => {
          const r = byKey.get(i.clientKey);
          if (!r) return i;
          return r.error ? { ...i, state: 'failed' as const, error: r.error.message } : null;
        })
        .filter((i): i is QueuedCheckin => i !== null);
      writeQueue(next);
      return { synced: res.results.filter((r) => !r.error).length, failed: next.filter((i) => i.state === 'failed').length };
    } catch (e) {
      if (isNetworkError(e)) return { synced: 0, failed: 0 };
      throw e;
    } finally {
      setSyncing(false);
    }
  }, [eventId, writeQueue]);

  const dismiss = useCallback((key: string) => writeQueue(load<QueuedCheckin[]>(queueKey(eventId), []).filter((i) => i.clientKey !== key)), [eventId, writeQueue]);

  const clear = useCallback(() => {
    save(packKey(eventId), null);
    setStored(null);
  }, [eventId]);

  return { online, pack, queue, syncing, lookup, alreadyQueued, enqueue, sync, dismiss, clear };
}
