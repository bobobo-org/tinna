import { describe, expect, it } from 'vitest';
import { clientIp, rateLimitKey } from '../src/lib/rate-limit';
import { fromTaipei } from '../src/lib/time';
import { atmInfoParams, bookingBody } from './helpers/ecpay-params';
import { makeHarness, postForm, postJson, signedEcpayForm, type Harness } from './helpers/harness';

// 資料層／API 安全審查的修正（A、B、C、E）。基準：2026-09-24（四）10:00 台北
const NOW = new Date('2026-09-24T10:00:00+08:00');
type Json = Record<string, any>;

let ipSeq = 0;
const nextIp = () => `192.0.2.${(ipSeq = (ipSeq % 250) + 1)}`;
const post = (h: Harness, body: Json) => postJson(h, '/bookings', { ...bookingBody, ...body }, { 'x-forwarded-for': nextIp() });
const json = async (r: Response) => (await r.json()) as Json;

describe('A. ATM 未付款保留濫用', () => {
  it('ATM 取號前保留 30 分鐘', async () => {
    const h = makeHarness({ now: NOW });
    const b = await json(await post(h, { pay_method: 'atm' }));
    expect(b.holdExpiresAt).toBe('2026-09-24T10:30:00+08:00');
  });

  it('取號後保留 = least(綠界繳費期限, 開始前 24 小時)', async () => {
    const h = makeHarness({ now: NOW });
    // 9/29（二）10:00 開始 → 開始前 24 小時 = 9/28 10:00；綠界期限 9/30 23:59:59
    const b = await json(await post(h, { pay_method: 'atm', date: '2026-09-29', time: '10:00' }));
    const c = await json(await postJson(h, '/payments/ecpay/checkout', { orderNo: b.orderNo }, { 'x-forwarded-for': nextIp() }));
    await postForm(h, '/payments/ecpay/atm-info', signedEcpayForm(atmInfoParams(c.fields.MerchantTradeNo, 3600, { ExpireDate: '2026/09/30' })));
    const pub = await json(await h.app.request(`/bookings/${b.orderNo}`));
    expect(pub.status).toBe('awaiting_transfer');
    expect(pub.holdExpiresAt).toBe('2026-09-28T10:00:00+08:00');
    expect(pub.atm.expireDate).toBe('2026/09/28 10:00:00');
  });

  it('同一 Email 最多 2 筆未付款保留，第 3 筆 → 409 too_many_pending', async () => {
    const h = makeHarness({ now: NOW });
    expect((await post(h, { date: '2026-10-07', phone: '0911111111', email: 'A@Example.com ' })).status).toBe(201);
    expect((await post(h, { date: '2026-10-08', phone: '0922222222', email: 'a@example.com' })).status).toBe(201);
    const r = await post(h, { date: '2026-10-09', phone: '0933333333', email: 'a@EXAMPLE.com' });
    expect(r.status).toBe(409);
    expect(await json(r)).toEqual({
      error: 'too_many_pending',
      message: '您已有尚未完成付款的預約，請先完成付款，或稍後再試',
    });
  });

  it('同一電話（正規化：+886、分隔符號）也算同一人', async () => {
    const h = makeHarness({ now: NOW });
    expect((await post(h, { date: '2026-10-07', phone: '0912-345-678', email: 'x1@example.com' })).status).toBe(201);
    expect((await post(h, { date: '2026-10-08', phone: '+886 912 345 678', email: 'x2@example.com' })).status).toBe(201);
    const r = await post(h, { date: '2026-10-09', phone: '(0912)345678', email: 'x3@example.com' });
    expect(r.status).toBe(409);
    expect((await json(r)).error).toBe('too_many_pending');
  });

  it('已付款或已逾時的不算未付款保留', async () => {
    const h = makeHarness({ now: NOW });
    h.db.addBooking({ startsAt: fromTaipei('2026-10-10', '19:00'), status: 'confirmed', holdExpiresAt: null, email: 'guest@example.com' });
    h.db.addBooking({ startsAt: fromTaipei('2026-10-11', '19:00'), status: 'expired', email: 'guest@example.com' });
    h.db.addBooking({
      startsAt: fromTaipei('2026-10-12', '19:00'),
      status: 'pending_payment',
      holdExpiresAt: new Date(NOW.getTime() - 1), // hold 已過期、還沒掃
      email: 'guest@example.com',
    });
    expect((await post(h, { date: '2026-10-07' })).status).toBe(201);
    expect((await post(h, { date: '2026-10-08' })).status).toBe(201);
  });

  it('全站未付款 ATM 上限 5 筆，第 6 筆 ATM → 400 fields.pay_method；信用卡不受影響', async () => {
    const h = makeHarness({ now: NOW });
    const dates = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
    for (const [i, date] of dates.entries()) {
      const r = await post(h, { pay_method: 'atm', date, phone: `09${String(10000000 + i)}`, email: `atm${i}@example.com` });
      expect(r.status).toBe(201);
    }
    const r = await post(h, { pay_method: 'atm', date: '2026-10-11', phone: '0987654321', email: 'late@example.com' });
    expect(r.status).toBe(400);
    const body = await json(r);
    expect(body.error).toBe('validation');
    expect(body.fields.pay_method).toBe('ATM 轉帳名額暫滿，請改用信用卡');
    const card = await post(h, { pay_method: 'card', date: '2026-10-11', phone: '0987654321', email: 'late@example.com' });
    expect(card.status).toBe(201);
  });
});

