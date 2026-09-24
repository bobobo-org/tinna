import { describe, expect, it } from 'vitest';
import { normalizeVipCard, VIP_CARD_RE } from '../src/lib/vip';
import { paidParams } from './helpers/ecpay-params';
import { adminHeaders, makeHarness, postForm, postJson, signedEcpayForm, type Harness } from './helpers/harness';

const NOW = new Date('2026-09-24T10:00:00+08:00');
type Json = Record<string, any>;
const json = async (res: Response) => (await res.json()) as Json;

const buyer = {
  plan_id: 'vip-4',
  name: '林小姐',
  email: 'Vip@Example.com',
  phone: '0922333444',
  birth_date: '1990-10-15',
  agree: true,
};

const vipBooking = {
  service_id: 'vip',
  date: '2026-10-07',
  time: '19:00',
  name: '林小姐',
  gender: 'female',
  birth_date: '1990-10-15',
  phone: '0922333444',
  email: 'vip@example.com',
  pay_method: 'vip',
  agree: true,
};

/** 買一個 VIP 4 堂並完成付款，回傳卡號 */
async function buyVip(h: Harness, extra: Json = {}): Promise<{ orderNo: string; cardNo: string }> {
  const created = await json(await postJson(h, '/vip/orders', { ...buyer, ...extra }));
  const checkout = await json(await postJson(h, '/payments/ecpay/order-checkout', { orderNo: created.orderNo }));
  const tradeNo = checkout.fields.MerchantTradeNo;
  const res = await postForm(h, '/payments/ecpay/order-notify', signedEcpayForm(paidParams(tradeNo, created.amount)));
  expect(await res.text()).toBe('1|OK');
  await h.flush();
  const order = await json(await h.app.request(`/orders/${created.orderNo}`));
  return { orderNo: created.orderNo, cardNo: order.vip.cardNo };
}

describe('VIP 卡號', () => {
  it('格式：VIP-XXXX-XXXX；輸入時不分大小寫、可省略連字號', () => {
    expect(normalizeVipCard('vip-ab2c-d3ef')).toBe('VIP-AB2C-D3EF');
    expect(normalizeVipCard('AB2CD3EF')).toBe('VIP-AB2C-D3EF');
    expect(normalizeVipCard(' VIP AB2C D3EF ')).toBe('VIP-AB2C-D3EF');
    expect(normalizeVipCard('VIP-AB2C-D3E')).toBeNull();
    expect(normalizeVipCard('VIP-AB1C-D3EF')).toBeNull(); // 1 不在字元表
    expect(VIP_CARD_RE.test('VIP-AB2C-D3EF')).toBe(true);
  });
});

