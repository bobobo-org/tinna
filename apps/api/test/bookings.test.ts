import { describe, expect, it } from 'vitest';
import { ORDER_NO_RE } from '../src/lib/order-no';
import { fromTaipei } from '../src/lib/time';
import { makeHarness, postJson } from './helpers/harness';

const NOW = new Date('2026-09-24T10:00:00+08:00');

const valid = {
  service_id: 'love',
  date: '2026-10-07',
  time: '19:00',
  name: '王小美',
  gender: 'female',
  birth_date: '1995-03-12',
  birth_time: '',
  birth_place: '台北市',
  phone: '0912345678',
  email: 'a@b.co',
  questions: '今年感情？',
  pay_method: 'card',
  agree: true,
};

type Json = Record<string, any>;
const body = async (res: Response) => (await res.json()) as Json;

describe('POST /bookings：驗證（README §5.5）', () => {
  const cases: [string, Json, string, string][] = [
    ['姓名空白', { name: '   ' }, 'name', '請填寫姓名'],
    ['缺姓名', { name: undefined }, 'name', '請填寫姓名'],
    ['缺出生日期', { birth_date: '' }, 'birth_date', '請選擇出生日期'],
    ['出生日期不存在', { birth_date: '1995-02-30' }, 'birth_date', '請選擇出生日期'],
    ['出生日期在未來', { birth_date: '2030-01-01' }, 'birth_date', '請確認出生日期'],
    ['Email 格式', { email: 'a@b' }, 'email', '請填寫有效的 Email'],
    ['Email 有空白', { email: 'a b@c.co' }, 'email', '請填寫有效的 Email'],
    ['手機不足 9 碼', { phone: '0912-345' }, 'phone', '請填寫手機號碼'],
    ['未同意條款', { agree: false }, 'agree', '請勾選同意改期與退款規則'],
    ['agree 不是 true', { agree: 'true' }, 'agree', '請勾選同意改期與退款規則'],
    ['性別', { gender: 'x' }, 'gender', '請選擇性別'],
    ['付款方式', { pay_method: 'cash' }, 'pay_method', '請選擇付款方式'],
    ['出生時間格式', { birth_time: '25:00' }, 'birth_time', '出生時間格式不正確'],
    ['日期格式', { date: '2026/10/07' }, 'date', '請選擇日期'],
    ['時間格式', { time: '7pm' }, 'time', '請選擇時段'],
    ['未知方案', { service_id: 'nope' }, 'service_id', '請選擇方案'],
  ];

  for (const [label, patch, field, msg] of cases) {
    it(`${label} → 400 fields.${field}`, async () => {
      const h = makeHarness({ now: NOW });
      const res = await postJson(h, '/bookings', { ...valid, ...patch });
      expect(res.status).toBe(400);
      const b = await body(res);
      expect(b.error).toBe('validation');
      expect(b.fields[field]).toBe(msg);
      expect(typeof b.message).toBe('string');
      expect(h.db.bookings).toHaveLength(0);
    });
  }

  it('手機可以有分隔符號（數字 ≥ 9 碼即可）', async () => {
    const h = makeHarness({ now: NOW });
    const res = await postJson(h, '/bookings', { ...valid, phone: '0912-345-678' });
    expect(res.status).toBe(201);
  });

  it('一次回報多個欄位錯誤', async () => {
    const h = makeHarness({ now: NOW });
    const res = await postJson(h, '/bookings', { ...valid, name: '', email: 'x', phone: '1', agree: false });
    const b = await body(res);
    expect(Object.keys(b.fields).sort()).toEqual(['agree', 'email', 'name', 'phone']);
  });

  it('不是 JSON 物件 → 400', async () => {
    const h = makeHarness({ now: NOW });
    const res = await h.app.request('/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[1,2]' });
    expect(res.status).toBe(400);
    const res2 = await h.app.request('/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    expect(res2.status).toBe(400);
  });

  it('LINE Pay 未設定 → 400 fields.pay_method', async () => {
    const h = makeHarness({ now: NOW });
    const res = await postJson(h, '/bookings', { ...valid, pay_method: 'line' });
    expect(res.status).toBe(400);
    expect((await body(res)).fields.pay_method).toBe('LINE Pay 即將開放，請改用信用卡或 ATM 轉帳');
  });

  it('綠界未設定 → 信用卡／ATM 不收單', async () => {
    const h = makeHarness({ now: NOW, env: { ECPAY_MERCHANT_ID: undefined, ECPAY_HASH_KEY: undefined, ECPAY_HASH_IV: undefined } });
    const res = await postJson(h, '/bookings', valid);
    expect(res.status).toBe(400);
    expect((await body(res)).fields.pay_method).toBeTruthy();
  });
});

