// 資料存取介面：正式環境用 Supabase（service_role），測試用記憶體實作（行為對齊 SQL 函式）。

import type { OrderKind, ReferralCode } from '../lib/referral';

export type BookingStatus =
  | 'pending_payment'
  | 'awaiting_transfer'
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'refunded';
export type PayMethod = 'card' | 'line' | 'atm';
/** 預約的付款方式：線上付款三種＋VIP 堂數（0007） */
export type BookingPayMethod = PayMethod | 'vip';
export type Provider = 'ecpay' | 'linepay';
export type PaymentStatus = 'init' | 'paid' | 'failed' | 'refunded';

export const ACTIVE_STATUSES: BookingStatus[] = ['pending_payment', 'awaiting_transfer', 'confirmed'];

export interface Service {
  id: string;
  name: string;
  shortName: string;
  minutes: number;
  price: number;
  /** 自選主題的價位：這個價位最多幾題（一般方案為 null） */
  topicLimit: number | null;
  /** 預約時「想問的問題」必填（接住你的諮詢室） */
  questionRequired: boolean;
  /** VIP 專用方案：只能用 VIP 堂數預約（0007） */
  vipOnly: boolean;
}

export interface WeeklySlotRow {
  weekday: number;
  time: string; // HH:MM
}

export interface DateOverrideRow {
  date: string; // YYYY-MM-DD
  closed: boolean;
  extraTimes: string[]; // HH:MM
}

/** 占用時段判斷用（不含個資） */
export interface BusyBooking {
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  holdExpiresAt: Date | null;
}

export interface NewBooking {
  orderNo: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  payMethod: PayMethod;
  amount: number;
  holdExpiresAt: Date;
  customerName: string;
  gender: 'female' | 'male';
  birthDate: string;
  birthTime: string | null;
  birthPlace: string | null;
  phone: string;
  email: string;
  questions: string | null;
}

/** 對外查詢用（不含個資） */
export interface BookingPublic {
  id: string;
  orderNo: string;
  status: BookingStatus;
  payMethod: BookingPayMethod;
  amount: number;
  startsAt: Date;
  endsAt: Date;
  holdExpiresAt: Date | null;
  atmBankCode: string | null;
  atmAccount: string | null;
  atmExpiresAt: Date | null;
  needsAttention: boolean;
  service: { id: string; name: string; minutes: number };
}

/** 後台預約列表（含個資，只給管理者，不可 log） */
export interface AdminBooking {
  orderNo: string;
  status: BookingStatus;
  payMethod: BookingPayMethod;
  amount: number;
  startsAt: Date;
  endsAt: Date;
  confirmedAt: Date | null;
  service: { id: string; name: string };
  customerName: string;
  gender: string | null;
  birthDate: string;
  birthTime: string | null;
  birthPlace: string | null;
  phone: string;
  email: string;
  questions: string | null;
  needsAttention: boolean;
  attentionReason: string | null;
}

// ---------- KOL 推薦碼（0006） ----------

export interface Kol {
  id: string;
  name: string;
  contact: string | null;
  note: string | null;
  active: boolean;
  createdAt: Date;
}

export interface NewKol {
  name: string;
  contact: string | null;
  note: string | null;
}

export type KolPatch = Partial<Pick<Kol, 'name' | 'contact' | 'note' | 'active'>>;

export interface NewReferralCode {
  code: string;
  kolId: string;
  discountType: 'percent' | 'amount';
  discountValue: number;
  commissionRate: number;
  appliesBooking: boolean;
  appliesVip: boolean;
  appliesShop: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
}

export type ReferralCodePatch = Partial<Omit<NewReferralCode, 'code' | 'kolId'> & { active: boolean }>;

export interface NewReferralUse {
  codeId: string;
  kind: OrderKind;
  orderNo: string;
  bookingId: string | null;
  /** VIP／商店訂單（0007） */
  orderId: string | null;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  commissionAmount: number;
}

/** 使用紀錄＋訂單目前狀態（paid：已付款才算成效與佣金；cancelled：取消／逾時／退款） */
export interface ReferralUseRow extends NewReferralUse {
  id: string;
  code: string;
  kolId: string;
  createdAt: Date;
  orderState: 'paid' | 'pending' | 'cancelled';
}

// ---------- VIP 包堂、商店、贈品（0007） ----------

export interface VipPlan {
  id: string;
  name: string;
  sessions: number;
  price: number;
  validDays: number;
  description: string | null;
  sort: number;
  active: boolean;
}

export type VipPlanPatch = Partial<Omit<VipPlan, 'id'>>;

export interface VipMember {
  id: string;
  cardNo: string;
  name: string;
  email: string;
  phone: string;
  birthDate: string | null;
  planId: string | null;
  planName: string;
  sessionsTotal: number;
  sessionsUsed: number;
  expiresAt: Date;
  orderId: string | null;
  note: string | null;
  createdAt: Date;
}