describe('VIP 購買', () => {
  it('方案列表含每堂價格', async () => {
    const h = makeHarness({ now: NOW });
    const b = await json(await h.app.request('/vip/plans'));
    expect(b.plans.map((p: Json) => [p.id, p.sessions, p.price, p.perSession])).toEqual([
      ['vip-4', 4, 18000, 4500],
      ['vip-10', 10, 42000, 4200],
      ['vip-12', 12, 49200, 4100],
      ['vip-15', 15, 60000, 4000],
      ['vip-20', 20, 76000, 3800],
    ]);
  });

  it('建立訂單 → 綠界 → 付款成功：發 VIP 卡（4 堂、一年）、寄卡號信與老師通知', async () => {
    const h = makeHarness({ now: NOW });
    const created = await postJson(h, '/vip/orders', buyer);
    expect(created.status).toBe(201);
    const { orderNo, amount } = await json(created);
    expect(amount).toBe(18000);
    expect(h.db.order(orderNo)).toMatchObject({ kind: 'vip', status: 'pending_payment', amount: 18000, vipPlanId: 'vip-4' });

    const checkout = await json(await postJson(h, '/payments/ecpay/order-checkout', { orderNo }));
    expect(checkout.fields).toMatchObject({
      TotalAmount: '18000',
      ChoosePayment: 'Credit',
      ReturnURL: 'https://api.yuanshe.example/payments/ecpay/order-notify',
      OrderResultURL: 'https://api.yuanshe.example/payments/ecpay/order-result',
      ClientBackURL: `https://yuanshe.example/orders/${orderNo}`,
    });

    const form = signedEcpayForm(paidParams(checkout.fields.MerchantTradeNo, 18000));
    expect(await (await postForm(h, '/payments/ecpay/order-notify', form)).text()).toBe('1|OK');
    // 重複通知不會發第二張卡
    expect(await (await postForm(h, '/payments/ecpay/order-notify', form)).text()).toBe('1|OK');
    await h.flush();

    expect(h.db.vipMembers).toHaveLength(1);
    const m = h.db.vipMembers[0]!;
    expect(m).toMatchObject({ sessionsTotal: 4, sessionsUsed: 0, email: 'Vip@Example.com', birthDate: '1990-10-15' });
    expect(m.cardNo).toMatch(VIP_CARD_RE);
    expect(m.expiresAt.getTime() - NOW.getTime()).toBe(365 * 86_400_000);
    expect(h.mailer.tags().sort()).toEqual(['admin_new_commerce_order', 'vip_purchased']);
    const mail = h.mailer.sent.find((x) => x.tag === 'vip_purchased')!;
    expect(mail.to).toEqual(['Vip@Example.com']);
    expect(mail.text).toContain(m.cardNo);

    const order = await json(await h.app.request(`/orders/${orderNo}`));
    expect(order).toMatchObject({ kind: 'vip', status: 'paid', amount: 18000, vip: { cardNo: m.cardNo, sessionsLeft: 4, planName: 'VIP 4 堂' } });
    expect(JSON.stringify(order)).not.toContain('0922333444');
  });

  it('瀏覽器導回（order-result）→ 303 到網站的訂單頁', async () => {
    const h = makeHarness({ now: NOW });
    const { orderNo } = await json(await postJson(h, '/vip/orders', buyer));
    const checkout = await json(await postJson(h, '/payments/ecpay/order-checkout', { orderNo }));
    const res = await postForm(h, '/payments/ecpay/order-result', signedEcpayForm(paidParams(checkout.fields.MerchantTradeNo, 18000)));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`https://yuanshe.example/orders/${orderNo}`);
    expect(h.db.order(orderNo)!.status).toBe('paid');
  });

  it('金額不符不發卡；簽章錯誤回 400', async () => {
    const h = makeHarness({ now: NOW });
    const { orderNo } = await json(await postJson(h, '/vip/orders', buyer));
    const checkout = await json(await postJson(h, '/payments/ecpay/order-checkout', { orderNo }));
    await postForm(h, '/payments/ecpay/order-notify', signedEcpayForm(paidParams(checkout.fields.MerchantTradeNo, 100)));
    await h.flush();
    expect(h.db.vipMembers).toHaveLength(0);
    expect(h.db.order(orderNo)!.status).toBe('pending_payment');
    const bad = await postForm(h, '/payments/ecpay/order-notify', signedEcpayForm(paidParams(checkout.fields.MerchantTradeNo, 18000), 'x', 'y'));
    expect(bad.status).toBe(400);
  });

  it('推薦碼（適用 VIP）→ 折扣後金額與使用紀錄', async () => {
    const h = makeHarness({ now: NOW });
    const headers = adminHeaders(h);
    const kol = (await json(await postJson(h, '/admin/kols', { name: 'Amy' }, headers))).kol;
    await postJson(h, '/admin/referral-codes', { kolId: kol.id, code: 'AMY10', discountType: 'percent', discountValue: 10, commissionRate: 10 }, headers);
    const { orderNo, amount } = await json(await postJson(h, '/vip/orders', { ...buyer, referral_code: 'amy10' }));
    expect(amount).toBe(16200);
    expect(h.db.order(orderNo)).toMatchObject({ subtotal: 18000, discountAmount: 1800, amount: 16200 });
    expect(h.db.referralUses[0]).toMatchObject({ kind: 'vip', orderNo, orderId: h.db.order(orderNo)!.id, finalAmount: 16200, commissionAmount: 1620 });
  });

  it('資料不正確 → 400；方案不存在 → 400', async () => {
    const h = makeHarness({ now: NOW });
    const noAgree = await postJson(h, '/vip/orders', { ...buyer, agree: false });
    expect((await json(noAgree)).fields.agree).toBe('請勾選同意購買與使用規則');
    const badPlan = await postJson(h, '/vip/orders', { ...buyer, plan_id: 'vip-999' });
    expect((await json(badPlan)).fields.plan_id).toBe('請選擇方案');
    const future = await postJson(h, '/vip/orders', { ...buyer, birth_date: '2030-01-01' });
    expect((await json(future)).fields.birth_date).toBe('請確認生日');
    expect(h.db.orders).toHaveLength(0);
  });

  it('逾時的訂單不能付款', async () => {
    const h = makeHarness({ now: NOW });
    const { orderNo } = await json(await postJson(h, '/vip/orders', buyer));
    h.clock.now = new Date(NOW.getTime() + 31 * 60_000);
    const res = await postJson(h, '/payments/ecpay/order-checkout', { orderNo });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe('expired');
    expect((await json(await h.app.request(`/orders/${orderNo}`))).status).toBe('expired');
  });
});

