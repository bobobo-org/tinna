/**
 * 前端 state ↔ API（POST /bookings）
 */

import type {
  BookingForm,
  CreateBookingBody,
  FieldErrors,
  FieldKey,
  PayMethod,
  PendingOrder,
  Step,
} from './types';

export const PAY_LABELS: Record<PayMethod, string> = {
  card: '信用卡',
  line: 'LINE Pay',
  atm: 'ATM 轉帳',
};

export function toBookingBody(s: {
  svc: string;
  date: string;
  time: string;
  f: BookingForm;
  pay: PayMethod;
  agree: boolean;
}): CreateBookingBody {
  return {
    service_id: s.svc,
    date: s.date,
    time: s.time,
    name: s.f.name.trim(),
    gender: s.f.gender === '男' ? 'male' : 'female',
    birth_date: s.f.bdate,
    birth_time: s.f.btime,
    birth_place: s.f.bplace.trim(),
    phone: s.f.phone.trim(),
    email: s.f.email.trim(),
    questions: s.f.q.trim(),
    pay_method: s.pay,
    agree: s.agree,
  };
}

/** 排盤資料的指紋：從綠界返回後資料沒改才沿用原本的訂單 */
export function formFingerprint(f: BookingForm): string {
  return JSON.stringify([
    f.name.trim(),
    f.gender,
    f.bdate,
    f.btime,
    f.bplace.trim(),
    f.phone.trim(),
    f.email.trim(),
    f.q.trim(),
  ]);
}

/** API 欄位名 → 前端欄位（顯示在哪一步） */
const API_FIELD_MAP: Record<string, { key: FieldKey; step: Step }> = {
  service_id: { key: 'svc', step: 1 },
  date: { key: 'dt', step: 2 },
  time: { key: 'dt', step: 2 },
  name: { key: 'name', step: 3 },
  gender: { key: 'gender', step: 3 },
  birth_date: { key: 'bdate', step: 3 },
  birth_time: { key: 'btime', step: 3 },
  birth_place: { key: 'bplace', step: 3 },
  phone: { key: 'phone', step: 3 },
  email: { key: 'email', step: 3 },
  questions: { key: 'q', step: 3 },
  pay_method: { key: 'pay', step: 4 },
  agree: { key: 'agree', step: 4 },
};

/**
 * 400 validation 的 fields → 前端錯誤＋要回到哪一步（有錯的最前面那一步）
 * 認不得的欄位不丟掉：step 為 4（留在付款步驟顯示整體訊息）
 */
export function mapApiFieldErrors(fields: Record<string, string> | undefined): {
  errors: FieldErrors;
  step: Step;
  unknown: string[];
} {
  const errors: FieldErrors = {};
  const unknown: string[] = [];
  let step: Step = 4;
  for (const [apiKey, message] of Object.entries(fields ?? {})) {
    const m = API_FIELD_MAP[apiKey];
    if (!m) {
      unknown.push(message);
      continue;
    }
    if (!errors[m.key]) errors[m.key] = message;
    if (m.step < step) step = m.step;
  }
  return { errors, step, unknown };
}

/** 保留是否已逾時（用裝置時鐘判斷，只用來決定要不要沿用訂單；最後仍以 API 為準） */
export function holdExpired(order: Pick<PendingOrder, 'holdExpiresAt'>, now: number = Date.now()): boolean {
  if (!order.holdExpiresAt) return false;
  const t = Date.parse(order.holdExpiresAt);
  return !Number.isNaN(t) && t <= now;
}

/** 同一個方案、時段、付款方式、排盤資料，且保留未逾時 → 可以直接重新付款 */
export function canReuseOrder(
  order: PendingOrder | null,
  s: { svc: string; date: string; time: string; pay: PayMethod; f: BookingForm },
  now: number = Date.now(),
): order is PendingOrder {
  return (
    !!order &&
    order.svc === s.svc &&
    order.date === s.date &&
    order.time === s.time &&
    order.pay === s.pay &&
    order.fp === formFingerprint(s.f) &&
    !holdExpired(order, now)
  );
}

/** 409 slot_taken 時：擋住的是不是自己剛建立、還在保留中的訂單（同一個時段） */
export function isOwnHold(
  order: PendingOrder | null,
  s: { date: string; time: string },
  now: number = Date.now(),
): order is PendingOrder {
  return !!order && order.date === s.date && order.time === s.time && !holdExpired(order, now);
}