export type VipMemberPatch = Partial<Pick<VipMember, 'sessionsTotal' | 'sessionsUsed' | 'expiresAt' | 'note'>>;

/** orders.kind：VIP 購買、商店、後台寄出的贈品 */
export type CommerceKind = 'vip' | 'shop' | 'gift';
export type OrderStatus = 'pending_payment' | 'paid' | 'shipped' | 'completed' | 'cancelled' | 'expired';

export interface OrderItem {
  productId: string | null;
  name: string;
  unitPrice: number;
  qty: number;
}

export interface NewOrder {
  orderNo: string;
  kind: CommerceKind;
  status: OrderStatus;
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  amount: number;
  customerName: string;
  email: string;
  phone: string;
  birthDate: string | null;
  shipName: string | null;
  shipPhone: string | null;
  shipAddress: string | null;
  note: string | null;
  vipPlanId: string | null;
  vipMemberId: string | null;
  holdExpiresAt: Date | null;
  items: OrderItem[];
}

/** 訂單（含個資，給後台與寄信；公開查詢另外挑欄位） */
export interface Order extends NewOrder {
  id: string;
  trackingNo: string | null;
  paidAt: Date | null;
  shippedAt: Date | null;
  createdAt: Date;
}

export type OrderPatch = Partial<Pick<Order, 'status' | 'trackingNo' | 'shippedAt' | 'note'>>;

/** apply_order_paid 的回傳 */
export interface OrderPaidResult {
  result: 'not_found' | 'already_paid' | 'amount_mismatch' | 'duplicate_payment' | 'paid';
  order_no?: string;
  kind?: CommerceKind;
  card_no?: string | null;
}

export interface NewVipBooking {
  orderNo: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  cardNo: string;
  customerName: string;
  gender: 'female' | 'male';
  birthDate: string;
  birthTime: string | null;
  birthPlace: string | null;
  phone: string;
  email: string;
  questions: string | null;
}

// ---------- 商店商品（0007）與運費設定 ----------

export interface Product {
  id: string;
  /** 網址代號：/shop/<slug> */
  slug: string;
  name: string;
  description: string | null;
  price: number;
  /** 圖片網址（第一張當封面） */
  images: string[];
  stock: number;
  /** 上架販售（false：只當 VIP 贈品） */
  forSale: boolean;
  active: boolean;
  sort: number;
  createdAt: Date;
}

export type NewProduct = Omit<Product, 'id' | 'createdAt'>;
export type ProductPatch = Partial<NewProduct>;

export interface ShopSettings {
  /** 運費（元） */
  shippingFee: number;
  /** 滿額免運門檻（商品小計 ≥ 這個金額免運；null＝不提供） */
  freeShippingOver: number | null;
}

export type VipBookingResult =
  | { ok: true; id: string; sessionsLeft: number }
  | { ok: false; reason: 'vip_not_found' | 'vip_expired' | 'vip_no_sessions' | 'slot_taken' | 'order_no_taken' };

/** 寄信用（含個資，只在寄信時讀取，不可 log） */
export interface BookingFull extends BookingPublic {
  customerName: string;
  gender: string | null;
  birthDate: string;
  birthTime: string | null;
  birthPlace: string | null;
  phone: string;
  email: string;
  questions: string | null;
  meetUrl: string | null;
  confirmedAt: Date | null;
  confirmationSentAt: Date | null;
  transferInfoSentAt: Date | null;
  adminNotifiedAt: Date | null;
  needsAttention: boolean;
  attentionReason: string | null;
}

export interface PaymentRow {
  id: string;
  bookingId: string;
  provider: Provider;
  method: PayMethod;
  tradeNo: string;
  providerTxnId: string | null;
  amount: number;
  status: PaymentStatus;
  createdAt: Date;
  /** LINE Pay 付款網址（request 成功時存在 raw.request.paymentUrl），沿用未完成的嘗試用 */
  paymentUrl: string | null;
  /** 這次付款引起的異常標記（結果不明）；有值且 status=init 時不可再開新的付款 */
  attentionReason: string | null;
}

export interface NewPayment {
  bookingId: string;
  provider: Provider;
  method: PayMethod;
  tradeNo: string;
  amount: number;
  raw: Record<string, unknown>;
}

/** apply_payment_paid 的回傳 */
export interface PaidResult {
  result: 'not_found' | 'already_paid' | 'ignored' | 'amount_mismatch' | 'confirmed' | 'needs_attention';
  reason?: string;
  reclaimed?: boolean;
  /** 確認了，但同一預約還有其他結果不明的付款（可能重複扣款） */
  possible_duplicate?: boolean;
  booking_id?: string;
  order_no?: string;
  booking_status?: BookingStatus;
}

