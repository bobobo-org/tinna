import type { PayMethod } from '../db/types';
import { HOUR_MS, MINUTE_MS } from './time';

// 預約與付款的營運規則（集中管理；docs/API.md 同步）

/** 付款前保留時段多久：信用卡／LINE Pay 15 分鐘；ATM 取號前 30 分鐘（取號後改為繳費期限，見 0002 apply_atm_issued） */
export const HOLD_MS: Record<PayMethod, number> = {
  card: 15 * MINUTE_MS,
  line: 15 * MINUTE_MS,
  atm: 30 * MINUTE_MS,
};

/** ATM 只接受諮詢開始 72 小時以後的時段 */
export const ATM_MIN_LEAD_HOURS = 72;

/** 同一顧客（Email 或電話，正規化後）最多幾筆未付款保留 */
export const MAX_PENDING_PER_CUSTOMER = 2;

/** 全站未付款 ATM（取號前 + 待轉帳）上限；超過時 ATM 暫停收單 */
export const MAX_PENDING_ATM = 5;

/** POST /bookings：每個 IP 每小時（台灣行動網路大量 CGNAT 共用 IP，所以放寬） */
export const BOOKING_RATE_LIMIT = { limit: 30, windowMs: HOUR_MS };

/** 付款端點：每個「IP＋訂單編號」每 10 分鐘 */
export const PAYMENT_RATE_LIMIT = { limit: 10, windowMs: 10 * MINUTE_MS };

/** 每筆訂單最多幾次付款嘗試（綠界 MerchantTradeNo 不可重複，每次 checkout 都是一次嘗試） */
export const MAX_PAYMENT_ATTEMPTS = 10;
