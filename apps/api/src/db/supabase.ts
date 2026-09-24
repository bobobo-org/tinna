import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthVerifier } from '../lib/admin-auth';
import { IMAGE_TYPES, MAX_UPLOAD_BYTES, PRODUCT_BUCKET, type PublicStorage } from '../lib/storage';
import type { ReferralCode } from '../lib/referral';
import { normalizeTime } from '../lib/time';
import {
  ACTIVE_STATUSES,
  type AdminBooking,
  type AtmIssuedResult,
  type BookingFull,
  type BookingLimits,
  type BookingPublic,
  type BookingStatus,
  type BusyBooking,
  type CreateBookingResult,
  type DateOverrideRow,
  type Db,
  type EmailKind,
  type FailedResult,
  type FlagResult,
  type CommerceKind,
  type Kol,
  type KolPatch,
  type NewBooking,
  type NewOrder,
  type NewProduct,
  type NewVipBooking,
  type Order,
  type OrderPaidResult,
  type OrderPatch,
  type OrderStatus,
  type Product,
  type ProductPatch,
  type ShopSettings,
  type NewKol,
  type NewPayment,
  type NewReferralCode,
  type NewReferralUse,
  type PaidResult,
  type PaymentRow,
  type Provider,
  type ReferralCodePatch,
  type ReferralUseRow,
  type Service,
  type VipBookingResult,
  type VipMember,
  type VipMemberPatch,
  type VipPlan,
  type VipPlanPatch,
  type WeeklySlotRow,
} from './types';

// service_role 繞過 RLS；只在後端使用。錯誤往外丟時只帶 code/message（不帶 details，避免整列個資進 log）。

export class DbError extends Error {
  constructor(
    readonly op: string,
    readonly code: string | undefined,
    message: string,
  ) {
    super(`${op}: ${message}`);
    this.name = 'DbError';
  }
}

interface PgErr {
  code?: string;
  message?: string;
}

function fail(op: string, err: PgErr): never {
  throw new DbError(op, err.code, err.message ?? 'unknown error');
}

const toDate = (v: string | null | undefined): Date | null => (v ? new Date(v) : null);

const PUBLIC_COLUMNS =
  'id,order_no,status,pay_method,amount,starts_at,ends_at,hold_expires_at,atm_bank_code,atm_account,atm_expires_at,needs_attention,service:services(id,name,minutes)';

const PAYMENT_COLUMNS =
  'id,booking_id,provider,method,provider_trade_no,provider_txn_id,amount,status,created_at,attention_reason,payment_url:raw->request->>paymentUrl';

const SERVICE_COLUMNS = 'id,name,short_name,minutes,price,topic_limit,question_required,vip_only';

// 未產生 Supabase 型別檔；欄位在 map* 函式集中轉換
type Row = any;

function toService(r: Row): Service {
  return {
    id: r.id,
    name: r.name,
    shortName: r.short_name,
    minutes: r.minutes,
    price: r.price,
    topicLimit: r.topic_limit ?? null,
    questionRequired: r.question_required === true,
    vipOnly: r.vip_only === true,
  };
}

const REFERRAL_CODE_COLUMNS =
  'id,code,kol_id,discount_type,discount_value,commission_rate,applies_booking,applies_vip,applies_shop,starts_at,ends_at,max_uses,active,created_at,kol:kols(name,active)';

function mapReferralCode(r: Row): ReferralCode {
  return {
    id: r.id,
    code: r.code,
    kolId: r.kol_id,
    kolName: r.kol?.name ?? '',
    kolActive: r.kol?.active !== false,
    discountType: r.discount_type,
    discountValue: r.discount_value,
    commissionRate: Number(r.commission_rate),
    appliesBooking: !!r.applies_booking,
    appliesVip: !!r.applies_vip,
    appliesShop: !!r.applies_shop,
    startsAt: toDate(r.starts_at),
    endsAt: toDate(r.ends_at),
    maxUses: r.max_uses ?? null,
    active: !!r.active,
    createdAt: new Date(r.created_at),
  };
}

/** NewReferralCode／patch → DB 欄位（只放有給的欄位） */
function referralCodeRow(c: Partial<NewReferralCode>): Row {
  const row: Row = {};
  if (c.code !== undefined) row.code = c.code;
  if (c.kolId !== undefined) row.kol_id = c.kolId;
  if (c.discountType !== undefined) row.discount_type = c.discountType;
  if (c.discountValue !== undefined) row.discount_value = c.discountValue;
  if (c.commissionRate !== undefined) row.commission_rate = c.commissionRate;
  if (c.appliesBooking !== undefined) row.applies_booking = c.appliesBooking;
  if (c.appliesVip !== undefined) row.applies_vip = c.appliesVip;
  if (c.appliesShop !== undefined) row.applies_shop = c.appliesShop;
  if (c.startsAt !== undefined) row.starts_at = c.startsAt ? c.startsAt.toISOString() : null;
  if (c.endsAt !== undefined) row.ends_at = c.endsAt ? c.endsAt.toISOString() : null;
  if (c.maxUses !== undefined) row.max_uses = c.maxUses;
  return row;
}

function mapKol(r: Row): Kol {
  return {
    id: r.id,
    name: r.name,
    contact: r.contact ?? null,
    note: r.note ?? null,
    active: !!r.active,
    createdAt: new Date(r.created_at),
  };
}

/**
 * 推薦碼使用紀錄對應的訂單狀態：已付款／保留中／已取消（取消、逾時、退款、保留過期）
 * 預約看 bookings，VIP／商店看 orders（0007）
 */
