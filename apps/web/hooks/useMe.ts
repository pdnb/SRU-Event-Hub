'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@sru/api-client';
import type { PermissionCode } from '@sru/shared-types';
import { api } from '@/services/api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.auth.me(),
    staleTime: 5 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 1,
  });
}

/**
 * UI-level permission check — only for showing/hiding controls.
 * The backend enforces every permission independently (spec §5).
 */
export function useCan() {
  const { data } = useMe();
  const set = new Set(data?.permissions ?? []);
  return (...codes: PermissionCode[]) => codes.every((c) => set.has(c));
}
