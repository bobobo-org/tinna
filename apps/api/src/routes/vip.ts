import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import { apiError, readJsonObject, requestIp } from '../lib/http';
import { errorFields } from '../lib/log';
import { vipLookupSchema, vipOrderSchema, zodFields } from '../lib/order-schema';
import { generateOrderNo } from '../lib/order-no';
import { MINUTE_MS, taipeiDate, taipeiTime, toTaipeiIso } from '../lib/time';
import { rateLimitKey } from '../lib/rate-limit';
import { expiryDate, normalizeVipCard } from '../lib/vip';
import { resolveReferral, type ResolvedReferral } from '../services/referral';

// VIP 包堂：方案列表、購買（建立訂單 → 綠界付款，付款成功才發卡）、查詢剩餘堂數

/** VIP／商店訂單付款前保留多久（不占時段與庫存，只是讓逾時未付款的訂單有個結束） */
export const ORDER_HOLD_MS = 30 * MINUTE_MS;

const MSG_LOOKUP_FAIL = '找不到這張 VIP 卡，請確認卡號與購買時的 Email';

export function vipRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get('/vip/plans', async (c) => {
    const plans = await deps.db.listVipPlans(true);
    return c.json({
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        sessions: p.sessions,
        price: p.price,
        perSession: Math.round(p.price / p.sessions),
        validDays: p.validDays,
        description: p.description,
      })),
    });
  });

  app.post('/vip/orders', async (c) => {
    const rl = deps.bookingLimiter.hit(rateLimitKey(requestIp(c)));
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSec));
      return apiError(c, 429, 'rate_limited', '送出次數太多了，請稍後再試');
    }
    const parsed = vipOrderSchema.safeParse((await readJsonObject(c)) ?? {});
    if (!parsed.success) {
      const fields = zodFields(parsed.error);
      return apiError(c, 400, 'validation', Object.values(fields)[0] ?? '請確認填寫的資料', fields);
    }
    const d = parsed.data;
    const now = deps.now();
    if (d.birth_date && (d.birth_date > taipeiDate(now) || d.birth_date < '1900-01-01')) {
      return apiError(c, 400, 'validation', '請確認生日', { birth_date: '請確認生日' });
    }
    const plan = await deps.db.getVipPlan(d.plan_id);
    if (!plan || !plan.active) return apiError(c, 400, 'validation', '請選擇方案', { plan_id: '請選擇方案' });
    if (!deps.env.ecpay) return apiError(c, 503, 'payment_unavailable', '線上付款暫停服務，請稍後再試');

    let amount = plan.price;
    let referral: ResolvedReferral | null = null;
    if (d.referral_code) {
      const r = await resolveReferral(deps, d.referral_code, 'vip', plan.price, now);
      if (!r.ok) return apiError(c, 400, 'validation', r.message, { referral_code: r.message });
      referral = r;
      amount = r.final;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNo = generateOrderNo();
      const r = await deps.db.createOrder({
        orderNo,
        kind: 'vip',
        status: 'pending_payment',
        subtotal: plan.price,
        shippingFee: 0,
        discountAmount: plan.price - amount,
        amount,
        customerName: d.name,
        email: d.email,
        phone: d.phone,
        birthDate: d.birth_date || null,
        shipName: null,
        shipPhone: null,
        shipAddress: null,
        note: null,
        vipPlanId: plan.id,
        vipMemberId: null,
        holdExpiresAt: new Date(now.getTime() + ORDER_HOLD_MS),
        items: [{ productId: null, name: `${plan.name}（${plan.sessions} 堂）`, unitPrice: plan.price, qty: 1 }],
      });
      if (!r.ok) continue; // 訂單編號撞號 → 換一個
      if (referral) {
        try {
          await deps.db.recordReferralUse({
            codeId: referral.code.id,
            kind: 'vip',
            orderNo,
            bookingId: null,
            orderId: r.id,
            originalAmount: referral.original,
            discountAmount: referral.discount,
            finalAmount: referral.final,
            commissionAmount: referral.commission,
          });
        } catch (e) {
          deps.logger.error('referral.record_failed', { order: orderNo, ...errorFields(e) });
        }
      }
      deps.logger.info('vip.order_created', { order: orderNo, plan: plan.id, referral: referral?.code.code ?? null });
      return c.json({ orderNo, amount }, 201);
    }
    throw new Error('could not allocate order number');
  });

  // 查詢剩餘堂數：卡號＋購買時的 Email（兩個都對才回資料）
  app.post('/vip/lookup', async (c) => {
    const rl = deps.paymentLimiter.hit(rateLimitKey(requestIp(c)));
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSec));
      return apiError(c, 429, 'rate_limited', '查詢次數太多了，請稍後再試');
    }
    const parsed = vipLookupSchema.safeParse((await readJsonObject(c)) ?? {});
    if (!parsed.success) {
      const fields = zodFields(parsed.error);
      return apiError(c, 400, 'validation', Object.values(fields)[0] ?? '請確認填寫的資料', fields);
    }
    const card = normalizeVipCard(parsed.data.card_no);
    const m = card ? await deps.db.getVipMemberByCard(card) : null;
    if (!m || m.email.trim().toLowerCase() !== parsed.data.email.trim().toLowerCase()) {
      return apiError(c, 404, 'not_found', MSG_LOOKUP_FAIL);
    }
    const bookings = await deps.db.listVipBookings(m.id);
    const now = deps.now();
    return c.json({
      cardNo: m.cardNo,
      name: m.name,
      planName: m.planName,
      sessionsTotal: m.sessionsTotal,
      sessionsUsed: m.sessionsUsed,
      sessionsLeft: m.sessionsTotal - m.sessionsUsed,
      expiresOn: expiryDate(m.expiresAt),
      expired: m.expiresAt.getTime() <= now.getTime(),
      bookings: bookings.map((b) => ({
        orderNo: b.orderNo,
        date: taipeiDate(b.startsAt),
        time: taipeiTime(b.startsAt),
        startsAt: toTaipeiIso(b.startsAt),
        serviceName: b.serviceName,
        status: b.status,
      })),
    });
  });

  return app;
}
