import { createApiClient } from '@sru/api-client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';

/** Browser client (cookie auth, CSRF, silent refresh). */
export const api = createApiClient({
  baseURL: API_URL,
  onUnauthenticated: () => {
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
  },
});
