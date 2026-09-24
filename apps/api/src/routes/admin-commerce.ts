import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../deps';
import type { CommerceKind, Order, OrderPatch, OrderStatus, VipMember, VipMemberPatch, VipPlanPatch } from '../db/types';
import { apiError, readJsonObject } from '../lib/http';
import { zodFields } from '../lib/order-schema';
import { fromTaipei, isValidDate, taipeiDate, taipeiTime, toTaipeiIso } from '../lib/time';
import { expiryDate } from '../lib/vip';
import { sendShippedEmail } from '../services/notify';
import type { AdminEnv } from './admin';

// 後台：VIP 方案、VIP 會員（查詢、生日月份、調整堂數與期限）、訂單（VIP／商店／贈品：狀態、出貨）
// 登入檢查在 app.ts 的 /admin/* middleware；回應含個資，不寫 log

const DAY_MS = 24 * 60 * 60 * 1000;
const KINDS: CommerceKind[] = ['vip', 'shop', 'gift'];
const STATUSES: OrderStatus[] = ['pending_payment', 'paid', 'shipped', 'completed', 'cancelled', 'expired'];

const planFields = {
  name: z.string().trim().min(1, '請填寫名稱').max(40, '名稱請勿超過 40 字'),
  sessions: z.number({ invalid_type_error: '請填寫堂數' }).int('堂數請填整數').min(1, '堂數 1–200').max(200, '堂數 1–200'),
  price: z.number({ invalid_type_error: '請填寫價格' }).int('價格請填整數').min(1, '價格必須大於 0').max(10_000_000, '價格太大'),
  validDays: z.number({ invalid_type_error: '請填寫有效天數' }).int('天數請填整數').min(1, '有效天數 1–3650').max(3650, '有效天數 1–3650'),
  description: z.string().trim().max(200, '說明請勿超過 200 字').nullable(),
  sort: z.number().int(),
  active: z.boolean(),
};

const planCreate = z.object({
  id: z
    .string({ required_error: '請填寫代號' })
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,31}$/, '代號請用 2–32 個英文小寫、數字或 -'),
  name: planFields.name,
  sessions: planFields.sessions,
  price: planFields.price,
  validDays: planFields.validDays.optional().default(365),
  description: planFields.description.optional().default(null),
  sort: planFields.sort.optional().default(0),
  active: planFields.active.optional().default(true),
});

const planPatch = z.object({
  name: planFields.name.optional(),
  sessions: planFields.sessions.optional(),
  price: planFields.price.optional(),
  validDays: planFields.validDays.optional(),
  description: planFields.description.optional(),
  sort: planFields.sort.optional(),
  active: planFields.active.optional(),
});

const memberPatch = z.object({
  sessionsTotal: z.number().int('堂數請填整數').min(0, '堂數不可小於 0').max(1000, '堂數太大').optional(),
  sessionsUsed: z.number().int('堂數請填整數').min(0, '堂數不可小於 0').max(1000, '堂數太大').optional(),
  expiresOn: z.string().refine(isValidDate, '日期格式不正確').optional(),
  note: z.string().trim().max(500, '備註請勿超過 500 字').nullable().optional(),
});

const orderPatch = z.object({
  status: z.enum(['paid', 'shipped', 'completed', 'cancelled'], { errorMap: () => ({ message: '狀態不正確' }) }).optional(),
  trackingNo: z.string().trim().max(60, '物流單號請勿超過 60 字').nullable().optional(),
  note: z.string().trim().max(500, '備註請勿超過 500 字').nullable().optional(),
});

function badRequest(c: Parameters<typeof apiError>[0], error: z.ZodError) {
  const fields = zodFields(error);
  return apiError(c, 400, 'validation', Object.values(fields)[0] ?? '資料不正確', fields);
}

export function memberJson(m: VipMember, now: Date) {
  return {
    id: m.id,
    cardNo: m.cardNo,
    name: m.name,
    email: m.email,
    phone: m.phone,
    birthDate: m.birthDate,
    planId: m.planId,
    planName: m.planName,
    sessionsTotal: m.sessionsTotal,
    sessionsUsed: m.sessionsUsed,
    sessionsLeft: m.sessionsTotal - m.sessionsUsed,
    expiresOn: expiryDate(m.expiresAt),
    expired: m.expiresAt.getTime() <= now.getTime(),
    note: m.note,
    createdAt: toTaipeiIso(m.createdAt),
  };
}