describe('POST /bookings：時段', () => {
  it('成功：201、金額取 DB、hold 15 分鐘、訂單編號格式', async () => {
    const h = makeHarness({ now: NOW });
    const res = await postJson(h, '/bookings', { ...valid, amount: 1, price: 1 });
    expect(res.status).toBe(201);
    const b = await body(res);
    expect(Object.keys(b).sort()).toEqual(['amount', 'bookingId', 'holdExpiresAt', 'orderNo', 'payMethod']);
    expect(b.orderNo).toMatch(ORDER_NO_RE);
    expect(b.amount).toBe(3600);
    expect(b.payMethod).toBe('card');
    expect(b.holdExpiresAt).toBe('2026-09-24T10:15:00+08:00');
    const row = h.db.booking(b.orderNo)!;
    expect(row.amount).toBe(3600);
    expect(row.startsAt.toISOString()).toBe('2026-10-07T11:00:00.000Z'); // 19:00 +08:00
    expect(row.endsAt.toISOString()).toBe('2026-10-07T12:30:00.000Z'); // 90 分鐘
    expect(row.status).toBe('pending_payment');
    expect(row.birthTime).toBeNull();
  });

  it('ATM hold 24 小時', async () => {
    const h = makeHarness({ now: NOW });
    const b = await body(await postJson(h, '/bookings', { ...valid, pay_method: 'atm' }));
    expect(b.holdExpiresAt).toBe('2026-09-25T10:00:00+08:00');
  });

  it('週一公休 / 不在時段表 / 24 小時內 / 超出月份 → 409 slot_unavailable', async () => {
    for (const patch of [
      { date: '2026-10-05', time: '19:00' },
      { date: '2026-10-07', time: '18:00' },
      { date: '2026-09-25', time: '09:59' },
      { date: '2026-09-24', time: '20:30' },
      { date: '2026-12-01', time: '19:00' },
    ]) {
      const h = makeHarness({ now: NOW });
      const res = await postJson(h, '/bookings', { ...valid, ...patch });
      expect(res.status).toBe(409);
      expect((await body(res)).error).toBe('slot_unavailable');
    }
  });

  it('date_overrides.closed → 409 slot_unavailable', async () => {
    const h = makeHarness({ now: NOW });
    h.db.overrides.push({ date: '2026-10-07', closed: true, extraTimes: [] });
    const res = await postJson(h, '/bookings', valid);
    expect((await body(res)).error).toBe('slot_unavailable');
  });

  it('已被占用 → 409 slot_taken', async () => {
    const h = makeHarness({ now: NOW });
    h.db.addBooking({ startsAt: fromTaipei('2026-10-07', '19:00'), status: 'confirmed', holdExpiresAt: null });
    const res = await postJson(h, '/bookings', valid);
    expect(res.status).toBe(409);
    const b = await body(res);
    expect(b).toEqual({ error: 'slot_taken', message: '這個時段剛被預約，請重新選擇時段' });
  });

  it('同時送出：insert 撞 unique index → 409 slot_taken', async () => {
    const h = makeHarness({ now: NOW });
    h.db.beforeInsert = (nb) => {
      h.db.beforeInsert = undefined;
      h.db.addBooking({ startsAt: nb.startsAt, status: 'pending_payment' });
    };
    const res = await postJson(h, '/bookings', valid);
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe('slot_taken');
    expect(h.db.bookings).toHaveLength(1);
  });

  it('hold 逾時但背景工作還沒跑 → 先釋出再成功', async () => {
    const h = makeHarness({ now: NOW });
    const old = h.db.addBooking({
      startsAt: fromTaipei('2026-10-07', '19:00'),
      status: 'pending_payment',
      holdExpiresAt: new Date(NOW.getTime() - 1000),
    });
    const res = await postJson(h, '/bookings', valid);
    expect(res.status).toBe(201);
    expect(old.status).toBe('expired');
  });

  it('同時送出重疊但開始時間不同的時段：insert 撞重疊約束 → 409 slot_taken', async () => {
    const h = makeHarness({ now: NOW });
    h.db.overrides.push({ date: '2026-10-07', closed: false, extraTimes: ['20:00'] });
    h.db.beforeInsert = () => {
      h.db.beforeInsert = undefined;
      h.db.addBooking({ startsAt: fromTaipei('2026-10-07', '20:00'), serviceId: 'quick', status: 'pending_payment' });
    };
    const res = await postJson(h, '/bookings', valid); // love 19:00–20:30 與 20:00–20:30 重疊
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe('slot_taken');
  });

  it('與既有預約時間重疊（加開時段）→ 409 slot_taken', async () => {
    const h = makeHarness({ now: NOW });
    h.db.overrides.push({ date: '2026-10-07', closed: false, extraTimes: ['20:00'] });
    h.db.addBooking({ startsAt: fromTaipei('2026-10-07', '20:00'), serviceId: 'quick', status: 'confirmed', holdExpiresAt: null });
    const res = await postJson(h, '/bookings', valid); // love 90 分鐘 19:00–20:30
    expect((await body(res)).error).toBe('slot_taken');
  });
});

