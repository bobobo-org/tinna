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
      topics: [],
      topic_note: '',
      referral_code: '',
      pay_method: 'atm',
      agree: true,
    });
    expect(toBookingBody({ svc: 'flow', date: 'd', time: 't', f: EMPTY_FORM, pay: 'card', agree: true }).gender).toBe('female');
  });

  it('自選主題：主題照優先順序送出、備註 trim', () => {
    const b = toBookingBody({
      svc: 'topics-6',
      date: '2026-10-07',
      time: '19:00',
      f,
      pay: 'card',
      agree: true,
      topics: ['財運', '工作', '健康', '小孩', '其他'],
      topicNote: ' 想問搬家 ',
    });
    expect(b.topics).toEqual(['財運', '工作', '健康', '小孩', '其他']);
    expect(b.topic_note).toBe('想問搬家');
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
    expect(mapApiFieldErrors({ topics: '請至少選擇 4 個主題' })).toEqual({ errors: { svc: '請至少選擇 4 個主題' }, step: 1, unknown: [] });
    expect(mapApiFieldErrors({ questions: '請填寫這一欄' })).toEqual({ errors: { q: '請填寫這一欄' }, step: 3, unknown: [] });
    expect(mapApiFieldErrors({ referral_code: '找不到這個推薦碼' })).toEqual({ errors: { ref: '找不到這個推薦碼' }, step: 4, unknown: [] });
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
  it('自選主題：主題、順序、備註都一樣才沿用；沒選主題時指紋和舊版相同', () => {
    expect(formFingerprint(f, [], '  ')).toBe(formFingerprint(f));
    const topics = ['財運', '工作', '健康', '小孩'];
    const withTopics = { ...order, svc: 'topics-4', fp: formFingerprint(f, topics, '備註') };
    const s = { ...same, svc: 'topics-4', topics, topicNote: ' 備註 ' };
    expect(canReuseOrder(withTopics, s, now)).toBe(true);
    expect(canReuseOrder(withTopics, { ...s, topics: ['工作', '財運', '健康', '小孩'] }, now)).toBe(false);
    expect(canReuseOrder(withTopics, { ...s, topicNote: '別的' }, now)).toBe(false);
    expect(canReuseOrder(withTopics, { ...s, topics: [], topicNote: '' }, now)).toBe(false);
  });
  it('推薦碼改了（或拿掉）→ 金額不同，不沿用', () => {
    const withRef = { ...order, fp: formFingerprint(f, [], '', 'AMY10') };
    expect(canReuseOrder(withRef, { ...same, referral: 'AMY10' }, now)).toBe(true);
    expect(canReuseOrder(withRef, { ...same, referral: '' }, now)).toBe(false);
    expect(canReuseOrder(withRef, { ...same, referral: 'BOB20' }, now)).toBe(false);
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

  it('自選主題：只留認得的主題、去重、保持順序；備註限 500 字', () => {
    const d = sanitizeDraft({ topics: ['財運', 'hack', '工作', '財運', 3, '其他'], topicNote: 'x'.repeat(600) });
    expect(d.topics).toEqual(['財運', '工作', '其他']);
    expect(d.topicNote).toHaveLength(500);
    expect(sanitizeDraft({ topics: '財運' }).topics).toEqual([]);
  });

  it('推薦碼：只留格式正確的', () => {
    expect(sanitizeDraft({ referral: 'AMY10' }).referral).toBe('AMY10');
    expect(sanitizeDraft({ referral: '<script>' }).referral).toBe('');
    expect(sanitizeDraft({ referral: 5 }).referral).toBe('');
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
