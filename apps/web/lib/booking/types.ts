/**
 * 預約流程共用型別（前端 state 與 docs/API.md 的回應形狀）
 */

export type Step = 1 | 2 | 3 | 4;

export type PayMethod = 'card' | 'line' | 'atm';

/** 預約的付款方式：線上付款三種＋VIP 堂數（VIP 諮詢專用） */
export type BookingPayMethod = PayMethod | 'vip';

/** 原型用中文字存性別；送 API 時轉成 female / male */
export type Gender = '女' | '男';

/** 排盤資料（原型 state.f） */
export interface BookingForm {
  name: string;
  gender: Gender;
  /** 國曆出生日期 YYYY-MM-DD */
  bdate: string;
  /** 出生時間 HH:MM，可空 */
  btime: string;
  bplace: string;
  email: string;
  phone: string;
  /** 想問的問題 */
  q: string;
}

/**
 * 錯誤訊息的 key
 * - 畫面上顯示的：name / bdate / email / phone / agree（原型）＋ API 可能回的 btime / bplace / q / gender / pay
 * - svc、dt 只用來判斷 Step 1/2 是否完成（原型的 e.svc / e.dt，不顯示）
 */
export type FieldKey =
  | 'svc'
  | 'dt'
  | 'name'
  | 'gender'
  | 'bdate'
  | 'btime'
  | 'bplace'
  | 'phone'
  | 'email'
  | 'q'
  | 'pay'
  | 'ref'
  | 'vip'
  | 'agree';

export type FieldErrors = Partial<Record<FieldKey, string>>;

/** POST /bookings 成功後記住的訂單（從綠界按返回時可以直接重新付款，不必再建一筆） */
export interface PendingOrder {
  orderNo: string;
  svc: string;
  date: string;
  time: string;
  pay: PayMethod;
  amount: number;
  /** ISO（+08:00）；null 表示 API 沒給 */
  holdExpiresAt: string | null;
  /** 建立訂單當下的排盤資料指紋：資料改過就不能沿用這筆訂單 */
  fp: string;
}

/** 存在 sessionStorage 的預約草稿（關分頁即清） */
export interface BookingDraft {
  svc: string | null;
  date: string | null;
  time: string | null;
  f: BookingForm;
  pay: PayMethod;
  agree: boolean;
  order: PendingOrder | null;
  /** 自選主題：勾選的主題（依優先順序） */
  topics: string[];
  /** 自選主題的備註 */
  topicNote: string;
  /** 已套用的 KOL 推薦碼（空字串＝沒有） */
  referral: string;
  /** VIP 諮詢：輸入的 VIP 卡號 */
  vipCard: string;
}

// ---------- API 回應（docs/API.md） ----------

export type DayStatus = 'open' | 'closed' | 'full' | 'past';

export interface SlotView {
  time: string;
  available: boolean;
}

export interface DayView {
  status: DayStatus;
  slots: SlotView[];
}

export interface AvailabilityResponse {
  month: string;
  timezone: string;
  days: Record<string, DayView>;
}

export interface PaymentConfig {
  payments: Record<PayMethod, boolean>;
  paymentEnv: 'stage' | 'prod';
  /** ATM 需在諮詢開始前幾小時預約（沒有這個欄位當 72） */
  atmMinLeadHours?: number;
}

export interface CreateBookingBody {
  service_id: string;
  date: string;
  time: string;
  name: string;
  gender: 'female' | 'male';
  birth_date: string;
  birth_time: string;
  birth_place: string;
  phone: string;
  email: string;
  questions: string;
  /** 自選主題（依優先順序）；其他方案送空陣列 */
  topics: string[];
  topic_note: string;
  /** KOL 推薦碼（空字串＝沒有）；折扣由 API 依 DB 設定計算 */
  referral_code: string;
  pay_method: BookingPayMethod;
  /** VIP 諮詢才有：VIP 卡號（Email 需與購買 VIP 時相同） */
  vip_card_no?: string;
  agree: boolean;
}

export interface CreateBookingResponse {
  bookingId: string;
  orderNo: string;
  amount: number;
  payMethod: BookingPayMethod;
  holdExpiresAt: string | null;
  /** VIP 堂數預約：扣完這堂後剩幾堂 */
  sessionsLeft?: number;
}

export type BookingStatus =
  | 'pending_payment'
  | 'awaiting_transfer'
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'refunded';

export interface PublicBooking {
  orderNo: string;
  status: BookingStatus;
  payMethod: BookingPayMethod;
  amount: number;
  service: { id: string; name: string; minutes: number };
  date: string;
  time: string;
  startsAt: string;
  holdExpiresAt: string | null;
  atm?: { bankCode: string; account: string; expireDate: string | null };
  /** true：已收到款項，但訂單逾時釋出且時段被他人約走，需人工處理（欄位不存在視為 false） */
  needsAttention?: boolean;
}

export interface EcpayCheckoutResponse {
  action: string;
  fields: Record<string, string>;
}

export interface LinePayRequestResponse {
  paymentUrl: string;
}
