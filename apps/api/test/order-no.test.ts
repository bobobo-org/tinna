import { describe, expect, it } from 'vitest';
import {
  ORDER_ALPHABET,
  ORDER_NO_RE,
  generateOrderNo,
  generateTradeNo,
  isOrderNo,
  orderNoFromTradeNo,
} from '../src/lib/order-no';

describe('訂單編號', () => {
  it("格式 'YS' + 8 碼，不含易混淆字元 0 O 1 I L", () => {
    for (let i = 0; i < 2000; i++) {
      const no = generateOrderNo();
      expect(no).toMatch(ORDER_NO_RE);
      expect(no.slice(2)).not.toMatch(/[01OIL]/);
    }
    expect(ORDER_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('隨機、不是流水號', () => {
    const set = new Set(Array.from({ length: 5000 }, generateOrderNo));
    expect(set.size).toBe(5000);
    const sorted = [...set].slice(0, 50);
    const sequential = sorted.every((v, i) => i === 0 || v > sorted[i - 1]!);
    expect(sequential).toBe(false);
  });

  it('isOrderNo', () => {
    expect(isOrderNo('YS8K2M4Q7T')).toBe(true);
    expect(isOrderNo('YS8K2M4Q70')).toBe(false); // 0
    expect(isOrderNo('ys8k2m4q7t')).toBe(false);
    expect(isOrderNo('YS8K2M4Q7')).toBe(false);
  });

  it('付款交易編號：訂單編號 + 10 碼，共 20 字英數字（綠界上限）', () => {
    const t = generateTradeNo('YS8K2M4Q7T');
    expect(t).toMatch(/^YS8K2M4Q7T[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
    expect(t).toHaveLength(20);
    expect(orderNoFromTradeNo(t)).toBe('YS8K2M4Q7T');
    expect(orderNoFromTradeNo('garbage')).toBeNull();
  });
});