/** apply_atm_issued 的回傳 */
export interface AtmIssuedResult {
  result: 'not_found' | 'ignored' | 'amount_mismatch' | 'issued' | 'already_issued' | 'slot_taken' | 'limit_exceeded';
  reason?: string;
  booking_id?: string;
  order_no?: string;
  booking_status?: BookingStatus;
}

/** flag_payment_attention 的回傳 */
export interface FlagResult {
  result: 'not_found' | 'ignored' | 'flagged' | 'already_flagged';
  booking_id?: string;
  order_no?: string;
  booking_status?: BookingStatus;
}

/** mark_payment_failed 的回傳 */
export interface FailedResult {
  result: 'not_found' | 'failed' | 'ignored';
  booking_id?: string;
  order_no?: string;
}

export type EmailKind = 'confirmation' | 'transfer_info' | 'admin_new_order';

export interface BookingLimits {
  maxPendingPerCustomer: number;
  maxPendingAtm: number;
}

export type CreateBookingResult =
  | { ok: true; id: string; replaced: number }
  | { ok: false; reason: 'slot_taken' | 'order_no_taken' | 'too_many_pending' | 'atm_full' };

export interface Db {
  listActiveServices(): Promise<Service[]>;
  getActiveService(id: string): Promise<Service | null>;
  listWeeklySlots(): Promise<WeeklySlotRow[]>;
  listOverrides(fromDate: string, toDate: string): Promise<DateOverrideRow[]>;
  /** starts_at ∈ [from, to) 且 status 為 active 的預約 */
  listBusyBookings(from: Date, to: Date): Promise<BusyBooking[]>;
  /** 逾時保留 → expired；有給區間時只處理與 [from, to) 重疊的預約；回傳筆數 */
  expireStaleHolds(range?: { from: Date; to: Date }): Promise<number>;
  /**
   * 建立預約（SQL create_booking，單一交易＋advisory lock）：釋出重疊的過期保留 → 取消同一人同時段的舊保留
   * → 檢查同一顧客未付款上限、全站未付款 ATM 上限 → insert
   */
  createBooking(b: NewBooking, limits: BookingLimits): Promise<CreateBookingResult>;
  getBookingPublic(orderNo: string): Promise<BookingPublic | null>;
  getBookingFull(id: string): Promise<BookingFull | null>;
  markEmailSent(bookingId: string, kind: EmailKind): Promise<void>;
  /** 已確認但確認信沒寄出（confirmedAt 在區間內；諮詢開始後才入帳的不寄） */
  listUnsentConfirmations(confirmedAfter: Date, confirmedBefore: Date): Promise<string[]>;
  /** 已確認但老師的新訂單通知沒寄出（confirmedAt 在區間內） */
  listUnsentAdminNotifications(confirmedAfter: Date, confirmedBefore: Date): Promise<string[]>;
  /** 待轉帳（保留未逾時）但轉帳資訊信沒寄出 */
  listUnsentTransferInfos(now: Date): Promise<string[]>;

  /** 後台：管理者名單（admins.email_sha256 = sha256(lower(trim(email)))） */
  isAdmin(emailSha256: string): Promise<boolean>;
  /** 後台：starts_at ∈ [from, to) 的預約（statuses 為 null 表示全部狀態），依開始時間排序 */
  listBookingsAdmin(q: { from: Date; to: Date; statuses: BookingStatus[] | null; limit: number }): Promise<AdminBooking[]>;

  // ---------- KOL 推薦碼 ----------
  findReferralCode(code: string): Promise<ReferralCode | null>;
  /** 還有效的使用次數（訂單已付款，或仍在保留中）；給「可用次數」判斷用 */
  countLiveReferralUses(codeId: string, now: Date): Promise<number>;
  recordReferralUse(u: NewReferralUse): Promise<void>;
  listKols(): Promise<Kol[]>;
  createKol(k: NewKol): Promise<Kol>;
  updateKol(id: string, patch: KolPatch): Promise<Kol | null>;
  listReferralCodes(): Promise<ReferralCode[]>;
  /** 代碼重複 → 'duplicate'；KOL 不存在 → 'no_kol' */
  createReferralCode(c: NewReferralCode): Promise<ReferralCode | 'duplicate' | 'no_kol'>;
  updateReferralCode(id: string, patch: ReferralCodePatch): Promise<ReferralCode | null>;
  /** created_at ∈ [from, to) 的使用紀錄（新到舊） */
  listReferralUses(q: { from: Date; to: Date; now: Date }): Promise<ReferralUseRow[]>;

