import { describe, expect, it } from 'vitest';
import { DEFAULT_ATM_MIN_LEAD_HOURS, atmLeadHours, fallbackPay, payAvailability, slotStartMs } from './payments';
import type { PaymentConfig } from './types';

const cfg = (over: Partial<PaymentConfig> = {}): PaymentConfig => ({
  payments: { card: true, atm: true, line: false },
  paymentEnv: 'stage',
  ...over,
});
// 2026-09-24 16:00（台北）
const NOW = Date.parse('2026-09-24T16:00:00+08:00');

describe('付款方式可用性', () => {
  it('slotStartMs 以台北時間計算', () => {
    expect(slotStartMs('2026-09-27', '19:00')).toBe(Date.parse('2026-09-27T11:00:00Z'));
    expect(slotStartMs(null, '19:00')).toBeNaN();
    expect(slotStartMs('2026-09-27', null)).toBeNaN();
  });

  it('atmMinLeadHours：沒有欄位或不合法 → 72', () => {
    expect(atmLeadHours(null)).toBe(DEFAULT_ATM_MIN_LEAD_HOURS);
    expect(atmLeadHours(cfg())).toBe(72);
    expect(atmLeadHours(cfg({ atmMinLeadHours: 48 }))).toBe(48);
    expect(atmLeadHours({ atmMinLeadHours: Number.NaN })).toBe(72);
    expect(atmLeadHours({ atmMinLeadHours: -1 })).toBe(72);
  });

  it('config 關閉的方式停用；讀不到 config 視為可用', () => {
    expect(payAvailability(cfg(), '2026-10-30', '19:00', NOW).enabled).toEqual({ card: true, atm: true, line: false });
    expect(payAvailability(null, '2026-10-30', '19:00', NOW).enabled).toEqual({ card: true, atm: true, line: true });
  });

  it('時段距離現在不到 72 小時 → ATM 停用（剛好 72 小時可用）', () => {
    const soon = payAvailability(cfg(), '2026-09-27', '15:59', NOW); // 71h59m
    expect(soon.enabled.atm).toBe(false);
    expect(soon.atmTooSoon).toBe(true);
    const ok = payAvailability(cfg(), '2026-09-27', '16:00', NOW); // 72h
    expect(ok.enabled.atm).toBe(true);
    expect(ok.atmTooSoon).toBe(false);
    // 欄位改成 24 小時
    expect(payAvailability(cfg({ atmMinLeadHours: 24 }), '2026-09-26', '10:00', NOW).enabled.atm).toBe(true);
    // 還沒選時段不停用
    expect(payAvailability(cfg(), null, null, NOW).atmTooSoon).toBe(false);
  });

  it('fallbackPay：目前的不能用 → 改信用卡（依序第一個可用）', () => {
    expect(fallbackPay('atm', { card: true, line: false, atm: false })).toBe('card');
    expect(fallbackPay('line', { card: false, line: false, atm: true })).toBe('atm');
    expect(fallbackPay('card', { card: true, line: false, atm: false })).toBeNull();
    expect(fallbackPay('atm', { card: false, line: false, atm: false })).toBeNull();
  });
});
