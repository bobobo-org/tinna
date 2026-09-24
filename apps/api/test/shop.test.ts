import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sniffImageType } from '../src/lib/storage';
import { paidParams } from './helpers/ecpay-params';
import { adminHeaders, makeHarness, postForm, postJson, signedEcpayForm, type Harness } from './helpers/harness';

const NOW = new Date('2026-09-24T10:00:00+08:00');
type Json = Record<string, any>;
const json = async (res: Response) => (await res.json()) as Json;

function patchJson(h: Harness, path: string, body: unknown, headers: Record<string, string>) {
  return h.app.request(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

const buyer = {
  name: '陳先生',
  email: 'shop@example.com',
  phone: '0911222333',
  ship_name: '陳先生',
  ship_phone: '0911222333',
  ship_address: '台北市信義區松仁路 1 號',
  note: '',
  agree: true,
};

function seed(h: Harness) {
  const amulet = h.db.addProduct({ name: '護身符', price: 800, stock: 5, slug: 'amulet' });
  const bracelet = h.db.addProduct({ name: '水晶手鍊', price: 1500, stock: 1, slug: 'bracelet', sort: 1 });
  const giftOnly = h.db.addProduct({ name: '生日小禮', price: 0, stock: 3, slug: 'birthday-gift', forSale: false });
  const hidden = h.db.addProduct({ name: '下架商品', price: 500, stock: 3, slug: 'hidden', active: false });
  return { amulet, bracelet, giftOnly, hidden };
}

async function payOrder(h: Harness, orderNo: string, amount: number) {
  const checkout = await json(await postJson(h, '/payments/ecpay/order-checkout', { orderNo }));
  const res = await postForm(h, '/payments/ecpay/order-notify', signedEcpayForm(paidParams(checkout.fields.MerchantTradeNo, amount)));
  expect(await res.text()).toBe('1|OK');
  await h.flush();
  return checkout;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

describe('商店：商品', () => {
  it('列表只有上架販售中的（依排序），附運費設定；單一商品用網址代號查', async () => {
    const h = makeHarness({ now: NOW });
    const { amulet } = seed(h);
    const list = await json(await h.app.request('/shop/products'));
    expect(list.products.map((p: Json) => p.slug)).toEqual(['amulet', 'bracelet']);
    expect(list).toMatchObject({ shippingFee: 100, freeShippingOver: null });
    expect(list.products[0]).toEqual({ id: amulet.id, slug: 'amulet', name: '護身符', description: null, price: 800, images: [], stock: 5 });

    expect((await json(await h.app.request('/shop/products/AMULET'))).product.name).toBe('護身符');
    expect((await h.app.request('/shop/products/birthday-gift')).status).toBe(404); // 只當贈品
    expect((await h.app.request('/shop/products/hidden')).status).toBe(404); // 下架
  });
});

describe('商店：下單與付款', () => {
  it('下單 → 綠界 → 付款成功：扣庫存、寄訂單確認與老師通知；訂單頁不含個資', async () => {
    const h = makeHarness({ now: NOW });
    const { amulet } = seed(h);
    const res = await postJson(h, '/shop/orders', { ...buyer, items: [{ product_id: amulet.id, qty: 2 }] });
    expect(res.status).toBe(201);
    const { orderNo, amount } = await json(res);
    expect(amount).toBe(1700);
    expect(h.db.order(orderNo)).toMatchObject({
      kind: 'shop',
      status: 'pending_payment',
      subtotal: 1600,
      shippingFee: 100,
      discountAmount: 0,
      amount: 1700,
      shipAddress: '台北市信義區松仁路 1 號',
      items: [{ productId: amulet.id, name: '護身符', unitPrice: 800, qty: 2 }],
    });
    // 付款前不扣庫存
    expect(h.db.products.find((p) => p.id === amulet.id)!.stock).toBe(5);

    const checkout = await payOrder(h, orderNo, 1700);
    expect(checkout.fields).toMatchObject({ TotalAmount: '1700', ItemName: '護身符 x2', ChoosePayment: 'Credit' });
    expect(h.db.products.find((p) => p.id === amulet.id)!.stock).toBe(3);
    expect(h.db.order(orderNo)!.status).toBe('paid');
    expect(h.mailer.tags().sort()).toEqual(['admin_new_commerce_order', 'shop_paid']);
    expect(h.mailer.sent.find((m) => m.tag === 'shop_paid')!.text).toContain('台北市信義區松仁路 1 號');

    const order = await json(await h.app.request(`/orders/${orderNo}`));
    expect(order).toMatchObject({ kind: 'shop', status: 'paid', subtotal: 1600, shippingFee: 100, amount: 1700 });
    expect(order.items).toEqual([{ name: '護身符', unitPrice: 800, qty: 2 }]);
    const text = JSON.stringify(order);
    expect(text).not.toContain('0911222333');
    expect(text).not.toContain('松仁路');
  });

  it('滿額免運；推薦碼只折商品金額（不含運費），記錄推薦成效', async () => {
    const h = makeHarness({ now: NOW });
    const { amulet } = seed(h);
    h.db.shopSettings.freeShippingOver = 2000;
    const free = await json(await postJson(h, '/shop/orders', { ...buyer, items: [{ product_id: amulet.id, qty: 3 }] }));
    expect(free.amount).toBe(2400);
    expect(h.db.order(free.orderNo)!.shippingFee).toBe(0);

    const headers = adminHeaders(h);
    const kol = (await json(await postJson(h, '/admin/kols', { name: 'Amy' }, headers))).kol;
    await postJson(h, '/admin/referral-codes', { kolId: kol.id, code: 'SHOP10', discountType: 'percent', discountValue: 10, commissionRate: 10 }, headers);
    const res = await json(await postJson(h, '/shop/orders', { ...buyer, referral_code: 'shop10', items: [{ product_id: amulet.id, qty: 1 }] }));
    expect(res.amount).toBe(820); // 800 打 9 折 = 720，加運費 100
    expect(h.db.order(res.orderNo)).toMatchObject({ subtotal: 800, discountAmount: 80, shippingFee: 100, amount: 820 });
    expect(h.db.referralUses).toHaveLength(1);
    expect(h.db.referralUses[0]).toMatchObject({ kind: 'shop', orderNo: res.orderNo, originalAmount: 800, finalAmount: 720, commissionAmount: 72 });

    // 推薦碼不適用商店
    await postJson(h, '/admin/referral-codes', { kolId: kol.id, code: 'NOSHOP', discountType: 'amount', discountValue: 100, appliesShop: false }, headers);
    const bad = await postJson(h, '/shop/orders', { ...buyer, referral_code: 'NOSHOP', items: [{ product_id: amulet.id, qty: 1 }] });
    expect(bad.status).toBe(400);
    expect((await json(bad)).fields.referral_code).toBeTruthy();
  });

  it('庫存不足、已售完、下架、只當贈品、不存在的商品都擋下；必填欄位', async () => {
    const h = makeHarness({ now: NOW });
    const { bracelet, giftOnly, hidden } = seed(h);
    const order = (items: Json[], extra: Json = {}) => postJson(h, '/shop/orders', { ...buyer, ...extra, items });

    let r = await json(await order([{ product_id: bracelet.id, qty: 2 }]));
    expect(r.fields.items).toBe('「水晶手鍊」庫存只剩 1 件');
    h.db.products.find((p) => p.id === bracelet.id)!.stock = 0;
    r = await json(await order([{ product_id: bracelet.id, qty: 1 }]));
    expect(r.fields.items).toBe('「水晶手鍊」已售完，請從購物車移除');
    for (const id of [giftOnly.id, hidden.id, randomUUID()]) {
      r = await json(await order([{ product_id: id, qty: 1 }]));
      expect(r.fields.items).toBe('購物車裡有商品已下架，請重新整理購物車');
    }
    expect((await json(await order([]))).fields.items).toBe('購物車是空的');
    r = await json(await order([{ product_id: bracelet.id, qty: 1 }], { ship_address: '', agree: false }));
    expect(r.fields).toMatchObject({ ship_address: '請填寫完整的收件地址', agree: '請勾選同意購物與退換貨規則' });
    expect(h.db.orders).toHaveLength(0);
  });
});

describe('後台：商品、圖片、運費', () => {
  it('新增（沒填代號自動產生）、重複代號、上架商品價格至少 1 元、編輯、列表含下架', async () => {
    const h = makeHarness({ now: NOW });
    seed(h);
    expect((await postJson(h, '/admin/products', { name: 'x', price: 100 })).status).toBe(401);
    const headers = adminHeaders(h);

    const created = await postJson(h, '/admin/products', { name: ' 開運手鍊 ', price: 1200, stock: 10 }, headers);
    expect(created.status).toBe(201);
    const p = (await json(created)).product;
    expect(p).toMatchObject({ name: '開運手鍊', price: 1200, stock: 10, forSale: true, active: true, images: [] });
    expect(p.slug).toMatch(/^p-[0-9a-f]{8}$/);

    const dup = await postJson(h, '/admin/products', { name: '另一個', price: 100, slug: 'Amulet' }, headers);
    expect(dup.status).toBe(409);
    expect((await json(dup)).fields.slug).toBeTruthy();
    const free = await postJson(h, '/admin/products', { name: '免費', price: 0 }, headers);
    expect((await json(free)).fields.price).toBeTruthy();
    expect((await postJson(h, '/admin/products', { name: '贈品', price: 0, forSale: false }, headers)).status).toBe(201);
    expect((await json(await postJson(h, '/admin/products', { name: 'y', price: 1, slug: '-bad' }, headers))).fields.slug).toBeTruthy();

    const patched = await patchJson(h, `/admin/products/${p.id}`, { stock: 3, active: false, images: ['https://cdn.example/a.jpg'], description: '粉晶' }, headers);
    expect((await json(patched)).product).toMatchObject({ stock: 3, active: false, images: ['https://cdn.example/a.jpg'], description: '粉晶' });
    expect((await json(await patchJson(h, `/admin/products/${p.id}`, { images: ['http://cdn.example/a.jpg'] }, headers))).fields.images).toBeTruthy();
    expect((await patchJson(h, `/admin/products/${p.id}`, { price: 0 }, headers)).status).toBe(400);
    expect((await patchJson(h, `/admin/products/${randomUUID()}`, { stock: 1 }, headers)).status).toBe(404);
    expect((await patchJson(h, '/admin/products/not-a-uuid', { stock: 1 }, headers)).status).toBe(404);

    const list = await json(await h.app.request('/admin/products', { headers }));
    expect(list.products).toHaveLength(6);
    expect(list.products.some((x: Json) => x.id === p.id && x.active === false)).toBe(true);
  });

  it('上傳圖片：只收 JPG／PNG／WebP／GIF（看檔頭）、最多 5MB、要登入', async () => {
    const h = makeHarness({ now: NOW });
    const upload = (body: Uint8Array, type: string, headers: Record<string, string> = {}) =>
      h.app.request('/admin/uploads', { method: 'POST', headers: { 'Content-Type': type, ...headers }, body });
    expect((await upload(PNG, 'image/png')).status).toBe(401);
    const headers = adminHeaders(h);

    const ok = await upload(PNG, 'image/png', headers);
    expect(ok.status).toBe(201);
    const { url } = await json(ok);
    expect(url).toMatch(/^https:\/\/storage\.example\/products\/2026-09\/[0-9a-f-]{36}\.png$/);
    expect(h.storage.files.size).toBe(1);

    expect((await upload(new TextEncoder().encode('<html>'), 'text/html', headers)).status).toBe(415);
    expect((await upload(new TextEncoder().encode('<html><script>'), 'image/png', headers)).status).toBe(415);
    expect((await upload(new Uint8Array(0), 'image/png', headers)).status).toBe(400);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await upload(big, 'image/png', headers)).status).toBe(413);

    h.storage.fail = true;
    expect((await upload(PNG, 'image/png', headers)).status).toBe(502);
    expect(h.storage.files.size).toBe(1);
  });

  it('檔頭判斷', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new TextEncoder().encode('GIF89a...'))).toBe('image/gif');
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WAVE'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('<svg'))).toBeNull();
  });

  it('運費設定：讀取、修改（滿額免運可以關掉），商店與下單跟著變', async () => {
    const h = makeHarness({ now: NOW });
    const { amulet } = seed(h);
    const headers = adminHeaders(h);
    expect(await json(await h.app.request('/admin/settings', { headers }))).toEqual({ shippingFee: 100, freeShippingOver: null });
    expect(await json(await patchJson(h, '/admin/settings', { shippingFee: 80, freeShippingOver: 1500 }, headers))).toEqual({
      shippingFee: 80,
      freeShippingOver: 1500,
    });
    expect(await json(await h.app.request('/shop/products'))).toMatchObject({ shippingFee: 80, freeShippingOver: 1500 });
    expect((await json(await postJson(h, '/shop/orders', { ...buyer, items: [{ product_id: amulet.id, qty: 1 }] }))).amount).toBe(880);
    expect((await json(await postJson(h, '/shop/orders', { ...buyer, items: [{ product_id: amulet.id, qty: 2 }] }))).amount).toBe(1600);
    expect((await json(await patchJson(h, '/admin/settings', { freeShippingOver: null }, headers))).freeShippingOver).toBeNull();
    expect((await patchJson(h, '/admin/settings', { shippingFee: -1 }, headers)).status).toBe(400);
  });
});

