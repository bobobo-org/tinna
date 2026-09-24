import { describe, expect, it } from 'vitest';
import { LinePayClient, linePaySignature, parseLinePayJson } from '../src/lib/linepay';
import { runJobsOnce } from '../src/jobs/expire-holds';
import { fromTaipei } from '../src/lib/time';
import { makeFakeFetch, makeHarness, postJson, type FakeFetch } from './helpers/harness';

const NOW = new Date('2026-09-24T10:00:00+08:00');
const SECRET = 'a917ab6a2367b536f8e5a6e2977e06f4';
const NONCE = '3f1a8d2e-5b6c-4d7e-8f90-a1b2c3d4e5f6';

describe('LINE Pay 簽章 HMAC-SHA256(channelSecret, channelSecret + uri + body + nonce)', () => {
  // 期望值以 openssl 獨立計算：printf '%s' "$SECRET$URI$BODY$NONCE" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64
  it('Request API', () => {
    const body = '{"amount":3600,"currency":"TWD","orderId":"YS8K2M4Q7TABCDEFGHJK"}';
    expect(linePaySignature(SECRET, '/v3/payments/request', body, NONCE)).toBe(
      'aR8NgeWpzPdQpQvUWrTFoUaffEa2oWur9SPaze3B7bE=',
    );
  });
  it('Confirm API', () => {
    expect(
      linePaySignature(SECRET, '/v3/payments/2023042201206549310/confirm', '{"amount":3600,"currency":"TWD"}', NONCE),
    ).toBe('75O1Stb9tOcgYN+StBm1VHs/bmxITkrom+gYytcVKzc=');
  });
  it('任何一段不同簽章就不同', () => {
    const a = linePaySignature(SECRET, '/v3/payments/request', '{}', NONCE);
    expect(linePaySignature(SECRET, '/v3/payments/request', '{}', `${NONCE}x`)).not.toBe(a);
    expect(linePaySignature(`${SECRET}x`, '/v3/payments/request', '{}', NONCE)).not.toBe(a);
  });
});

describe('transactionId（19 位數）不失真', () => {
  it('JSON 解析前轉字串', () => {
    const text = '{"returnCode":"0000","info":{"transactionId":2023042201206549310,"paymentAccessToken":"056579816895"}}';
    const v = parseLinePayJson(text) as { info: { transactionId: string } };
    expect(v.info.transactionId).toBe('2023042201206549310');
    expect(String(JSON.parse(text).info.transactionId)).not.toBe('2023042201206549310'); // 直接 parse 會失真
  });
});

