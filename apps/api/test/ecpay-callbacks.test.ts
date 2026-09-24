import { describe, expect, it } from 'vitest';
import { fromTaipei } from '../src/lib/time';
import { makeHarness, postForm, postJson, signedEcpayForm, type Harness } from './helpers/harness';

const NOW = new Date('2026-09-24T10:00:00+08:00');

const bookingBody = {
  service_id: 'love',
  date: '2026-10-07',
  time: '19:00',
  name: '王小美',
  gender: 'female',
  birth_date: '1995-03-12',
  birth_time: '21:30',
  birth_place: '台北市',
  phone: '0912345678',
  email: 'guest@example.com',
  questions: '感情',
  pay_method: 'card',
  agree: true,
};

type Json = Record<string, any>;

async function book(h: Harness, patch: Json = {}) {
  const res = await postJson(h, '/bookings', { ...bookingBody, ...patch });
  expect(res.status).toBe(201);
  return (await res.json()) as Json;
}

async function checkout(h: Harness, orderNo: string) {
  const res = await postJson(h, '/payments/ecpay/checkout', { orderNo });
  expect(res.status).toBe(200);
  return (await res.json()) as { action: string; fields: Record<string, string> };
}

function paidParams(tradeNo: string, amount: number, extra: Record<string, string> = {}) {
  return {
    CustomField1: tradeNo.slice(0, 10),
    CustomField2: '',
    CustomField3: '',
    CustomField4: '',
    MerchantID: '3002607',
    MerchantTradeNo: tradeNo,
    PaymentDate: '2026/09/24 10:05:00',
    PaymentType: 'Credit_CreditCard',
    PaymentTypeChargeFee: '100',
    RtnCode: '1',
    RtnMsg: '交易成功',
    SimulatePaid: '0',
    StoreID: '',
    TradeAmt: String(amount),
    TradeDate: '2026/09/24 10:01:00',
    TradeNo: '2609241001001234',
    ...extra,
  };
}

function atmInfoParams(tradeNo: string, amount: number, extra: Record<string, string> = {}) {
  return {
    BankCode: '822',
    CustomField1: '',
    CustomField2: '',
    CustomField3: '',
    CustomField4: '',
    ExpireDate: '2026/09/25',
    MerchantID: '3002607',
    MerchantTradeNo: tradeNo,
    PaymentType: 'ATM_CHINATRUST',
    RtnCode: '2',
    RtnMsg: 'Get VirtualAccount Succeeded',
    StoreID: '',
    TradeAmt: String(amount),
    TradeDate: '2026/09/24 10:01:00',
    TradeNo: '2609241001005678',
    vAccount: '9103522175887271',
    ...extra,
  };
}

