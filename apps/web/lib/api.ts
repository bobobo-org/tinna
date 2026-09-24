/**
 * apps/api 用戶端（合約見 docs/API.md）
 *
 * - Base URL：NEXT_PUBLIC_API_URL
 * - 錯誤一律轉成 ApiError（status、error code、可直接顯示的中文 message、fields）
 *   網路斷線／逾時也是 ApiError（status 0），畫面只要顯示 message
 */

import type {
  AvailabilityResponse,
  CreateBookingBody,
  CreateBookingResponse,
  EcpayCheckoutResponse,
  LinePayRequestResponse,
  PaymentConfig,
  PublicBooking,
} from './booking/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const MSG_NETWORK = '網路連線不穩，請確認網路後再試一次';
export const MSG_TIMEOUT = '連線逾時，請稍後再試一次';
export const MSG_NOT_CONFIGURED = '預約系統暫時無法使用，請稍後再試';

function defaultMessage(status: number): string {
  if (status === 404) return '找不到資料';
  if (status === 429) return '送出次數太多了，請稍後再試';
  if (status >= 500) return '系統忙碌中，請稍後再試';
  return '發生錯誤，請稍後再試';
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException ? e.name === 'AbortError' : (e as { name?: string })?.name === 'AbortError';
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function normalizeBase(base: string | undefined | null): string {
  return (base ?? '').trim().replace(/\/+$/, '');
}

export function createApiClient(baseUrl: string | undefined, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  const base = normalizeBase(baseUrl);

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    if (!base) throw new ApiError(0, 'not_configured', MSG_NOT_CONFIGURED);
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, opts.timeoutMs ?? 15_000);
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: opts.method ?? 'GET',
        headers: opts.body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: ctrl.signal,
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e; // 呼叫端自己取消（換月份、離開頁面）
      if (timedOut) throw new ApiError(0, 'timeout', MSG_TIMEOUT);
      if (isAbort(e)) throw e;
      throw new ApiError(0, 'network', MSG_NETWORK);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }

    let data: unknown = null;
    try {
      const text = await res.text();
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const err = (data && typeof data === 'object' ? data : {}) as {
        error?: unknown;
        message?: unknown;
        fields?: unknown;
      };
      const fields =
        err.fields && typeof err.fields === 'object' && !Array.isArray(err.fields)
          ? Object.fromEntries(
              Object.entries(err.fields as Record<string, unknown>).filter(
                (kv): kv is [string, string] => typeof kv[1] === 'string',
              ),
            )
          : undefined;
      throw new ApiError(
        res.status,
        typeof err.error === 'string' ? err.error : `http_${res.status}`,
        typeof err.message === 'string' && err.message.trim() ? err.message : defaultMessage(res.status),
        fields,
      );
    }
    if (data === null) throw new ApiError(res.status, 'bad_response', defaultMessage(500));
    return data as T;
  }

  return {
    base,
    getConfig: (signal?: AbortSignal) => request<PaymentConfig>('/config', { signal, timeoutMs: 8_000 }),
    getAvailability: (month: string, service: string | null, signal?: AbortSignal) => {
      const q = new URLSearchParams({ month });
      if (service) q.set('service', service);
      return request<AvailabilityResponse>(`/availability?${q.toString()}`, { signal });
    },
    createBooking: (body: CreateBookingBody) =>
      request<CreateBookingResponse>('/bookings', { method: 'POST', body, timeoutMs: 25_000 }),
    getBooking: (orderNo: string, signal?: AbortSignal) =>
      request<PublicBooking>(`/bookings/${encodeURIComponent(orderNo)}`, { signal }),
    ecpayCheckout: (orderNo: string) =>
      request<EcpayCheckoutResponse>('/payments/ecpay/checkout', { method: 'POST', body: { orderNo }, timeoutMs: 25_000 }),
    linepayRequest: (orderNo: string) =>
      request<LinePayRequestResponse>('/payments/linepay/request', { method: 'POST', body: { orderNo }, timeoutMs: 25_000 }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** 前端共用的 client（NEXT_PUBLIC_API_URL 在 build 時寫進 bundle） */
export const api = createApiClient(process.env.NEXT_PUBLIC_API_URL);