describe('後台：寄 VIP 贈品', () => {
  function addMember(h: Harness) {
    const m = {
      id: randomUUID(),
      cardNo: 'VIP-AB2C-D3EF',
      name: '林小姐',
      email: 'vip@example.com',
      phone: '0922333444',
      birthDate: '1990-10-15',
      planId: 'vip-4',
      sessionsTotal: 4,
      sessionsUsed: 0,
      expiresAt: new Date(NOW.getTime() + 365 * 86_400_000),
      orderId: null,
      note: null,
      createdAt: NOW,
    };
    h.db.vipMembers.push(m);
    return m;
  }

  it('建立贈品訂單（不收費、待出貨）、扣庫存；出貨寄通知信（不顯示價格）；公開訂單頁查不到', async () => {
    const h = makeHarness({ now: NOW });
    const { amulet, giftOnly } = seed(h);
    const m = addMember(h);
    const headers = adminHeaders(h);
    const body = {
      memberId: m.id,
      items: [
        { productId: giftOnly.id, qty: 1 },
        { productId: amulet.id, qty: 1 },
      ],
      shipName: '林小姐',
      shipPhone: '0922333444',
      shipAddress: '台北市大安區仁愛路 1 號',
      note: '生日禮',
    };
    const res = await postJson(h, '/admin/gifts', body, headers);
    expect(res.status).toBe(201);
    const order = (await json(res)).order;
    expect(order).toMatchObject({ kind: 'gift', status: 'paid', amount: 0, subtotal: 800, vipMemberId: m.id, note: '生日禮' });
    expect(h.db.products.find((p) => p.id === giftOnly.id)!.stock).toBe(2);
    expect(h.db.products.find((p) => p.id === amulet.id)!.stock).toBe(4);
    expect(h.mailer.sent).toHaveLength(0);

    const list = await json(await h.app.request('/admin/orders?kind=gift', { headers }));
    expect(list.orders.map((o: Json) => o.orderNo)).toEqual([order.orderNo]);
    expect((await h.app.request(`/orders/${order.orderNo}`)).status).toBe(404);

    const shipped = await patchJson(h, `/admin/orders/${order.orderNo}`, { status: 'shipped', trackingNo: 'T123' }, headers);
    expect(shipped.status).toBe(200);
    await h.flush();
    const mail = h.mailer.sent.find((x) => x.tag === 'order_shipped')!;
    expect(mail.subject).toContain('VIP 贈品已寄出');
    expect(mail.to).toEqual(['vip@example.com']);
    expect(mail.text).toContain('生日小禮');
    expect(mail.text).toContain('T123');
    expect(mail.text).not.toContain('NT$');
  });

  it('會員不存在、庫存不足、下架、重複品項都擋下', async () => {
    const h = makeHarness({ now: NOW });
    const { amulet, hidden } = seed(h);
    const m = addMember(h);
    const headers = adminHeaders(h);
    const base = { memberId: m.id, shipName: '林小姐', shipPhone: '0922333444', shipAddress: '台北市大安區仁愛路 1 號' };
    expect((await postJson(h, '/admin/gifts', { ...base, memberId: randomUUID(), items: [{ productId: amulet.id, qty: 1 }] }, headers)).status).toBe(404);
    expect((await json(await postJson(h, '/admin/gifts', { ...base, items: [{ productId: amulet.id, qty: 9 }] }, headers))).fields.items).toBe(
      '「護身符」庫存只剩 5 件',
    );
    expect((await postJson(h, '/admin/gifts', { ...base, items: [{ productId: hidden.id, qty: 1 }] }, headers)).status).toBe(400);
    const dup = await postJson(
      h,
      '/admin/gifts',
      {
        ...base,
        items: [
          { productId: amulet.id, qty: 1 },
          { productId: amulet.id, qty: 1 },
        ],
      },
      headers,
    );
    expect((await json(dup)).fields.items).toBe('同一個贈品請合併數量');
    expect((await json(await postJson(h, '/admin/gifts', { ...base, items: [] }, headers))).fields.items).toBe('請選擇贈品');
    expect(h.db.orders).toHaveLength(0);
  });
});