describe('POST /payments/ecpay/checkout', () => {
  it('回傳 stage action 與可驗簽的欄位；每次 MerchantTradeNo 都不同', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    const c1 = await checkout(h, b.orderNo);
    const c2 = await checkout(h, b.orderNo);
    expect(c1.action).toBe('https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5');
    expect(c1.fields.TotalAmount).toBe('3600');
    expect(c1.fields.ChoosePayment).toBe('Credit');
    expect(c1.fields.MerchantTradeNo).toMatch(/^[A-Z0-9]{20}$/);
    expect(c1.fields.MerchantTradeNo!.startsWith(b.orderNo)).toBe(true);
    expect(c1.fields.MerchantTradeNo).not.toBe(c2.fields.MerchantTradeNo);
    expect(h.db.payments.map((p) => p.tradeNo)).toEqual([c1.fields.MerchantTradeNo, c2.fields.MerchantTradeNo]);
    expect(JSON.stringify(c1)).not.toContain('王小美');
  });

  it('ATM 訂單 → ChoosePayment=ATM', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h, { pay_method: 'atm' });
    const c = await checkout(h, b.orderNo);
    expect(c.fields.ChoosePayment).toBe('ATM');
    expect(c.fields.ExpireDate).toBe('1');
  });

  it('已付款 409 already_paid；已逾時 409 expired；查無 404；LINE Pay 訂單 409', async () => {
    const h = makeHarness({ now: NOW });
    const paid = h.db.addBooking({ startsAt: fromTaipei('2026-10-08', '19:00'), status: 'confirmed', holdExpiresAt: null });
    let res = await postJson(h, '/payments/ecpay/checkout', { orderNo: paid.orderNo });
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error).toBe('already_paid');

    const stale = h.db.addBooking({
      startsAt: fromTaipei('2026-10-09', '19:00'),
      status: 'pending_payment',
      holdExpiresAt: new Date(NOW.getTime() - 1),
    });
    res = await postJson(h, '/payments/ecpay/checkout', { orderNo: stale.orderNo });
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error).toBe('expired');

    const expired = h.db.addBooking({ startsAt: fromTaipei('2026-10-10', '19:00'), status: 'expired' });
    res = await postJson(h, '/payments/ecpay/checkout', { orderNo: expired.orderNo });
    expect(((await res.json()) as Json).error).toBe('expired');

    const line = h.db.addBooking({ startsAt: fromTaipei('2026-10-11', '19:00'), payMethod: 'line' });
    res = await postJson(h, '/payments/ecpay/checkout', { orderNo: line.orderNo });
    expect(res.status).toBe(409);

    res = await postJson(h, '/payments/ecpay/checkout', { orderNo: 'YS22222222' });
    expect(res.status).toBe(404);
    res = await postJson(h, '/payments/ecpay/checkout', {});
    expect(res.status).toBe(400);
  });

  it('綠界未設定 → 503', async () => {
    const h = makeHarness({ now: NOW, env: { ECPAY_HASH_IV: undefined } });
    const res = await postJson(h, '/payments/ecpay/checkout', { orderNo: 'YS22222222' });
    expect(res.status).toBe(503);
  });
});

