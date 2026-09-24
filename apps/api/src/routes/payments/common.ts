import type { BookingPublic } from '../../db/types';

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
