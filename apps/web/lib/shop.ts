/**
 * 商店（前端）
 *
 * - 商品與運費：GET {API}/shop/products（Server Component 用；只回上架販售中的商品）
 * - 購物車：localStorage（商品 id＋數量），金額、庫存一律在下單時由 API 重新計算
 */

import { normalizeBase } from './api';

export interface ShopProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  images: string[];
  stock: number;
}

export interface ShopSettings {
  shippingFee: number;
  /** 商品小計達到這個金額免運（null＝沒有滿額免運） */
  freeShippingOver: number | null;
}

export interface ShopCatalog extends ShopSettings {
  products: ShopProduct[];
}

const FETCH_TIMEOUT_MS = 6000;

function isProduct(v: unknown): v is ShopProduct {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.slug === 'string' &&
    typeof r.name === 'string' &&
    typeof r.price === 'number' &&
    typeof r.stock === 'number' &&
    Array.isArray(r.images) &&
    r.images.every((x) => typeof x === 'string') &&
    (r.description == null || typeof r.description === 'string')
  );
}

function toSettings(r: Record<string, unknown>): ShopSettings {
  return {
    shippingFee: typeof r.shippingFee === 'number' ? r.shippingFee : 0,
    freeShippingOver: typeof r.freeShippingOver === 'number' ? r.freeShippingOver : null,
  };
}

async function getJson(path: string, env: Record<string, string | undefined>, fresh: boolean): Promise<{ status: number; body: unknown } | null> {
  const base = normalizeBase(env.NEXT_PUBLIC_API_URL);
  if (!base) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = fetch(`${base}${path}`, {
      headers: { Accept: 'application/json' },
      ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: 60 } }),
    }).catch(() => null);
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), FETCH_TIMEOUT_MS);
    });
    const res = await Promise.race([request, timeout]);
    if (!res) return null;
    return { status: res.status, body: res.ok ? await res.json() : null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 商品列表＋運費；API 讀不到 → null（頁面顯示「暫時無法使用」） */
export async function getCatalog(opts: { fresh?: boolean } = {}, env: Record<string, string | undefined> = process.env): Promise<ShopCatalog | null> {
  const r = await getJson('/shop/products', env, opts.fresh === true);
  if (!r || !r.body || typeof r.body !== 'object') return null;
  const b = r.body as Record<string, unknown>;
  if (!Array.isArray(b.products)) return null;
  return { products: b.products.filter(isProduct), ...toSettings(b) };
}

/** 單一商品：找不到 → 'not_found'；API 讀不到 → null */
export async function getShopProduct(
  slug: string,
  env: Record<string, string | undefined> = process.env,
): Promise<(ShopSettings & { product: ShopProduct }) | 'not_found' | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/i.test(slug)) return 'not_found';
  const r = await getJson(`/shop/products/${encodeURIComponent(slug.toLowerCase())}`, env, false);
  if (!r) return null;
  if (r.status === 404) return 'not_found';
  const b = r.body as Record<string, unknown> | null;
  if (!b || !isProduct(b.product)) return null;
  return { product: b.product, ...toSettings(b) };
}

/** 運費：商品小計（折扣前）達免運門檻就免運（和 API 相同） */
export function shippingFor(subtotal: number, s: ShopSettings): number {
  return s.freeShippingOver !== null && subtotal >= s.freeShippingOver ? 0 : s.shippingFee;
}

// ---------- 購物車（localStorage） ----------

export interface CartLine {
  id: string;
  qty: number;
}

export const CART_KEY = 'yuanshe.cart.v1';
/** 下單後記住訂單編號：付款完成才清空購物車（付款失敗回來購物車還在） */
export const CART_ORDER_KEY = 'yuanshe.cart.order.v1';
export const CART_EVENT = 'yuanshe:cart';
export const MAX_QTY = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function sanitizeCart(raw: unknown): CartLine[] {
  if (!Array.isArray(raw)) return [];
  const out: CartLine[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (typeof r.id !== 'string' || !UUID_RE.test(r.id) || out.some((l) => l.id === r.id)) continue;
    const qty = typeof r.qty === 'number' && Number.isFinite(r.qty) ? Math.floor(r.qty) : 0;
    if (qty >= 1) out.push({ id: r.id, qty: Math.min(qty, MAX_QTY) });
    if (out.length >= 30) break;
  }
  return out;
}

export function loadCart(store: Storage | null = storage()): CartLine[] {
  try {
    const text = store?.getItem(CART_KEY);
    return text ? sanitizeCart(JSON.parse(text)) : [];
  } catch {
    return [];
  }
}

export function saveCart(lines: CartLine[], store: Storage | null = storage()): void {
  try {
    if (lines.length === 0) store?.removeItem(CART_KEY);
    else store?.setItem(CART_KEY, JSON.stringify(lines));
  } catch {
    // 無痕模式等：不存
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CART_EVENT));
}

/** 加入購物車（同一商品累加數量，不超過庫存與上限） */
export function addLine(lines: CartLine[], id: string, qty: number, stock: number): CartLine[] {
  const cap = Math.max(0, Math.min(stock, MAX_QTY));
  const cur = lines.find((l) => l.id === id)?.qty ?? 0;
  const next = Math.min(cap, cur + qty);
  if (next < 1) return lines;
  return lines.some((l) => l.id === id) ? lines.map((l) => (l.id === id ? { ...l, qty: next } : l)) : [...lines, { id, qty: next }];
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}

export function rememberCartOrder(orderNo: string, store: Storage | null = storage()): void {
  try {
    store?.setItem(CART_ORDER_KEY, orderNo);
  } catch {
    // ignore
  }
}

/** 這筆商店訂單付款完成：如果是從購物車下的單就清空購物車 */
export function clearCartForOrder(orderNo: string, store: Storage | null = storage()): void {
  try {
    if (!store || store.getItem(CART_ORDER_KEY) !== orderNo) return;
    store.removeItem(CART_ORDER_KEY);
  } catch {
    return;
  }
  saveCart([], store);
}

// ---------- 下單（docs/API.md「商店」） ----------

export interface ShopOrderBody {
  items: { product_id: string; qty: number }[];
  name: string;
  email: string;
  phone: string;
  ship_name: string;
  ship_phone: string;
  ship_address: string;
  note: string;
  referral_code: string;
  agree: boolean;
}