describe('綠界付款回呼：驗簽、金額、冪等', () => {
  it('notify 成功 → confirmed，確認信與老師通知各一封；重複 notify / result 不重複寄', async () => {
    const h = makeHarness({ now: NOW, env: { MEET_URL: 'https://meet.google.com/abc-defg-hij' } });
    const b = await book(h);
    const { fields } = await checkout(h, b.orderNo);
    const form = signedEcpayForm(paidParams(fields.MerchantTradeNo!, 3600));

    let res = await postForm(h, '/payments/ecpay/notify', form);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('1|OK');
    await h.flush();
    expect(h.db.booking(b.orderNo)!.status).toBe('confirmed');
    expect(h.db.payments[0]!.status).toBe('paid');
    expect(h.mailer.tags()).toEqual(['booking_confirmed', 'admin_new_order']);

    res = await postForm(h, '/payments/ecpay/notify', form);
    expect(await res.text()).toBe('1|OK');
    res = await postForm(h, '/payments/ecpay/result', form);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`https://yuanshe.example/booking/success?order=${b.orderNo}`);
    await h.flush();
    expect(h.mailer.tags()).toEqual(['booking_confirmed', 'admin_new_order']);
    expect(h.db.booking(b.orderNo)!.confirmationSentAt).not.toBeNull();

    const mail = h.mailer.sent[0]!;
    expect(mail.to).toEqual(['guest@example.com']);
    expect(mail.text).toContain('https://meet.google.com/abc-defg-hij');
    expect(mail.text).toContain('2026/10/07（三）19:00–20:30（台北時間）');
    const ics = Buffer.from(mail.attachments![0]!.content, 'base64').toString('utf8');
    expect(ics).toContain('DTSTART;TZID=Asia/Taipei:20261007T190000');
    expect(ics).toContain('DTEND;TZID=Asia/Taipei:20261007T203000');
    expect(ics).toContain('BEGIN:VTIMEZONE');
  });

  it('result 先到、notify 後到 → 仍只寄一次', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    const { fields } = await checkout(h, b.orderNo);
    const form = signedEcpayForm(paidParams(fields.MerchantTradeNo!, 3600));
    expect((await postForm(h, '/payments/ecpay/result', form)).status).toBe(303);
    expect(await (await postForm(h, '/payments/ecpay/notify', form)).text()).toBe('1|OK');
    await h.flush();
    expect(h.mailer.tags()).toEqual(['booking_confirmed', 'admin_new_order']);
  });

  it('沒有 MEET_URL → 信中寫「視訊連結將於諮詢前另行寄送」', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    const { fields } = await checkout(h, b.orderNo);
    await postForm(h, '/payments/ecpay/notify', signedEcpayForm(paidParams(fields.MerchantTradeNo!, 3600)));
    await h.flush();
    expect(h.mailer.sent[0]!.text).toContain('視訊連結將於諮詢前另行寄送');
  });

  it('CheckMacValue 錯誤 → 拒絕、不改狀態', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    const { fields } = await checkout(h, b.orderNo);
    const good = signedEcpayForm(paidParams(fields.MerchantTradeNo!, 3600));
    const tampered = good.replace('TradeAmt=3600', 'TradeAmt=1');
    const res = await postForm(h, '/payments/ecpay/notify', tampered);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('0|CheckMacValue Error');
    const unsigned = new URLSearchParams(paidParams(fields.MerchantTradeNo!, 3600)).toString();
    expect((await postForm(h, '/payments/ecpay/notify', unsigned)).status).toBe(400);
    // 瀏覽器端的 result 也不處理，但仍導回完成頁
    const r = await postForm(h, '/payments/ecpay/result', tampered);
    expect(r.status).toBe(303);
    await h.flush();
    expect(h.db.booking(b.orderNo)!.status).toBe('pending_payment');
    expect(h.db.payments[0]!.status).toBe('init');
    expect(h.mailer.sent).toHaveLength(0);
  });

  it('MerchantID 不符 → 拒絕', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    const { fields } = await checkout(h, b.orderNo);
    const res = await postForm(
      h,
      '/payments/ecpay/notify',
      signedEcpayForm(paidParams(fields.MerchantTradeNo!, 3600, { MerchantID: '2000132' })),
    );
    expect(res.status).toBe(400);
    expect(h.db.booking(b.orderNo)!.status).toBe('pending_payment');
  });

  it('金額不符 → 不確認、標記人工處理、通知老師', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    const { fields } = await checkout(h, b.orderNo);
    const res = await postForm(h, '/payments/ecpay/notify', signedEcpayForm(paidParams(fields.MerchantTradeNo!, 36)));
    expect(await res.text()).toBe('1|OK');
    await h.flush();
    const row = h.db.booking(b.orderNo)!;
    expect(row.status).toBe('pending_payment');
    expect(row.needsAttention).toBe(true);
    expect(row.attentionReason).toBe('amount_mismatch');
    expect(h.db.payments[0]!.status).toBe('init');
    expect(h.mailer.tags()).toEqual(['admin_alert']);
  });

  it('付款失敗 → payments=failed；之後同筆成功通知仍可確認；晚到的失敗不會改掉 confirmed', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    const { fields } = await checkout(h, b.orderNo);
    const failed = signedEcpayForm(paidParams(fields.MerchantTradeNo!, 3600, { RtnCode: '10100248', RtnMsg: '拒絕交易' }));
    const r1 = await postForm(h, '/payments/ecpay/result', failed);
    expect(r1.status).toBe(303);
    expect(h.db.payments[0]!.status).toBe('failed');
    expect(h.db.booking(b.orderNo)!.status).toBe('pending_payment');

    await postForm(h, '/payments/ecpay/notify', signedEcpayForm(paidParams(fields.MerchantTradeNo!, 3600)));
    expect(h.db.booking(b.orderNo)!.status).toBe('confirmed');

    await postForm(h, '/payments/ecpay/notify', failed);
    expect(h.db.booking(b.orderNo)!.status).toBe('confirmed');
    expect(h.db.payments[0]!.status).toBe('paid');
  });

  it('保留逾時後才付款、時段已被別人約走 → payments=paid、booking 標記人工處理、不動別人的預約', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    const { fields } = await checkout(h, b.orderNo);
    // 20 分鐘後：背景工作把保留設成 expired，另一位顧客約走同一時段
    h.clock.now = new Date(NOW.getTime() + 20 * 60_000);
    await h.db.expireStaleHolds();
    const other = h.db.addBooking({ startsAt: fromTaipei('2026-10-07', '19:00'), status: 'confirmed', holdExpiresAt: null });

    const res = await postForm(h, '/payments/ecpay/notify', signedEcpayForm(paidParams(fields.MerchantTradeNo!, 3600)));
    expect(await res.text()).toBe('1|OK');
    await h.flush();
    const mine = h.db.booking(b.orderNo)!;
    expect(mine.status).toBe('expired');
    expect(mine.needsAttention).toBe(true);
    expect(mine.attentionReason).toBe('paid_after_expiry_slot_taken');
    expect(h.db.payments[0]!.status).toBe('paid');
    expect(other.status).toBe('confirmed');
    expect(h.mailer.tags()).toEqual(['admin_alert']);
    expect(h.mailer.sent[0]!.to).toEqual(['teacher@example.com']);
  });

  it('保留逾時後才付款、時段還空著 → 直接確認', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    const { fields } = await checkout(h, b.orderNo);
    h.clock.now = new Date(NOW.getTime() + 20 * 60_000);
    await h.db.expireStaleHolds();
    await postForm(h, '/payments/ecpay/notify', signedEcpayForm(paidParams(fields.MerchantTradeNo!, 3600)));
    await h.flush();
    expect(h.db.booking(b.orderNo)!.status).toBe('confirmed');
    expect(h.mailer.tags()).toEqual(['booking_confirmed', 'admin_new_order']);
  });

  it('已退款的付款，重送舊的付款結果 → 不會改回 paid', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h);
    const { fields } = await checkout(h, b.orderNo);
    const form = signedEcpayForm(paidParams(fields.MerchantTradeNo!, 3600));
    await postForm(h, '/payments/ecpay/notify', form);
    await h.flush();
    // 老師在後台退款
    h.db.payments[0]!.status = 'refunded';
    h.db.booking(b.orderNo)!.status = 'refunded';
    const r = await postForm(h, '/payments/ecpay/result', form);
    expect(r.status).toBe(303);
    await h.flush();
    expect(h.db.payments[0]!.status).toBe('refunded');
    expect(h.db.booking(b.orderNo)!.status).toBe('refunded');
    expect(h.mailer.tags()).toEqual(['booking_confirmed', 'admin_new_order']);
  });

  it('查無交易（簽章正確）→ 1|OK 並通知老師', async () => {
    const h = makeHarness({ now: NOW });
    const res = await postForm(h, '/payments/ecpay/notify', signedEcpayForm(paidParams('YS22222222ABCDEFGHJK', 3600)));
    expect(await res.text()).toBe('1|OK');
    await h.flush();
    expect(h.mailer.tags()).toEqual(['admin_alert']);
  });

  it('模擬付款 SimulatePaid=1：prod 忽略、stage 照常處理', async () => {
    const prod = makeHarness({ now: NOW, env: { ECPAY_ENV: 'prod', ECPAY_MERCHANT_ID: '3999999' } });
    const b = await book(prod);
    const { fields } = await checkout(prod, b.orderNo);
    expect(fields.MerchantID).toBe('3999999');
    const res = await postForm(
      prod,
      '/payments/ecpay/notify',
      signedEcpayForm(paidParams(fields.MerchantTradeNo!, 3600, { MerchantID: '3999999', SimulatePaid: '1' })),
    );
    expect(await res.text()).toBe('1|OK');
    expect(prod.db.booking(b.orderNo)!.status).toBe('pending_payment');

    const stage = makeHarness({ now: NOW });
    const b2 = await book(stage);
    const c2 = await checkout(stage, b2.orderNo);
    await postForm(
      stage,
      '/payments/ecpay/notify',
      signedEcpayForm(paidParams(c2.fields.MerchantTradeNo!, 3600, { SimulatePaid: '1' })),
    );
    expect(stage.db.booking(b2.orderNo)!.status).toBe('confirmed');
  });
});

