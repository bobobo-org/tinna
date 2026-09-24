import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthVerifier } from '../lib/admin-auth';
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
  type Kol,
  type KolPatch,
  type NewBooking,
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

const SERVICE_COLUMNS = 'id,name,short_name,minutes,price,topic_limit,question_required';

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

/** 推薦碼使用紀錄對應的訂單狀態：已付款／保留中／已取消（取消、逾時、退款、保留過期） */
function referralOrderState(kind: string, booking: Row | null, now: Date): 'paid' | 'pending' | 'cancelled' {
  if (kind !== 'booking' || !booking) return 'cancelled';
  if (booking.status === 'confirmed') return 'paid';
  if (booking.status === 'awaiting_transfer') return 'pending';
  if (booking.status === 'pending_payment' && booking.hold_expires_at && new Date(booking.hold_expires_at) > now) return 'pending';
  return 'cancelled';
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
      .select('id,order_kind,booking:bookings(status,hold_expires_at)')
      .eq('code_id', codeId);
    if (error) fail('countLiveReferralUses', error);
    return (data ?? []).filter((r: Row) => referralOrderState(r.order_kind, r.booking, now) !== 'cancelled').length;
  }

  async recordReferralUse(u: NewReferralUse): Promise<void> {
    const { error } = await this.sb.from('referral_uses').insert({
      code_id: u.codeId,
      order_kind: u.kind,
      order_no: u.orderNo,
      booking_id: u.bookingId,
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
        'id,code_id,order_kind,order_no,booking_id,original_amount,discount_amount,final_amount,commission_amount,created_at,code:referral_codes(code,kol_id),booking:bookings(status,hold_expires_at)',
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
      originalAmount: r.original_amount,
      discountAmount: r.discount_amount,
      finalAmount: r.final_amount,
      commissionAmount: r.commission_amount,
      createdAt: new Date(r.created_at),
      orderState: referralOrderState(r.order_kind, r.booking, q.now),
    }));
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
