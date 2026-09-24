import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, EMPTY_FORM, loadDraft, sanitizeDraft, saveDraft, clearDraftForOrder, forgetOrder, DRAFT_KEY } from './draft';
import { canReuseOrder, formFingerprint, holdExpired, isOwnHold, mapApiFieldErrors, toBookingBody } from './payload';
import type { PendingOrder } from './types';

const f = {
  ...EMPTY_FORM,
  name: ' 王小美 ',
  gender: '男' as const,
  bdate: '1990-05-20',
  btime: '',
  bplace: ' 台北市 ',
  email: ' a@b.co ',
  phone: ' 0912 345 678 ',
  q: '  今年適合換工作嗎？ ',
};

describe('toBookingBody', () => {
  it('欄位對照 API（gender 轉 female/male、文字 trim）', () => {
    expect(toBookingBody({ svc: 'love', date: '2026-10-07', time: '19:00', f, pay: 'atm', agree: true })).toEqual({
      service_id: 'love',
      date: '2026-10-07',
      time: '19:00',
      name: '王小美',
      gender: 'male',
      birth_date: '1990-05-20',
      birth_time: '',
      birth_place: '台北市',
      phone: '0912 345 678',
      email: 'a@b.co',
      questions: '今年適合換工作嗎？',
      pay_method: 'atm',
      agree: true,
    });
    expect(toBookingBody({ svc: 'flow', date: 'd', time: 't', f: EMPTY_FORM, pay: 'card', agree: true }).gender).toBe('female');
  });
});

describe('mapApiFieldErrors（400 validation → 欄位與步驟）', () => {
  it('對應到前端欄位，回到有錯的最前面那一步', () => {
    expect(mapApiFieldErrors({ email: '請填寫有效的 Email', agree: '請勾選同意改期與退款規則' })).toEqual({
      errors: { email: '請填寫有效的 Email', agree: '請勾選同意改期與退款規則' },
      step: 3,
      unknown: [],
    });
    expect(mapApiFieldErrors({ time: '請選擇時段' }).step).toBe(2);
    expect(mapApiFieldErrors({ service_id: '請選擇方案', name: 'x' }).step).toBe(1);
    expect(mapApiFieldErrors({ pay_method: 'LINE Pay 即將開放' })).toEqual({ errors: { pay: 'LINE Pay 即將開放' }, step: 4, unknown: [] });
  });
  it('認不得的欄位留在 Step 4 當整體訊息', () => {
    expect(mapApiFieldErrors({ foo: '奇怪的錯' })).toEqual({ errors: {}, step: 4, unknown: ['奇怪的錯'] });
    expect(mapApiFieldErrors(undefined)).toEqual({ errors: {}, step: 4, unknown: [] });
  });
});

describe('沿用訂單（從綠界返回後重新付款）', () => {
  const now = Date.parse('2026-09-24T12:00:00+08:00');
  const order: PendingOrder = {
    orderNo: 'YS8K2M4Q7T',
    svc: 'love',
    date: '2026-10-07',
    time: '19:00',
    pay: 'card',
    amount: 3600,
    holdExpiresAt: '2026-09-24T12:15:00+08:00',
    fp: formFingerprint(f),
  };
  const same = { svc: 'love', date: '2026-10-07', time: '19:00', pay: 'card' as const, f };

  it('方案、時段、付款方式、資料都一樣且保留未逾時 → 沿用', () => {
    expect(canReuseOrder(order, same, now)).toBe(true);
    // 只有前後空白不同也算一樣
    expect(canReuseOrder(order, { ...same, f: { ...f, name: '王小美' } }, now)).toBe(true);
  });
  it('任何一項不同、或已逾時 → 不沿用', () => {
    expect(canReuseOrder(null, same, now)).toBe(false);
    expect(canReuseOrder(order, { ...same, pay: 'atm' }, now)).toBe(false);
    expect(canReuseOrder(order, { ...same, time: '20:30' }, now)).toBe(false);
    expect(canReuseOrder(order, { ...same, svc: 'flow' }, now)).toBe(false);
    expect(canReuseOrder(order, { ...same, f: { ...f, email: 'c@d.co' } }, now)).toBe(false);
    expect(canReuseOrder(order, same, Date.parse('2026-09-24T12:15:00+08:00'))).toBe(false);
  });
  it('holdExpired / isOwnHold', () => {
    expect(holdExpired({ holdExpiresAt: null }, now)).toBe(false);
    expect(holdExpired({ holdExpiresAt: '2026-09-24T11:59:59+08:00' }, now)).toBe(true);
    expect(isOwnHold(order, { date: '2026-10-07', time: '19:00' }, now)).toBe(true);
    expect(isOwnHold(order, { date: '2026-10-07', time: '20:30' }, now)).toBe(false);
    expect(isOwnHold(order, { date: '2026-10-07', time: '19:00' }, Date.parse('2026-09-24T13:00:00+08:00'))).toBe(false);
  });
});

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

describe('sessionStorage 草稿', () => {
  it('存取來回一致', () => {
    const s = new MemoryStorage();
    const d = { ...EMPTY_DRAFT, svc: 'love', date: '2026-10-07', time: '19:00', f, pay: 'atm' as const, agree: true };
    saveDraft(d, s);
    expect(loadDraft(s)).toEqual({ ...d, f: { ...f, name: ' 王小美 ' } });
  });

  it('形狀不對的欄位用預設值；壞掉的 JSON 回 null', () => {
    expect(sanitizeDraft({ svc: 123, date: '10/7', time: '19:00', pay: 'bitcoin', agree: 'yes', f: { gender: 'x', name: 5 } })).toEqual(EMPTY_DRAFT);
    const s = new MemoryStorage();
    s.setItem(DRAFT_KEY, '{oops');
    expect(loadDraft(s)).toBeNull();
    expect(loadDraft(null)).toBeNull();
    // 訂單編號格式不對就不沿用
    expect(sanitizeDraft({ order: { orderNo: 'hack', svc: 'love', date: '2026-10-07', time: '19:00', pay: 'card' } }).order).toBeNull();
  });

  it('storage 丟例外不會讓頁面壞掉', () => {
    const broken = new MemoryStorage();
    broken.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    broken.getItem = () => {
      throw new Error('SecurityError');
    };
    expect(() => saveDraft(EMPTY_DRAFT, broken)).not.toThrow();
    expect(loadDraft(broken)).toBeNull();
  });

  it('clearDraftForOrder 只清同一筆訂單；forgetOrder 只拿掉訂單、資料留著', () => {
    const s = new MemoryStorage();
    const order: PendingOrder = { orderNo: 'YS8K2M4Q7T', svc: 'love', date: '2026-10-07', time: '19:00', pay: 'card', amount: 3600, holdExpiresAt: null, fp: '' };
    saveDraft({ ...EMPTY_DRAFT, f, order }, s);
    clearDraftForOrder('YS22222222', s);
    expect(loadDraft(s)?.order?.orderNo).toBe('YS8K2M4Q7T');
    forgetOrder('YS8K2M4Q7T', s);
    expect(loadDraft(s)?.order).toBeNull();
    expect(loadDraft(s)?.f.email).toBe(' a@b.co ');
    saveDraft({ ...EMPTY_DRAFT, order }, s);
    clearDraftForOrder('YS8K2M4Q7T', s);
    expect(loadDraft(s)).toBeNull();
  });
});