describe('綠界 ATM：取號 → 轉帳', () => {
  it('atm-info → awaiting_transfer（hold 改為繳費期限）→ 轉帳資訊信一封；atm-redirect 冪等 → 付款通知 → confirmed', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h, { pay_method: 'atm' });
    const { fields } = await checkout(h, b.orderNo);
    const info = signedEcpayForm(atmInfoParams(fields.MerchantTradeNo!, 3600));

    const r1 = await postForm(h, '/payments/ecpay/atm-info', info);
    expect(await r1.text()).toBe('1|OK');
    const r2 = await postForm(h, '/payments/ecpay/atm-redirect', info);
    expect(r2.status).toBe(303);
    expect(r2.headers.get('location')).toBe(`https://yuanshe.example/booking/success?order=${b.orderNo}`);
    await h.flush();

    const row = h.db.booking(b.orderNo)!;
    expect(row.status).toBe('awaiting_transfer');
    expect(row.atmAccount).toBe('9103522175887271');
    expect(row.holdExpiresAt!.toISOString()).toBe(new Date('2026-09-25T23:59:59+08:00').toISOString());
    expect(h.mailer.tags()).toEqual(['transfer_info']);
    expect(h.mailer.sent[0]!.text).toContain('9103522175887271');

    const pub = (await (await h.app.request(`/bookings/${b.orderNo}`)).json()) as Json;
    expect(pub.status).toBe('awaiting_transfer');
    expect(pub.atm).toEqual({ bankCode: '822', account: '9103522175887271', expireDate: '2026/09/25 23:59:59' });
    expect(pub.holdExpiresAt).toBe('2026-09-25T23:59:59+08:00');

    // 已取號的訂單不能再 checkout
    const again = await postJson(h, '/payments/ecpay/checkout', { orderNo: b.orderNo });
    expect(again.status).toBe(409);

    // 轉帳入帳
    const paid = signedEcpayForm(
      paidParams(fields.MerchantTradeNo!, 3600, { PaymentType: 'ATM_CHINATRUST', TradeNo: '2609241001005678' }),
    );
    expect(await (await postForm(h, '/payments/ecpay/notify', paid)).text()).toBe('1|OK');
    await h.flush();
    expect(h.db.booking(b.orderNo)!.status).toBe('confirmed');
    expect(h.mailer.tags()).toEqual(['transfer_info', 'booking_confirmed', 'admin_new_order']);

    // 晚到的取號通知不會把 confirmed 改回去
    await postForm(h, '/payments/ecpay/atm-info', info);
    expect(h.db.booking(b.orderNo)!.status).toBe('confirmed');
  });

  it('重送舊的取號結果（繳費期限已過）→ 不會把逾時的預約復活、不重寄轉帳資訊', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h, { pay_method: 'atm' });
    const { fields } = await checkout(h, b.orderNo);
    const info = signedEcpayForm(atmInfoParams(fields.MerchantTradeNo!, 3600));
    await postForm(h, '/payments/ecpay/atm-info', info);
    await h.flush();
    // 繳費期限（9/25 23:59:59）過後背景工作把它設成 expired，使用者再按上一頁重送表單
    h.clock.now = new Date('2026-09-26T09:00:00+08:00');
    await h.db.expireStaleHolds();
    expect(h.db.booking(b.orderNo)!.status).toBe('expired');
    const r = await postForm(h, '/payments/ecpay/atm-redirect', info);
    expect(r.status).toBe(303);
    await h.flush();
    expect(h.db.booking(b.orderNo)!.status).toBe('expired');
    expect(h.mailer.tags()).toEqual(['transfer_info']);
  });

  it('ATM 訂單收到非 1 的付款通知 → 不標記失敗，之後的取號／入帳照常', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h, { pay_method: 'atm' });
    const { fields } = await checkout(h, b.orderNo);
    const odd = signedEcpayForm(paidParams(fields.MerchantTradeNo!, 3600, { RtnCode: '2', PaymentType: 'ATM_CHINATRUST' }));
    expect(await (await postForm(h, '/payments/ecpay/notify', odd)).text()).toBe('1|OK');
    expect(h.db.payments[0]!.status).toBe('init');
    await postForm(h, '/payments/ecpay/atm-info', signedEcpayForm(atmInfoParams(fields.MerchantTradeNo!, 3600)));
    expect(h.db.booking(b.orderNo)!.status).toBe('awaiting_transfer');
  });

  it('取號失敗 → 不改預約狀態', async () => {
    const h = makeHarness({ now: NOW });
    const b = await book(h, { pay_method: 'atm' });
    const { fields } = await checkout(h, b.orderNo);
    await postForm(
      h,
      '/payments/ecpay/atm-info',
      signedEcpayForm(atmInfoParams(fields.MerchantTradeNo!, 3600, { RtnCode: '10100058', vAccount: '' })),
    );
    expect(h.db.booking(b.orderNo)!.status).toBe('pending_payment');
    expect(h.db.payments[0]!.status).toBe('failed');
  });
});