function referralOrderState(kind: string, booking: Row | null, order: Row | null, now: Date): 'paid' | 'pending' | 'cancelled' {
  const holdAlive = (r: Row) => !!r.hold_expires_at && new Date(r.hold_expires_at) > now;
  if (kind === 'booking') {
    if (!booking) return 'cancelled';
    if (booking.status === 'confirmed') return 'paid';
    if (booking.status === 'awaiting_transfer') return 'pending';
    if (booking.status === 'pending_payment' && holdAlive(booking)) return 'pending';
    return 'cancelled';
  }
  if (!order) return 'cancelled';
  if (order.status === 'paid' || order.status === 'shipped' || order.status === 'completed') return 'paid';
  if (order.status === 'pending_payment' && holdAlive(order)) return 'pending';
  return 'cancelled';
}

function mapVipPlan(r: Row): VipPlan {
  return {
    id: r.id,
    name: r.name,
    sessions: r.sessions,
    price: r.price,
    validDays: r.valid_days,
    description: r.description ?? null,
    sort: r.sort ?? 0,
    active: !!r.active,
  };
}

function vipPlanRow(p: Partial<VipPlan>): Row {
  const row: Row = {};
  if (p.id !== undefined) row.id = p.id;
  if (p.name !== undefined) row.name = p.name;
  if (p.sessions !== undefined) row.sessions = p.sessions;
  if (p.price !== undefined) row.price = p.price;
  if (p.validDays !== undefined) row.valid_days = p.validDays;
  if (p.description !== undefined) row.description = p.description;
  if (p.sort !== undefined) row.sort = p.sort;
  if (p.active !== undefined) row.active = p.active;
  return row;
}

const VIP_MEMBER_COLUMNS =
  'id,card_no,name,email,phone,birth_date,plan_id,sessions_total,sessions_used,expires_at,order_id,note,created_at,plan:vip_plans(name)';

function mapVipMember(r: Row): VipMember {
  return {
    id: r.id,
    cardNo: r.card_no,
    name: r.name,
    email: r.email,
    phone: r.phone,
    birthDate: r.birth_date ?? null,
    planId: r.plan_id ?? null,
    planName: r.plan?.name ?? '',
    sessionsTotal: r.sessions_total,
    sessionsUsed: r.sessions_used,
    expiresAt: new Date(r.expires_at),
    orderId: r.order_id ?? null,
    note: r.note ?? null,
    createdAt: new Date(r.created_at),
  };
}

const PRODUCT_COLUMNS = 'id,slug,name,description,price,images,stock,for_sale,active,sort,created_at';

function mapProduct(r: Row): Product {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description ?? null,
    price: r.price,
    images: Array.isArray(r.images) ? r.images : [],
    stock: r.stock,
    forSale: !!r.for_sale,
    active: !!r.active,
    sort: r.sort ?? 0,
    createdAt: new Date(r.created_at),
  };
}

function productRow(p: ProductPatch): Row {
  const row: Row = {};
  if (p.slug !== undefined) row.slug = p.slug;
  if (p.name !== undefined) row.name = p.name;
  if (p.description !== undefined) row.description = p.description;
  if (p.price !== undefined) row.price = p.price;
  if (p.images !== undefined) row.images = p.images;
  if (p.stock !== undefined) row.stock = p.stock;
  if (p.forSale !== undefined) row.for_sale = p.forSale;
  if (p.active !== undefined) row.active = p.active;
  if (p.sort !== undefined) row.sort = p.sort;
  return row;
}

/** 預設運費（settings 表沒有值時） */
export const DEFAULT_SHIPPING_FEE = 100;

/** settings 的 shipping_fee／free_shipping_over（jsonb）→ ShopSettings；不是數字就用預設值／不提供免運 */
export function parseShopSettings(rows: { key: string; value: unknown }[]): ShopSettings {
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const fee = get('shipping_fee');
  const free = get('free_shipping_over');
  return {
    shippingFee: typeof fee === 'number' && Number.isFinite(fee) && fee >= 0 ? Math.round(fee) : DEFAULT_SHIPPING_FEE,
    freeShippingOver: typeof free === 'number' && Number.isFinite(free) && free > 0 ? Math.round(free) : null,
  };
}

const ORDER_COLUMNS = '*,items:order_items(product_id,name,unit_price,qty)';

function mapOrder(r: Row): Order {
  return {
    id: r.id,
    orderNo: r.order_no,
    kind: r.kind,
    status: r.status,
    subtotal: r.subtotal,
    shippingFee: r.shipping_fee,
    discountAmount: r.discount_amount,
    amount: r.amount,
    customerName: r.customer_name,
    email: r.email,
    phone: r.phone,
    birthDate: r.birth_date ?? null,
    shipName: r.ship_name ?? null,
    shipPhone: r.ship_phone ?? null,
    shipAddress: r.ship_address ?? null,
    note: r.note ?? null,
    vipPlanId: r.vip_plan_id ?? null,
    vipMemberId: r.vip_member_id ?? null,
    holdExpiresAt: toDate(r.hold_expires_at),
    trackingNo: r.tracking_no ?? null,
    paidAt: toDate(r.paid_at),
    shippedAt: toDate(r.shipped_at),
    createdAt: new Date(r.created_at),
    items: (r.items ?? []).map((i: Row) => ({
      productId: i.product_id ?? null,
      name: i.name,
      unitPrice: i.unit_price,
      qty: i.qty,
    })),
  };
}

/** 後台搜尋字串只留安全字元（PostgREST or 篩選語法用到逗號與括號） */
function safeSearch(s: string): string {
  return s.replace(/[^\p{L}\p{N}@._+-]/gu, '').slice(0, 60);
}

const ADMIN_BOOKING_COLUMNS =
  'order_no,status,pay_method,amount,starts_at,ends_at,confirmed_at,customer_name,gender,birth_date,birth_time,birth_place,phone,email,questions,needs_attention,attention_reason,service:services(id,name)';