describe('VIP 查詢與用堂數預約', () => {
  it('卡號＋Email 查剩餘堂數；Email 不對 → 404', async () => {
    const h = makeHarness({ now: NOW });
    const { cardNo } = await buyVip(h);
    const ok = await json(await postJson(h, '/vip/lookup', { card_no: cardNo.toLowerCase(), email: 'vip@example.com' }));
    expect(ok).toMatchObject({ cardNo, sessionsTotal: 4, sessionsLeft: 4, expired: false, bookings: [] });
    const bad = await postJson(h, '/vip/lookup', { card_no: cardNo, email: 'other@example.com' });
    expect(bad.status).toBe(404);
  });

  it('用堂數預約：直接確認、扣一堂、寄確認信與老師通知', async () => {
    const h = makeHarness({ now: NOW });
    const { cardNo } = await buyVip(h);
    h.mailer.sent = [];
    const res = await postJson(h, '/bookings', { ...vipBooking, vip_card_no: cardNo });
    expect(res.status).toBe(201);
    const b = await json(res);
    expect(b).toMatchObject({ payMethod: 'vip', holdExpiresAt: null, sessionsLeft: 3 });
    const row = h.db.booking(b.orderNo)!;
    expect(row).toMatchObject({ status: 'confirmed', payMethod: 'vip', amount: 4500, serviceId: 'vip' });
    expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(90 * 60_000);
    await h.flush();
    expect(h.mailer.tags().sort()).toEqual(['admin_new_order', 'booking_confirmed']);
    expect(h.mailer.sent.find((m) => m.tag === 'booking_confirmed')!.text).toContain('VIP 堂數');
    const lookup = await json(await postJson(h, '/vip/lookup', { card_no: cardNo, email: 'vip@example.com' }));
    expect(lookup.sessionsLeft).toBe(3);
    expect(lookup.bookings).toEqual([expect.objectContaining({ orderNo: b.orderNo, date: '2026-10-07', time: '19:00', status: 'confirmed' })]);
  });

  it('VIP 方案只能用堂數、堂數只能用在 VIP 方案；卡號格式／Email 不對／堂數用完 → 400', async () => {
    const h = makeHarness({ now: NOW });
    const { cardNo } = await buyVip(h);
    const payCard = await postJson(h, '/bookings', { ...vipBooking, pay_method: 'card' });
    expect((await json(payCard)).fields.pay_method).toBe('VIP 諮詢只能使用 VIP 堂數預約');
    const wrongService = await postJson(h, '/bookings', { ...vipBooking, service_id: 'love', vip_card_no: cardNo });
    expect((await json(wrongService)).fields.pay_method).toBe('VIP 堂數只能預約「VIP 諮詢」');
    const badFormat = await postJson(h, '/bookings', { ...vipBooking, vip_card_no: '12345' });
    expect((await json(badFormat)).fields.vip_card_no).toContain('VIP 卡號');
    const wrongEmail = await postJson(h, '/bookings', { ...vipBooking, email: 'x@y.co', vip_card_no: cardNo });
    expect((await json(wrongEmail)).fields.vip_card_no).toBe('找不到這張 VIP 卡，請確認卡號與購買時的 Email');
    h.db.vipMembers[0]!.sessionsUsed = 4;
    const used = await postJson(h, '/bookings', { ...vipBooking, vip_card_no: cardNo });
    expect((await json(used)).fields.vip_card_no).toBe('這張 VIP 卡的堂數已經用完');
    expect(h.db.bookings).toHaveLength(0);
  });

  it('時段被占用 → 409 slot_taken，不扣堂數', async () => {
    const h = makeHarness({ now: NOW });
    const { cardNo } = await buyVip(h);
    await postJson(h, '/bookings', { ...vipBooking, service_id: 'love', pay_method: 'card', email: 'z@z.co', phone: '0933444555' });
    const res = await postJson(h, '/bookings', { ...vipBooking, vip_card_no: cardNo });
    expect(res.status).toBe(409);
    expect(h.db.vipMembers[0]!.sessionsUsed).toBe(0);
  });
});

