import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import type {
  ApiErrorBody,
  AuthUser,
  BillingInfoDto,
  EventDetailDto,
  EventSummaryDto,
  OrganizationDto,
  PageMeta,
  PaymentDto,
  RegistrationDto,
} from '@sru/shared-types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Page<T> {
  items: T[];
  meta: PageMeta & { statusCounts?: Record<string, number> };
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface ClientOptions {
  baseURL: string;
  /** Called when the session cannot be refreshed (e.g. redirect to /login). */
  onUnauthenticated?: () => void;
}

/**
 * Creates the API client. Authentication uses httpOnly cookies; the CSRF
 * double-submit token is echoed from the readable `sru_csrf` cookie. A 401
 * triggers one silent refresh (deduplicated across concurrent requests).
 */
export function createApiClient(opts: ClientOptions) {
  const http: AxiosInstance = axios.create({ baseURL: opts.baseURL, withCredentials: true, timeout: 30_000 });

  http.interceptors.request.use((config) => {
    const csrf = readCookie('sru_csrf');
    if (csrf && config.method && !['get', 'head', 'options'].includes(config.method)) {
      config.headers.set('X-CSRF-Token', csrf);
    }
    return config;
  });

  let refreshing: Promise<boolean> | null = null;
  const refresh = () =>
    (refreshing ??= http
      .post('/auth/refresh', null, { _skipRefresh: true } as AxiosRequestConfig)
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => (refreshing = null), 0);
      }));

  http.interceptors.response.use(
    (res) => res,
    async (error: AxiosError<ApiErrorBody>) => {
      const cfg = error.config as (AxiosRequestConfig & { _retried?: boolean; _skipRefresh?: boolean }) | undefined;
      if (error.response?.status === 401 && cfg && !cfg._retried && !cfg._skipRefresh && !cfg.url?.startsWith('/auth/login')) {
        cfg._retried = true;
        if (await refresh()) return http(cfg);
        opts.onUnauthenticated?.();
      }
      const body = error.response?.data;
      if (body && typeof body === 'object' && 'error' in body) {
        throw new ApiError(error.response!.status, body.error.code, body.error.message, body.error.details, body.error.requestId);
      }
      throw new ApiError(error.response?.status ?? 0, 'NETWORK_ERROR', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    },
  );

  async function data<T>(p: Promise<{ data: { data: T } }>): Promise<T> {
    return (await p).data.data;
  }
  async function page<T>(p: Promise<{ data: { data: T[]; meta: PageMeta } }>): Promise<Page<T>> {
    const r = (await p).data;
    return { items: r.data, meta: r.meta };
  }

  return {
    http,
    get: <T>(url: string, params?: object) => data<T>(http.get(url, { params })),
    getPage: <T>(url: string, params?: object) => page<T>(http.get(url, { params })),
    post: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) => data<T>(http.post(url, body, config)),
    patch: <T>(url: string, body?: unknown) => data<T>(http.patch(url, body)),
    del: <T>(url: string) => data<T>(http.delete(url)),

    auth: {
      login: (username: string, password: string) => data<{ expiresIn: number }>(http.post('/auth/login', { username, password })),
      logout: () => data<{ loggedOut: boolean }>(http.post('/auth/logout')),
      me: () => data<AuthUser>(http.get('/auth/me')),
      providers: () => data<{ google: boolean }>(http.get('/auth/providers')),
    },
    public: {
      events: (params: object) => page<EventSummaryDto>(http.get('/public/events', { params })),
      event: (idOrCode: string) => data<EventDetailDto>(http.get(`/public/events/${encodeURIComponent(idOrCode)}`)),
      organizations: () => data<OrganizationDto[]>(http.get('/organizations')),
      lookups: () =>
        data<{
          eventTypes: { id: string; code: string; nameTh: string }[];
          categories: { id: string; code: string; nameTh: string; color: string | null }[];
          participantTypes: { id: string; code: string; nameTh: string }[];
        }>(http.get('/lookups')),
      register: (eventId: string, body: unknown, idempotencyKey: string) =>
        data<RegistrationDto & { accessToken: string }>(
          http.post(`/events/${eventId}/registrations`, body, { headers: { 'Idempotency-Key': idempotencyKey } }),
        ),
      lookup: (referenceNo: string, token: string) =>
        data<RegistrationDto & { event: { id: string; code: string; titleTh: string; startAt: string; endAt: string; venueText: string | null; allowSelfCancel: boolean } }>(
          http.post('/public/registrations/lookup', { referenceNo, token }),
        ),
      cancel: (referenceNo: string, token: string, reason?: string) =>
        data<{ cancelled: boolean }>(http.post('/public/registrations/cancel', { referenceNo, token, reason })),
      /** Guest slip upload (multipart). The token authorises the request. */
      uploadSlip: (referenceNo: string, token: string, file: Blob, opts: { transferredAt?: string; note?: string } = {}) =>
        data<PaymentDto>(http.post('/public/registrations/slip', slipForm(file, { referenceNo, token, ...opts }))),
      /** FIN-9: who the official receipt is made out to (token-authorised). */
      saveBilling: (referenceNo: string, token: string, billing: object) =>
        data<BillingInfoDto>(http.post('/public/registrations/billing', { referenceNo, token, billing })),
    },
    payments: {
      /** Signed-in registrant uploads a slip for their own registration. */
      uploadSlip: (registrationId: string, file: Blob, opts: { transferredAt?: string; note?: string } = {}) =>
        data<PaymentDto>(http.post(`/registrations/${registrationId}/slip`, slipForm(file, opts))),
      saveBilling: (registrationId: string, billing: object) => data<BillingInfoDto>(http.patch(`/registrations/${registrationId}/billing`, { billing })),
    },
  };
}

function slipForm(file: Blob, fields: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
  fd.append('file', file);
  return fd;
}

export type ApiClient = ReturnType<typeof createApiClient>;
