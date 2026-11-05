'use client';

import { ApiError, newIdempotencyKey } from '@sru/api-client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { api } from '@/services/api';
import type { PayableDto } from './types';

/**
 * FIN-12 offline capture at the cash point.
 *
 * While online the page keeps a copy of every unpaid order of the event (amounts are the backend
 * snapshots). When the network drops, a collection is queued locally with its own Idempotency-Key
 * and the time the cash was taken; when the network returns the queue is replayed in order with the
 * same keys, so a request that did reach the server is never booked twice. Collections the server
 * refuses (e.g. the order was paid by transfer meanwhile) stay in the list marked failed, for
 * finance to settle the cash by hand.
 *
 * Privacy: only what the cashier needs is stored (no e-mail/phone), per session, and it is cleared
 * once the session is closed and the queue is empty.
 */

export interface OfflinePayable {
  orderId: string;
  orderNo: string;
  referenceNo: string | null;
  payerName: string;
  feeName: string;
  amount: string;
}
interface Pack {
  generatedAt: string;
  truncated: boolean;
  payables: OfflinePayable[];
}
export interface QueuedCollection extends OfflinePayable {
  key: string;
  capturedAt: string;
  state: 'pending' | 'failed';
  error?: string;
}

const packKey = (id: string) => `sru-cash-pack:${id}`;
const queueKey = (id: string) => `sru-cash-queue:${id}`;

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
    /* storage full / blocked: offline mode simply is not available */
  }
}

export const isNetworkError = (e: unknown) => e instanceof ApiError && e.code === 'NETWORK_ERROR';

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

export function useOfflineCash(sessionId: string, active: boolean) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  // Lazy init: the page renders a skeleton until its data loads, so SSR/hydration never shows these.
  const [stored, setStored] = useState<Pack | null>(() => (typeof window === 'undefined' ? null : load<Pack | null>(packKey(sessionId), null)));
  const [queue, setQueue] = useState<QueuedCollection[]>(() => (typeof window === 'undefined' ? [] : load<QueuedCollection[]>(queueKey(sessionId), [])));
  const [syncing, setSyncing] = useState(false);

  const writeQueue = useCallback(
    (next: QueuedCollection[]) => {
      setQueue(next);
      save(queueKey(sessionId), next.length ? next : null);
    },
    [sessionId],
  );

  // Keep the local copy fresh while the session is open and the network is up.
  const fresh = useQuery({
    queryKey: ['cashier-offline-pack', sessionId],
    enabled: active && online,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const p = await api.get<Pack & { payables: (PayableDto & OfflinePayable)[] }>(`/finance/cashier-sessions/${sessionId}/offline-pack`);
      const slim: Pack = {
        generatedAt: p.generatedAt,
        truncated: p.truncated,
        payables: p.payables.map(({ orderId, orderNo, referenceNo, payerName, feeName, amount }) => ({ orderId, orderNo, referenceNo, payerName, feeName, amount })),
      };
      save(packKey(sessionId), slim);
      return slim;
    },
  });
  const pack = fresh.data ?? stored;

  const enqueue = useCallback(
    (p: OfflinePayable, key = newIdempotencyKey()) => {
      const item: QueuedCollection = { ...p, key, capturedAt: new Date().toISOString(), state: 'pending' };
      writeQueue([...load<QueuedCollection[]>(queueKey(sessionId), []), item]);
      return item;
    },
    [sessionId, writeQueue],
  );

  /** Replays pending items in order; stops at the first network failure. */
  const sync = useCallback(async () => {
    setSyncing(true);
    let items = load<QueuedCollection[]>(queueKey(sessionId), []);
    let synced = 0;
    try {
      for (const item of items.filter((i) => i.state === 'pending')) {
        try {
          await api.post(`/finance/cashier-sessions/${sessionId}/collect`, { orderId: item.orderId, capturedAt: item.capturedAt }, { headers: { 'Idempotency-Key': item.key } });
          items = items.filter((i) => i.key !== item.key);
          synced++;
        } catch (e) {
          if (isNetworkError(e)) break;
          items = items.map((i) => (i.key === item.key ? { ...i, state: 'failed', error: e instanceof Error ? e.message : String(e) } : i));
        }
        writeQueue(items);
      }
    } finally {
      setSyncing(false);
    }
    return { synced, failed: items.filter((i) => i.state === 'failed').length, pending: items.filter((i) => i.state === 'pending').length };
  }, [sessionId, writeQueue]);

  /** A failed item is removed once finance has dealt with the cash (returned it to the payer…). */
  const dismiss = useCallback((key: string) => writeQueue(load<QueuedCollection[]>(queueKey(sessionId), []).filter((i) => i.key !== key)), [sessionId, writeQueue]);

  const clear = useCallback(() => {
    save(packKey(sessionId), null);
    setStored(null);
  }, [sessionId]);

  /** Unpaid orders from the local copy, minus those already collected offline. */
  const localPayables = useCallback(
    (search: string) => {
      const queued = new Set(queue.map((q) => q.orderId));
      const s = search.trim().toLowerCase();
      return (pack?.payables ?? [])
        .filter((p) => !queued.has(p.orderId))
        .filter((p) => !s || p.payerName.toLowerCase().includes(s) || p.orderNo.toLowerCase() === s || (p.referenceNo ?? '').toLowerCase() === s)
        .slice(0, 30);
    },
    [pack, queue],
  );

  return { online, pack, queue, syncing, enqueue, sync, dismiss, clear, localPayables };
}