describe('POST /bookings：限流', () => {
  it('同一 IP（x-forwarded-for 第一段）每小時 10 次，第 11 次 429', async () => {
    const h = makeHarness({ now: NOW });
    const headers = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
    for (let i = 0; i < 10; i++) {
      const res = await postJson(h, '/bookings', { ...valid, name: '' }, headers);
      expect(res.status).toBe(400);
    }
    const res = await postJson(h, '/bookings', valid, headers);
    expect(res.status).toBe(429);
    expect((await body(res)).error).toBe('rate_limited');
    expect(res.headers.get('Retry-After')).toBeTruthy();
    // 其他 IP 不受影響
    const other = await postJson(h, '/bookings', valid, { 'x-forwarded-for': '198.51.100.7' });
    expect(other.status).toBe(201);
    // 一小時後恢復
    h.clock.now = new Date(NOW.getTime() + 3600_000 + 1);
    const later = await postJson(h, '/bookings', { ...valid, date: '2026-10-08' }, headers);
    expect(later.status).toBe(201);
  });
});

describe('GET /bookings/:orderNo', () => {
  it('只回非敏感欄位', async () => {
    const h = makeHarness({ now: NOW });
    const created = await body(await postJson(h, '/bookings', valid));
    const res = await h.app.request(`/bookings/${created.orderNo}`);
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b).toEqual({
      orderNo: created.orderNo,
      status: 'pending_payment',
      payMethod: 'card',
      amount: 3600,
      service: { id: 'love', name: '感情合盤', minutes: 90 },
      date: '2026-10-07',
      time: '19:00',
      startsAt: '2026-10-07T19:00:00+08:00',
      holdExpiresAt: '2026-09-24T10:15:00+08:00',
    });
    const text = JSON.stringify(b);
    for (const pii of ['王小美', '0912345678', 'a@b.co', '1995-03-12', '今年感情', '台北市']) {
      expect(text).not.toContain(pii);
    }
  });

  it('ATM 取號後帶 atm', async () => {
    const h = makeHarness({ now: NOW });
    const bk = h.db.addBooking({
      startsAt: fromTaipei('2026-10-07', '19:00'),
      status: 'awaiting_transfer',
      payMethod: 'atm',
      atmBankCode: '822',
      atmAccount: '9103522175887271',
      atmExpiresAt: new Date('2026-09-25T23:59:59+08:00'),
      holdExpiresAt: new Date('2026-09-25T23:59:59+08:00'),
    });
    const b = await body(await h.app.request(`/bookings/${bk.orderNo}`));
    expect(b.atm).toEqual({ bankCode: '822', account: '9103522175887271', expireDate: '2026/09/25 23:59:59' });
  });

  it('查無 / 格式錯誤 → 404', async () => {
    const h = makeHarness({ now: NOW });
    expect((await h.app.request('/bookings/YS22222222')).status).toBe(404);
    expect((await h.app.request('/bookings/hello')).status).toBe(404);
  });

  it('log 不含個資', async () => {
    const h = makeHarness({ now: NOW });
    await postJson(h, '/bookings', valid);
    const text = h.logger.text();
    for (const pii of ['王小美', '0912345678', 'a@b.co', '1995-03-12', '今年感情']) expect(text).not.toContain(pii);
    expect(text).toContain('booking.created');
  });
});