  // ---------- VIP 包堂、商店、贈品 ----------
  listVipPlans(activeOnly: boolean): Promise<VipPlan[]>;
  getVipPlan(id: string): Promise<VipPlan | null>;
  createVipPlan(p: VipPlan): Promise<VipPlan | 'duplicate'>;
  updateVipPlan(id: string, patch: VipPlanPatch): Promise<VipPlan | null>;
  /** 訂單編號撞號 → 'order_no_taken' */
  createOrder(o: NewOrder): Promise<{ ok: true; id: string } | { ok: false; reason: 'order_no_taken' }>;
  getOrder(orderNo: string): Promise<Order | null>;
  /** created_at ∈ [from, to)，新到舊 */
  listOrders(q: { kinds: CommerceKind[] | null; statuses: OrderStatus[] | null; from: Date; to: Date; limit: number }): Promise<Order[]>;
  updateOrder(orderNo: string, patch: OrderPatch): Promise<Order | null>;
  /** 保留逾時未付款 → expired；回傳筆數 */
  expireStaleOrders(now: Date): Promise<number>;
  insertOrderPayment(p: { orderId: string; tradeNo: string; amount: number; raw: Record<string, unknown> }): Promise<void>;
  countOrderPayments(orderId: string): Promise<number>;
  /** SQL apply_order_paid：冪等；VIP 訂單建立會員（cardNo）、商店訂單扣庫存 */
  applyOrderPaid(args: { tradeNo: string; amount: number; providerTxnId: string | null; raw: Record<string, unknown>; cardNo: string }): Promise<OrderPaidResult>;
  markOrderPaymentFailed(tradeNo: string, raw: Record<string, unknown>): Promise<void>;
  getVipMemberByCard(cardNo: string): Promise<VipMember | null>;
  getVipMemberByOrder(orderId: string): Promise<VipMember | null>;
  getVipMember(id: string): Promise<VipMember | null>;
  /** search：姓名／Email／卡號／手機部分比對；birthMonth：1–12 */
  listVipMembers(q: { search: string | null; birthMonth: number | null; limit: number }): Promise<VipMember[]>;
  updateVipMember(id: string, patch: VipMemberPatch): Promise<VipMember | null>;
  /** 這位 VIP 用堂數預約的紀錄（新到舊） */
  listVipBookings(memberId: string): Promise<{ orderNo: string; startsAt: Date; status: BookingStatus; serviceName: string }[]>;
  /** SQL create_vip_booking：卡號＋Email 對得上、未到期、有堂數 → 建立已確認的預約並扣一堂（單一交易） */
  createVipBooking(b: NewVipBooking): Promise<VipBookingResult>;

  // ---------- 商店商品、運費、贈品 ----------
  /** publicOnly：只回上架販售中的（active 且 for_sale）；依 sort、新到舊 */
  listProducts(q: { publicOnly: boolean }): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  getProductBySlug(slug: string): Promise<Product | null>;
  getProductsByIds(ids: string[]): Promise<Product[]>;
  /** slug 重複 → 'duplicate' */
  createProduct(p: NewProduct): Promise<Product | 'duplicate'>;
  updateProduct(id: string, patch: ProductPatch): Promise<Product | null | 'duplicate'>;
  getShopSettings(): Promise<ShopSettings>;
  updateShopSettings(patch: Partial<ShopSettings>): Promise<ShopSettings>;
  /** SQL consume_order_stock：依訂單品項扣庫存（贈品建立時；不會扣成負數） */
  consumeOrderStock(orderId: string): Promise<void>;

  insertPayment(p: NewPayment): Promise<PaymentRow>;
  getPayment(provider: Provider, tradeNo: string): Promise<PaymentRow | null>;
  listBookingPayments(bookingId: string): Promise<PaymentRow[]>;
  /** LINE Pay 已取得 transactionId、狀態仍是 init 的付款（對帳用；createdAt 在區間內） */
  listPendingLinePay(createdAfter: Date, createdBefore: Date): Promise<PaymentRow[]>;
  setPaymentTxn(paymentId: string, providerTxnId: string, raw: Record<string, unknown>): Promise<void>;

  applyPaymentPaid(args: {
    provider: Provider;
    tradeNo: string;
    amount: number;
    providerTxnId: string | null;
    event: string;
    raw: Record<string, unknown>;
  }): Promise<PaidResult>;
  applyAtmIssued(args: {
    tradeNo: string;
    amount: number;
    providerTxnId: string | null;
    bankCode: string;
    account: string;
    expiresAt: Date;
    event: string;
    raw: Record<string, unknown>;
  }): Promise<AtmIssuedResult>;
  flagPaymentAttention(args: {
    provider: Provider;
    tradeNo: string;
    event: string;
    raw: Record<string, unknown>;
    reason: string;
  }): Promise<FlagResult>;
  markPaymentFailed(args: {
    provider: Provider;
    tradeNo: string;
    event: string;
    raw: Record<string, unknown>;
  }): Promise<FailedResult>;
}
