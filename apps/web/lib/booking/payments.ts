/**
 * 付款方式能不能用（Step 4）
 *
 * - GET /config 的 payments：false → 停用（例：LINE Pay 未開通）；讀不到 config 視為可用，送出時由 API 判斷
 * - ATM：所選時段距離現在不到 atmMinLeadHours（沒有這個欄位當 72）小時 → 停用
 */

import type { PayMethod, PaymentConfig } from './types';

export const DEFAULT_ATM_MIN_LEAD_HOURS = 72;
export const PAY_ORDER: PayMethod[] = ['card', 'line', 'atm'];

export function atmLeadHours(config: Pick<PaymentConfig, 'atmMinLeadHours'> | null | undefined): number {
  const n = config?.atmMinLeadHours;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : DEFAULT_ATM_MIN_LEAD_HOURS;
}

/** 台北時間的日期＋時段 → epoch 毫秒；沒選回 NaN */
export function slotStartMs(date: string | null, time: string | null): number {
  return date && time ? Date.parse(`${date}T${time}:00+08:00`) : Number.NaN;
}

export interface PayAvailability {
  enabled: Record<PayMethod, boolean>;
  /** ATM 因為離諮詢開始太近而停用 */
  atmTooSoon: boolean;
  leadHours: number;
}

export function payAvailability(
  config: PaymentConfig | null,
  date: string | null,
  time: string | null,
  nowMs: number,
): PayAvailability {
  const leadHours = atmLeadHours(config);
  const start = slotStartMs(date, time);
  const atmTooSoon = Number.isFinite(start) && start - nowMs < leadHours * 3_600_000;
  return {
    enabled: {
      card: config?.payments?.card !== false,
      line: config?.payments?.line !== false,
      atm: config?.payments?.atm !== false && !atmTooSoon,
    },
    atmTooSoon,
    leadHours,
  };
}

/** 目前選的付款方式不能用 → 依序改用第一個可用的（信用卡優先）；可用或全都不能用 → null */
export function fallbackPay(current: PayMethod, enabled: Record<PayMethod, boolean>): PayMethod | null {
  if (enabled[current]) return null;
  return PAY_ORDER.find((m) => enabled[m]) ?? null;
}
