import { describe, expect, it } from 'vitest';
import { runJobsOnce } from '../src/jobs/expire-holds';
import { fromTaipei } from '../src/lib/time';
import { atmInfoParams, bookingBody, paidParams } from './helpers/ecpay-params';
import {
  makeFakeFetch,
  makeHarness,
  postForm,
  postJson,
  signedEcpayForm,
  type FakeFetch,
  type Harness,
} from './helpers/harness';

// 付款審查的修正（第 1–4、6 項）。基準：2026-09-24（四）10:00 台北
const NOW = new Date('2026-09-24T10:00:00+08:00');
type Json = Record<string, any>;

let ipSeq = 0;
const nextIp = () => `198.51.100.${(ipSeq = (ipSeq % 250) + 1)}`;

async function book(h: Harness, patch: Json = {}) {
  const res = await postJson(h, '/bookings', { ...bookingBody, ...patch }, { 'x-forwarded-for': nextIp() });
  expect(res.status).toBe(201);
  return (await res.json()) as Json;
}

async function checkout(h: Harness, orderNo: string, ip = nextIp()) {
  return postJson(h, '/payments/ecpay/checkout', { orderNo }, { 'x-forwarded-for': ip });
}

async function checkoutFields(h: Harness, orderNo: string) {
  const res = await checkout(h, orderNo);
  expect(res.status).toBe(200);
  return ((await res.json()) as { fields: Record<string, string> }).fields;
}

describe('1. 綠界信用卡 RtnCode≠1：只有確定失敗才標 failed', () => {
  // 來源：developers.ecpay.com.tw 付款結果通知（2878）「常見交易狀態」與交易狀態代碼表（5740）
  for (const code of ['10100058', '10100248', '10100251', '10100252', '10100254', '10100255', '10100256', '10800001', '10300024']) {
    it(`確定失敗 ${code} → payments=failed、不通知老師`, async () => {
      const h = makeHarness({ now: NOW });
      const b = await book(h);
      const f = await checkoutFields(h, b.orderNo);
      const r = await postForm(h, '/payments/ecpay/result', signedEcpayForm(paidParams(f.MerchantTradeNo!, 3600, { RtnCode: code })));
      expect(r.status).toBe(303);
      await h.flush();
      expect(h.db.payments[0]!.status).toBe('failed');
      expect(h.db.booking(b.orderNo)!.needsAttention).toBe(false);
      expect(h.mailer.tags()).toEqual([]);
    });
  }

  it('10300066「交易付款結果待確認中」→ 不標 failed，標人工處理並通知老師', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    const f = await checkoutFields(h, b.orderNo);
    const r = await postForm(h, '/payments/ecpay/notify', signedEcpayForm(paidParams(f.MerchantTradeNo!, 3600, { RtnCode: '10300066' })));
    expect(await r.text()).toBe('1|OK');
    await h.flush();
    expect(h.db.payments[0]!.status).toBe('init');
    const row = h.db.booking(b.orderNo)!;
    expect(row.status).toBe('pending_payment');
    expect(row.needsAttention).toBe(true);
    expect(row.attentionReason).toBe('payment_pending_review');
    expect(h.mailer.tags()).toEqual(['admin_alert']);
  });

  it('不認得的代碼 → 同樣標人工處理；之後收到成功通知 → confirmed 且清除暫時性標記', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    const f = await checkoutFields(h, b.orderNo);
    await postForm(h, '/payments/ecpay/result', signedEcpayForm(paidParams(f.MerchantTradeNo!, 3600, { RtnCode: '99999999' })));
    await h.flush();
    expect(h.db.payments[0]!.status).toBe('init');
    expect(h.db.booking(b.orderNo)!.attentionReason).toBe('payment_unknown_status');
    expect(h.mailer.tags()).toEqual(['admin_alert']);

    await postForm(h, '/payments/ecpay/notify', signedEcpayForm(paidParams(f.MerchantTradeNo!, 3600)));
    await h.flush();
    const row = h.db.booking(b.orderNo)!;
    expect(row.status).toBe('confirmed');
    expect(row.needsAttention).toBe(false);
    const pub = (await (await h.app.request(`/bookings/${b.orderNo}`)).json()) as Json;
    expect(pub.needsAttention).toBe(false);
  });
});

