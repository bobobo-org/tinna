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

// 第二次驗收審查（fresh-context）找到的問題。基準：2026-09-24（四）10:00 台北
const NOW = new Date('2026-09-24T10:00:00+08:00');
type Json = Record<string, any>;

let ipSeq = 0;
const nextIp = () => `198.19.0.${(ipSeq = (ipSeq % 250) + 1)}`;
const post = (h: Harness, body: Json) => postJson(h, '/bookings', { ...bookingBody, ...body }, { 'x-forwarded-for': nextIp() });
const json = async (r: Response) => (await r.json()) as Json;
const checkout = (h: Harness, orderNo: string) =>
  postJson(h, '/payments/ecpay/checkout', { orderNo }, { 'x-forwarded-for': nextIp() });

describe('審查 1：同一人同時段重新送出，建單失敗時不可取消舊保留', () => {
  it('換成較長的方案、跟別人的預約重疊 → 409 slot_taken，舊保留仍在', async () => {
    const h = makeHarness({ now: NOW });
    h.db.overrides.push({ date: '2026-10-07', closed: false, extraTimes: ['20:00'] });
    h.db.addBooking({ startsAt: fromTaipei('2026-10-07', '20:00'), serviceId: 'quick', status: 'confirmed', holdExpiresAt: null, email: 'other@example.com', phone: '0955555555' });
    const mine = await json(await post(h, { service_id: 'quick' })); // 19:00–19:30
    const r = await post(h, { service_id: 'love' }); // 19:00–20:30，跟 20:00 重疊
    expect(r.status).toBe(409);
    expect((await json(r)).error).toBe('slot_taken');
    expect(h.db.booking(mine.orderNo)!.status).toBe('pending_payment');
  });

  it('換成 ATM 但全站 ATM 已滿 → 400 atm_full，舊保留仍在', async () => {
    const h = makeHarness({ now: NOW });
    for (let i = 0; i < 5; i++) {
      h.db.addBooking({
        startsAt: fromTaipei(`2026-10-1${i}`, '10:00'),
        payMethod: 'atm',
        holdExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
        email: `atm${i}@example.com`,
        phone: `096000000${i}`,
      });
    }
    const mine = await json(await post(h, { pay_method: 'card' }));
    const r = await post(h, { pay_method: 'atm' });
    expect(r.status).toBe(400);
    expect((await json(r)).fields.pay_method).toBe('ATM 轉帳名額暫滿，請改用信用卡');
    expect(h.db.booking(mine.orderNo)!.status).toBe('pending_payment');
  });
});

describe('審查 2：異常標記跟著「引起它的那次付款」', () => {
  async function flagged(h: Harness) {
    const b = await json(await post(h, {}));
    const f = ((await json(await checkout(h, b.orderNo))) as { fields: Record<string, string> }).fields;
    await postForm(h, '/payments/ecpay/result', signedEcpayForm(paidParams(f.MerchantTradeNo!, 3600, { RtnCode: '10300066' })));
    await h.flush();
    return { b, tradeNo: f.MerchantTradeNo! };
  }

  it('有結果不明的付款時，不能再 checkout（避免重複扣款）→ 409 payment_under_review', async () => {
    const h = makeHarness({ now: NOW });
    const { b } = await flagged(h);
    const r = await checkout(h, b.orderNo);
    expect(r.status).toBe(409);
    expect((await json(r)).error).toBe('payment_under_review');
  });

  it('另一次付款成功 → 預約確認，但仍標記人工處理（可能重複扣款）並通知老師', async () => {
    const h = makeHarness({ now: NOW });
    const { b } = await flagged(h);
    const second = h.db.addPayment({ bookingId: h.db.booking(b.orderNo)!.id, tradeNo: `${b.orderNo}SECOND2345` });
    await postForm(h, '/payments/ecpay/notify', signedEcpayForm(paidParams(second.tradeNo, 3600, { TradeNo: '2609241001002222' })));
    await h.flush();
    const row = h.db.booking(b.orderNo)!;
    expect(row.status).toBe('confirmed');
    expect(row.needsAttention).toBe(true);
    expect(row.attentionReason).toBe('possible_duplicate_payment');
    expect(h.mailer.tags().sort()).toEqual(['admin_alert', 'admin_alert', 'admin_new_order', 'booking_confirmed']);
  });

  it('引起標記的那次付款後來確定失敗 → 解除標記，可以重新付款', async () => {
    const h = makeHarness({ now: NOW });
    const { b, tradeNo } = await flagged(h);
    await postForm(h, '/payments/ecpay/notify', signedEcpayForm(paidParams(tradeNo, 3600, { RtnCode: '10100248' })));
    const row = h.db.booking(b.orderNo)!;
    expect(row.needsAttention).toBe(false);
    expect(row.attentionReason).toBeNull();
    expect((await checkout(h, b.orderNo)).status).toBe(200);
  });
});

