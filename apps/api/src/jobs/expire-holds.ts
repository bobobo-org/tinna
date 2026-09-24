import type { AppDeps } from '../deps';
import { errorFields } from '../lib/log';
import { HOUR_MS, MINUTE_MS } from '../lib/time';
import { reconcileLinePay } from '../services/linepay';
import { notifyAdminNewOrder, sendConfirmation, sendTransferInfo } from '../services/notify';

// 程序內背景工作（每 5 分鐘，啟動時先跑一次）：
//  1. pending_payment / awaiting_transfer 且 hold_expires_at < now() → expired，時段自動釋出
//  2. 補寄沒寄成功的確認信／轉帳資訊信／老師新訂單通知（Resend Idempotency-Key 防止 24 小時內重複寄出）
//  3. LINE Pay 對帳：結果不明或使用者沒回到 confirmUrl 的付款，查詢 LINE Pay 後收尾

export const JOB_INTERVAL_MS = 5 * MINUTE_MS;

type Deps = Pick<AppDeps, 'db' | 'mailer' | 'env' | 'logger' | 'defer' | 'now' | 'linepay'>;

export async function runExpireHolds(deps: Deps): Promise<number> {
  const n = await deps.db.expireStaleHolds();
  if (n > 0) deps.logger.info('job.expired_holds', { count: n });
  // VIP／商店訂單：保留逾時未付款 → expired（不占時段也不占庫存，只是讓後台看得清楚）
  const o = await deps.db.expireStaleOrders(deps.now());
  if (o > 0) deps.logger.info('job.expired_orders', { count: o });
  return n;
}

export async function retryUnsentEmails(deps: Deps): Promise<void> {
  const now = deps.now();
  const confirmIds = await deps.db.listUnsentConfirmations(
    new Date(now.getTime() - 24 * HOUR_MS),
    new Date(now.getTime() - 2 * MINUTE_MS), // 剛確認的交給即時寄信，不搶
  );
  for (const id of confirmIds) {
    const ok = await sendConfirmation(deps, id);
    deps.logger.info('job.retry_confirmation', { booking: id, ok });
  }
  const transferIds = await deps.db.listUnsentTransferInfos(now);
  for (const id of transferIds) {
    const ok = await sendTransferInfo(deps, id);
    deps.logger.info('job.retry_transfer_info', { booking: id, ok });
  }
  if (deps.env.mail.adminEmails.length > 0) {
    const adminIds = await deps.db.listUnsentAdminNotifications(
      new Date(now.getTime() - 24 * HOUR_MS),
      new Date(now.getTime() - 2 * MINUTE_MS),
    );
    for (const id of adminIds) {
      const ok = await notifyAdminNewOrder(deps, id);
      deps.logger.info('job.retry_admin_notification', { booking: id, ok });
    }
  }
}

export async function runJobsOnce(deps: Deps): Promise<void> {
  try {
    await runExpireHolds(deps);
  } catch (e) {
    deps.logger.error('job.expire_holds_failed', errorFields(e));
  }
  try {
    await retryUnsentEmails(deps);
  } catch (e) {
    deps.logger.error('job.retry_emails_failed', errorFields(e));
  }
  try {
    await reconcileLinePay(deps);
  } catch (e) {
    deps.logger.error('job.reconcile_linepay_failed', errorFields(e));
  }
}

/** 啟動背景工作；回傳停止函式 */
export function startJobs(deps: Deps, intervalMs = JOB_INTERVAL_MS): () => void {
  let running = false;
  const tick = async () => {
    if (running) return; // 上一輪還沒跑完就跳過
    running = true;
    try {
      await runJobsOnce(deps);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
