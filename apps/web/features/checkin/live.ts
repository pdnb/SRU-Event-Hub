'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, API_URL } from '@/services/api';

/** Socket.IO lives at the API's origin (/socket.io), not under /api/v1. */
function socketOrigin(): string {
  try {
    return new URL(API_URL, window.location.href).origin;
  } catch {
    return window.location.origin;
  }
}

export type LiveState = 'connecting' | 'live' | 'offline' | 'denied';

/**
 * Subscribes to real-time check-in notifications for one event and refreshes the given queries
 * when something changes (debounced, so a burst of scans causes one refetch). Messages carry no
 * personal data; everything shown comes from the access-checked REST endpoints.
 */
export function useCheckinLive(eventId: string, queryKeys: unknown[][]): LiveState {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');
  const keys = useRef(queryKeys);
  useEffect(() => {
    keys.current = queryKeys;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const socket: Socket = io(`${socketOrigin()}/checkin`, { path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        for (const k of keys.current) void qc.invalidateQueries({ queryKey: k });
      }, 800);
    };
    socket.on('connect', async () => {
      const ack = (await socket.emitWithAck('subscribe', { eventId }).catch(() => null)) as { ok: boolean; code?: string } | null;
      setState(ack?.ok ? 'live' : ack?.code === 'FORBIDDEN' ? 'denied' : 'offline');
      if (ack?.ok) refresh(); // catch up on anything missed while disconnected
    });
    // The server drops sockets whose access token expired (15 min). A REST call refreshes the
    // session cookie (silent refresh in the API client), then we reconnect — a few times at most.
    let reauth = 0;
    socket.on('disconnect', (reason) => {
      setState('offline');
      if (reason === 'io server disconnect' && reauth++ < 3) {
        void api.auth
          .me()
          .then(() => socket.connect())
          .catch(() => setState('denied'));
      }
    });
    socket.on('connect', () => {
      reauth = 0;
    });
    socket.on('connect_error', () => setState('offline'));
    socket.on('checkin', (m: { eventId: string }) => {
      if (m.eventId === eventId) refresh();
    });
    return () => {
      if (timer) clearTimeout(timer);
      socket.close();
    };
  }, [eventId, qc]);

  return state;
}