describe('審查 3：LINE Pay Confirm 失敗後 Check 回 0110／0000 也要通知老師（只通知一次）', () => {
  const TX = '2023042201206549310';
  it('標記人工處理＋通知一次；之後對帳 Confirm 成功 → 確認並解除標記', async () => {
    const state = { confirm: '1172', check: '0110' };
    const f: FakeFetch = makeFakeFetch((url) => {
      if (url.endsWith('/v3/payments/request')) {
        return { body: `{"returnCode":"0000","returnMessage":"Success.","info":{"paymentUrl":{"web":"https://sandbox-web-pay.line.me/x"},"transactionId":${TX}}}` };
      }
      if (url.endsWith(`/v3/payments/${TX}/confirm`)) return { body: `{"returnCode":"${state.confirm}","returnMessage":"x","info":{"transactionId":${TX}}}` };
      if (url.endsWith(`/v3/payments/requests/${TX}/check`)) return { body: `{"returnCode":"${state.check}","returnMessage":"x"}` };
      return new Error(`unexpected ${url}`);
    });
    const h = makeHarness({
      now: NOW,
      env: { LINEPAY_CHANNEL_ID: '1234567890', LINEPAY_CHANNEL_SECRET: 'a917ab6a2367b536f8e5a6e2977e06f4' },
      linepayFetch: f,
    });
    const b = await json(await post(h, { pay_method: 'line' }));
    await postJson(h, '/payments/linepay/request', { orderNo: b.orderNo }, { 'x-forwarded-for': nextIp() });
    const p = h.db.payments[0]!;
    await h.app.request(`/payments/linepay/confirm?transactionId=${TX}&orderId=${p.tradeNo}`);
    await h.flush();
    expect(p.status).toBe('init');
    expect(h.db.booking(b.orderNo)!.needsAttention).toBe(true);
    expect(h.mailer.tags()).toEqual(['admin_alert']);

    // 背景對帳：Confirm 還是失敗 → 不重複通知
    h.clock.now = new Date(NOW.getTime() + 5 * 60_000);
    await runJobsOnce(h.deps);
    await h.flush();
    expect(h.mailer.tags()).toEqual(['admin_alert']);

    // 下一輪 Confirm 成功 → 確認並解除標記
    state.confirm = '0000';
    h.clock.now = new Date(NOW.getTime() + 10 * 60_000);
    await runJobsOnce(h.deps);
    await h.flush();
    expect(p.status).toBe('paid');
    const row = h.db.booking(b.orderNo)!;
    expect(row.status).toBe('confirmed');
    expect(row.needsAttention).toBe(false);
  });
});

describe('審查 4：ATM 逾時後才取號也要守上限', () => {
  it('全站未付款 ATM 已滿 → 不恢復待轉帳', async () => {
    const h = makeHarness({ now: NOW });
    const a = await json(await post(h, { pay_method: 'atm' }));
    const f = ((await json(await checkout(h, a.orderNo))) as { fields: Record<string, string> }).fields;
    h.clock.now = new Date(NOW.getTime() + 40 * 60_000);
    await h.db.expireStaleHolds(); // A（30 分鐘保留）→ expired
    for (let i = 0; i < 5; i++) {
      h.db.addBooking({
        startsAt: fromTaipei(`2026-10-1${i}`, '10:00'),
        payMethod: 'atm',
        holdExpiresAt: new Date(h.clock.now.getTime() + 30 * 60_000),
        email: `atm${i}@example.com`,
        phone: `096000000${i}`,
      });
    }
    await postForm(h, '/payments/ecpay/atm-info', signedEcpayForm(atmInfoParams(f.MerchantTradeNo!, 3600)));
    expect(h.db.booking(a.orderNo)!.status).toBe('expired');
  });
});
