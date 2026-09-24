import { randomUUID } from 'node:crypto';
import {
  ACTIVE_STATUSES,
  type AtmIssuedResult,
  type BookingFull,
  type BookingPublic,
  type BookingStatus,
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
  type PaymentStatus,
  type PayMethod,
  type Provider,
  type Service,
  type WeeklySlotRow,
} from '../../src/db/types';
import { generateOrderNo } from '../../src/lib/order-no';

// 測試用記憶體資料庫。狀態轉換邏輯逐行對齊 supabase/migrations/0001_init.sql 的
// apply_payment_paid / apply_atm_issued / mark_payment_failed / expire_stale_holds。

export interface MemBooking {
  id: string;
  orderNo: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  payMethod: PayMethod;
  amount: number;
  customerName: string;
  gender: string | null;
  birthDate: string;
  birthTime: string | null;
  birthPlace: string | null;
  phone: string;
  email: string;
  questions: string | null;
  atmBankCode: string | null;
  atmAccount: string | null;
  atmExpiresAt: Date | null;
  holdExpiresAt: Date | null;
  meetUrl: string | null;
  confirmedAt: Date | null;
  needsAttention: boolean;
  attentionReason: string | null;
  confirmationSentAt: Date | null;
  transferInfoSentAt: Date | null;
  adminNotifiedAt: Date | null;
}

export interface MemPayment {
  id: string;
  bookingId: string;
  provider: Provider;
  method: PayMethod;
  tradeNo: string;
  providerTxnId: string | null;
  amount: number;
  status: PaymentStatus;
  paidAt: Date | null;
  raw: Record<string, unknown>;
  createdAt: Date;
}

export const SEED_SERVICES: (Service & { active: boolean })[] = [
  { id: 'flow', name: '流年運勢盤', shortName: '流年 · 大限', minutes: 60, price: 2800, active: true },
  { id: 'love', name: '感情合盤', shortName: '姻緣 · 合盤', minutes: 90, price: 3600, active: true },
  { id: 'career', name: '事業／擇時', shortName: '事業 · 擇時', minutes: 75, price: 3200, active: true },
  { id: 'quick', name: '單題快問', shortName: '單題快問', minutes: 30, price: 1500, active: true },
];

export const SEED_WEEKLY: WeeklySlotRow[] = [0, 2, 3, 4, 5, 6].flatMap((weekday) =>
  ['10:00', '13:30', '15:30', '19:00', '20:30'].map((time) => ({ weekday, time })),
);

export class MemoryDb implements Db {
  services = SEED_SERVICES.map((s) => ({ ...s }));
  weekly: WeeklySlotRow[] = SEED_WEEKLY.map((w) => ({ ...w }));
  overrides: DateOverrideRow[] = [];
  bookings: MemBooking[] = [];
  payments: MemPayment[] = [];
  calls: string[] = [];
  /** 模擬 insert 前一刻別人搶先寫入同時段（race） */
  beforeInsert?: (b: NewBooking) => void;

  constructor(private readonly clock: () => Date) {}

  private isActive(s: BookingStatus) {
    return ACTIVE_STATUSES.includes(s);
  }

  /** 對齊 bookings_slot_unique（同開始時間）＋ bookings_no_overlap（區間重疊） */
  private slotConflict(startsAt: Date, endsAt: Date, exceptId?: string) {
    return this.bookings.some(
      (b) => b.id !== exceptId && this.isActive(b.status) && b.startsAt < endsAt && startsAt < b.endsAt,
    );
  }

  /** 測試直接塞資料 */
  addBooking(p: Partial<MemBooking> & Pick<MemBooking, 'startsAt'>): MemBooking {
    const svc = this.services.find((s) => s.id === (p.serviceId ?? 'love'))!;
    const b: MemBooking = {
      id: randomUUID(),
      orderNo: generateOrderNo(),
      serviceId: svc.id,
      endsAt: new Date(p.startsAt.getTime() + svc.minutes * 60_000),
      status: 'pending_payment',
      payMethod: 'card',
      amount: svc.price,
      customerName: '測試',
      gender: 'female',
      birthDate: '1990-01-01',
      birthTime: null,
      birthPlace: null,
      phone: '0912345678',
      email: 'guest@example.com',
      questions: null,
      atmBankCode: null,
      atmAccount: null,
      atmExpiresAt: null,
      holdExpiresAt: new Date(this.clock().getTime() + 15 * 60_000),
      meetUrl: null,
      confirmedAt: null,
      needsAttention: false,
      attentionReason: null,
      confirmationSentAt: null,
      transferInfoSentAt: null,
      adminNotifiedAt: null,
      ...p,
    };
    if (this.isActive(b.status) && this.slotConflict(b.startsAt, b.endsAt)) throw new Error('23P01 bookings_no_overlap');
    this.bookings.push(b);
    return b;
  }

