/**
 * 驗證規則（README §5.5、原型 validate()，文案逐字相同）
 *
 * - Step 1：要選方案；自選主題要選滿最少題數；Step 2：要選日期與時段
 *   （這兩步只決定「下一步」能不能按，不顯示訊息）
 * - Step 3：姓名非空、出生日期必填、Email、手機數字 ≥ 9 碼；方案要求時問題欄必填（接住你的諮詢室）
 *   另補上 API 的出生日期範圍（1900-01-01 ～ 今天），避免送出後才被擋
 * - Step 4：同意條款必勾；信用卡不在本站收卡號，所以沒有卡號驗證
 */

import type { BookingForm, FieldErrors, PayMethod, Step } from './types';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const MIN_BIRTH_DATE = '1900-01-01';

export const MSG = {
  svc: '請選擇方案',
  topics: '請選足主題',
  dt: '請選擇日期與時段',
  name: '請填寫姓名',
  bdate: '請選擇出生日期',
  bdateRange: '請確認出生日期',
  email: '請填寫有效的 Email',
  phone: '請填寫手機號碼',
  qRequired: '請填寫這一欄',
  agree: '請勾選同意改期與退款規則',
  payUnavailable: '這個付款方式即將開放，請改選其他付款方式',
} as const;

export interface ValidationInput {
  svc: string | null;
  date: string | null;
  time: string | null;
  f: BookingForm;
  pay: PayMethod;
  agree: boolean;
  /** 付款方式是否可用（GET /config）；沒給視為可用 */
  payEnabled?: Partial<Record<PayMethod, boolean>>;
  /** 自選主題還差幾題才能預約（0 或沒給：不是自選主題，或題數已足夠） */
  topicsShort?: number;
  /** Step 3 問題欄必填（接住你的諮詢室） */
  qRequired?: boolean;
}

export function validateDetails(f: BookingForm, today: string, qRequired = false): FieldErrors {
  const e: FieldErrors = {};
  if (!f.name.trim()) e.name = MSG.name;
  if (!f.bdate) e.bdate = MSG.bdate;
  else if (f.bdate < MIN_BIRTH_DATE || f.bdate > today) e.bdate = MSG.bdateRange;
  if (!EMAIL_RE.test(f.email.trim())) e.email = MSG.email;
  if (f.phone.replace(/\D/g, '').length < 9) e.phone = MSG.phone;
  if (qRequired && !f.q.trim()) e.q = MSG.qRequired;
  return e;
}

export function validateStep(step: Step, s: ValidationInput, today: string): FieldErrors {
  const e: FieldErrors = {};
  if (step === 1) {
    if (!s.svc) e.svc = MSG.svc;
    else if ((s.topicsShort ?? 0) > 0) e.svc = MSG.topics;
  }
  if (step === 2 && !(s.date && s.time)) e.dt = MSG.dt;
  if (step === 3) Object.assign(e, validateDetails(s.f, today, s.qRequired));
  if (step === 4) {
    if (s.payEnabled && s.payEnabled[s.pay] === false) e.pay = MSG.payUnavailable;
    if (!s.agree) e.agree = MSG.agree;
  }
  return e;
}

/** 第一個還沒完成的步驟（Step 4 本身沒有「完成」，所以最多回 4） */
export function firstIncompleteStep(s: ValidationInput, today: string): Step {
  if (!s.svc || (s.topicsShort ?? 0) > 0) return 1;
  if (!(s.date && s.time)) return 2;
  if (Object.keys(validateDetails(s.f, today, s.qRequired)).length > 0) return 3;
  return 4;
}

/** 網址要求的步驟超前（例：沒選時段就 step=4）→ 退回第一個未完成的步驟 */
export function clampStep(requested: Step, s: ValidationInput, today: string): Step {
  const limit = firstIncompleteStep(s, today);
  return requested > limit ? limit : requested;
}

/** 原型 canNext：Step 1/2 未完成時「下一步」半透明且無作用；Step 3/4 按下才顯示錯誤 */
export function canGoNext(step: Step, s: ValidationInput, today: string): boolean {
  if (step >= 3) return true;
  return Object.keys(validateStep(step, s, today)).length === 0;
}

/** 顯示錯誤時的欄位順序（捲到第一個錯誤欄位） */
export const FIELD_ORDER = ['name', 'gender', 'bdate', 'btime', 'bplace', 'phone', 'email', 'q', 'pay', 'agree'] as const;

export function firstErrorField(e: FieldErrors): (typeof FIELD_ORDER)[number] | null {
  return FIELD_ORDER.find((k) => e[k]) ?? null;
}
