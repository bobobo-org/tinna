import { randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../deps';
import type { NewProduct, Product, ProductPatch, ShopSettings } from '../db/types';
import { apiError, readJsonObject } from '../lib/http';
import { errorFields } from '../lib/log';
import { generateOrderNo } from '../lib/order-no';
import { zodFields } from '../lib/order-schema';
import { IMAGE_TYPES, MAX_UPLOAD_BYTES, sniffImageType } from '../lib/storage';
import { taipeiDate } from '../lib/time';
import type { AdminEnv } from './admin';
import { adminOrderJson } from './admin-commerce';

// 後台：商品（新增／編輯／上下架、庫存）、商品圖片上傳、運費設定、寄 VIP 贈品
// 登入檢查在 app.ts 的 /admin/* middleware

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;
const MSG_SLUG = '網址代號請用 2–60 個英文小寫、數字或 -（開頭不能是 -）';
const MSG_PRICE_FOR_SALE = '上架販售的商品價格至少 1 元（只當贈品的可以是 0）';

const productFields = {
  slug: z.string({ invalid_type_error: MSG_SLUG }).trim().toLowerCase().regex(SLUG_RE, MSG_SLUG),
  name: z.string({ invalid_type_error: '請填寫商品名稱' }).trim().min(1, '請填寫商品名稱').max(80, '名稱請勿超過 80 字'),
  description: z.string().trim().max(2000, '說明請勿超過 2000 字').nullable(),
  price: z.number({ invalid_type_error: '請填寫價格' }).int('價格請填整數').min(0, '價格不可小於 0').max(1_000_000, '價格太大'),
  images: z
    .array(z.string().trim().url('圖片網址不正確').max(500, '圖片網址太長').refine((u) => u.startsWith('https://'), '圖片網址必須是 https'))
    .max(8, '最多 8 張圖片'),
  stock: z.number({ invalid_type_error: '請填寫庫存' }).int('庫存請填整數').min(0, '庫存不可小於 0').max(100_000, '庫存太大'),
  forSale: z.boolean(),
  active: z.boolean(),
  sort: z.number().int(),
};

const productCreate = z.object({
  slug: productFields.slug.optional(),
  name: productFields.name,
  description: productFields.description.optional().default(null),
  price: productFields.price,
  images: productFields.images.optional().default([]),
  stock: productFields.stock.optional().default(0),
  forSale: productFields.forSale.optional().default(true),
  active: productFields.active.optional().default(true),
  sort: productFields.sort.optional().default(0),
});

const productPatch = z.object({
  slug: productFields.slug.optional(),
  name: productFields.name.optional(),
  description: productFields.description.optional(),
  price: productFields.price.optional(),
  images: productFields.images.optional(),
  stock: productFields.stock.optional(),
  forSale: productFields.forSale.optional(),
  active: productFields.active.optional(),
  sort: productFields.sort.optional(),
});

const settingsPatch = z.object({
  shippingFee: z.number({ invalid_type_error: '請填寫運費' }).int('運費請填整數').min(0, '運費不可小於 0').max(10_000, '運費太大').optional(),
  freeShippingOver: z.number().int('金額請填整數').min(1, '免運門檻至少 1 元').max(1_000_000, '金額太大').nullable().optional(),
});

const phoneOk = (s: string) => s.replace(/\D/g, '').length >= 9;

const giftSchema = z.object({
  memberId: z.string({ required_error: '請選擇 VIP 會員' }).uuid('請選擇 VIP 會員'),
  items: z
    .array(
      z.object({
        productId: z.string().uuid('商品不正確'),
        qty: z.number().int('數量不正確').min(1, '數量不正確').max(20, '每樣最多 20 件'),
      }),
      { required_error: '請選擇贈品', invalid_type_error: '請選擇贈品' },
    )
    .min(1, '請選擇贈品')
    .max(10, '贈品種類太多')
    .refine((a) => new Set(a.map((i) => i.productId)).size === a.length, '同一個贈品請合併數量'),
  shipName: z.string({ required_error: '請填寫收件人' }).trim().min(1, '請填寫收件人').max(50, '收件人請勿超過 50 字'),
  shipPhone: z.string({ required_error: '請填寫收件人手機' }).trim().max(30, '請填寫收件人手機').refine(phoneOk, '請填寫收件人手機'),
  shipAddress: z.string({ required_error: '請填寫收件地址' }).trim().min(6, '請填寫完整的收件地址').max(200, '地址請勿超過 200 字'),
  note: z.string().trim().max(500, '備註請勿超過 500 字').optional().default(''),
});

function badRequest(c: Parameters<typeof apiError>[0], error: z.ZodError) {
  const fields = zodFields(error);
  return apiError(c, 400, 'validation', Object.values(fields)[0] ?? '資料不正確', fields);
}

export function adminProductJson(p: Product) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    price: p.price,
    images: p.images,
    stock: p.stock,
    forSale: p.forSale,
    active: p.active,
    sort: p.sort,
    createdAt: p.createdAt.toISOString(),
  };
}