  addPayment(p: Partial<MemPayment> & Pick<MemPayment, 'bookingId' | 'tradeNo'>): MemPayment {
    const b = this.bookings.find((x) => x.id === p.bookingId)!;
    const row: MemPayment = {
      id: randomUUID(),
      provider: 'ecpay',
      method: b.payMethod,
      providerTxnId: null,
      amount: b.amount,
      status: 'init',
      paidAt: null,
      raw: {},
      createdAt: this.clock(),
      ...p,
    };
    this.payments.push(row);
    return row;
  }

  booking(orderNo: string) {
    return this.bookings.find((b) => b.orderNo === orderNo);
  }

  private toPublic(b: MemBooking): BookingPublic {
    const s = this.services.find((x) => x.id === b.serviceId)!;
    return {
      id: b.id,
      orderNo: b.orderNo,
      status: b.status,
      payMethod: b.payMethod,
      amount: b.amount,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      holdExpiresAt: b.holdExpiresAt,
      atmBankCode: b.atmBankCode,
      atmAccount: b.atmAccount,
      atmExpiresAt: b.atmExpiresAt,
      service: { id: s.id, name: s.name, minutes: s.minutes },
    };
  }

  // ---------- Db ----------
  async listActiveServices() {
    this.calls.push('listActiveServices');
    return this.services.filter((s) => s.active).map(({ active: _a, ...s }) => s);
  }
  async getActiveService(id: string) {
    this.calls.push('getActiveService');
    const s = this.services.find((x) => x.id === id && x.active);
    if (!s) return null;
    const { active: _a, ...rest } = s;
    return rest;
  }
  async listWeeklySlots() {
    return this.weekly.map((w) => ({ ...w }));
  }
  async listOverrides(fromDate: string, toDate: string) {
    return this.overrides.filter((o) => o.date >= fromDate && o.date <= toDate);
  }
  async listBusyBookings(from: Date, to: Date): Promise<BusyBooking[]> {
    return this.bookings
      .filter((b) => this.isActive(b.status) && b.startsAt >= from && b.startsAt < to)
      .map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt, status: b.status, holdExpiresAt: b.holdExpiresAt }));
  }
  async expireStaleHolds(range?: { from: Date; to: Date }) {
    this.calls.push('expireStaleHolds');
    const now = this.clock().getTime();
    let n = 0;
    for (const b of this.bookings) {
      if (
        (b.status === 'pending_payment' || b.status === 'awaiting_transfer') &&
        b.holdExpiresAt !== null &&
        b.holdExpiresAt.getTime() < now &&
        (!range || (b.startsAt < range.to && b.endsAt > range.from))
      ) {
        b.status = 'expired';
        n++;
      }
    }
    return n;
  }
  async insertBooking(nb: NewBooking): Promise<InsertBookingResult> {
    this.calls.push('insertBooking');
    this.beforeInsert?.(nb);
    if (this.slotConflict(nb.startsAt, nb.endsAt)) return { ok: false, reason: 'slot_taken' };
    if (this.bookings.some((b) => b.orderNo === nb.orderNo)) return { ok: false, reason: 'order_no_taken' };
    const b = this.addBooking({
      orderNo: nb.orderNo,
      serviceId: nb.serviceId,
      startsAt: nb.startsAt,
      endsAt: nb.endsAt,
      payMethod: nb.payMethod,
      amount: nb.amount,
      holdExpiresAt: nb.holdExpiresAt,
      customerName: nb.customerName,
      gender: nb.gender,
      birthDate: nb.birthDate,
      birthTime: nb.birthTime,
      birthPlace: nb.birthPlace,
      phone: nb.phone,
      email: nb.email,
      questions: nb.questions,
    });
    return { ok: true, id: b.id };
  }
  async getBookingPublic(orderNo: string) {
    const b = this.booking(orderNo);
    return b ? this.toPublic(b) : null;
  }
  async getBookingFull(id: string): Promise<BookingFull | null> {
    const b = this.bookings.find((x) => x.id === id);
    if (!b) return null;
    return {
      ...this.toPublic(b),
      customerName: b.customerName,
      gender: b.gender,
      birthDate: b.birthDate,
      birthTime: b.birthTime,
      birthPlace: b.birthPlace,
      phone: b.phone,
      email: b.email,
      questions: b.questions,
      meetUrl: b.meetUrl,
      confirmedAt: b.confirmedAt,
      confirmationSentAt: b.confirmationSentAt,
      transferInfoSentAt: b.transferInfoSentAt,
      adminNotifiedAt: b.adminNotifiedAt,
      needsAttention: b.needsAttention,
      attentionReason: b.attentionReason,
    };
  }
  async markEmailSent(bookingId: string, kind: EmailKind) {
    const b = this.bookings.find((x) => x.id === bookingId)!;
    if (kind === 'confirmation') b.confirmationSentAt = this.clock();
    else if (kind === 'transfer_info') b.transferInfoSentAt = this.clock();
    else b.adminNotifiedAt = this.clock();
  }
  async listUnsentConfirmations(after: Date, before: Date) {
    return this.bookings
      .filter(
        (b) =>
          b.status === 'confirmed' &&
          b.attentionReason !== 'paid_after_start' &&
          !b.confirmationSentAt &&
          b.confirmedAt !== null &&
          b.confirmedAt > after &&
          b.confirmedAt < before,
      )
      .map((b) => b.id);
  }
  async listUnsentAdminNotifications(after: Date, before: Date) {
    return this.bookings
      .filter(
        (b) =>
          b.status === 'confirmed' &&
          !b.adminNotifiedAt &&
          b.confirmedAt !== null &&
          b.confirmedAt > after &&
          b.confirmedAt < before,
      )
      .map((b) => b.id);
  }
  async listUnsentTransferInfos(now: Date) {
    return this.bookings
      .filter(
        (b) =>
          b.status === 'awaiting_transfer' &&
          !b.transferInfoSentAt &&
          b.holdExpiresAt !== null &&
          b.holdExpiresAt > now,
      )
      .map((b) => b.id);
  }
  async insertPayment(p: NewPayment): Promise<PaymentRow> {
    if (this.payments.some((x) => x.provider === p.provider && x.tradeNo === p.tradeNo)) {
      throw new Error('23505 payments_trade_no_unique');
    }
    const row = this.addPayment({
      bookingId: p.bookingId,
      provider: p.provider,
      method: p.method,
      tradeNo: p.tradeNo,
      amount: p.amount,
      raw: p.raw,
    });
    return this.paymentRow(row);
  }
  private paymentRow(p: MemPayment): PaymentRow {
    return {
      id: p.id,
      bookingId: p.bookingId,
      provider: p.provider,
      method: p.method,
      tradeNo: p.tradeNo,
      providerTxnId: p.providerTxnId,
      amount: p.amount,
      status: p.status,
    };
  }
  async getPayment(provider: Provider, tradeNo: string) {
    const p = this.payments.find((x) => x.provider === provider && x.tradeNo === tradeNo);
    return p ? this.paymentRow(p) : null;
  }
  async listBookingPayments(bookingId: string) {
    return this.payments.filter((p) => p.bookingId === bookingId).map((p) => this.paymentRow(p));
  }
  async listPendingLinePay(after: Date, before: Date) {
    return this.payments
      .filter(
        (p) =>
          p.provider === 'linepay' &&
          p.status === 'init' &&
          p.providerTxnId !== null &&
          p.createdAt > after &&
          p.createdAt < before,
      )
      .map((p) => this.paymentRow(p));
  }
  async setPaymentTxn(paymentId: string, providerTxnId: string, raw: Record<string, unknown>) {
    const p = this.payments.find((x) => x.id === paymentId)!;
    p.providerTxnId = providerTxnId;
    p.raw = raw;
  }

  async applyPaymentPaid(a: {
    provider: Provider;
    tradeNo: string;
    amount: number;
    providerTxnId: string | null;
    event: string;
    raw: Record<string, unknown>;
  }): Promise<PaidResult> {
    this.calls.push(`applyPaymentPaid:${a.event}`);
    const pay = this.payments.find((x) => x.provider === a.provider && x.tradeNo === a.tradeNo);
    if (!pay) return { result: 'not_found' };
    const bk = this.bookings.find((x) => x.id === pay.bookingId)!;
    pay.raw = { ...pay.raw, [a.event]: a.raw };
    pay.providerTxnId ??= a.providerTxnId;
    const ref = { booking_id: bk.id, order_no: bk.orderNo };
    if (pay.status === 'paid') return { result: 'already_paid', ...ref, booking_status: bk.status };
    if (pay.status === 'refunded') return { result: 'ignored', ...ref, booking_status: bk.status };
    if (a.amount !== pay.amount || pay.amount !== bk.amount) {
      bk.needsAttention = true;
      bk.attentionReason = 'amount_mismatch';
      return { result: 'amount_mismatch', reason: 'amount_mismatch', ...ref, booking_status: bk.status };
    }
    const now = this.clock();
    pay.status = 'paid';
    pay.paidAt = now;
    if (bk.status === 'pending_payment' || bk.status === 'awaiting_transfer') {
      bk.status = 'confirmed';
      bk.confirmedAt = now;
      bk.holdExpiresAt = null;
      if (bk.startsAt <= now) {
        bk.needsAttention = true;
        bk.attentionReason = 'paid_after_start';
        return { result: 'needs_attention', reason: 'paid_after_start', ...ref, booking_status: 'confirmed' };
      }
      return { result: 'confirmed', ...ref, booking_status: 'confirmed' };
    }
    if (bk.status === 'expired' && bk.startsAt > now) {
      if (this.slotConflict(bk.startsAt, bk.endsAt, bk.id)) {
        bk.needsAttention = true;
        bk.attentionReason = 'paid_after_expiry_slot_taken';
        return {
          result: 'needs_attention',
          reason: 'paid_after_expiry_slot_taken',
          ...ref,
          booking_status: bk.status,
        };
      }
      bk.status = 'confirmed';
      bk.confirmedAt = now;
      bk.holdExpiresAt = null;
      return { result: 'confirmed', reclaimed: true, ...ref, booking_status: 'confirmed' };
    }
    const reason =
      bk.status === 'confirmed'
        ? 'duplicate_payment'
        : bk.status === 'expired'
          ? 'paid_after_expiry_past'
          : bk.status === 'cancelled'
            ? 'paid_after_cancel'
            : 'paid_after_refund';
    bk.needsAttention = true;
    bk.attentionReason = reason;
    return { result: 'needs_attention', reason, ...ref, booking_status: bk.status };
  }

  async applyAtmIssued(a: {
    tradeNo: string;
    amount: number;
    providerTxnId: string | null;
    bankCode: string;
    account: string;
    expiresAt: Date;
    event: string;
    raw: Record<string, unknown>;
  }): Promise<AtmIssuedResult> {
    this.calls.push(`applyAtmIssued:${a.event}`);
    const pay = this.payments.find((x) => x.provider === 'ecpay' && x.tradeNo === a.tradeNo);
    if (!pay) return { result: 'not_found' };
    const bk = this.bookings.find((x) => x.id === pay.bookingId)!;
    pay.raw = { ...pay.raw, [a.event]: a.raw };
    pay.providerTxnId ??= a.providerTxnId;
    const ref = { booking_id: bk.id, order_no: bk.orderNo };
    if (pay.status !== 'init') return { result: 'ignored', ...ref, booking_status: bk.status };
    if (a.amount !== pay.amount) {
      bk.needsAttention = true;
      bk.attentionReason = 'amount_mismatch';
      return { result: 'amount_mismatch', reason: 'amount_mismatch', ...ref, booking_status: bk.status };
    }
    const now = this.clock();
    if (a.expiresAt <= now) return { result: 'ignored', ...ref, booking_status: bk.status };
    if (bk.status === 'awaiting_transfer' && bk.atmAccount === a.account) {
      return { result: 'already_issued', ...ref, booking_status: bk.status };
    }
    if (
      bk.status === 'pending_payment' ||
      bk.status === 'awaiting_transfer' ||
      (bk.status === 'expired' && bk.startsAt > now)
    ) {
      if (bk.status === 'expired' && this.slotConflict(bk.startsAt, bk.endsAt, bk.id)) {
        return { result: 'slot_taken', ...ref, booking_status: bk.status };
      }
      bk.status = 'awaiting_transfer';
      bk.atmBankCode = a.bankCode;
      bk.atmAccount = a.account;
      bk.atmExpiresAt = a.expiresAt;
      bk.holdExpiresAt = a.expiresAt;
      bk.transferInfoSentAt = null;
      return { result: 'issued', ...ref, booking_status: 'awaiting_transfer' };
    }
    return { result: 'ignored', ...ref, booking_status: bk.status };
  }

  async markPaymentFailed(a: {
    provider: Provider;
    tradeNo: string;
    event: string;
    raw: Record<string, unknown>;
  }): Promise<FailedResult> {
    this.calls.push(`markPaymentFailed:${a.event}`);
    const pay = this.payments.find((x) => x.provider === a.provider && x.tradeNo === a.tradeNo);
    if (!pay) return { result: 'not_found' };
    const wasInit = pay.status === 'init';
    pay.raw = { ...pay.raw, [a.event]: a.raw };
    if (wasInit) pay.status = 'failed';
    const bk = this.bookings.find((x) => x.id === pay.bookingId)!;
    return { result: wasInit ? 'failed' : 'ignored', booking_id: bk.id, order_no: bk.orderNo };
  }
}
