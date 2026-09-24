/**
 * VIP 包堂（前端）
 *
 * - 方案：Server Component 讀 Supabase vip_plans（anon key + RLS，只回 active），5 分鐘 revalidate；
 *   沒設 env、讀取失敗 → 靜態預設方案（和 0007 migration 的預設值相同）
 * - VIP 卡號：VIP-XXXX-XXXX（和 apps/api/src/lib/vip.ts 相同的正規化規則）
 */

export interface VipPlan {
  id: string;
  name: string;
  sessions: number;
  price: number;
  validDays: number;
  description: string | null;
}

/** Supabase vip_plans 表的一列 */
export interface VipPlanRow {
  id: string;
  name: string;
  sessions: number;
  price: number;
  valid_days: number;
  description: string | null;
  sort: number | null;
  active: boolean | null;
}

/** 0007 migration 的預設方案（DB 讀不到時的備援；實際收費以 API 讀 DB 為準） */
export const VIP_PLANS: VipPlan[] = [
  { id: 'vip-4', name: 'VIP 4 堂', sessions: 4, price: 18000, validDays: 365, description: '每堂 90 分鐘，共 6 小時' },
  { id: 'vip-10', name: 'VIP 10 堂', sessions: 10, price: 42000, validDays: 365, description: '每堂 90 分鐘，共 15 小時' },
  { id: 'vip-12', name: 'VIP 12 堂', sessions: 12, price: 49200, validDays: 365, description: '每堂 90 分鐘，共 18 小時' },
  { id: 'vip-15', name: 'VIP 15 堂', sessions: 15, price: 60000, validDays: 365, description: '每堂 90 分鐘，共 22.5 小時' },
  { id: 'vip-20', name: 'VIP 20 堂', sessions: 20, price: 76000, validDays: 365, description: '每堂 90 分鐘，共 30 小時' },
];

function isPlanRow(v: unknown): v is VipPlanRow {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.sessions === 'number' &&
    r.sessions > 0 &&
    typeof r.price === 'number' &&
    typeof r.valid_days === 'number' &&
    (r.description == null || typeof r.description === 'string')
  );
}

/** DB rows → VipPlan[]（依 sort）；形狀不對或空 → null */
export function mapVipPlanRows(rows: unknown): VipPlan[] | null {
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isPlanRow)) return null;
  const list = rows
    .filter((r) => r.active !== false)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((r) => ({
      id: r.id,
      name: r.name,
      sessions: r.sessions,
      price: r.price,
      validDays: r.valid_days,
      description: r.description?.trim() ? r.description : null,
    }));
  return list.length > 0 ? list : null;
}

const FETCH_TIMEOUT_MS = 5000;

export async function getVipPlans(env: Record<string, string | undefined> = process.env): Promise<VipPlan[]> {
  const base = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!base || !key) return VIP_PLANS;
  const url = `${base.replace(/\/+$/, '')}/rest/v1/vip_plans?select=*&active=eq.true&order=sort`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      next: { revalidate: 300 },
    }).catch(() => null);
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), FETCH_TIMEOUT_MS);
    });
    const res = await Promise.race([request, timeout]);
    if (!res || !res.ok) return VIP_PLANS;
    return mapVipPlanRows(await res.json()) ?? VIP_PLANS;
  } catch {
    return VIP_PLANS;
  } finally {
    clearTimeout(timer);
  }
}

/** 每堂價格（四捨五入到元） */
export function perSession(p: Pick<VipPlan, 'price' | 'sessions'>): number {
  return Math.round(p.price / p.sessions);
}

/** 和每堂最貴的方案相比省下的金額（堂數越多越划算）；沒有省就是 0 */
export function savings(p: Pick<VipPlan, 'price' | 'sessions'>, plans: Pick<VipPlan, 'price' | 'sessions'>[]): number {
  const base = Math.max(...plans.map(perSession));
  return Math.max(0, base * p.sessions - p.price);
}

/** YYYY-MM-DD → YYYY/MM/DD（到期日要看得到年份） */
export function slashDate(date: string): string {
  return date.replace(/-/g, '/');
}

/** 有效期文字：365 天 → 1 年；其餘照天數 */
export function validLabel(days: number): string {
  return days % 365 === 0 ? `${days / 365} 年` : `${days} 天`;
}

// ---------- VIP 卡號 ----------

export const VIP_CARD_RE = /^VIP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

/** 使用者輸入 → 標準格式（去空白、轉大寫、補上連字號）；格式不對回 null */
export function normalizeVipCard(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const body = compact.startsWith('VIP') ? compact.slice(3) : compact;
  if (body.length !== 8) return null;
  const card = `VIP-${body.slice(0, 4)}-${body.slice(4)}`;
  return VIP_CARD_RE.test(card) ? card : null;
}

// ---------- API 回應（docs/API.md「VIP 包堂」） ----------

export interface VipOrderBody {
  plan_id: string;
  name: string;
  email: string;
  phone: string;
  birth_date: string;
  referral_code: string;
  agree: boolean;
}

export interface VipLookupResponse {
  cardNo: string;
  name: string;
  planName: string;
  sessionsTotal: number;
  sessionsUsed: number;
  sessionsLeft: number;
  expiresOn: string;
  expired: boolean;
  bookings: { orderNo: string; date: string; time: string; startsAt: string; serviceName: string; status: string }[];
}

export type OrderStatus = 'pending_payment' | 'paid' | 'shipped' | 'completed' | 'cancelled' | 'expired';

/** GET /orders/:orderNo（不含個資） */
export interface PublicOrder {
  orderNo: string;
  kind: 'vip' | 'shop';
  status: OrderStatus;
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  amount: number;
  items: { name: string; unitPrice: number; qty: number }[];
  holdExpiresAt: string | null;
  createdAt: string;
  trackingNo: string | null;
  vip?: { cardNo: string; planName: string; sessionsTotal: number; sessionsLeft: number; expiresOn: string };
}