describe('2. 付款端點限流、沿用嘗試、每筆訂單嘗試上限', () => {
  it('綠界 checkout：同一 IP＋訂單 10 分鐘內第 11 次 → 429 rate_limited', async () => {
    const h = makeHarness({ now: NOW });
    const ip = '203.0.113.50';
    for (let i = 0; i < 10; i++) expect((await checkout(h, 'YS22222222', ip)).status).toBe(404);
    const res = await checkout(h, 'YS22222222', ip);
    expect(res.status).toBe(429);
    expect(((await res.json()) as Json).error).toBe('rate_limited');
    expect(res.headers.get('retry-after')).toBeTruthy();
    // 不同訂單不受影響
    expect((await checkout(h, 'YS33333333', ip)).status).toBe(404);
  });

  it('綠界 checkout：每筆訂單最多 10 次付款嘗試，第 11 次 → 429 too_many_attempts', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    for (let i = 0; i < 10; i++) expect((await checkout(h, b.orderNo)).status).toBe(200);
    const res = await checkout(h, b.orderNo);
    expect(res.status).toBe(429);
    const body = (await res.json()) as Json;
    expect(body.error).toBe('too_many_attempts');
    expect(body.message).toContain('客服');
    expect(h.db.payments).toHaveLength(10);
  });

  const TX = '2023042201206549310';
  function linepay(check: string) {
    const state = { check, requests: 0 };
    const f: FakeFetch = makeFakeFetch((url) => {
      if (url.endsWith('/v3/payments/request')) {
        state.requests++;
        const tx = `20230422012065${String(49310 + state.requests).padStart(5, '0')}`;
        return {
          body: `{"returnCode":"0000","returnMessage":"Success.","info":{"paymentUrl":{"web":"https://sandbox-web-pay.line.me/web/payment/wait?transactionReserveId=r${state.requests}"},"transactionId":${tx}}}`,
        };
      }
      if (url.includes('/v3/payments/requests/') && url.endsWith('/check')) return { body: `{"returnCode":"${state.check}","returnMessage":"x"}` };
      if (url.endsWith('/confirm')) return { body: `{"returnCode":"0000","returnMessage":"OK","info":{"transactionId":${TX}}}` };
      return new Error(`unexpected ${url}`);
    });
    const h = makeHarness({
      now: NOW,
      env: { LINEPAY_CHANNEL_ID: '1234567890', LINEPAY_CHANNEL_SECRET: 'a917ab6a2367b536f8e5a6e2977e06f4' },
      linepayFetch: f,
    });
    return { h, f, state };
  }
  const lpRequest = (h: Harness, orderNo: string, ip = nextIp()) =>
    postJson(h, '/payments/linepay/request', { orderNo }, { 'x-forwarded-for': ip });

  it('LINE Pay：上一筆嘗試還在等使用者付款（Check 0000）→ 沿用同一個 paymentUrl，不建新交易', async () => {
    const { h, state } = linepay('0000');
    const b = await book(h, { pay_method: 'line' });
    const r1 = (await (await lpRequest(h, b.orderNo)).json()) as Json;
    const r2res = await lpRequest(h, b.orderNo);
    expect(r2res.status).toBe(200);
    const r2 = (await r2res.json()) as Json;
    expect(r2.paymentUrl).toBe(r1.paymentUrl);
    expect(state.requests).toBe(1);
    expect(h.db.payments).toHaveLength(1);
  });

  it('LINE Pay：每筆訂單最多 10 次嘗試 → 429 too_many_attempts', async () => {
    const { h, state } = linepay('0121'); // 每次舊嘗試都已逾時 → 建新的
    const b = await book(h, { pay_method: 'line' });
    for (let i = 0; i < 10; i++) expect((await lpRequest(h, b.orderNo)).status).toBe(200);
    const res = await lpRequest(h, b.orderNo);
    expect(res.status).toBe(429);
    expect(((await res.json()) as Json).error).toBe('too_many_attempts');
    expect(state.requests).toBe(10);
  });

  it('LINE Pay：同一 IP＋訂單第 11 次 → 429 rate_limited', async () => {
    const { h } = linepay('0000');
    const ip = '203.0.113.60';
    for (let i = 0; i < 10; i++) expect((await lpRequest(h, 'YS22222222', ip)).status).toBe(404);
    expect((await lpRequest(h, 'YS22222222', ip)).status).toBe(429);
  });
});

