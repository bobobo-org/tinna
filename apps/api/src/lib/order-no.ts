import { randomInt } from 'node:crypto';

// 去除易混淆字元：0/O、1/I/L
export const ORDER_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ORDER_NO_RE = /^YS[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

function randomChars(n: number, alphabet = ORDER_ALPHABET): string {
  let out = '';
  for (let i = 0; i < n; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** 訂單編號：'YS' + 8 碼隨機（crypto 亂數，不是流水號） */
export function generateOrderNo(): string {
  return `YS${randomChars(8)}`;
}

export function isOrderNo(s: string): boolean {
  return ORDER_NO_RE.test(s);
}

/**
 * 每次付款嘗試用的交易編號（綠界 MerchantTradeNo／LINE Pay orderId）。
 * 綠界限 20 字英數字且不可重複；測試特店是所有開發者共用，所以後 10 碼用亂數。
 */
export function generateTradeNo(orderNo: string): string {
  return `${orderNo}${randomChars(10)}`;
}

/** 從交易編號取回訂單編號（只用在找不到資料時組導回網址） */
export function orderNoFromTradeNo(tradeNo: string | undefined | null): string | null {
  if (!tradeNo) return null;
  const head = tradeNo.slice(0, 10);
  return isOrderNo(head) ? head : null;
}
