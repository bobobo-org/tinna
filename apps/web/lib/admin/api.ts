/**
 * 後台 API（apps/api 的 /admin/*，合約見 docs/API.md「後台」）
 * 每個請求帶 Supabase Auth 的 access token；401 → 清掉登入狀態（畫面會導回登入頁）
 */

import { ApiError, MSG_NETWORK, MSG_NOT_CONFIGURED, MSG_TIMEOUT, normalizeBase } from '../api';
import { clearSession, getSession } from './session';

export type AdminMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function adminRequest<T>(path: string, opts: { method?: AdminMethod; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const base = normalizeBase(process.env.NEXT_PUBLIC_API_URL);
  if (!base) throw new ApiError(0, 'not_configured', MSG_NOT_CONFIGURED);
  const session = await getSession();
  if (!session) throw new ApiError(401, 'unauthorized', '請先登入後台');

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw new ApiError(0, timedOut ? 'timeout' : 'network', timedOut ? MSG_TIMEOUT : MSG_NETWORK);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401) clearSession();
    const e = (data && typeof data === 'object' ? data : {}) as { error?: unknown; message?: unknown; fields?: unknown };
    const fields =
      e.fields && typeof e.fields === 'object' && !Array.isArray(e.fields)
        ? Object.fromEntries(
            Object.entries(e.fields as Record<string, unknown>).filter((kv): kv is [string, string] => typeof kv[1] === 'string'),
          )
        : undefined;
    throw new ApiError(
      res.status,
      typeof e.error === 'string' ? e.error : `http_${res.status}`,
      typeof e.message === 'string' && e.message ? e.message : '發生錯誤，請稍後再試',
      fields,
    );
  }
  return data as T;
}

// ---------- 型別（docs/API.md） ----------

export interface AdminBookingRow {
  orderNo: string;
  status: 'pending_payment' | 'awaiting_transfer' | 'confirmed' | 'cancelled' | 'expired' | 'refunded';
  payMethod: 'card' | 'line' | 'atm' | 'vip';
  amount: number;
  date: string;
  time: string;
  startsAt: string;
  endsAt: string;
  confirmedAt: string | null;
  service: { id: string; name: string };
  customer: {
    name: string;
    gender: string | null;
    birthDate: string;
    birthTime: string | null;
    birthPlace: string | null;
    phone: string;
    email: string;
  };
  questions: string | null;
  needsAttention: boolean;
  attentionReason: string | null;
}

export const BOOKING_STATUS_LABELS: Record<AdminBookingRow['status'], string> = {
  pending_payment: '待付款',
  awaiting_transfer: '待轉帳',
  confirmed: '已確認',
  cancelled: '已取消',
  expired: '已逾時',
  refunded: '已退款',
};

export const PAY_METHOD_LABELS: Record<AdminBookingRow['payMethod'], string> = {
  card: '信用卡',
  line: 'LINE Pay',
  atm: 'ATM',
  vip: 'VIP 堂數',
};

// ---------- KOL 推薦碼 ----------

export interface AdminReferralCode {
  id: string;
  code: string;
  kolId: string;
  kolName: string;
  discountType: 'percent' | 'amount';
  discountValue: number;
  label: string;
  commissionRate: number;
  appliesBooking: boolean;
  appliesVip: boolean;
  appliesShop: boolean;
  startsOn: string | null;
  endsOn: string | null;
  maxUses: number | null;
  active: boolean;
  createdAt: string;
}

export interface AdminKol {
  id: string;
  name: string;
  contact: string | null;
  note: string | null;
  active: boolean;
  createdAt: string;
  codes: AdminReferralCode[];
}

export interface ReferralSum {
  orders: number;
  pending: number;
  revenue: number;
  discount: number;
  commission: number;
}

export interface ReferralStats {
  from: string;
  to: string;
  kols: (ReferralSum & { kolId: string; name: string; active: boolean })[];
  codes: (ReferralSum & { codeId: string; code: string; kolId: string })[];
  uses: {
    orderNo: string;
    kind: 'booking' | 'vip' | 'shop';
    code: string;
    kolName: string;
    createdAt: string;
    originalAmount: number;
    discountAmount: number;
    finalAmount: number;
    commissionAmount: number;
    state: 'paid' | 'pending' | 'cancelled';
  }[];
}

export const ORDER_KIND_LABELS: Record<ReferralStats['uses'][number]['kind'], string> = {
  booking: '預約',
  vip: 'VIP',
  shop: '商店',
};
