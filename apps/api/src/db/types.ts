// 資料存取介面：正式環境用 Supabase（service_role），測試用記憶體實作（行為對齊 SQL 函式）。

export type BookingStatus =
  | 'pending_payment'
  | 'awaiting_transfer'
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'refunded';
export type PayMethod = 'card' | 'line' | 'atm';
export type Provider = 'ecpay' | 'linepay';
export type PaymentStatus = 'init' | 'paid' | 'failed' | 'refunded';

export const ACTIVE_STATUSES: BookingStatus[] = ['pending_payment', 'awaiting_transfer', 'confirmed'];

export interface Service {
  id: string;
  name: string;
  shortName: string;
  minutes: number;
  price: number;
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
  payMethod: PayMethod;
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