function mapAdminBooking(r: Row): AdminBooking {
  return {
    orderNo: r.order_no,
    status: r.status,
    payMethod: r.pay_method,
    amount: r.amount,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    confirmedAt: toDate(r.confirmed_at),
    service: { id: r.service?.id ?? '', name: r.service?.name ?? '' },
    customerName: r.customer_name,
    gender: r.gender ?? null,
    birthDate: r.birth_date,
    birthTime: r.birth_time ? normalizeTime(r.birth_time) : null,
    birthPlace: r.birth_place ?? null,
    phone: r.phone,
    email: r.email,
    questions: r.questions ?? null,
    needsAttention: !!r.needs_attention,
    attentionReason: r.attention_reason ?? null,
  };
}

function mapPublic(r: Row): BookingPublic {
  return {
    id: r.id,
    orderNo: r.order_no,
    status: r.status,
    payMethod: r.pay_method,
    amount: r.amount,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    holdExpiresAt: toDate(r.hold_expires_at),
    atmBankCode: r.atm_bank_code ?? null,
    atmAccount: r.atm_account ?? null,
    atmExpiresAt: toDate(r.atm_expires_at),
    needsAttention: !!r.needs_attention,
    service: { id: r.service?.id, name: r.service?.name, minutes: r.service?.minutes },
  };
}

function mapPayment(r: Row): PaymentRow {
  return {
    id: r.id,
    bookingId: r.booking_id,
    provider: r.provider,
    method: r.method,
    tradeNo: r.provider_trade_no,
    providerTxnId: r.provider_txn_id ?? null,
    amount: r.amount,
    status: r.status,
    createdAt: new Date(r.created_at),
    paymentUrl: r.payment_url ?? null,
    attentionReason: r.attention_reason ?? null,
  };
}

export function createSupabaseDb(url: string, serviceRoleKey: string): Db {
  const sb: SupabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabaseDb(sb);
}

/**
 * 後台登入驗證：用獨立的 client 呼叫 Supabase Auth 的 getUser（只驗證 token，不登入、不保存 session，
 * 不會影響資料存取用的 service_role client）
 */
export function createSupabaseAuth(url: string, serviceRoleKey: string): AuthVerifier {
  const sb: SupabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async verify(accessToken: string) {
      const { data, error } = await sb.auth.getUser(accessToken);
      const user = data?.user;
      if (error || !user?.email || !user.email_confirmed_at) return null;
      return { email: user.email };
    },
  };
}

export class SupabaseDb implements Db {
  constructor(private readonly sb: SupabaseClient) {}

  async listActiveServices(): Promise<Service[]> {
    const { data, error } = await this.sb
      .from('services')
      .select(SERVICE_COLUMNS)
      .eq('active', true)
      .order('sort');
    if (error) fail('listActiveServices', error);
    return (data ?? []).map(toService);
  }

  async getActiveService(id: string): Promise<Service | null> {
    const { data, error } = await this.sb
      .from('services')
      .select(SERVICE_COLUMNS)
      .eq('id', id)
      .eq('active', true)
      .maybeSingle();
    if (error) fail('getActiveService', error);
    if (!data) return null;
    return toService(data);
  }

  async listWeeklySlots(): Promise<WeeklySlotRow[]> {
    const { data, error } = await this.sb.from('weekly_slots').select('weekday,start_time');
    if (error) fail('listWeeklySlots', error);
    return (data ?? []).map((r: Row) => ({ weekday: r.weekday, time: normalizeTime(r.start_time) }));
  }

  async listOverrides(fromDate: string, toDate: string): Promise<DateOverrideRow[]> {
    const { data, error } = await this.sb
      .from('date_overrides')
      .select('date,closed,extra_times')
      .gte('date', fromDate)
      .lte('date', toDate);
    if (error) fail('listOverrides', error);
    return (data ?? []).map((r: Row) => ({
      date: r.date,
      closed: !!r.closed,
      extraTimes: (r.extra_times ?? []).map((t: string) => normalizeTime(t)),
    }));
  }

  async listBusyBookings(from: Date, to: Date): Promise<BusyBooking[]> {
    const { data, error } = await this.sb
      .from('bookings')
      .select('starts_at,ends_at,status,hold_expires_at')
      .in('status', ACTIVE_STATUSES)
      .gte('starts_at', from.toISOString())
      .lt('starts_at', to.toISOString());
    if (error) fail('listBusyBookings', error);
    return (data ?? []).map((r: Row) => ({
      startsAt: new Date(r.starts_at),
      endsAt: new Date(r.ends_at),
      status: r.status,
      holdExpiresAt: toDate(r.hold_expires_at),
    }));
  }

  async expireStaleHolds(range?: { from: Date; to: Date }): Promise<number> {
    const { data, error } = await this.sb.rpc('expire_stale_holds', {
      p_from: range ? range.from.toISOString() : null,
      p_to: range ? range.to.toISOString() : null,
    });
    if (error) fail('expireStaleHolds', error);
    return typeof data === 'number' ? data : Number(data ?? 0);
  }

  async createBooking(b: NewBooking, limits: BookingLimits): Promise<CreateBookingResult> {
    const { data, error } = await this.sb.rpc('create_booking', {
      p_order_no: b.orderNo,
      p_service_id: b.serviceId,
      p_starts_at: b.startsAt.toISOString(),
      p_ends_at: b.endsAt.toISOString(),
      p_pay_method: b.payMethod,
      p_amount: b.amount,
      p_hold_expires_at: b.holdExpiresAt.toISOString(),
      p_customer_name: b.customerName,
      p_gender: b.gender,
      p_birth_date: b.birthDate,
      p_birth_time: b.birthTime,
      p_birth_place: b.birthPlace,
      p_phone: b.phone,
      p_email: b.email,
      p_questions: b.questions,
      p_max_pending_per_customer: limits.maxPendingPerCustomer,
      p_max_pending_atm: limits.maxPendingAtm,
    });
    if (error) fail('createBooking', error);
    const r = data as { result: string; id?: string; replaced?: number };
    if (r.result === 'created' && r.id) return { ok: true, id: r.id, replaced: r.replaced ?? 0 };
    if (r.result === 'slot_taken' || r.result === 'order_no_taken' || r.result === 'too_many_pending' || r.result === 'atm_full') {
      return { ok: false, reason: r.result };
    }
    throw new DbError('createBooking', undefined, `unexpected result ${String(r.result)}`);
  }

