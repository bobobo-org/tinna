import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeTime } from '../lib/time';
import {
  ACTIVE_STATUSES,
  type AtmIssuedResult,
  type BookingFull,
  type BookingPublic,
  type BusyBooking,
  type DateOverrideRow,
  type Db,
  type EmailKind,
  type FailedResult,
  type InsertBookingResult,
  type NewBooking,
  type NewPayment,
  type PaidResult,
  type PaymentRow,
  type Provider,
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
  'id,order_no,status,pay_method,amount,starts_at,ends_at,hold_expires_at,atm_bank_code,atm_account,atm_expires_at,service:services(id,name,minutes)';

// 未產生 Supabase 型別檔；欄位在 map* 函式集中轉換
type Row = any;

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
  };
}

export function createSupabaseDb(url: string, serviceRoleKey: string): Db {
  const sb: SupabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabaseDb(sb);
}

export class SupabaseDb implements Db {
  constructor(private readonly sb: SupabaseClient) {}

  async listActiveServices(): Promise<Service[]> {
    const { data, error } = await this.sb
      .from('services')
      .select('id,name,short_name,minutes,price')
      .eq('active', true)
      .order('sort');
    if (error) fail('listActiveServices', error);
    return (data ?? []).map((r: Row) => ({
      id: r.id,
      name: r.name,
      shortName: r.short_name,
      minutes: r.minutes,
      price: r.price,
    }));
  }

  async getActiveService(id: string): Promise<Service | null> {
    const { data, error } = await this.sb
      .from('services')
      .select('id,name,short_name,minutes,price')
      .eq('id', id)
      .eq('active', true)
      .maybeSingle();
    if (error) fail('getActiveService', error);
    if (!data) return null;
    const r: Row = data;
    return { id: r.id, name: r.name, shortName: r.short_name, minutes: r.minutes, price: r.price };
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

  async insertBooking(b: NewBooking): Promise<InsertBookingResult> {
    const { data, error } = await this.sb
      .from('bookings')
      .insert({
        order_no: b.orderNo,
        service_id: b.serviceId,
        starts_at: b.startsAt.toISOString(),
        ends_at: b.endsAt.toISOString(),
        status: 'pending_payment',
        pay_method: b.payMethod,
        amount: b.amount,
        hold_expires_at: b.holdExpiresAt.toISOString(),
        customer_name: b.customerName,
        gender: b.gender,
        birth_date: b.birthDate,
        birth_time: b.birthTime,
        birth_place: b.birthPlace,
        phone: b.phone,
        email: b.email,
        questions: b.questions,
      })
      .select('id')
      .single();
    if (error) {
      const msg = `${error.message ?? ''}`;
      // 23505：同一開始時間（bookings_slot_unique）；23P01：時間區間重疊（bookings_no_overlap）
      if (error.code === '23P01') return { ok: false, reason: 'slot_taken' };
      if (error.code === '23505') {
        if (msg.includes('bookings_slot_unique')) return { ok: false, reason: 'slot_taken' };
        if (msg.includes('bookings_order_no_unique')) return { ok: false, reason: 'order_no_taken' };
      }
      fail('insertBooking', error);
    }
    return { ok: true, id: (data as Row).id };
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
      .select('id,booking_id,provider,method,provider_trade_no,provider_txn_id,amount,status')
      .single();
    if (error) fail('insertPayment', error);
    return mapPayment(data);
  }

  async getPayment(provider: Provider, tradeNo: string): Promise<PaymentRow | null> {
    const { data, error } = await this.sb
      .from('payments')
      .select('id,booking_id,provider,method,provider_trade_no,provider_txn_id,amount,status')
      .eq('provider', provider)
      .eq('provider_trade_no', tradeNo)
      .maybeSingle();
    if (error) fail('getPayment', error);
    return data ? mapPayment(data) : null;
  }

  async listBookingPayments(bookingId: string): Promise<PaymentRow[]> {
    const { data, error } = await this.sb
      .from('payments')
      .select('id,booking_id,provider,method,provider_trade_no,provider_txn_id,amount,status')
      .eq('booking_id', bookingId)
      .order('created_at');
    if (error) fail('listBookingPayments', error);
    return (data ?? []).map(mapPayment);
  }

  async listPendingLinePay(createdAfter: Date, createdBefore: Date): Promise<PaymentRow[]> {
    const { data, error } = await this.sb
      .from('payments')
      .select('id,booking_id,provider,method,provider_trade_no,provider_txn_id,amount,status')
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
