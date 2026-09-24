/**
 * 預約草稿存 sessionStorage（關分頁即清；從綠界按返回時資料還在）
 *
 * - 讀出來的東西一律重新檢查型別，形狀不對的欄位用預設值（舊版本、被竄改都不會讓頁面壞掉）
 * - sessionStorage 在無痕模式／被停用時可能丟例外：一律吞掉，只是不存
 */

import { CODE_RE } from '../referral';
import { TOPIC_NOTE_MAX, isTopic } from '../topics';
import type { BookingDraft, BookingForm, Gender, PayMethod, PendingOrder } from './types';

export const DRAFT_KEY = 'yuanshe.booking.v1';

export const EMPTY_FORM: BookingForm = {
  name: '',
  gender: '女',
  bdate: '',
  btime: '',
  bplace: '',
  email: '',
  phone: '',
  q: '',
};

export const EMPTY_DRAFT: BookingDraft = {
  svc: null,
  date: null,
  time: null,
  f: EMPTY_FORM,
  pay: 'card',
  agree: false,
  order: null,
  topics: [],
  topicNote: '',
  referral: '',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ORDER_RE = /^YS[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
const PAY: PayMethod[] = ['card', 'line', 'atm'];

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const strOrNull = (v: unknown, re: RegExp): string | null => (typeof v === 'string' && re.test(v) ? v : null);
const isPay = (v: unknown): v is PayMethod => typeof v === 'string' && (PAY as string[]).includes(v);

function sanitizeForm(raw: unknown): BookingForm {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const gender: Gender = r.gender === '男' ? '男' : '女';
  return {
    name: str(r.name, 50),
    gender,
    bdate: strOrNull(r.bdate, DATE_RE) ?? '',
    btime: strOrNull(r.btime, TIME_RE) ?? '',
    bplace: str(r.bplace, 100),
    email: str(r.email, 254),
    phone: str(r.phone, 30),
    q: str(r.q, 2000),
  };
}

function sanitizeOrder(raw: unknown): PendingOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const orderNo = strOrNull(r.orderNo, ORDER_RE);
  const date = strOrNull(r.date, DATE_RE);
  const time = strOrNull(r.time, TIME_RE);
  if (!orderNo || !date || !time || typeof r.svc !== 'string' || !isPay(r.pay)) return null;
  return {
    orderNo,
    svc: r.svc,
    date,
    time,
    pay: r.pay,
    amount: typeof r.amount === 'number' && Number.isFinite(r.amount) ? r.amount : 0,
    holdExpiresAt: typeof r.holdExpiresAt === 'string' ? r.holdExpiresAt : null,
    fp: typeof r.fp === 'string' ? r.fp : '',
  };
}

/** 只留認得的主題、去掉重複，保持原本順序（順序＝優先順序） */
function sanitizeTopics(raw: unknown): string[] {
  return Array.isArray(raw) ? Array.from(new Set(raw.filter(isTopic))) : [];
}

export function sanitizeDraft(raw: unknown): BookingDraft {
  if (!raw || typeof raw !== 'object') return EMPTY_DRAFT;
  const r = raw as Record<string, unknown>;
  const date = strOrNull(r.date, DATE_RE);
  return {
    svc: typeof r.svc === 'string' && r.svc.length > 0 && r.svc.length <= 32 ? r.svc : null,
    date,
    time: date ? strOrNull(r.time, TIME_RE) : null,
    f: sanitizeForm(r.f),
    pay: isPay(r.pay) ? r.pay : 'card',
    agree: r.agree === true,
    order: sanitizeOrder(r.order),
    topics: sanitizeTopics(r.topics),
    topicNote: str(r.topicNote, TOPIC_NOTE_MAX),
    referral: typeof r.referral === 'string' && CODE_RE.test(r.referral) ? r.referral : '',
  };
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadDraft(store: Storage | null = storage()): BookingDraft | null {
  try {
    const text = store?.getItem(DRAFT_KEY);
    if (!text) return null;
    return sanitizeDraft(JSON.parse(text));
  } catch {
    return null;
  }
}

export function saveDraft(draft: BookingDraft, store: Storage | null = storage()): void {
  try {
    store?.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 容量滿、無痕模式：不存
  }
}

export function clearDraft(store: Storage | null = storage()): void {
  try {
    store?.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

/** 付款完成（或轉帳帳號已取得）後清掉草稿：只清屬於這筆訂單的，避免誤刪另一筆正在填的 */
export function clearDraftForOrder(orderNo: string, store: Storage | null = storage()): void {
  const d = loadDraft(store);
  if (d?.order?.orderNo === orderNo) clearDraft(store);
}

/** 訂單逾時／取消：只拿掉記住的訂單，排盤資料留著方便重新預約 */
export function forgetOrder(orderNo: string, store: Storage | null = storage()): void {
  const d = loadDraft(store);
  if (d?.order?.orderNo === orderNo) saveDraft({ ...d, order: null }, store);
}