describe('B. 限流的 IP 取法', () => {
  const H = (xff: string) => new Headers({ 'x-forwarded-for': xff });

  it('XFF 由右往左，跳過受信任段，取第一個非受信任 IP', () => {
    expect(clientIp(H('6.6.6.6, 203.0.113.9, 10.0.0.1'))).toBe('203.0.113.9');
    expect(clientIp(H('203.0.113.9, 100.64.0.7, 127.0.0.1, 172.16.5.4, 192.168.1.1'))).toBe('203.0.113.9');
    expect(clientIp(H('203.0.113.9'))).toBe('203.0.113.9');
    expect(clientIp(H('[2001:db8::1]:443, fc00::1, ::1'))).toBe('2001:db8::1');
    expect(clientIp(H('::ffff:203.0.113.9'))).toBe('203.0.113.9');
  });

  it('偽造最左段不影響 key', () => {
    const real = rateLimitKey(clientIp(H('203.0.113.9, 10.0.0.1')));
    for (const spoof of ['1.1.1.1', '8.8.8.8, 9.9.9.9', 'garbage', '2001:db8::dead']) {
      expect(rateLimitKey(clientIp(H(`${spoof}, 203.0.113.9, 10.0.0.1`)))).toBe(real);
    }
  });

  it('IPv6 以 /64 當 key', () => {
    const k1 = rateLimitKey(clientIp(H('2001:db8:abcd:12:1::5, 100.64.0.1')));
    const k2 = rateLimitKey(clientIp(H('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff')));
    expect(k1).toBe('2001:db8:abcd:12::/64');
    expect(k2).toBe(k1);
    expect(rateLimitKey('2001:db8:abcd:13::1')).not.toBe(k1);
    expect(rateLimitKey('203.0.113.9')).toBe('203.0.113.9');
  });

  it('全部都是受信任段 → 退回連線來源位址', () => {
    expect(clientIp(H('10.0.0.2, 127.0.0.1'), '198.51.100.20')).toBe('198.51.100.20');
    expect(clientIp(new Headers(), undefined)).toBe('unknown');
  });

  it('POST /bookings：每次換偽造的最左段，同一真實 IP 第 31 次仍 429（上限 30/小時）', async () => {
    const h = makeHarness({ now: NOW });
    for (let i = 0; i < 30; i++) {
      const spoofed = `${i + 1}.2.3.4, 203.0.113.77, 10.0.0.1`; // 最左段每次都不同（偽造）
      const r = await postJson(h, '/bookings', { ...bookingBody, name: '' }, { 'x-forwarded-for': spoofed });
      expect(r.status).toBe(400);
    }
    const r = await postJson(h, '/bookings', bookingBody, { 'x-forwarded-for': '99.99.99.99, 203.0.113.77, 10.0.0.1' });
    expect(r.status).toBe(429);
  });
});

