// KOL 推薦碼：可不可以用、折扣與佣金怎麼算（金額一律以 DB 設定計算，不信任前端）

export type OrderKind = 'booking' | 'vip' | 'shop';

export interface ReferralCode {
  id: string;
  code: string;
  kolId: string;
  kolName: string;
  kolActive: boolean;
  discountType: 'percent' | 'amount';
  /** percent：折扣百分比（10 = 打 9 折）；amount：折抵金額（元） */
  discountValue: number;
  /** 佣金：實付金額的百分比 */
  commissionRate: number;
  appliesBooking: boolean;
  appliesVip: boolean;
  appliesShop: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  active: boolean;
  createdAt: Date;
}

export const CODE_RE = /^[A-Z0-9_-]{3,20}$/;

export const REFERRAL_MSG = {
  invalid: '找不到這個推薦碼',
  inactive: '這個推薦碼已停用',
  notApplicable: '這個推薦碼不適用於此項目',
  notStarted: '這個推薦碼尚未開始使用',
  expired: '這個推薦碼已過期',
  usedUp: '這個推薦碼已達使用上限',
} as const;

/** 使用者輸入 → 標準格式（去空白、轉大寫）；格式不對回 null */
export function normalizeCode(raw: string): string | null {
  const c = raw.trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

export function appliesTo(code: ReferralCode, kind: OrderKind): boolean {
  return kind === 'booking' ? code.appliesBooking : kind === 'vip' ? code.appliesVip : code.appliesShop;
}

/** 可不可以用（usedCount：目前還有效的使用次數，只在有上限時需要） */
export function checkUsable(code: ReferralCode, kind: OrderKind, now: Date, usedCount: number): string | null {
  if (!code.active || !code.kolActive) return REFERRAL_MSG.inactive;
  if (!appliesTo(code, kind)) return REFERRAL_MSG.notApplicable;
  if (code.startsAt && code.startsAt.getTime() > now.getTime()) return REFERRAL_MSG.notStarted;
  if (code.endsAt && code.endsAt.getTime() <= now.getTime()) return REFERRAL_MSG.expired;
  if (code.maxUses !== null && usedCount >= code.maxUses) return REFERRAL_MSG.usedUp;
  return null;
}

/** 折扣：打折四捨五入到元；折抵金額不超過原價；實付至少 1 元（綠界與資料庫都要求 > 0） */
export function applyDiscount(
  amount: number,
  code: Pick<ReferralCode, 'discountType' | 'discountValue'>,
): { discount: number; final: number } {
  const raw = code.discountType === 'percent' ? Math.round((amount * code.discountValue) / 100) : code.discountValue;
  const discount = Math.max(0, Math.min(raw, amount - 1));
  return { discount, final: amount - discount };
}

export function commissionOf(finalAmount: number, rate: number): number {
  return Math.round((finalAmount * rate) / 100);
}

/** 顯示用：「9 折」「85 折」「折 NT$300」 */
export function discountLabel(code: Pick<ReferralCode, 'discountType' | 'discountValue'>): string {
  if (code.discountType === 'amount') return `折 NT$${code.discountValue.toLocaleString('en-US')}`;
  const pay = 100 - code.discountValue;
  return `${pay % 10 === 0 ? pay / 10 : pay} 折`;
}
