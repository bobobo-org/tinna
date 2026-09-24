import { describe, expect, it } from 'vitest';
import {
  REFERRAL_MSG,
  applyDiscount,
  checkUsable,
  commissionOf,
  discountLabel,
  normalizeCode,
  type ReferralCode,
} from '../src/lib/referral';

const NOW = new Date('2026-09-24T10:00:00+08:00');

const base: ReferralCode = {
  id: 'c1',
  code: 'AMY10',
  kolId: 'k1',
  kolName: 'Amy',
  kolActive: true,
  discountType: 'percent',
  discountValue: 10,
  commissionRate: 15,
  appliesBooking: true,
  appliesVip: true,
  appliesShop: false,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  active: true,
  createdAt: NOW,
};

describe('推薦碼計算', () => {
  it('normalizeCode：去空白、轉大寫、格式檢查', () => {
    expect(normalizeCode(' amy10 ')).toBe('AMY10');
    expect(normalizeCode('a_b-c9')).toBe('A_B-C9');
    expect(normalizeCode('ab')).toBeNull();
    expect(normalizeCode('有中文')).toBeNull();
    expect(normalizeCode('A'.repeat(21))).toBeNull();
  });

  it('打折：四捨五入到元', () => {
    expect(applyDiscount(3600, base)).toEqual({ discount: 360, final: 3240 });
    expect(applyDiscount(2600, { discountType: 'percent', discountValue: 15 })).toEqual({ discount: 390, final: 2210 });
    expect(applyDiscount(1555, { discountType: 'percent', discountValue: 10 })).toEqual({ discount: 156, final: 1399 });
  });

  it('折抵金額：不超過原價，實付至少 1 元', () => {
    expect(applyDiscount(3600, { discountType: 'amount', discountValue: 300 })).toEqual({ discount: 300, final: 3300 });
    expect(applyDiscount(500, { discountType: 'amount', discountValue: 800 })).toEqual({ discount: 499, final: 1 });
  });

  it('佣金：實付金額 × 比例，四捨五入', () => {
    expect(commissionOf(3240, 15)).toBe(486);
    expect(commissionOf(2210, 12.5)).toBe(276);
    expect(commissionOf(1000, 0)).toBe(0);
  });

  it('顯示文字', () => {
    expect(discountLabel(base)).toBe('9 折');
    expect(discountLabel({ discountType: 'percent', discountValue: 15 })).toBe('85 折');
    expect(discountLabel({ discountType: 'amount', discountValue: 1200 })).toBe('折 NT$1,200');
  });

  it('能不能用：停用、不適用、未開始、過期、達上限', () => {
    expect(checkUsable(base, 'booking', NOW, 0)).toBeNull();
    expect(checkUsable({ ...base, active: false }, 'booking', NOW, 0)).toBe(REFERRAL_MSG.inactive);
    expect(checkUsable({ ...base, kolActive: false }, 'booking', NOW, 0)).toBe(REFERRAL_MSG.inactive);
    expect(checkUsable(base, 'shop', NOW, 0)).toBe(REFERRAL_MSG.notApplicable);
    expect(checkUsable({ ...base, startsAt: new Date('2026-10-01T00:00:00+08:00') }, 'booking', NOW, 0)).toBe(REFERRAL_MSG.notStarted);
    expect(checkUsable({ ...base, endsAt: new Date('2026-09-24T10:00:00+08:00') }, 'booking', NOW, 0)).toBe(REFERRAL_MSG.expired);
    expect(checkUsable({ ...base, maxUses: 3 }, 'booking', NOW, 3)).toBe(REFERRAL_MSG.usedUp);
    expect(checkUsable({ ...base, maxUses: 3 }, 'booking', NOW, 2)).toBeNull();
  });
});