describe('LinePayClient', () => {
  it('送出的 header 與簽章可由 body 重新計算', async () => {
    const f = makeFakeFetch(() => ({
      body: '{"returnCode":"0000","returnMessage":"Success.","info":{"paymentUrl":{"web":"https://sandbox-web-pay.line.me/web/payment/wait?transactionReserveId=abc"},"transactionId":2023042201206549310}}',
    }));
    const client = new LinePayClient(
      { channelId: '1234567890', channelSecret: SECRET, env: 'sandbox', apiBase: 'https://sandbox-api-pay.line.me' },
      f as unknown as typeof fetch,
    );
    const res = await client.requestPayment({
      tradeNo: 'YS8K2M4Q7TABCDEFGHJK',
      orderNo: 'YS8K2M4Q7T',
      amount: 3600,
      serviceId: 'love',
      productName: '感情合盤 90分鐘線上諮詢',
      confirmUrl: 'https://api.yuanshe.example/payments/linepay/confirm',
      cancelUrl: 'https://yuanshe.example/booking/success?order=YS8K2M4Q7T',
    });
    expect(res.info!.transactionId).toBe('2023042201206549310');
    const call = f.calls[0]!;
    expect(call.url).toBe('https://sandbox-api-pay.line.me/v3/payments/request');
    const headers = call.init!.headers as Record<string, string>;
    const body = call.init!.body as string;
    expect(headers['X-LINE-ChannelId']).toBe('1234567890');
    expect(headers['Content-Type']).toBe('application/json');
    const nonce = headers['X-LINE-Authorization-Nonce']!;
    expect(nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers['X-LINE-Authorization']).toBe(linePaySignature(SECRET, '/v3/payments/request', body, nonce));
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({
      amount: 3600,
      currency: 'TWD',
      orderId: 'YS8K2M4Q7TABCDEFGHJK',
      redirectUrls: { confirmUrl: 'https://api.yuanshe.example/payments/linepay/confirm' },
    });
    expect(parsed.packages[0].amount).toBe(3600);
    expect(parsed.packages[0].products[0]).toMatchObject({ quantity: 1, price: 3600 });
  });

  it('confirm 拒絕非數字的 transactionId（避免路徑注入）', async () => {
    const f = makeFakeFetch(() => ({ body: '{}' }));
    const client = new LinePayClient(
      { channelId: '1', channelSecret: SECRET, env: 'sandbox', apiBase: 'https://sandbox-api-pay.line.me' },
      f as unknown as typeof fetch,
    );
    await expect(client.confirmPayment('../refund', 1)).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
});

describe('LINE Pay 未設定', () => {
  it('/config line=false、request 回 503', async () => {
    const h = makeHarness({ now: NOW });
    const cfg = (await (await h.app.request('/config')).json()) as Record<string, any>;
    expect(cfg).toEqual({ payments: { card: true, atm: true, line: false }, paymentEnv: 'stage' });
    const res = await postJson(h, '/payments/linepay/request', { orderNo: 'YS22222222' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'payment_unavailable',
      message: 'LINE Pay 即將開放，請改用信用卡或 ATM 轉帳',
    });
  });
});

describe('LINE Pay 已設定：request → confirm → 對帳', () => {
  const TX = '2023042201206549310';
  function setup(opts: { confirm?: string | Error; check?: string | Error } = {}) {
    const state = { confirm: opts.confirm ?? '0000', check: opts.check ?? '0000' };
    const f: FakeFetch = makeFakeFetch((url) => {
      if (url.endsWith('/v3/payments/request')) {
        return {
          body: `{"returnCode":"0000","returnMessage":"Success.","info":{"paymentUrl":{"web":"https://sandbox-web-pay.line.me/web/payment/wait?transactionReserveId=abc","app":"line://pay/payment/abc"},"transactionId":${TX},"paymentAccessToken":"056579816895"}}`,
        };
      }
      if (url.endsWith(`/v3/payments/${TX}/confirm`)) {
        if (state.confirm instanceof Error) return state.confirm;
        return {
          body: `{"returnCode":"${state.confirm}","returnMessage":"x","info":{"orderId":"o","transactionId":${TX},"payInfo":[{"method":"BALANCE","amount":3600}]}}`,
        };
      }
      if (url.endsWith(`/v3/payments/requests/${TX}/check`)) {
        if (state.check instanceof Error) return state.check;
        return { body: `{"returnCode":"${state.check}","returnMessage":"x"}` };
      }
      return new Error(`unexpected ${url}`);
    });
    const h = makeHarness({
      now: NOW,
      env: { LINEPAY_CHANNEL_ID: '1234567890', LINEPAY_CHANNEL_SECRET: SECRET, LINEPAY_ENV: 'sandbox' },
      linepayFetch: f,
    });
    return { h, f, state };
  }

  async function bookLine(h: ReturnType<typeof setup>['h'], date = '2026-10-07') {
    const res = await postJson(h, '/bookings', {
      service_id: 'love',
      date,
      time: '19:00',
      name: '王小美',
      gender: 'female',
      birth_date: '1995-03-12',
      phone: '0912345678',
      email: 'guest@example.com',
      pay_method: 'line',
      agree: true,
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { orderNo: string };
  }

  async function requestAndGetPayment(h: ReturnType<typeof setup>['h'], orderNo: string) {
    const res = await postJson(h, '/payments/linepay/request', { orderNo });
    expect(res.status).toBe(200);
    return h.db.payments[h.db.payments.length - 1]!;
  }

  const confirmCalls = (f: FakeFetch) => f.calls.filter((c) => c.url.endsWith('/confirm')).length;

  it('/config line=true；request 回 paymentUrl；confirm 成功 → confirmed，重複導回不重複 confirm/寄信', async () => {
    const { h, f } = setup();
    expect(((await (await h.app.request('/config')).json()) as any).payments.line).toBe(true);
    const b = await bookLine(h);
    const res = await postJson(h, '/payments/linepay/request', { orderNo: b.orderNo });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      paymentUrl: 'https://sandbox-web-pay.line.me/web/payment/wait?transactionReserveId=abc',
    });
    const payment = h.db.payments[0]!;
    expect(payment.provider).toBe('linepay');
    expect(payment.providerTxnId).toBe(TX);
    const reqBody = JSON.parse(f.calls[0]!.init!.body as string);
    expect(reqBody.redirectUrls.cancelUrl).toBe(`https://yuanshe.example/booking/success?order=${b.orderNo}`);

    const confirmPath = `/payments/linepay/confirm?transactionId=${TX}&orderId=${payment.tradeNo}`;
    let r = await h.app.request(confirmPath);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(`https://yuanshe.example/booking/success?order=${b.orderNo}`);
    await h.flush();
    expect(h.db.booking(b.orderNo)!.status).toBe('confirmed');
    expect(payment.status).toBe('paid');
    const confirmCall = f.calls.find((c) => c.url.endsWith('/confirm'))!;
    expect(JSON.parse(confirmCall.init!.body as string)).toEqual({ amount: 3600, currency: 'TWD' });

    r = await h.app.request(confirmPath);
    expect(r.status).toBe(302);
    await h.flush();
    expect(confirmCalls(f)).toBe(1);
    expect(h.mailer.tags()).toEqual(['booking_confirmed', 'admin_new_order']);
  });

  it('confirm 失敗且查詢為已取消（0121）→ payments=failed、預約仍待付款、導回完成頁', async () => {
    const { h } = setup({ confirm: '1150', check: '0121' });
    const b = await bookLine(h);
    const payment = await requestAndGetPayment(h, b.orderNo);
    const r = await h.app.request(`/payments/linepay/confirm?transactionId=${TX}&orderId=${payment.tradeNo}`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(`https://yuanshe.example/booking/success?order=${b.orderNo}`);
    expect(payment.status).toBe('failed');
    expect(h.db.booking(b.orderNo)!.status).toBe('pending_payment');
  });

  it('confirm 回非 0000 但查詢為已完成（0123）→ 照付款成功處理', async () => {
    const { h } = setup({ confirm: '1172', check: '0123' });
    const b = await bookLine(h);
    const payment = await requestAndGetPayment(h, b.orderNo);
    await h.app.request(`/payments/linepay/confirm?transactionId=${TX}&orderId=${payment.tradeNo}`);
    await h.flush();
    expect(payment.status).toBe('paid');
    expect(h.db.booking(b.orderNo)!.status).toBe('confirmed');
    expect(h.mailer.tags()).toEqual(['booking_confirmed', 'admin_new_order']);
  });

  it('confirm 無回應 → 維持 init、通知老師；背景對帳查到 0123 → confirmed＋寄信', async () => {
    const { h, state } = setup({ confirm: new Error('timeout') });
    const b = await bookLine(h);
    const payment = await requestAndGetPayment(h, b.orderNo);
    await h.app.request(`/payments/linepay/confirm?transactionId=${TX}&orderId=${payment.tradeNo}`);
    await h.flush();
    expect(payment.status).toBe('init');
    expect(h.mailer.tags()).toEqual(['admin_alert']);

    state.check = '0123';
    h.clock.now = new Date(NOW.getTime() + 5 * 60_000);
    await runJobsOnce(h.deps);
    await h.flush();
    expect(payment.status).toBe('paid');
    expect(h.db.booking(b.orderNo)!.status).toBe('confirmed');
    expect(h.mailer.tags()).toEqual(['admin_alert', 'booking_confirmed', 'admin_new_order']);
  });

  it('使用者授權後沒回到 confirmUrl（0110）→ 背景對帳補 Confirm', async () => {
    const { h, f } = setup({ check: '0110' });
    const b = await bookLine(h);
    const payment = await requestAndGetPayment(h, b.orderNo);
    h.clock.now = new Date(NOW.getTime() + 5 * 60_000);
    await runJobsOnce(h.deps);
    await h.flush();
    expect(confirmCalls(f)).toBe(1);
    expect(payment.status).toBe('paid');
    expect(h.db.booking(b.orderNo)!.status).toBe('confirmed');
  });

  it('預約已被其他付款確認 → 不呼叫 Confirm（不扣款）', async () => {
    const { h, f } = setup();
    const b = await bookLine(h);
    const payment = await requestAndGetPayment(h, b.orderNo);
    h.db.booking(b.orderNo)!.status = 'confirmed';
    await h.app.request(`/payments/linepay/confirm?transactionId=${TX}&orderId=${payment.tradeNo}`);
    expect(confirmCalls(f)).toBe(0);
    expect(payment.status).toBe('failed');
  });

  it('保留逾時且時段已被別人約走 → 不呼叫 Confirm', async () => {
    const { h, f } = setup();
    const b = await bookLine(h);
    const payment = await requestAndGetPayment(h, b.orderNo);
    h.clock.now = new Date(NOW.getTime() + 20 * 60_000);
    await h.db.expireStaleHolds();
    h.db.addBooking({ startsAt: fromTaipei('2026-10-07', '19:00'), status: 'confirmed', holdExpiresAt: null });
    await h.app.request(`/payments/linepay/confirm?transactionId=${TX}&orderId=${payment.tradeNo}`);
    expect(confirmCalls(f)).toBe(0);
    expect(h.db.booking(b.orderNo)!.status).toBe('expired');
  });

  it('再次 request 前先收尾上一筆：上一筆其實已扣款（0123）→ 409 already_paid，不會重複扣款', async () => {
    const { h, state } = setup({ confirm: new Error('timeout') });
    const b = await bookLine(h);
    const payment = await requestAndGetPayment(h, b.orderNo);
    await h.app.request(`/payments/linepay/confirm?transactionId=${TX}&orderId=${payment.tradeNo}`);
    state.check = '0123';
    const res = await postJson(h, '/payments/linepay/request', { orderNo: b.orderNo });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe('already_paid');
    expect(h.db.booking(b.orderNo)!.status).toBe('confirmed');
    expect(h.db.payments).toHaveLength(1);
  });

  it('transactionId 與 request 時不同 → 不呼叫 Confirm', async () => {
    const { h, f } = setup();
    const b = await bookLine(h);
    const payment = await requestAndGetPayment(h, b.orderNo);
    await h.app.request(`/payments/linepay/confirm?transactionId=1111111111111111111&orderId=${payment.tradeNo}`);
    expect(confirmCalls(f)).toBe(0);
    expect(payment.status).toBe('init');
  });

  it('信用卡訂單不能走 LINE Pay request', async () => {
    const { h } = setup();
    const res = await postJson(h, '/bookings', {
      service_id: 'love',
      date: '2026-10-08',
      time: '19:00',
      name: 'x',
      gender: 'male',
      birth_date: '1990-01-01',
      phone: '0912345678',
      email: 'x@y.co',
      pay_method: 'card',
      agree: true,
    });
    const { orderNo } = (await res.json()) as { orderNo: string };
    expect((await postJson(h, '/payments/linepay/request', { orderNo })).status).toBe(409);
  });
});
