'use client';

import { useSyncExternalStore } from 'react';

const noSubscribe = () => () => {};

/**
 * A browser-only value (e.g. `'share' in navigator`) that renders `serverValue` during SSR and the
 * first hydration pass, then the real value — without setState-in-effect or hydration mismatches.
 */
export function useClientValue<T>(get: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscribe, get, () => serverValue);
}

const minuteSubscribe = (cb: () => void) => {
  const t = setInterval(cb, 60_000);
  return () => clearInterval(t);
};
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** Current time rounded to the minute, re-rendering every minute; null on the server. */
export function useNowMinute(): number | null {
  return useSyncExternalStore(minuteSubscribe, currentMinute, () => null);
}