  async getBookingPublic(orderNo: string): Promise<BookingPublic | null> {
    const { data, error } = await this.sb
      .from('bookings')
      .select(PUBLIC_COLUMNS)
      .eq('order_no', orderNo)
      .maybeSingle();
    if (error) fail('getBookingPublic', error);
    return data ? mapPublic(data) : null;
  }

  async getBookingFull(id: string): Promise<BookingFull | null> {
    const { data, error } = await this.sb
      .from('bookings')
      .select(
        `${PUBLIC_COLUMNS},customer_name,gender,birth_date,birth_time,birth_place,phone,email,questions,meet_url,confirmed_at,confirmation_sent_at,transfer_info_sent_at,admin_notified_at,needs_attention,attention_reason`,
      )
      .eq('id', id)
      .maybeSingle();
    if (error) fail('getBookingFull', error);
    if (!data) return null;
    const r: Row = data;
    return {
      ...mapPublic(r),
      customerName: r.customer_name,
      gender: r.gender ?? null,
      birthDate: r.birth_date,
      birthTime: r.birth_time ? normalizeTime(r.birth_time) : null,
      birthPlace: r.birth_place ?? null,
      phone: r.phone,
      email: r.email,
      questions: r.questions ?? null,
      meetUrl: r.meet_url ?? null,
      confirmedAt: toDate(r.confirmed_at),
      confirmationSentAt: toDate(r.confirmation_sent_at),
      transferInfoSentAt: toDate(r.transfer_info_sent_at),
      adminNotifiedAt: toDate(r.admin_notified_at),
      needsAttention: !!r.needs_attention,
      attentionReason: r.attention_reason ?? null,
    };
  }

  async markEmailSent(bookingId: string, kind: EmailKind): Promise<void> {
    const col =
      kind === 'confirmation'
        ? 'confirmation_sent_at'
        : kind === 'transfer_info'
          ? 'transfer_info_sent_at'
          : 'admin_notified_at';
    const { error } = await this.sb
      .from('bookings')
      .update({ [col]: new Date().toISOString() })
      .eq('id', bookingId);
    if (error) fail('markEmailSent', error);
  }

  async listUnsentConfirmations(confirmedAfter: Date, confirmedBefore: Date): Promise<string[]> {
    const { data, error } = await this.sb
      .from('bookings')
      .select('id')
      .eq('status', 'confirmed')
      .or('attention_reason.is.null,attention_reason.neq.paid_after_start')
      .is('confirmation_sent_at', null)
      .gt('confirmed_at', confirmedAfter.toISOString())
      .lt('confirmed_at', confirmedBefore.toISOString())
      .limit(20);
    if (error) fail('listUnsentConfirmations', error);
    return (data ?? []).map((r: Row) => r.id);
  }

  async listUnsentAdminNotifications(confirmedAfter: Date, confirmedBefore: Date): Promise<string[]> {
    const { data, error } = await this.sb
      .from('bookings')
      .select('id')
      .eq('status', 'confirmed')
      .is('admin_notified_at', null)
      .gt('confirmed_at', confirmedAfter.toISOString())
      .lt('confirmed_at', confirmedBefore.toISOString())
      .limit(20);
    if (error) fail('listUnsentAdminNotifications', error);
    return (data ?? []).map((r: Row) => r.id);
  }

  async listUnsentTransferInfos(now: Date): Promise<string[]> {
    const { data, error } = await this.sb
      .from('bookings')
      .select('id')
      .eq('status', 'awaiting_transfer')
      .is('transfer_info_sent_at', null)
      .gt('hold_expires_at', now.toISOString())
      .limit(20);
    if (error) fail('listUnsentTransferInfos', error);
    return (data ?? []).map((r: Row) => r.id);
  }

  async isAdmin(emailSha256: string): Promise<boolean> {
    const { data, error } = await this.sb.from('admins').select('email_sha256').eq('email_sha256', emailSha256).maybeSingle();
    if (error) fail('isAdmin', error);
    return !!data;
  }

  async listBookingsAdmin(q: { from: Date; to: Date; statuses: BookingStatus[] | null; limit: number }): Promise<AdminBooking[]> {
    let query = this.sb
      .from('bookings')
      .select(ADMIN_BOOKING_COLUMNS)
      .gte('starts_at', q.from.toISOString())
      .lt('starts_at', q.to.toISOString())
      .order('starts_at', { ascending: true })
      .limit(q.limit);
    if (q.statuses) query = query.in('status', q.statuses);
    const { data, error } = await query;
    if (error) fail('listBookingsAdmin', error);
    return (data ?? []).map(mapAdminBooking);
  }

  // ---------- KOL 推薦碼 ----------

  async findReferralCode(code: string): Promise<ReferralCode | null> {
    const { data, error } = await this.sb.from('referral_codes').select(REFERRAL_CODE_COLUMNS).eq('code', code).maybeSingle();
    if (error) fail('findReferralCode', error);
    return data ? mapReferralCode(data) : null;
  }

  async countLiveReferralUses(codeId: string, now: Date): Promise<number> {
    const { data, error } = await this.sb
      .from('referral_uses')
      .select('id,order_kind,booking:bookings(status,hold_expires_at),order:orders(status,hold_expires_at)')
      .eq('code_id', codeId);
    if (error) fail('countLiveReferralUses', error);
    return (data ?? []).filter((r: Row) => referralOrderState(r.order_kind, r.booking, r.order, now) !== 'cancelled').length;
  }

  async recordReferralUse(u: NewReferralUse): Promise<void> {
    const { error } = await this.sb.from('referral_uses').insert({
      code_id: u.codeId,
      order_kind: u.kind,
      order_no: u.orderNo,
      booking_id: u.bookingId,
      order_id: u.orderId,
      original_amount: u.originalAmount,
      discount_amount: u.discountAmount,
      final_amount: u.finalAmount,
      commission_amount: u.commissionAmount,
    });
    if (error) fail('recordReferralUse', error);
  }