describe('3. LINE Pay Confirm 失敗後 Check 回不明代碼 → 不標 failed、交給對帳並通知老師', () => {
  const TX = '2023042201206549310';
  function setup(check: string) {
    const state = { check };
    const f: FakeFetch = makeFakeFetch((url) => {
      if (url.endsWith('/v3/payments/request')) {
        return { body: `{"returnCode":"0000","returnMessage":"Success.","info":{"paymentUrl":{"web":"https://sandbox-web-pay.line.me/x"},"transactionId":${TX}}}` };
      }
      if (url.endsWith(`/v3/payments/${TX}/confirm`)) return { body: '{"returnCode":"1172","returnMessage":"x"}' };
      if (url.endsWith(`/v3/payments/requests/${TX}/check`)) return { body: `{"returnCode":"${state.check}","returnMessage":"x"}` };
      return new Error(`unexpected ${url}`);
    });
    const h = makeHarness({
      now: NOW,
      env: { LINEPAY_CHANNEL_ID: '1234567890', LINEPAY_CHANNEL_SECRET: 'a917ab6a2367b536f8e5a6e2977e06f4' },
      linepayFetch: f,
    });
    return { h, state };
  }

  for (const code of ['1104', '1105', '9000']) {
    it(`Check ${code} → payments 維持 init、通知老師`, async () => {
      const { h } = setup(code);
      const b = await book(h, { pay_method: 'line' });
      await postJson(h, '/payments/linepay/request', { orderNo: b.orderNo }, { 'x-forwarded-for': nextIp() });
      const p = h.db.payments[0]!;
      await h.app.request(`/payments/linepay/confirm?transactionId=${TX}&orderId=${p.tradeNo}`);
      await h.flush();
      expect(p.status).toBe('init');
      expect(h.db.booking(b.orderNo)!.status).toBe('pending_payment');
      expect(h.mailer.tags()).toEqual(['admin_alert']);
    });
  }

  it('Check 0122 → 確定失敗', async () => {
    const { h } = setup('0122');
    const b = await book(h, { pay_method: 'line' });
    await postJson(h, '/payments/linepay/request', { orderNo: b.orderNo }, { 'x-forwarded-for': nextIp() });
    const p = h.db.payments[0]!;
    await h.app.request(`/payments/linepay/confirm?transactionId=${TX}&orderId=${p.tradeNo}`);
    await h.flush();
    expect(p.status).toBe('failed');
    expect(h.mailer.tags()).toEqual([]);
  });
});

