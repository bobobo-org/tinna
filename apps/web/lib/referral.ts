/**
 * KOL 推薦碼（前端）
 *
 * - 預覽：GET /referral/:code?kind=booking → 折扣方式與數值；畫面上的折扣後金額用和 API 相同的算法
 *   （apps/api/src/lib/referral.ts applyDiscount），實際收費仍以 API 建立訂單時計算的金額為準
 * - KOL 分享連結 ?ref=CODE：存在 localStorage 30 天，結帳時自動帶入
 */

export interface ReferralPreview {
  code: string;
  discountType: 'percent' | 'amount';
  discountValue: number;
  label: string;
}

export const CODE_RE = /^[A-Z0-9_-]{3,20}$/;
const STORAGE_KEY = 'yuanshe.referral.v1';
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeCode(raw: string): string | null {
  const c = raw.trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

/** 和 API 相同：打折四捨五入到元；折抵金額不超過原價，實付至少 1 元 */
export function applyDiscount(amount: number, r: Pick<ReferralPreview, 'discountType' | 'discountValue'>): { discount: number; final: number } {
  const raw = r.discountType === 'percent' ? Math.round((amount * r.discountValue) / 100) : r.discountValue;
  const discount = Math.max(0, Math.min(raw, amount - 1));
  return { discount, final: amount - discount };
}

// ---------- 分享連結 ?ref= ----------

export function storeReferral(code: string, now: number = Date.now(), store: Storage | null = safeStorage()): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify({ code, savedAt: now }));
  } catch {
    // 無痕模式等：不存
  }
}

/** 30 天內從 KOL 連結帶進來的推薦碼 */
export function loadReferral(now: number = Date.now(), store: Storage | null = safeStorage()): string | null {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { code?: unknown; savedAt?: unknown };
    if (typeof v.code !== 'string' || typeof v.savedAt !== 'number') return null;
    if (now - v.savedAt > KEEP_MS) return null;
    return normalizeCode(v.code);
  } catch {
    return null;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