describe('後台：VIP 與訂單', () => {
  it('會員列表（搜尋、生日月份）、調整堂數與期限', async () => {
    const h = makeHarness({ now: NOW });
    const { cardNo } = await buyVip(h);
    const headers = adminHeaders(h);
    const list = await json(await h.app.request('/admin/vip-members?search=林', { headers }));
    expect(list.members).toEqual([expect.objectContaining({ cardNo, sessionsLeft: 4, birthDate: '1990-10-15' })]);
    expect((await json(await h.app.request('/admin/vip-members?birthMonth=10', { headers }))).members).toHaveLength(1);
    expect((await json(await h.app.request('/admin/vip-members?birthMonth=3', { headers }))).members).toHaveLength(0);
    const id = list.members[0].id;
    const patched = await h.app.request(`/admin/vip-members/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionsTotal: 5, expiresOn: '2027-12-31', note: '補贈一堂' }),
    });
    expect((await json(patched)).member).toMatchObject({ sessionsTotal: 5, sessionsLeft: 5, expiresOn: '2027-12-31', note: '補贈一堂' });
    const bad = await h.app.request(`/admin/vip-members/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionsUsed: 9 }),
    });
    expect(bad.status).toBe(400);
  });

  it('VIP 方案：修改價格、新增方案；訂單列表；VIP 訂單不能標出貨', async () => {
    const h = makeHarness({ now: NOW });
    const { orderNo } = await buyVip(h);
    const headers = adminHeaders(h);
    const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
    const plan = await h.app.request('/admin/vip-plans/vip-4', { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ price: 17000 }) });
    expect((await json(plan)).plan).toMatchObject({ id: 'vip-4', price: 17000 });
    const created = await postJson(h, '/admin/vip-plans', { id: 'VIP-30', name: 'VIP 30 堂', sessions: 30, price: 108000 }, headers);
    expect(created.status).toBe(201);
    expect((await json(created)).plan).toMatchObject({ id: 'vip-30', validDays: 365, active: true });
    const orders = await json(await h.app.request('/admin/orders?kind=vip', { headers }));
    expect(orders.orders).toEqual([expect.objectContaining({ orderNo, status: 'paid', customer: expect.objectContaining({ phone: '0922333444' }) })]);
    const ship = await h.app.request(`/admin/orders/${orderNo}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ status: 'shipped' }) });
    expect(ship.status).toBe(400);
  });
});
