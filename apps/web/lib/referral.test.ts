import { describe, expect, it } from 'vitest';
import { applyDiscount, loadReferral, normalizeCode, storeReferral } from './referral';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}

describe('推薦碼（前端）', () => {
  it('折扣算法和 API 一致', () => {
    expect(applyDiscount(3600, { discountType: 'percent', discountValue: 10 })).toEqual({ discount: 360, final: 3240 });
    expect(applyDiscount(1555, { discountType: 'percent', discountValue: 10 })).toEqual({ discount: 156, final: 1399 });
    expect(applyDiscount(500, { discountType: 'amount', discountValue: 800 })).toEqual({ discount: 499, final: 1 });
  });

  it('normalizeCode', () => {
    expect(normalizeCode(' amy10 ')).toBe('AMY10');
    expect(normalizeCode('x')).toBeNull();
  });

  it('分享連結帶進來的推薦碼保留 30 天', () => {
    const s = new MemoryStorage();
    const t0 = Date.parse('2026-09-24T12:00:00+08:00');
    storeReferral('AMY10', t0, s);
    expect(loadReferral(t0 + 29 * 86_400_000, s)).toBe('AMY10');
    expect(loadReferral(t0 + 31 * 86_400_000, s)).toBeNull();
    expect(loadReferral(t0, null)).toBeNull();
  });
});