/** 沒填網址代號：p-<8 碼亂數> */
const randomSlug = () => `p-${randomBytes(4).toString('hex')}`;

export function adminShopRoutes(deps: AppDeps) {
  const app = new Hono<AdminEnv>();

  // ---------- 商品 ----------
  app.get('/admin/products', async (c) => c.json({ products: (await deps.db.listProducts({ publicOnly: false })).map(adminProductJson) }));

  app.post('/admin/products', async (c) => {
    const parsed = productCreate.safeParse((await readJsonObject(c)) ?? {});
    if (!parsed.success) return badRequest(c, parsed.error);
    const d = parsed.data;
    if (d.forSale && d.price < 1) return apiError(c, 400, 'validation', MSG_PRICE_FOR_SALE, { price: MSG_PRICE_FOR_SALE });
    const input: NewProduct = { ...d, slug: d.slug ?? randomSlug() };
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await deps.db.createProduct(input);
      if (r !== 'duplicate') return c.json({ product: adminProductJson(r) }, 201);
      if (d.slug) return apiError(c, 409, 'duplicate', '這個網址代號已經有商品了', { slug: '這個網址代號已經有商品了' });
      input.slug = randomSlug();
    }
    throw new Error('could not allocate product slug');
  });

  app.patch('/admin/products/:id', async (c) => {
    const id = c.req.param('id');
    if (!z.string().uuid().safeParse(id).success) return apiError(c, 404, 'not_found', '找不到這個商品');
    const parsed = productPatch.safeParse((await readJsonObject(c)) ?? {});
    if (!parsed.success) return badRequest(c, parsed.error);
    const cur = await deps.db.getProduct(id);
    if (!cur) return apiError(c, 404, 'not_found', '找不到這個商品');
    const patch: ProductPatch = {};
    for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
    if ((patch.forSale ?? cur.forSale) && (patch.price ?? cur.price) < 1) {
      return apiError(c, 400, 'validation', MSG_PRICE_FOR_SALE, { price: MSG_PRICE_FOR_SALE });
    }
    const r = await deps.db.updateProduct(id, patch);
    if (r === 'duplicate') return apiError(c, 409, 'duplicate', '這個網址代號已經有商品了', { slug: '這個網址代號已經有商品了' });
    if (!r) return apiError(c, 404, 'not_found', '找不到這個商品');
    return c.json({ product: adminProductJson(r) });
  });

  // ---------- 商品圖片上傳：body 是圖片本身（Content-Type: image/jpeg｜png｜webp｜gif，最多 5MB） ----------
  app.post('/admin/uploads', async (c) => {
    const declared = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(declared in IMAGE_TYPES)) {
      return apiError(c, 415, 'unsupported_media_type', '只能上傳 JPG、PNG、WebP 或 GIF 圖片');
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) return apiError(c, 400, 'validation', '沒有收到圖片');
    if (bytes.length > MAX_UPLOAD_BYTES) return apiError(c, 413, 'payload_too_large', '圖片太大了（最多 5MB）');
    const type = sniffImageType(bytes);
    if (!type) return apiError(c, 415, 'unsupported_media_type', '只能上傳 JPG、PNG、WebP 或 GIF 圖片');
    const path = `${taipeiDate(deps.now()).slice(0, 7)}/${randomUUID()}.${IMAGE_TYPES[type]}`;
    try {
      const url = await deps.storage.upload(path, bytes, type);
      deps.logger.info('admin.upload', { path, bytes: bytes.length });
      return c.json({ url }, 201);
    } catch (e) {
      deps.logger.error('admin.upload_failed', { path, ...errorFields(e) });
      return apiError(c, 502, 'upload_failed', '圖片上傳失敗，請稍後再試');
    }
  });

  // ---------- 運費設定 ----------
  app.get('/admin/settings', async (c) => c.json(await deps.db.getShopSettings()));

  app.patch('/admin/settings', async (c) => {
    const parsed = settingsPatch.safeParse((await readJsonObject(c)) ?? {});
    if (!parsed.success) return badRequest(c, parsed.error);
    const patch: Partial<ShopSettings> = {};
    if (parsed.data.shippingFee !== undefined) patch.shippingFee = parsed.data.shippingFee;
    if (parsed.data.freeShippingOver !== undefined) patch.freeShippingOver = parsed.data.freeShippingOver;
    return c.json(await deps.db.updateShopSettings(patch));
  });

  // ---------- 寄 VIP 贈品：建立 kind=gift 的訂單（不收費、直接算已付款＝待出貨），扣庫存 ----------
  app.post('/admin/gifts', async (c) => {
    const parsed = giftSchema.safeParse((await readJsonObject(c)) ?? {});
    if (!parsed.success) return badRequest(c, parsed.error);
    const d = parsed.data;
    const member = await deps.db.getVipMember(d.memberId);
    if (!member) return apiError(c, 404, 'not_found', '找不到這位 VIP', { memberId: '找不到這位 VIP' });
    const products = await deps.db.getProductsByIds(d.items.map((i) => i.productId));
    const lines: { product: Product; qty: number }[] = [];
    for (const i of d.items) {
      const p = products.find((x) => x.id === i.productId);
      if (!p || !p.active) return apiError(c, 400, 'validation', '有贈品已下架，請重新選擇', { items: '有贈品已下架，請重新選擇' });
      if (p.stock < i.qty) {
        const msg = `「${p.name}」庫存只剩 ${p.stock} 件`;
        return apiError(c, 400, 'validation', msg, { items: msg });
      }
      lines.push({ product: p, qty: i.qty });
    }
    const value = lines.reduce((t, l) => t + l.product.price * l.qty, 0);
    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNo = generateOrderNo();
      const r = await deps.db.createOrder({
        orderNo,
        kind: 'gift',
        status: 'paid',
        subtotal: value,
        shippingFee: 0,
        discountAmount: 0,
        amount: 0,
        customerName: member.name,
        email: member.email,
        phone: member.phone,
        birthDate: member.birthDate,
        shipName: d.shipName,
        shipPhone: d.shipPhone,
        shipAddress: d.shipAddress,
        note: d.note || null,
        vipPlanId: null,
        vipMemberId: member.id,
        holdExpiresAt: null,
        items: lines.map((l) => ({ productId: l.product.id, name: l.product.name, unitPrice: l.product.price, qty: l.qty })),
      });
      if (!r.ok) continue;
      await deps.db.consumeOrderStock(r.id);
      const o = await deps.db.getOrder(orderNo);
      deps.logger.info('admin.gift_created', { order: orderNo, member: member.id, items: lines.length });
      return c.json({ order: o ? adminOrderJson(o, deps.now()) : { orderNo } }, 201);
    }
    throw new Error('could not allocate order number');
  });

  return app;
}