describe('4. 補確認／ATM 恢復前先釋出同時段「保留已過期但還沒掃」的預約', () => {
  it('綠界：逾時後付款、同時段有別人的過期保留（尚未掃）→ 釋出它並確認', async () => {
    const h = makeHarness({ now: NOW });
    const a = await book(h);
    const f = await checkoutFields(h, a.orderNo);
    h.clock.now = new Date(NOW.getTime() + 20 * 60_000);
    await h.db.expireStaleHolds(); // A → expired
    const b = h.db.addBooking({
      startsAt: fromTaipei('2026-10-07', '19:00'),
      status: 'pending_payment',
      holdExpiresAt: new Date(h.clock.now.getTime() - 60_000), // 已過期、背景工作還沒掃
    });
    await postForm(h, '/payments/ecpay/notify', signedEcpayForm(paidParams(f.MerchantTradeNo!, 3600)));
    await h.flush();
    expect(h.db.booking(a.orderNo)!.status).toBe('confirmed');
    expect(b.status).toBe('expired');
    expect(h.mailer.tags()).toEqual(['booking_confirmed', 'admin_new_order']);
  });

  it('綠界 ATM：逾時後才取號、同時段有別人的過期保留 → 釋出它並恢復待轉帳', async () => {
    const h = makeHarness({ now: NOW });
    const a = await book(h, { pay_method: 'atm' });
    const f = await checkoutFields(h, a.orderNo);
    h.clock.now = new Date(NOW.getTime() + 40 * 60_000);
    await h.db.expireStaleHolds(); // A（30 分鐘保留）→ expired
    const b = h.db.addBooking({
      startsAt: fromTaipei('2026-10-07', '19:00'),
      status: 'pending_payment',
      holdExpiresAt: new Date(h.clock.now.getTime() - 60_000),
    });
    await postForm(h, '/payments/ecpay/atm-info', signedEcpayForm(atmInfoParams(f.MerchantTradeNo!, 3600)));
    expect(h.db.booking(a.orderNo)!.status).toBe('awaiting_transfer');
    expect(b.status).toBe('expired');
  });

  it('LINE Pay：isConfirmable 與 SQL 一致 → 過期保留視為空位、Confirm 後成功確認（不會先扣款再失敗）', async () => {
    const TX = '2023042201206549310';
    const f = makeFakeFetch((url) => {
      if (url.endsWith('/v3/payments/request')) {
        return { body: `{"returnCode":"0000","returnMessage":"Success.","info":{"paymentUrl":{"web":"https://sandbox-web-pay.line.me/x"},"transactionId":${TX}}}` };
      }
      if (url.endsWith('/confirm')) return { body: `{"returnCode":"0000","returnMessage":"OK","info":{"transactionId":${TX}}}` };
      return new Error(`unexpected ${url}`);
    });
    const h = makeHarness({
      now: NOW,
      env: { LINEPAY_CHANNEL_ID: '1234567890', LINEPAY_CHANNEL_SECRET: 'a917ab6a2367b536f8e5a6e2977e06f4' },
      linepayFetch: f,
    });
    const a = await book(h, { pay_method: 'line' });
    await postJson(h, '/payments/linepay/request', { orderNo: a.orderNo }, { 'x-forwarded-for': nextIp() });
    const p = h.db.payments[0]!;
    h.clock.now = new Date(NOW.getTime() + 20 * 60_000);
    await h.db.expireStaleHolds();
    const b = h.db.addBooking({
      startsAt: fromTaipei('2026-10-07', '19:00'),
      status: 'pending_payment',
      holdExpiresAt: new Date(h.clock.now.getTime() - 60_000),
    });
    await h.app.request(`/payments/linepay/confirm?transactionId=${TX}&orderId=${p.tradeNo}`);
    await h.flush();
    expect(f.calls.filter((c) => c.url.endsWith('/confirm'))).toHaveLength(1);
    expect(h.db.booking(a.orderNo)!.status).toBe('confirmed');
    expect(h.db.booking(a.orderNo)!.needsAttention).toBe(false);
    expect(b.status).toBe('expired');
  });
});

describe('6. GET /bookings/:orderNo 回 needsAttention', () => {
  it('一般為 false；金額不符後為 true', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    let pub = (await (await h.app.request(`/bookings/${b.orderNo}`)).json()) as Json;
    expect(pub.needsAttention).toBe(false);
    const f = await checkoutFields(h, b.orderNo);
    await postForm(h, '/payments/ecpay/notify', signedEcpayForm(paidParams(f.MerchantTradeNo!, 1)));
    pub = (await (await h.app.request(`/bookings/${b.orderNo}`)).json()) as Json;
    expect(pub.needsAttention).toBe(true);
  });

  it('背景對帳：LINE Pay Check 回不明代碼時維持 init（與 Confirm 路徑一致）', async () => {
    const TX = '2023042201206549310';
    const f = makeFakeFetch((url) => {
      if (url.endsWith('/v3/payments/request')) {
        return { body: `{"returnCode":"0000","returnMessage":"Success.","info":{"paymentUrl":{"web":"https://sandbox-web-pay.line.me/x"},"transactionId":${TX}}}` };
      }
      if (url.endsWith('/check')) return { body: '{"returnCode":"9000","returnMessage":"x"}' };
      return new Error(`unexpected ${url}`);
    });
    const h = makeHarness({
      now: NOW,
      env: { LINEPAY_CHANNEL_ID: '1234567890', LINEPAY_CHANNEL_SECRET: 'a917ab6a2367b536f8e5a6e2977e06f4' },
      linepayFetch: f,
    });
    const b = await book(h, { pay_method: 'line' });
    await postJson(h, '/payments/linepay/request', { orderNo: b.orderNo }, { 'x-forwarded-for': nextIp() });
    h.clock.now = new Date(NOW.getTime() + 5 * 60_000);
    await runJobsOnce(h.deps);
    expect(h.db.payments[0]!.status).toBe('init');
  });
});
