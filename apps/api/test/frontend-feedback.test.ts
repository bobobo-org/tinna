import { describe, expect, it } from 'vitest';
import { fromTaipei } from '../src/lib/time';
import { bookingBody } from './helpers/ecpay-params';
import { makeHarness, postJson, type Harness } from './helpers/harness';

// 前端實測回饋（F、G、H）。基準：2026-09-24（四）10:00 台北
const NOW = new Date('2026-09-24T10:00:00+08:00');
type Json = Record<string, any>;

let ipSeq = 0;
const nextIp = () => `198.18.0.${(ipSeq = (ipSeq % 250) + 1)}`;
const post = (h: Harness, body: Json) => postJson(h, '/bookings', { ...bookingBody, ...body }, { 'x-forwarded-for': nextIp() });
const json = async (r: Response) => (await r.json()) as Json;

describe('F. POST /bookings 每 IP 每小時 30 次', () => {
  it('第 30 次還可以、第 31 次 429', async () => {
    const h = makeHarness({ now: NOW });
    const headers = { 'x-forwarded-for': '203.0.113.200' };
    for (let i = 0; i < 29; i++) expect((await postJson(h, '/bookings', { ...bookingBody, name: '' }, headers)).status).toBe(400);
    expect((await postJson(h, '/bookings', bookingBody, headers)).status).toBe(201); // 第 30 次
    expect((await postJson(h, '/bookings', bookingBody, headers)).status).toBe(429); // 第 31 次
  });
});

describe('G. 同一人同一時段重新送出 → 取消自己的舊保留再建新單', () => {
  it('從綠界返回後換付款方式：舊單 cancelled、新單 201（不會被自己擋成 409）', async () => {
    const h = makeHarness({ now: NOW });
    const first = await json(await post(h, { pay_method: 'card' }));
    const res = await post(h, { pay_method: 'atm', phone: '+886 912-345-678', email: ' GUEST@example.com' });
    expect(res.status).toBe(201);
    const second = await json(res);
    expect(second.orderNo).not.toBe(first.orderNo);
    expect(h.db.booking(first.orderNo)!.status).toBe('cancelled');
    expect(h.db.booking(second.orderNo)!.status).toBe('pending_payment');
    expect((await json(await h.app.request(`/bookings/${first.orderNo}`))).status).toBe('cancelled');
  });

  it('待轉帳（已取號）的舊保留也會被取代', async () => {
    const h = makeHarness({ now: NOW });
    const old = h.db.addBooking({
      startsAt: fromTaipei('2026-10-07', '19:00'),
      status: 'awaiting_transfer',
      payMethod: 'atm',
      holdExpiresAt: new Date('2026-09-25T23:59:59+08:00'),
      email: bookingBody.email,
      phone: bookingBody.phone,
    });
    expect((await post(h, { pay_method: 'card' })).status).toBe(201);
    expect(old.status).toBe('cancelled');
  });

  it('只有 Email 相同（電話不同）不算同一人 → 409 slot_taken', async () => {
    const h = makeHarness({ now: NOW });
    await post(h, {});
    const r = await post(h, { phone: '0987654321' });
    expect(r.status).toBe(409);
    expect((await json(r)).error).toBe('slot_taken');
  });

  it('不同時段不會被取代（仍算在未付款上限內）', async () => {
    const h = makeHarness({ now: NOW });
    const a = await json(await post(h, { date: '2026-10-07' }));
    await post(h, { date: '2026-10-08' });
    const r = await post(h, { date: '2026-10-09' });
    expect(r.status).toBe(409);
    expect((await json(r)).error).toBe('too_many_pending');
    expect(h.db.booking(a.orderNo)!.status).toBe('pending_payment');
  });

  it('已有 2 筆未付款時，重新送出其中一個時段 → 先取代再算上限 → 201', async () => {
    const h = makeHarness({ now: NOW });
    const a = await json(await post(h, { date: '2026-10-07' }));
    await post(h, { date: '2026-10-08' });
    const r = await post(h, { date: '2026-10-07', pay_method: 'atm' });
    expect(r.status).toBe(201);
    expect(h.db.booking(a.orderNo)!.status).toBe('cancelled');
  });

  it('舊單已有付款成功紀錄 → 不可取消 → 409 slot_taken', async () => {
    const h = makeHarness({ now: NOW });
    const old = h.db.addBooking({
      startsAt: fromTaipei('2026-10-07', '19:00'),
      status: 'pending_payment',
      email: bookingBody.email,
      phone: bookingBody.phone,
    });
    h.db.addPayment({ bookingId: old.id, tradeNo: `${old.orderNo}ABCDEFGHJK`, status: 'paid' });
    const r = await post(h, {});
    expect(r.status).toBe(409);
    expect(old.status).toBe('pending_payment');
  });
});

describe('H. /config：綠界未設定時 paymentEnv 為 null', () => {
  it('未設定 → null；stage／prod 照實回', async () => {
    const none = makeHarness({ now: NOW, env: { ECPAY_MERCHANT_ID: undefined, ECPAY_HASH_KEY: undefined, ECPAY_HASH_IV: undefined } });
    expect(await json(await none.app.request('/config'))).toEqual({
      payments: { card: false, atm: false, line: false },
      paymentEnv: null,
      atmMinLeadHours: 72,
    });
    const prod = makeHarness({ now: NOW, env: { ECPAY_ENV: 'prod', ECPAY_MERCHANT_ID: '3999999' } });
    expect((await json(await prod.app.request('/config'))).paymentEnv).toBe('prod');
  });
});
