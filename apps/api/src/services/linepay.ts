import type { AppDeps } from '../deps';
import type { PaidResult, PaymentRow } from '../db/types';
import { activeIntervals, isSlotBusy } from '../lib/availability';
import { LINEPAY_STATUS } from '../lib/linepay';
import { errorFields } from '../lib/log';
import { orderNoFromTradeNo } from '../lib/order-no';
import { HOUR_MS, MINUTE_MS } from '../lib/time';
import { afterPaid, alertAdmin } from './notify';

// LINE Pay Confirm 與對帳（使用者導回 confirmUrl 與背景工作共用）。
// 原則：
//  * Confirm 之前先確認這筆預約還能確認（LINE Pay 在 Confirm 前只是授權，不 Confirm 就不會扣款）
//  * Confirm 回非 0000 時先查交易狀態，已完成（0123）就照付款成功處理，不直接標失敗
//  * Confirm 結果不明（逾時／斷線）或扣款後寫 DB 失敗 → 付款維持 init，由背景對帳補上

type Deps = Pick<AppDeps, 'db' | 'mailer' | 'env' | 'logger' | 'defer' | 'now' | 'linepay'>;

export type ConfirmOutcome = 'paid' | 'failed' | 'skipped' | 'unknown';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 扣款成功後寫 DB：短暫錯誤重試 3 次；仍失敗就留給背景對帳並通知老師 */
async function recordPaid(
  deps: Deps,
  payment: PaymentRow,
  transactionId: string,
  event: string,
  raw: Record<string, unknown>,
): Promise<PaidResult | null> {
  const delays = [0, 300, 1000];
  for (const [i, delay] of delays.entries()) {
    if (delay) await sleep(delay);
    try {
      return await deps.db.applyPaymentPaid({
        provider: 'linepay',
        tradeNo: payment.tradeNo,
        amount: payment.amount, // Confirm API 以此金額請款，LINE Pay 會比對原請求金額
        providerTxnId: transactionId,
        event,
        raw,
      });
    } catch (e) {
      deps.logger.error('linepay.record_paid_failed', { attempt: i + 1, trade_no: payment.tradeNo, ...errorFields(e) });
    }
  }
  const orderNo = orderNoFromTradeNo(payment.tradeNo);
  deps.defer('admin_alert', () =>
    alertAdmin(deps, {
      orderNo,
      reason: 'linepay_confirm_unknown',
      detail: `LINE Pay 已扣款但寫入資料庫失敗，背景對帳會重試（transactionId ${transactionId}）`,
    }),
  );
  return null;
}

/**
 * 付款結果不明：標在這次付款與預約上（needsAttention），第一次標記時通知老師（之後重試不再重複通知）。
 * 付款之後有了結果（成功／確定失敗）會由 SQL 自動解除標記。
 */
async function flagUnknown(deps: Deps, payment: PaymentRow, event: string, raw: Record<string, unknown>, detail: string) {
  const orderNo = orderNoFromTradeNo(payment.tradeNo);
  try {
    const f = await deps.db.flagPaymentAttention({
      provider: 'linepay',
      tradeNo: payment.tradeNo,
      event: `${event}_unknown`,
      raw,
      reason: 'linepay_confirm_unknown',
    });
    if (f.result !== 'flagged') return;
  } catch (e) {
    deps.logger.error('linepay.flag_failed', { order: orderNo, ...errorFields(e) });
  }
  deps.defer('admin_alert', () => alertAdmin(deps, { orderNo, reason: 'linepay_confirm_unknown', detail }));
}

/** 這筆預約現在還能不能確認（不能就不要 Confirm，免得扣款後還要退款） */
async function isConfirmable(deps: Deps, payment: PaymentRow): Promise<{ ok: boolean; reason?: string }> {
  const orderNo = orderNoFromTradeNo(payment.tradeNo);
  const b = orderNo ? await deps.db.getBookingPublic(orderNo) : null;
  if (!b) return { ok: false, reason: 'booking_not_found' };
  if (b.status === 'pending_payment') return { ok: true };
  if (b.status !== 'expired') return { ok: false, reason: `booking_${b.status}` };
  const now = deps.now();
  if (b.startsAt.getTime() <= now.getTime()) return { ok: false, reason: 'booking_past' };
  // 保留逾時：時段還空著才確認（SQL 會補確認）；被別人約走就不扣款
  const busy = await deps.db.listBusyBookings(
    new Date(b.startsAt.getTime() - 24 * HOUR_MS),
    new Date(b.endsAt.getTime() + 24 * HOUR_MS),
  );
  const minutes = Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / MINUTE_MS);
  if (isSlotBusy(b.startsAt, activeIntervals(busy, now), minutes)) return { ok: false, reason: 'slot_taken' };
  return { ok: true };
}