  async listKols(): Promise<Kol[]> {
    const { data, error } = await this.sb.from('kols').select('*').order('created_at', { ascending: true });
    if (error) fail('listKols', error);
    return (data ?? []).map(mapKol);
  }

  async createKol(k: NewKol): Promise<Kol> {
    const { data, error } = await this.sb.from('kols').insert({ name: k.name, contact: k.contact, note: k.note }).select('*').single();
    if (error) fail('createKol', error);
    return mapKol(data);
  }

  async updateKol(id: string, patch: KolPatch): Promise<Kol | null> {
    const { data, error } = await this.sb.from('kols').update(patch).eq('id', id).select('*').maybeSingle();
    if (error) fail('updateKol', error);
    return data ? mapKol(data) : null;
  }

  async listReferralCodes(): Promise<ReferralCode[]> {
    const { data, error } = await this.sb.from('referral_codes').select(REFERRAL_CODE_COLUMNS).order('created_at', { ascending: true });
    if (error) fail('listReferralCodes', error);
    return (data ?? []).map(mapReferralCode);
  }

  async createReferralCode(c: NewReferralCode): Promise<ReferralCode | 'duplicate' | 'no_kol'> {
    const { data, error } = await this.sb
      .from('referral_codes')
      .insert(referralCodeRow(c))
      .select(REFERRAL_CODE_COLUMNS)
      .single();
    if (error?.code === '23505') return 'duplicate';
    if (error?.code === '23503') return 'no_kol';
    if (error) fail('createReferralCode', error);
    return mapReferralCode(data);
  }

  async updateReferralCode(id: string, patch: ReferralCodePatch): Promise<ReferralCode | null> {
    const row: Row = referralCodeRow(patch);
    if (patch.active !== undefined) row.active = patch.active;
    const { data, error } = await this.sb.from('referral_codes').update(row).eq('id', id).select(REFERRAL_CODE_COLUMNS).maybeSingle();
    if (error) fail('updateReferralCode', error);
    return data ? mapReferralCode(data) : null;
  }

