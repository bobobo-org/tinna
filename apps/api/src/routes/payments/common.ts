import type { Context } from 'hono';
import type { AppDeps } from '../../deps';
import type { BookingPublic } from '../../db/types';
import { apiError, requestIp } from '../../lib/http';
import { MAX_PAYMENT_ATTEMPTS } from '../../lib/policy';
import { rateLimitKey } from '../../lib/rate-limit';

export const MSG_TOO_MANY_ATTEMPTS = '付款嘗試次數已達上限，請聯繫客服協助處理';

/** 付款端點限流：每個「IP＋訂單編號」（超過回 429 rate_limited） */
export function paymentRateLimited(deps: AppDeps, c: Context, orderNo: string): Response | null {
  const rl = deps.paymentLimiter.hit(`${rateLimitKey(requestIp(c))}|${orderNo}`);
  if (rl.allowed) return null;
  c.header('Retry-After', String(rl.retryAfterSec));
  deps.logger.warn('payment.rate_limited', { order: orderNo, retry_after: rl.retryAfterSec });
  return apiError(c, 429, 'rate_limited', '操作太頻繁，請稍後再試');
}

/** 同一訂單有結果不明（已標記）的付款時，不再開新的付款，避免重複扣款 → 409 payment_under_review */
export function paymentUnderReview(
  deps: AppDeps,
  c: Context,
  orderNo: string,
  attempts: { status: string; attentionReason: string | null }[],
): Response | null {
  if (!attempts.some((p) => p.status === 'init' && p.attentionReason)) return null;
  deps.logger.warn('payment.under_review_blocked', { order: orderNo });
  return apiError(c, 409, 'payment_under_review', '付款結果確認中，請勿重複付款，我們會盡快與您聯繫');
}

/** 每筆訂單的付款嘗試上限（超過回 429 too_many_attempts） */
export function attemptsExceeded(deps: AppDeps, c: Context, orderNo: string, attempts: number): Response | null {
  if (attempts < MAX_PAYMENT_ATTEMPTS) return null;
  deps.logger.warn('payment.too_many_attempts', { order: orderNo, attempts });
  return apiError(c, 429, 'too_many_attempts', MSG_TOO_MANY_ATTEMPTS);
}

export interface Blocked {
  status: 409;
  error: string;
  message: string;
}

/** 付款前檢查：只接受 pending_payment 且 hold 未逾時 */
export function checkPayable(b: BookingPublic, now: Date): Blocked | null {
  switch (b.status) {
    case 'pending_payment':
      if (b.holdExpiresAt && b.holdExpiresAt.getTime() <= now.getTime()) {
        return { status: 409, error: 'expired', message: '預約保留時間已過，請重新預約' };
      }
      return null;
    case 'confirmed':
      return { status: 409, error: 'already_paid', message: '這筆訂單已完成付款' };
    case 'awaiting_transfer':
      return { status: 409, error: 'awaiting_transfer', message: '這筆訂單已取得轉帳帳號，請依帳號完成轉帳' };
    default:
      return { status: 409, error: 'expired', message: '預約保留時間已過，請重新預約' };
  }
}

export function successUrl(webUrl: string, orderNo: string | null): string {
  return orderNo ? `${webUrl}/booking/success?order=${orderNo}` : `${webUrl}/`;
}

export function itemName(b: BookingPublic): string {
  return `${b.service.name} ${b.service.minutes}分鐘線上諮詢`;
}