export async function confirmLinePay(
  deps: Deps,
  payment: PaymentRow,
  transactionId: string,
  event: 'confirm' | 'reconcile',
): Promise<ConfirmOutcome> {
  const client = deps.linepay!;
  const orderNo = orderNoFromTradeNo(payment.tradeNo);

  const can = await isConfirmable(deps, payment);
  if (!can.ok) {
    await deps.db.markPaymentFailed({
      provider: 'linepay',
      tradeNo: payment.tradeNo,
      event: `${event}_skipped`,
      raw: { reason: can.reason },
    });
    deps.logger.warn('linepay.confirm_skipped', { order: orderNo, reason: can.reason });
    return 'skipped';
  }

  let res;
  try {
    res = await client.confirmPayment(transactionId, payment.amount);
  } catch (e) {
    deps.logger.error('linepay.confirm_error', { order: orderNo, event, ...errorFields(e) });
    await flagUnknown(deps, payment, event, { error: (e as Error).name },
      `Confirm 無回應，背景對帳會每 5 分鐘查詢（transactionId ${transactionId}）`);
    return 'unknown';
  }

  if (res.returnCode === '0000') {
    const r = await recordPaid(deps, payment, transactionId, event, {
      returnCode: res.returnCode,
      payInfo: res.info?.payInfo ?? [],
    });
    if (!r) return 'unknown';
    afterPaid(deps, r, { provider: 'linepay', tradeNo: payment.tradeNo, event });
    return 'paid';
  }

  // 非 0000（例如重複 Confirm）：先查實際狀態再決定
  let status: string | null = null;
  try {
    status = (await client.checkRequestStatus(transactionId)).returnCode;
  } catch (e) {
    deps.logger.error('linepay.check_error', { order: orderNo, ...errorFields(e) });
    await flagUnknown(deps, payment, event, { returnCode: res.returnCode, check: 'error' },
      `Confirm 回 ${res.returnCode}，查詢交易狀態失敗，背景對帳會繼續查詢（transactionId ${transactionId}）`);
    return 'unknown';
  }
  if (status === LINEPAY_STATUS.completed) {
    const r = await recordPaid(deps, payment, transactionId, event, { returnCode: res.returnCode, check: status });
    if (!r) return 'unknown';
    afterPaid(deps, r, { provider: 'linepay', tradeNo: payment.tradeNo, event });
    return 'paid';
  }
  // 只有 0121（取消／逾時）與 0122（付款失敗）是確定失敗
  if (status === LINEPAY_STATUS.cancelled || status === LINEPAY_STATUS.failed) {
    const f = await deps.db.markPaymentFailed({
      provider: 'linepay',
      tradeNo: payment.tradeNo,
      event,
      raw: { returnCode: res.returnCode, returnMessage: res.returnMessage, check: status },
    });
    deps.logger.warn('linepay.confirm_failed', { order: orderNo, return_code: res.returnCode, check: status, result: f.result });
    return 'failed';
  }
  // 0110／0000（還沒扣款也還沒結束）或其他代碼（1104、1105、9000…狀態不明）
  // → 維持 init 交給背景對帳（24 小時內每 5 分鐘），標記人工處理並通知老師（只通知一次）
  deps.logger.warn('linepay.confirm_retry_later', { order: orderNo, return_code: res.returnCode, check: status });
  await flagUnknown(deps, payment, event, { returnCode: res.returnCode, returnMessage: res.returnMessage, check: status },
    `Confirm 回 ${res.returnCode}、查詢交易狀態回 ${status}，背景對帳會繼續處理（transactionId ${transactionId}）`);
  return 'unknown';
}

export type PendingOutcome = 'paid' | 'open' | 'closed' | 'unknown';

/**
 * 查一筆 init 的 LINE Pay 付款實際狀態並收尾：
 *   0123 已完成 → 記為付款成功｜0110 已認證 → 補 Confirm｜0121/0122 → 失敗｜0000 → 使用者還沒付（open）
 */
export async function resolvePendingLinePay(deps: Deps, p: PaymentRow): Promise<PendingOutcome> {
  const client = deps.linepay;
  const txId = p.providerTxnId;
  if (!client || !txId) return 'unknown';
  let code: string;
  try {
    code = (await client.checkRequestStatus(txId)).returnCode;
  } catch (e) {
    deps.logger.error('linepay.check_error', { trade_no: p.tradeNo, ...errorFields(e) });
    return 'unknown';
  }
  deps.logger.info('linepay.checked', { trade_no: p.tradeNo, check: code });
  if (code === LINEPAY_STATUS.completed) {
    const r = await recordPaid(deps, p, txId, 'reconcile', { check: code });
    if (!r) return 'unknown';
    afterPaid(deps, r, { provider: 'linepay', tradeNo: p.tradeNo, event: 'reconcile' });
    return 'paid';
  }
  if (code === LINEPAY_STATUS.authorized) {
    const outcome = await confirmLinePay(deps, p, txId, 'reconcile');
    return outcome === 'paid' ? 'paid' : outcome === 'unknown' ? 'unknown' : 'closed';
  }
  if (code === LINEPAY_STATUS.cancelled || code === LINEPAY_STATUS.failed) {
    await deps.db.markPaymentFailed({ provider: 'linepay', tradeNo: p.tradeNo, event: 'reconcile', raw: { check: code } });
    return 'closed';
  }
  if (code === LINEPAY_STATUS.waiting) return 'open'; // 使用者還沒在 LINE Pay 完成付款
  deps.logger.warn('linepay.check_unknown', { trade_no: p.tradeNo, check: code }); // 1104、9000… 狀態不明
  await flagUnknown(deps, p, 'reconcile', { check: code }, `查詢交易狀態回 ${code}（transactionId ${txId}）`);
  return 'unknown';
}

/** 背景對帳：24 小時內仍是 init、已取得 transactionId 的 LINE Pay 付款 */
export async function reconcileLinePay(deps: Deps): Promise<void> {
  if (!deps.linepay) return;
  const now = deps.now();
  const rows = await deps.db.listPendingLinePay(
    new Date(now.getTime() - 24 * HOUR_MS),
    new Date(now.getTime() - 2 * MINUTE_MS),
  );
  for (const p of rows) await resolvePendingLinePay(deps, p);
}