  async listReferralUses(q: { from: Date; to: Date; now: Date }): Promise<ReferralUseRow[]> {
    const { data, error } = await this.sb
      .from('referral_uses')
      .select(
        'id,code_id,order_kind,order_no,booking_id,order_id,original_amount,discount_amount,final_amount,commission_amount,created_at,code:referral_codes(code,kol_id),booking:bookings(status,hold_expires_at),order:orders(status,hold_expires_at)',
      )
      .gte('created_at', q.from.toISOString())
      .lt('created_at', q.to.toISOString())
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) fail('listReferralUses', error);
    return (data ?? []).map((r: Row) => ({
      id: r.id,
      codeId: r.code_id,
      code: r.code?.code ?? '',
      kolId: r.code?.kol_id ?? '',
      kind: r.order_kind,
      orderNo: r.order_no,
      bookingId: r.booking_id ?? null,
      orderId: r.order_id ?? null,
      originalAmount: r.original_amount,
      discountAmount: r.discount_amount,
      finalAmount: r.final_amount,
      commissionAmount: r.commission_amount,
      createdAt: new Date(r.created_at),
      orderState: referralOrderState(r.order_kind, r.booking, r.order, q.now),
    }));
  }

  // ---------- VIP 包堂、商店、贈品 ----------

  async listVipPlans(activeOnly: boolean): Promise<VipPlan[]> {
    let q = this.sb.from('vip_plans').select('*').order('sort', { ascending: true });
    if (activeOnly) q = q.eq('active', true);
    const { data, error } = await q;
    if (error) fail('listVipPlans', error);
    return (data ?? []).map(mapVipPlan);
  }

  async getVipPlan(id: string): Promise<VipPlan | null> {
    const { data, error } = await this.sb.from('vip_plans').select('*').eq('id', id).maybeSingle();
    if (error) fail('getVipPlan', error);
    return data ? mapVipPlan(data) : null;
  }

  async createVipPlan(p: VipPlan): Promise<VipPlan | 'duplicate'> {
    const { data, error } = await this.sb.from('vip_plans').insert(vipPlanRow(p)).select('*').single();
    if (error?.code === '23505') return 'duplicate';
    if (error) fail('createVipPlan', error);
    return mapVipPlan(data);
  }

  async updateVipPlan(id: string, patch: VipPlanPatch): Promise<VipPlan | null> {
    const { data, error } = await this.sb.from('vip_plans').update(vipPlanRow(patch)).eq('id', id).select('*').maybeSingle();
    if (error) fail('updateVipPlan', error);
    return data ? mapVipPlan(data) : null;
  }

  async createOrder(o: NewOrder): Promise<{ ok: true; id: string } | { ok: false; reason: 'order_no_taken' }> {
    const { data, error } = await this.sb
      .from('orders')
      .insert({
        order_no: o.orderNo,
        kind: o.kind,
        status: o.status,
        subtotal: o.subtotal,
        shipping_fee: o.shippingFee,
        discount_amount: o.discountAmount,
        amount: o.amount,
        customer_name: o.customerName,
        email: o.email,
        phone: o.phone,
        birth_date: o.birthDate,
        ship_name: o.shipName,
        ship_phone: o.shipPhone,
        ship_address: o.shipAddress,
        note: o.note,
        vip_plan_id: o.vipPlanId,
        vip_member_id: o.vipMemberId,
        hold_expires_at: o.holdExpiresAt ? o.holdExpiresAt.toISOString() : null,
        paid_at: o.status === 'paid' ? new Date().toISOString() : null,
      })
      .select('id')
      .single();
    if (error?.code === '23505') return { ok: false, reason: 'order_no_taken' };
    if (error) fail('createOrder', error);
    if (o.items.length > 0) {
      const { error: itemsError } = await this.sb.from('order_items').insert(
        o.items.map((i) => ({ order_id: data.id, product_id: i.productId, name: i.name, unit_price: i.unitPrice, qty: i.qty })),
      );
      if (itemsError) {
        // 品項寫不進去就把訂單刪掉，不留下沒有品項的訂單
        await this.sb.from('orders').delete().eq('id', data.id);
        fail('createOrder.items', itemsError);
      }
    }
    return { ok: true, id: data.id };
  }

  async getOrder(orderNo: string): Promise<Order | null> {
    const { data, error } = await this.sb.from('orders').select(ORDER_COLUMNS).eq('order_no', orderNo).maybeSingle();
    if (error) fail('getOrder', error);
    return data ? mapOrder(data) : null;
  }

  async listOrders(q: { kinds: CommerceKind[] | null; statuses: OrderStatus[] | null; from: Date; to: Date; limit: number }): Promise<Order[]> {
    let query = this.sb
      .from('orders')
      .select(ORDER_COLUMNS)
      .gte('created_at', q.from.toISOString())
      .lt('created_at', q.to.toISOString())
      .order('created_at', { ascending: false })
      .limit(q.limit);
    if (q.kinds) query = query.in('kind', q.kinds);
    if (q.statuses) query = query.in('status', q.statuses);
    const { data, error } = await query;
    if (error) fail('listOrders', error);
    return (data ?? []).map(mapOrder);
  }

  async updateOrder(orderNo: string, patch: OrderPatch): Promise<Order | null> {
    const row: Row = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.trackingNo !== undefined) row.tracking_no = patch.trackingNo;
    if (patch.shippedAt !== undefined) row.shipped_at = patch.shippedAt ? patch.shippedAt.toISOString() : null;
    if (patch.note !== undefined) row.note = patch.note;
    const { data, error } = await this.sb.from('orders').update(row).eq('order_no', orderNo).select(ORDER_COLUMNS).maybeSingle();
    if (error) fail('updateOrder', error);
    return data ? mapOrder(data) : null;
  }

  async expireStaleOrders(now: Date): Promise<number> {
    const { data, error } = await this.sb
      .from('orders')
      .update({ status: 'expired' })
      .eq('status', 'pending_payment')
      .lt('hold_expires_at', now.toISOString())
      .select('id');
    if (error) fail('expireStaleOrders', error);
    return (data ?? []).length;
  }

  async insertOrderPayment(p: { orderId: string; tradeNo: string; amount: number; raw: Record<string, unknown> }): Promise<void> {
    const { error } = await this.sb
      .from('order_payments')
      .insert({ order_id: p.orderId, trade_no: p.tradeNo, amount: p.amount, raw: p.raw });
    if (error) fail('insertOrderPayment', error);
  }

  async countOrderPayments(orderId: string): Promise<number> {
    const { count, error } = await this.sb.from('order_payments').select('id', { count: 'exact', head: true }).eq('order_id', orderId);
    if (error) fail('countOrderPayments', error);
    return count ?? 0;
  }

  async applyOrderPaid(args: {
    tradeNo: string;
    amount: number;
    providerTxnId: string | null;
    raw: Record<string, unknown>;
    cardNo: string;
  }): Promise<OrderPaidResult> {
    const { data, error } = await this.sb.rpc('apply_order_paid', {
      p_trade_no: args.tradeNo,
      p_amount: args.amount,
      p_txn: args.providerTxnId,
      p_raw: args.raw,
      p_card_no: args.cardNo,
    });
    if (error) fail('applyOrderPaid', error);
    return data as OrderPaidResult;
  }

  async markOrderPaymentFailed(tradeNo: string, raw: Record<string, unknown>): Promise<void> {
    const { data: cur, error: readError } = await this.sb.from('order_payments').select('raw').eq('trade_no', tradeNo).maybeSingle();
    if (readError) fail('markOrderPaymentFailed.read', readError);
    if (!cur) return;
    const { error } = await this.sb
      .from('order_payments')
      .update({ status: 'failed', raw: { ...(cur.raw ?? {}), failed: raw } })
      .eq('trade_no', tradeNo)
      .eq('status', 'init');
    if (error) fail('markOrderPaymentFailed', error);
  }

  async getVipMemberByCard(cardNo: string): Promise<VipMember | null> {
    const { data, error } = await this.sb.from('vip_members').select(VIP_MEMBER_COLUMNS).eq('card_no', cardNo).maybeSingle();
    if (error) fail('getVipMemberByCard', error);
    return data ? mapVipMember(data) : null;
  }

  async getVipMemberByOrder(orderId: string): Promise<VipMember | null> {
    const { data, error } = await this.sb.from('vip_members').select(VIP_MEMBER_COLUMNS).eq('order_id', orderId).maybeSingle();
    if (error) fail('getVipMemberByOrder', error);
    return data ? mapVipMember(data) : null;
  }

  async getVipMember(id: string): Promise<VipMember | null> {
    const { data, error } = await this.sb.from('vip_members').select(VIP_MEMBER_COLUMNS).eq('id', id).maybeSingle();
    if (error) fail('getVipMember', error);
    return data ? mapVipMember(data) : null;
  }

  async listVipMembers(q: { search: string | null; birthMonth: number | null; limit: number }): Promise<VipMember[]> {
    let query = this.sb
      .from('vip_members')
      .select(VIP_MEMBER_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(q.birthMonth ? 1000 : q.limit);
    const s = q.search ? safeSearch(q.search) : '';
    if (s) query = query.or(`name.ilike.*${s}*,email.ilike.*${s}*,card_no.ilike.*${s}*,phone.ilike.*${s}*`);
    const { data, error } = await query;
    if (error) fail('listVipMembers', error);
    let rows = (data ?? []).map(mapVipMember);
    if (q.birthMonth) rows = rows.filter((m: VipMember) => m.birthDate && Number(m.birthDate.slice(5, 7)) === q.birthMonth);
    return rows.slice(0, q.limit);
  }

  async updateVipMember(id: string, patch: VipMemberPatch): Promise<VipMember | null> {
    const row: Row = {};
    if (patch.sessionsTotal !== undefined) row.sessions_total = patch.sessionsTotal;
    if (patch.sessionsUsed !== undefined) row.sessions_used = patch.sessionsUsed;
    if (patch.expiresAt !== undefined) row.expires_at = patch.expiresAt.toISOString();
    if (patch.note !== undefined) row.note = patch.note;
    const { data, error } = await this.sb.from('vip_members').update(row).eq('id', id).select(VIP_MEMBER_COLUMNS).maybeSingle();
    if (error) fail('updateVipMember', error);
    return data ? mapVipMember(data) : null;
  }

  async listVipBookings(memberId: string): Promise<{ orderNo: string; startsAt: Date; status: BookingStatus; serviceName: string }[]> {
    const { data, error } = await this.sb
      .from('bookings')
      .select('order_no,starts_at,status,service:services(name)')
      .eq('vip_member_id', memberId)
      .order('starts_at', { ascending: false })
      .limit(100);
    if (error) fail('listVipBookings', error);
    return (data ?? []).map((r: Row) => ({
      orderNo: r.order_no,
      startsAt: new Date(r.starts_at),
      status: r.status,
      serviceName: r.service?.name ?? '',
    }));
  }

  async createVipBooking(b: NewVipBooking): Promise<VipBookingResult> {
    const { data, error } = await this.sb.rpc('create_vip_booking', {
      p_order_no: b.orderNo,
      p_service_id: b.serviceId,
      p_starts_at: b.startsAt.toISOString(),
      p_ends_at: b.endsAt.toISOString(),
      p_card_no: b.cardNo,
      p_customer_name: b.customerName,
      p_gender: b.gender,
      p_birth_date: b.birthDate,
      p_birth_time: b.birthTime,
      p_birth_place: b.birthPlace,
      p_phone: b.phone,
      p_email: b.email,
      p_questions: b.questions,
    });
    if (error) fail('createVipBooking', error);
    const r = (data ?? {}) as { result?: string; id?: string; sessions_left?: number };
    if (r.result === 'created' && r.id) return { ok: true, id: r.id, sessionsLeft: r.sessions_left ?? 0 };
    if (
      r.result === 'vip_not_found' ||
      r.result === 'vip_expired' ||
      r.result === 'vip_no_sessions' ||
      r.result === 'slot_taken' ||
      r.result === 'order_no_taken'
    ) {
      return { ok: false, reason: r.result };
    }
    throw new DbError('createVipBooking', undefined, `unexpected result ${String(r.result)}`);
  }

  // ---------- 商店商品、運費、贈品 ----------

  async listProducts(q: { publicOnly: boolean }): Promise<Product[]> {
    let query = this.sb
      .from('products')
      .select(PRODUCT_COLUMNS)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: false });
    if (q.publicOnly) query = query.eq('active', true).eq('for_sale', true);
    const { data, error } = await query;
    if (error) fail('listProducts', error);
    return (data ?? []).map(mapProduct);
  }

  async getProduct(id: string): Promise<Product | null> {
    const { data, error } = await this.sb.from('products').select(PRODUCT_COLUMNS).eq('id', id).maybeSingle();
    if (error) fail('getProduct', error);
    return data ? mapProduct(data) : null;
  }

  async getProductBySlug(slug: string): Promise<Product | null> {
    const { data, error } = await this.sb.from('products').select(PRODUCT_COLUMNS).eq('slug', slug).maybeSingle();
    if (error) fail('getProductBySlug', error);
    return data ? mapProduct(data) : null;
  }

  async getProductsByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.sb.from('products').select(PRODUCT_COLUMNS).in('id', ids);
    if (error) fail('getProductsByIds', error);
    return (data ?? []).map(mapProduct);
  }

  async createProduct(p: NewProduct): Promise<Product | 'duplicate'> {
    const { data, error } = await this.sb.from('products').insert(productRow(p)).select(PRODUCT_COLUMNS).single();
    if (error?.code === '23505') return 'duplicate';
    if (error) fail('createProduct', error);
    return mapProduct(data);
  }

  async updateProduct(id: string, patch: ProductPatch): Promise<Product | null | 'duplicate'> {
    const { data, error } = await this.sb.from('products').update(productRow(patch)).eq('id', id).select(PRODUCT_COLUMNS).maybeSingle();
    if (error?.code === '23505') return 'duplicate';
    if (error) fail('updateProduct', error);
    return data ? mapProduct(data) : null;
  }

  async getShopSettings(): Promise<ShopSettings> {
    const { data, error } = await this.sb.from('settings').select('key,value').in('key', ['shipping_fee', 'free_shipping_over']);
    if (error) fail('getShopSettings', error);
    return parseShopSettings(data ?? []);
  }

  async updateShopSettings(patch: Partial<ShopSettings>): Promise<ShopSettings> {
    const now = new Date().toISOString();
    if (patch.shippingFee !== undefined) {
      const { error } = await this.sb.from('settings').upsert({ key: 'shipping_fee', value: patch.shippingFee, updated_at: now });
      if (error) fail('updateShopSettings.shipping_fee', error);
    }
    if (patch.freeShippingOver !== undefined) {
      // value 是 jsonb not null：不提供免運時刪掉這一列（讀取時沒有值＝不提供）
      const { error } =
        patch.freeShippingOver === null
          ? await this.sb.from('settings').delete().eq('key', 'free_shipping_over')
          : await this.sb.from('settings').upsert({ key: 'free_shipping_over', value: patch.freeShippingOver, updated_at: now });
      if (error) fail('updateShopSettings.free_shipping_over', error);
    }
    return this.getShopSettings();
  }

  async consumeOrderStock(orderId: string): Promise<void> {
    const { error } = await this.sb.rpc('consume_order_stock', { p_order_id: orderId });
    if (error) fail('consumeOrderStock', error);
  }

  async insertPayment(p: NewPayment): Promise<PaymentRow> {
    const { data, error } = await this.sb
      .from('payments')
      .insert({
        booking_id: p.bookingId,
        provider: p.provider,
        method: p.method,
        provider_trade_no: p.tradeNo,
        amount: p.amount,
        status: 'init',
        raw: p.raw,
      })
      .select(PAYMENT_COLUMNS)
      .single();
    if (error) fail('insertPayment', error);
    return mapPayment(data);
  }

  async getPayment(provider: Provider, tradeNo: string): Promise<PaymentRow | null> {
    const { data, error } = await this.sb
      .from('payments')
      .select(PAYMENT_COLUMNS)
      .eq('provider', provider)
      .eq('provider_trade_no', tradeNo)
      .maybeSingle();
    if (error) fail('getPayment', error);
    return data ? mapPayment(data) : null;
  }

  async listBookingPayments(bookingId: string): Promise<PaymentRow[]> {
    const { data, error } = await this.sb
      .from('payments')
      .select(PAYMENT_COLUMNS)
      .eq('booking_id', bookingId)
      .order('created_at');
    if (error) fail('listBookingPayments', error);
    return (data ?? []).map(mapPayment);
  }

  async listPendingLinePay(createdAfter: Date, createdBefore: Date): Promise<PaymentRow[]> {
    const { data, error } = await this.sb
      .from('payments')
      .select(PAYMENT_COLUMNS)
      .eq('provider', 'linepay')
      .eq('status', 'init')
      .not('provider_txn_id', 'is', null)
      .gt('created_at', createdAfter.toISOString())
      .lt('created_at', createdBefore.toISOString())
      .limit(20);
    if (error) fail('listPendingLinePay', error);
    return (data ?? []).map(mapPayment);
  }

  async setPaymentTxn(paymentId: string, providerTxnId: string, raw: Record<string, unknown>): Promise<void> {
    const { error } = await this.sb
      .from('payments')
      .update({ provider_txn_id: providerTxnId, raw })
      .eq('id', paymentId);
    if (error) fail('setPaymentTxn', error);
  }

  async applyPaymentPaid(args: {
    provider: Provider;
    tradeNo: string;
    amount: number;
    providerTxnId: string | null;
    event: string;
    raw: Record<string, unknown>;
  }): Promise<PaidResult> {
    const { data, error } = await this.sb.rpc('apply_payment_paid', {
      p_provider: args.provider,
      p_trade_no: args.tradeNo,
      p_amount: args.amount,
      p_provider_txn_id: args.providerTxnId,
      p_event: args.event,
      p_raw: args.raw,
    });
    if (error) fail('applyPaymentPaid', error);
    return data as PaidResult;
  }

  async applyAtmIssued(args: {
    tradeNo: string;
    amount: number;
    providerTxnId: string | null;
    bankCode: string;
    account: string;
    expiresAt: Date;
    event: string;
    raw: Record<string, unknown>;
  }): Promise<AtmIssuedResult> {
    const { data, error } = await this.sb.rpc('apply_atm_issued', {
      p_trade_no: args.tradeNo,
      p_amount: args.amount,
      p_provider_txn_id: args.providerTxnId,
      p_bank_code: args.bankCode,
      p_account: args.account,
      p_expires_at: args.expiresAt.toISOString(),
      p_event: args.event,
      p_raw: args.raw,
    });
    if (error) fail('applyAtmIssued', error);
    return data as AtmIssuedResult;
  }

  async flagPaymentAttention(args: {
    provider: Provider;
    tradeNo: string;
    event: string;
    raw: Record<string, unknown>;
    reason: string;
  }): Promise<FlagResult> {
    const { data, error } = await this.sb.rpc('flag_payment_attention', {
      p_provider: args.provider,
      p_trade_no: args.tradeNo,
      p_event: args.event,
      p_raw: args.raw,
      p_reason: args.reason,
    });
    if (error) fail('flagPaymentAttention', error);
    return data as FlagResult;
  }

  async markPaymentFailed(args: {
    provider: Provider;
    tradeNo: string;
    event: string;
    raw: Record<string, unknown>;
  }): Promise<FailedResult> {
    const { data, error } = await this.sb.rpc('mark_payment_failed', {
      p_provider: args.provider,
      p_trade_no: args.tradeNo,
      p_event: args.event,
      p_raw: args.raw,
    });
    if (error) fail('markPaymentFailed', error);
    return data as FailedResult;
  }
}

