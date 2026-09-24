import { describe, expect, it } from 'vitest';
import { adminHeaders, makeHarness, postJson, type Harness } from './helpers/harness';

const NOW = new Date('2026-09-24T10:00:00+08:00');
type Json = Record<string, any>;

const valid = {
  service_id: 'love',
  date: '2026-10-07',
  time: '19:00',
  name: '王小美',
  gender: 'female',
  birth_date: '1995-03-12',
  phone: '0912345678',
  email: 'a@b.co',
  pay_method: 'card',
  agree: true,
};

const json = async (res: Response) => (await res.json()) as Json;

function patchJson(h: Harness, path: string, body: unknown, headers: Record<string, string>) {
  return h.app.request(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

/** 建立一位 KOL 與一個推薦碼（預設 9 折、佣金 15%、預約與 VIP 可用） */
async function setup(h: Harness, code: Json = {}) {
  const headers = adminHeaders(h);
  const kol = (await json(await postJson(h, '/admin/kols', { name: 'Amy', contact: 'IG @amy' }, headers))).kol;
  const res = await postJson(
    h,
    '/admin/referral-codes',
    { kolId: kol.id, code: 'amy10', discountType: 'percent', discountValue: 10, commissionRate: 15, appliesShop: false, ...code },
    headers,
  );
  return { headers, kol, res, code: (await json(res)).code };
}

describe('後台：KOL 與推薦碼', () => {
  it('建立 KOL 與推薦碼（代碼轉大寫、顯示折扣文字）、列表含推薦碼', async () => {
    const h = makeHarness({ now: NOW });
    const { headers, kol, res, code } = await setup(h);
    expect(res.status).toBe(201);
    expect(code).toMatchObject({ code: 'AMY10', kolId: kol.id, kolName: 'Amy', label: '9 折', commissionRate: 15, appliesShop: false, active: true });
    const list = await json(await h.app.request('/admin/kols', { headers }));
    expect(list.kols).toHaveLength(1);
    expect(list.kols[0]).toMatchObject({ name: 'Amy', contact: 'IG @amy', codes: [{ code: 'AMY10' }] });
  });

  it('代碼重複 → 409；打折超過 90% → 400；期間顛倒 → 400；KOL 不存在 → 404', async () => {
    const h = makeHarness({ now: NOW });
    const { headers, kol } = await setup(h);
    const dup = await postJson(h, '/admin/referral-codes', { kolId: kol.id, code: 'AMY10', discountType: 'amount', discountValue: 100 }, headers);
    expect(dup.status).toBe(409);
    const tooMuch = await postJson(h, '/admin/referral-codes', { kolId: kol.id, code: 'BIG', discountType: 'percent', discountValue: 95 }, headers);
    expect(tooMuch.status).toBe(400);
    expect((await json(tooMuch)).fields.discountValue).toBeTruthy();
    const period = await postJson(
      h,
      '/admin/referral-codes',
      { kolId: kol.id, code: 'OOPS', discountType: 'amount', discountValue: 100, startsOn: '2026-10-10', endsOn: '2026-10-01' },
      headers,
    );
    expect(period.status).toBe(400);
    const noKol = await postJson(
      h,
      '/admin/referral-codes',
      { kolId: '00000000-0000-4000-8000-000000000000', code: 'NOKOL', discountType: 'amount', discountValue: 100 },
      headers,
    );
    expect(noKol.status).toBe(404);
  });

  it('修改推薦碼（停用、改折扣、有效期間含結束日當天）；沒登入 → 401', async () => {
    const h = makeHarness({ now: NOW });
    const { headers, code } = await setup(h);
    const res = await patchJson(h, `/admin/referral-codes/${code.id}`, { discountType: 'amount', discountValue: 300, endsOn: '2026-09-30', active: false }, headers);
    expect(res.status).toBe(200);
    expect((await json(res)).code).toMatchObject({ label: '折 NT$300', endsOn: '2026-09-30', active: false });
    expect((await postJson(h, '/admin/kols', { name: 'x' })).status).toBe(401);
  });
});

describe('推薦碼：預覽與預約折扣', () => {
  it('GET /referral/:code：可用 → 折扣；不存在 → 404；不適用 → 409', async () => {
    const h = makeHarness({ now: NOW });
    await setup(h);
    const ok = await h.app.request('/referral/amy10?kind=booking');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ code: 'AMY10', discountType: 'percent', discountValue: 10, label: '9 折' });
    expect((await h.app.request('/referral/nope99')).status).toBe(404);
    const shop = await h.app.request('/referral/AMY10?kind=shop');
    expect(shop.status).toBe(409);
    expect((await json(shop)).message).toBe('這個推薦碼不適用於此項目');
  });

  it('預約帶推薦碼：收折扣後的金額、記錄使用（含佣金）', async () => {
    const h = makeHarness({ now: NOW });
    await setup(h);
    const res = await postJson(h, '/bookings', { ...valid, referral_code: ' amy10 ' });
    expect(res.status).toBe(201);
    const b = await json(res);
    expect(b.amount).toBe(3240);
    expect(h.db.booking(b.orderNo)!.amount).toBe(3240);
    expect(h.db.referralUses).toEqual([
      expect.objectContaining({
        kind: 'booking',
        orderNo: b.orderNo,
        originalAmount: 3600,
        discountAmount: 360,
        finalAmount: 3240,
        commissionAmount: 486,
      }),
    ]);
  });

  it('推薦碼無效 → 400 fields.referral_code，不建立預約', async () => {
    const h = makeHarness({ now: NOW });
    const { headers, code } = await setup(h);
    const bad = await postJson(h, '/bookings', { ...valid, referral_code: 'NOPE99' });
    expect(bad.status).toBe(400);
    expect((await json(bad)).fields.referral_code).toBe('找不到這個推薦碼');
    await patchJson(h, `/admin/referral-codes/${code.id}`, { active: false }, headers);
    const off = await postJson(h, '/bookings', { ...valid, referral_code: 'AMY10' });
    expect((await json(off)).fields.referral_code).toBe('這個推薦碼已停用');
    expect(h.db.bookings).toHaveLength(0);
  });

  it('可用次數：只算已付款或保留中的訂單（保留逾時就不算）', async () => {
    const h = makeHarness({ now: NOW });
    await setup(h, { maxUses: 1 });
    expect((await postJson(h, '/bookings', { ...valid, referral_code: 'AMY10' })).status).toBe(201);
    const second = { ...valid, time: '20:30', phone: '0922333444', email: 'c@d.co', referral_code: 'AMY10' };
    const full = await postJson(h, '/bookings', second);
    expect((await json(full)).fields.referral_code).toBe('這個推薦碼已達使用上限');
    h.clock.now = new Date(NOW.getTime() + 16 * 60_000); // 第一筆 15 分鐘保留已過期
    expect((await postJson(h, '/bookings', second)).status).toBe(201);
  });
});

describe('後台：推薦成效與佣金', () => {
  it('只有已付款的訂單算進成效與佣金；保留中的另計', async () => {
    const h = makeHarness({ now: NOW });
    const { headers, kol } = await setup(h);
    const paid = await json(await postJson(h, '/bookings', { ...valid, referral_code: 'AMY10' }));
    await postJson(h, '/bookings', { ...valid, service_id: 'flow', time: '10:00', date: '2026-10-08', phone: '0922333444', email: 'c@d.co', referral_code: 'AMY10' });
    h.db.booking(paid.orderNo)!.status = 'confirmed';
    const res = await h.app.request('/admin/referral-stats', { headers });
    expect(res.status).toBe(200);
    const s = await json(res);
    expect(s.from).toBe('2026-09-01');
    expect(s.to).toBe('2026-09-30');
    expect(s.kols).toEqual([{ kolId: kol.id, name: 'Amy', active: true, orders: 1, pending: 1, revenue: 3240, discount: 360, commission: 486 }]);
    expect(s.codes[0]).toMatchObject({ code: 'AMY10', orders: 1, pending: 1, revenue: 3240 });
    expect(s.uses.map((u: Json) => u.state).sort()).toEqual(['paid', 'pending']);
  });
});
