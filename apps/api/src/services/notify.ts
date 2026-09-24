import type { AppDeps } from '../deps';
import type { AtmIssuedResult, PaidResult, Provider } from '../db/types';
import {
  adminAlertEmail,
  adminNewOrderEmail,
  confirmationEmail,
  transferInfoEmail,
} from '../lib/emails';

// 寄信與付款結果後續處理。只有「第一次」狀態轉換（SQL 函式回 confirmed / issued）才寄信，
// 重複通知回 already_paid / already_issued，不會重複寄。

type Deps = Pick<AppDeps, 'db' | 'mailer' | 'env' | 'logger' | 'defer'>;

export async function sendConfirmation(deps: Deps, bookingId: string): Promise<boolean> {
  const b = await deps.db.getBookingFull(bookingId);
  if (!b || b.status !== 'confirmed') return false;
  if (b.confirmationSentAt) return true;
  const res = await deps.mailer.send(confirmationEmail(b, b.meetUrl ?? deps.env.meetUrl));
  if (res.ok) await deps.db.markEmailSent(b.id, 'confirmation');
  return res.ok;
}

export async function sendTransferInfo(deps: Deps, bookingId: string): Promise<boolean> {
  const b = await deps.db.getBookingFull(bookingId);
  if (!b || b.status !== 'awaiting_transfer' || !b.atmAccount) return false;
  if (b.transferInfoSentAt) return true;
  const res = await deps.mailer.send(transferInfoEmail(b));
  if (res.ok) await deps.db.markEmailSent(b.id, 'transfer_info');
  return res.ok;
}

export async function notifyAdminNewOrder(deps: Deps, bookingId: string): Promise<boolean> {
  if (deps.env.mail.adminEmails.length === 0) return false;
  const b = await deps.db.getBookingFull(bookingId);
  if (!b || b.status !== 'confirmed') return false;
  if (b.adminNotifiedAt) return true;
  const res = await deps.mailer.send(adminNewOrderEmail(b, deps.env.mail.adminEmails));
  if (res.ok) await deps.db.markEmailSent(b.id, 'admin_new_order');
  return res.ok;
}

export async function alertAdmin(
  deps: Deps,
  args: { orderNo: string | null; reason: string; detail?: string },
): Promise<void> {
  deps.logger.warn('attention.required', { order: args.orderNo, reason: args.reason });
  if (deps.env.mail.adminEmails.length === 0) return;
  await deps.mailer.send(adminAlertEmail(args, deps.env.mail.adminEmails));
}

/** apply_payment_paid 結果 → log + 寄信（背景） */
export function afterPaid(
  deps: Deps,
  r: PaidResult,
  ctx: { provider: Provider; tradeNo: string; event: string },
): void {
  const base = { order: r.order_no ?? null, provider: ctx.provider, event: ctx.event, trade_no: ctx.tradeNo };
  switch (r.result) {
    case 'confirmed': {
      deps.logger.info('payment.confirmed', { ...base, reclaimed: !!r.reclaimed });
      const id = r.booking_id!;
      deps.defer('confirmation_email', async () => {
        await sendConfirmation(deps, id);
        await notifyAdminNewOrder(deps, id);
      });
      return;
    }
    case 'already_paid':
      deps.logger.info('payment.duplicate_notice', base);
      return;
    case 'ignored':
      deps.logger.warn('payment.paid_notice_ignored', base); // 例如已退款後重送的舊回呼
      return;
    case 'amount_mismatch':
    case 'needs_attention':
      deps.logger.warn('payment.needs_attention', { ...base, reason: r.reason ?? r.result });
      deps.defer('admin_alert', () =>
        alertAdmin(deps, { orderNo: r.order_no ?? null, reason: r.reason ?? r.result }),
      );
      return;
    case 'not_found':
      deps.logger.warn('payment.unknown_trade', base);
      deps.defer('admin_alert', () =>
        alertAdmin(deps, {
          orderNo: null,
          reason: 'unknown_trade',
          detail: `${ctx.provider} 交易編號 ${ctx.tradeNo}`,
        }),
      );
      return;
  }
}

/** apply_atm_issued 結果 → log + 寄轉帳資訊信（背景） */
export function afterAtmIssued(deps: Deps, r: AtmIssuedResult, ctx: { tradeNo: string; event: string }): void {
  const base = { order: r.order_no ?? null, event: ctx.event, trade_no: ctx.tradeNo };
  switch (r.result) {
    case 'issued': {
      deps.logger.info('payment.atm_issued', base);
      const id = r.booking_id!;
      deps.defer('transfer_info_email', async () => {
        await sendTransferInfo(deps, id);
      });
      return;
    }
    case 'already_issued':
    case 'ignored':
      deps.logger.info('payment.atm_info_ignored', { ...base, result: r.result });
      return;
    case 'slot_taken':
      deps.logger.warn('payment.atm_slot_taken', base);
      return;
    case 'amount_mismatch':
      deps.logger.warn('payment.needs_attention', { ...base, reason: 'amount_mismatch' });
      deps.defer('admin_alert', () => alertAdmin(deps, { orderNo: r.order_no ?? null, reason: 'amount_mismatch' }));
      return;
    case 'not_found':
      deps.logger.warn('payment.unknown_trade', base);
      deps.defer('admin_alert', () =>
        alertAdmin(deps, { orderNo: null, reason: 'unknown_trade', detail: `ecpay 交易編號 ${ctx.tradeNo}` }),
      );
      return;
  }
}