/**
 * 商品圖片：Supabase Storage 的公開 bucket（第一次上傳時建立；建立失敗下次再試）
 */
export function createSupabaseStorage(url: string, serviceRoleKey: string): PublicStorage {
  const sb: SupabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let ready: Promise<void> | null = null;
  const ensureBucket = () => {
    ready ??= (async () => {
      const { data } = await sb.storage.getBucket(PRODUCT_BUCKET);
      if (data) return;
      const { error } = await sb.storage.createBucket(PRODUCT_BUCKET, {
        public: true,
        fileSizeLimit: MAX_UPLOAD_BYTES,
        allowedMimeTypes: Object.keys(IMAGE_TYPES),
      });
      if (error && !/already exists/i.test(error.message)) throw new DbError('storage.createBucket', undefined, error.message);
    })().catch((e: unknown) => {
      ready = null;
      throw e;
    });
    return ready;
  };
  return {
    async upload(path, bytes, contentType) {
      await ensureBucket();
      const bucket = sb.storage.from(PRODUCT_BUCKET);
      const { error } = await bucket.upload(path, bytes, { contentType, cacheControl: '31536000', upsert: false });
      if (error) throw new DbError('storage.upload', undefined, error.message);
      return bucket.getPublicUrl(path).data.publicUrl;
    },
  };
}