describe('C. ATM 只接受 72 小時後的時段', () => {
  it('不到 72 小時 → 400 fields.pay_method；剛好 72 小時可以；信用卡不受限', async () => {
    const h = makeHarness({ now: NOW });
    const near = await post(h, { pay_method: 'atm', date: '2026-09-26', time: '19:00' }); // 57 小時後
    expect(near.status).toBe(400);
    expect((await json(near)).fields.pay_method).toBe('ATM 轉帳需於諮詢開始 72 小時前預約，請改用信用卡');
    expect((await post(h, { pay_method: 'atm', date: '2026-09-27', time: '10:00' })).status).toBe(201); // 剛好 72 小時
    expect((await post(h, { pay_method: 'card', date: '2026-09-26', time: '19:00' })).status).toBe(201);
  });

  it('/config 回 atmMinLeadHours: 72', async () => {
    const h = makeHarness({ now: NOW });
    expect(await json(await h.app.request('/config'))).toEqual({
      payments: { card: true, atm: true, line: false },
      paymentEnv: 'stage',
      atmMinLeadHours: 72,
    });
  });
});

describe('E. 跨站建單防護（Content-Type、Origin）', () => {
  const endpoints = ['/bookings', '/payments/ecpay/checkout', '/payments/linepay/request'];

  for (const path of endpoints) {
    it(`${path}：text/plain → 415`, async () => {
      const h = makeHarness({ now: NOW });
      const r = await h.app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'x-forwarded-for': nextIp() },
        body: JSON.stringify({ ...bookingBody, orderNo: 'YS22222222' }),
      });
      expect(r.status).toBe(415);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect((await json(r)).error).toBe('unsupported_media_type');
    });

    it(`${path}：Origin 不在白名單 → 403`, async () => {
      const h = makeHarness({ now: NOW });
      const r = await postJson(h, path, { ...bookingBody, orderNo: 'YS22222222' }, { Origin: 'https://evil.example', 'x-forwarded-for': nextIp() });
      expect(r.status).toBe(403);
      expect((await json(r)).error).toBe('forbidden_origin');
    });
  }

  it('白名單 Origin、charset 參數、沒有 Origin（server 端呼叫）都照常', async () => {
    const h = makeHarness({ now: NOW });
    const ok = await h.app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://yuanshe.example', 'x-forwarded-for': nextIp() },
      body: JSON.stringify(bookingBody),
    });
    expect(ok.status).toBe(201);
    const noOrigin = await postJson(h, '/bookings', { ...bookingBody, date: '2026-10-08' }, { 'x-forwarded-for': nextIp() });
    expect(noOrigin.status).toBe(201);
  });

  it('綠界回呼（form POST、Origin 是綠界網域）不受影響', async () => {
    const h = makeHarness({ now: NOW });
    const b = await json(await post(h, {}));
    const c = await json(await postJson(h, '/payments/ecpay/checkout', { orderNo: b.orderNo }, { 'x-forwarded-for': nextIp() }));
    const form = signedEcpayForm({
      MerchantID: '3002607',
      MerchantTradeNo: c.fields.MerchantTradeNo,
      RtnCode: '1',
      RtnMsg: '交易成功',
      TradeAmt: '3600',
      TradeNo: '2609241001009999',
      SimulatePaid: '0',
    });
    const notify = await h.app.request('/payments/ecpay/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    expect(await notify.text()).toBe('1|OK');
    const result = await h.app.request('/payments/ecpay/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://payment-stage.ecpay.com.tw' },
      body: form,
    });
    expect(result.status).toBe(303);
    expect(h.db.booking(b.orderNo)!.status).toBe('confirmed');
  });
});
