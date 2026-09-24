import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import type { Product, ShopSettings } from '../db/types';
import { apiError, readJsonObject, requestIp } from '../lib/http';
import { errorFields } from '../lib/log';
import { generateOrderNo } from '../lib/order-no';
import { shopOrderSchema, zodFields } from '../lib/order-schema';
import { rateLimitKey } from '../lib/rate-limit';
import { resolveReferral, type ResolvedReferral } from '../services/referral';
import { ORDER_HOLD_MS } from './vip';

// 商店：商品列表／單一商品、下單（建立訂單 → 綠界信用卡付款，付款成功才扣庫存）

/** 公開的商品資料（不含內部欄位） */
export function publicProductJson(p: Product) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    price: p.price,
    images: p.images,
    stock: p.stock,
  };
}

/** 運費：商品小計（折扣前）達免運門檻就免運 */
export function shippingFor(subtotal: number, s: ShopSettings): number {
  return s.freeShippingOver !== null && subtotal >= s.freeShippingOver ? 0 : s.shippingFee;
}

const MSG_GONE = '購物車裡有商品已下架，請重新整理購物車';

export function shopRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get('/shop/products', async (c) => {
    const [products, settings] = await Promise.all([deps.db.listProducts({ publicOnly: true }), deps.db.getShopSettings()]);
    return c.json({ products: products.map(publicProductJson), ...settings });
  });

  app.get('/shop/products/:slug', async (c) => {
    const p = await deps.db.getProductBySlug(c.req.param('slug').toLowerCase());
    if (!p || !p.active || !p.forSale) return apiError(c, 404, 'not_found', '找不到這個商品');
    const settings = await deps.db.getShopSettings();
    return c.json({ product: publicProductJson(p), ...settings });
  });

  app.post('/shop/orders', async (c) => {
    const rl = deps.bookingLimiter.hit(rateLimitKey(requestIp(c)));
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSec));
      return apiError(c, 429, 'rate_limited', '送出次數太多了，請稍後再試');
    }
    const parsed = shopOrderSchema.safeParse((await readJsonObject(c)) ?? {});
    if (!parsed.success) {
      const fields = zodFields(parsed.error);
      return apiError(c, 400, 'validation', Object.values(fields)[0] ?? '請確認填寫的資料', fields);
    }
    const d = parsed.data;
    const now = deps.now();

    // 金額、庫存一律以 DB 為準
    const products = await deps.db.getProductsByIds(d.items.map((i) => i.product_id));
    const lines: { product: Product; qty: number }[] = [];
    for (const i of d.items) {
      const p = products.find((x) => x.id === i.product_id);
      if (!p || !p.active || !p.forSale || p.price < 1) return apiError(c, 400, 'validation', MSG_GONE, { items: MSG_GONE });
      if (p.stock < i.qty) {
        const msg = p.stock === 0 ? `「${p.name}」已售完，請從購物車移除` : `「${p.name}」庫存只剩 ${p.stock} 件`;
        return apiError(c, 400, 'validation', msg, { items: msg });
      }
      lines.push({ product: p, qty: i.qty });
    }
    if (!deps.env.ecpay) return apiError(c, 503, 'payment_unavailable', '線上付款暫停服務，請稍後再試');

    const subtotal = lines.reduce((t, l) => t + l.product.price * l.qty, 0);
    const shippingFee = shippingFor(subtotal, await deps.db.getShopSettings());
    let itemsTotal = subtotal;
    let referral: ResolvedReferral | null = null;
    if (d.referral_code) {
      // 推薦碼折扣只算在商品上（不含運費）
      const r = await resolveReferral(deps, d.referral_code, 'shop', subtotal, now);
      if (!r.ok) return apiError(c, 400, 'validation', r.message, { referral_code: r.message });
      referral = r;
      itemsTotal = r.final;
    }
    const amount = itemsTotal + shippingFee;

    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNo = generateOrderNo();
      const r = await deps.db.createOrder({
        orderNo,
        kind: 'shop',
        status: 'pending_payment',
        subtotal,
        shippingFee,
        discountAmount: subtotal - itemsTotal,
        amount,
        customerName: d.name,
        email: d.email,
        phone: d.phone,
        birthDate: null,
        shipName: d.ship_name,
        shipPhone: d.ship_phone,
        shipAddress: d.ship_address,
        note: d.note || null,
        vipPlanId: null,
        vipMemberId: null,
        holdExpiresAt: new Date(now.getTime() + ORDER_HOLD_MS),
        items: lines.map((l) => ({ productId: l.product.id, name: l.product.name, unitPrice: l.product.price, qty: l.qty })),
      });
      if (!r.ok) continue; // 訂單編號撞號 → 換一個
      if (referral) {
        try {
          await deps.db.recordReferralUse({
            codeId: referral.code.id,
            kind: 'shop',
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
      deps.logger.info('shop.order_created', { order: orderNo, items: lines.length, referral: referral?.code.code ?? null });
      return c.json({ orderNo, amount }, 201);
    }
    throw new Error('could not allocate order number');
  });

  return app;
}