export function adminOrderJson(o: Order, now: Date) {
  const expired = o.status === 'pending_payment' && !!o.holdExpiresAt && o.holdExpiresAt.getTime() <= now.getTime();
  return {
    orderNo: o.orderNo,
    kind: o.kind,
    status: expired ? 'expired' : o.status,
    subtotal: o.subtotal,
    shippingFee: o.shippingFee,
    discountAmount: o.discountAmount,
    amount: o.amount,
    items: o.items,
    customer: { name: o.customerName, email: o.email, phone: o.phone, birthDate: o.birthDate },
    shipping: o.shipAddress ? { name: o.shipName, phone: o.shipPhone, address: o.shipAddress } : null,
    note: o.note,
    vipPlanId: o.vipPlanId,
    vipMemberId: o.vipMemberId,
    trackingNo: o.trackingNo,
    createdAt: toTaipeiIso(o.createdAt),
    paidAt: o.paidAt ? toTaipeiIso(o.paidAt) : null,
    shippedAt: o.shippedAt ? toTaipeiIso(o.shippedAt) : null,
  };
}

export function adminCommerceRoutes(deps: AppDeps) {
  const app = new Hono<AdminEnv>();

  // ---------- VIP 方案 ----------
  app.get('/admin/vip-plans', async (c) => c.json({ plans: await deps.db.listVipPlans(false) }));

  app.post('/admin/vip-plans', async (c) => {
    const parsed = planCreate.safeParse((await readJsonObject(c)) ?? {});
    if (!parsed.success) return badRequest(c, parsed.error);
    const r = await deps.db.createVipPlan(parsed.data);
    if (r === 'duplicate') return apiError(c, 409, 'duplicate', '這個代號已經有方案了', { id: '這個代號已經有方案了' });
    return c.json({ plan: r }, 201);
  });

  app.patch('/admin/vip-plans/:id', async (c) => {
    const parsed = planPatch.safeParse((await readJsonObject(c)) ?? {});
    if (!parsed.success) return badRequest(c, parsed.error);
    const patch: VipPlanPatch = {};
    for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
    const r = await deps.db.updateVipPlan(c.req.param('id'), patch);
    if (!r) return apiError(c, 404, 'not_found', '找不到這個方案');
    return c.json({ plan: r });
  });

  // ---------- VIP 會員 ----------
  // ?search=姓名／Email／卡號／手機 &birthMonth=1–12（生日禮）
  app.get('/admin/vip-members', async (c) => {
    const q = c.req.query();
    const birthMonth = q.birthMonth ? Number(q.birthMonth) : null;
    if (birthMonth !== null && !(Number.isInteger(birthMonth) && birthMonth >= 1 && birthMonth <= 12)) {
      return apiError(c, 400, 'validation', '月份不正確', { birthMonth: '月份不正確' });
    }
    const members = await deps.db.listVipMembers({ search: q.search?.trim() || null, birthMonth, limit: 500 });
    const now = deps.now();
    return c.json({ members: members.map((m) => memberJson(m, now)) });
  });

  app.get('/admin/vip-members/:id', async (c) => {
    const m = await deps.db.getVipMember(c.req.param('id'));
    if (!m) return apiError(c, 404, 'not_found', '找不到這位 VIP');
    const bookings = await deps.db.listVipBookings(m.id);
    return c.json({
      member: memberJson(m, deps.now()),
      bookings: bookings.map((b) => ({
        orderNo: b.orderNo,
        date: taipeiDate(b.startsAt),
        time: taipeiTime(b.startsAt),
        serviceName: b.serviceName,
        status: b.status,
      })),
    });
  });

  // 調整堂數／期限／備註（例：退還一堂、延長期限）
  app.patch('/admin/vip-members/:id', async (c) => {
    const body = (await readJsonObject(c)) ?? {};
    const parsed = memberPatch.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error);
    const cur = await deps.db.getVipMember(c.req.param('id'));
    if (!cur) return apiError(c, 404, 'not_found', '找不到這位 VIP');
    const d = parsed.data;
    const total = d.sessionsTotal ?? cur.sessionsTotal;
    const used = d.sessionsUsed ?? cur.sessionsUsed;
    if (used > total) return apiError(c, 400, 'validation', '已使用堂數不能多於總堂數', { sessionsUsed: '已使用堂數不能多於總堂數' });
    const patch: VipMemberPatch = {};
    if (d.sessionsTotal !== undefined) patch.sessionsTotal = d.sessionsTotal;
    if (d.sessionsUsed !== undefined) patch.sessionsUsed = d.sessionsUsed;
    // 到期日含當天：存成隔天 00:00（台北時間）
    if (d.expiresOn !== undefined) patch.expiresAt = new Date(fromTaipei(d.expiresOn, '00:00').getTime() + DAY_MS);
    if ('note' in body) patch.note = d.note ?? null;
    const m = await deps.db.updateVipMember(cur.id, patch);
    if (!m) return apiError(c, 404, 'not_found', '找不到這位 VIP');
    return c.json({ member: memberJson(m, deps.now()) });
  });

  // ---------- 訂單（VIP／商店／贈品） ----------
  // ?kind=vip,shop,gift &status=... &from=YYYY-MM-DD&to=YYYY-MM-DD（依下單時間，含 to 當天；預設最近 60 天）
  app.get('/admin/orders', async (c) => {
    const q = c.req.query();
    const now = deps.now();
    const to = q.to || taipeiDate(now);
    const from = q.from || taipeiDate(new Date(fromTaipei(to, '00:00').getTime() - 59 * DAY_MS));
    if (!isValidDate(from) || !isValidDate(to) || to < from) {
      return apiError(c, 400, 'validation', '日期範圍不正確', { to: '日期範圍不正確' });
    }
    const kinds = q.kind ? q.kind.split(',').map((s) => s.trim()) : null;
    if (kinds && !kinds.every((k): k is CommerceKind => (KINDS as string[]).includes(k))) {
      return apiError(c, 400, 'validation', '類型不正確', { kind: '類型不正確' });
    }
    const statuses = q.status ? q.status.split(',').map((s) => s.trim()) : null;
    if (statuses && !statuses.every((s): s is OrderStatus => (STATUSES as string[]).includes(s))) {
      return apiError(c, 400, 'validation', '狀態不正確', { status: '狀態不正確' });
    }
    const orders = await deps.db.listOrders({
      kinds: kinds as CommerceKind[] | null,
      statuses: statuses as OrderStatus[] | null,
      from: fromTaipei(from, '00:00'),
      to: new Date(fromTaipei(to, '00:00').getTime() + DAY_MS),
      limit: 500,
    });
    return c.json({ from, to, orders: orders.map((o) => adminOrderJson(o, now)) });
  });

  // 出貨（填物流單號並寄通知信）、完成、取消
  app.patch('/admin/orders/:orderNo', async (c) => {
    const body = (await readJsonObject(c)) ?? {};
    const parsed = orderPatch.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error);
    const orderNo = c.req.param('orderNo').toUpperCase();
    const cur = await deps.db.getOrder(orderNo);
    if (!cur) return apiError(c, 404, 'not_found', '找不到這筆訂單');
    const d = parsed.data;
    if (d.status === 'shipped' || d.status === 'completed') {
      if (cur.kind === 'vip') return apiError(c, 400, 'validation', 'VIP 訂單不需要出貨', { status: 'VIP 訂單不需要出貨' });
      if (cur.status === 'pending_payment' || cur.status === 'expired' || cur.status === 'cancelled') {
        return apiError(c, 400, 'validation', '還沒付款的訂單不能出貨', { status: '還沒付款的訂單不能出貨' });
      }
    }
    if (d.status === 'paid') {
      return apiError(c, 400, 'validation', '付款狀態由金流自動更新', { status: '付款狀態由金流自動更新' });
    }
    const patch: OrderPatch = {};
    if (d.status !== undefined) patch.status = d.status;
    if ('trackingNo' in body) patch.trackingNo = d.trackingNo || null;
    if ('note' in body) patch.note = d.note ?? null;
    const becameShipped = d.status === 'shipped' && cur.status !== 'shipped';
    if (becameShipped) patch.shippedAt = deps.now();
    const o = await deps.db.updateOrder(orderNo, patch);
    if (!o) return apiError(c, 404, 'not_found', '找不到這筆訂單');
    if (becameShipped) deps.defer('order_shipped_email', () => sendShippedEmail(deps, o));
    return c.json({ order: adminOrderJson(o, deps.now()) });
  });

  return app;
}
