import { randomInt } from 'node:crypto';
import { ORDER_ALPHABET } from './order-no';
import { taipeiDate } from './time';

// VIP 卡號：VIP-XXXX-XXXX（去除易混淆字元，crypto 亂數；卡號＋購買時的 Email 才能用堂數）

export const VIP_CARD_RE = /^VIP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

export function generateVipCardNo(): string {
  const part = () => Array.from({ length: 4 }, () => ORDER_ALPHABET[randomInt(ORDER_ALPHABET.length)]).join('');
  return `VIP-${part()}-${part()}`;
}

/** 使用者輸入 → 標準格式（去空白、轉大寫、補上連字號）；格式不對回 null */
export function normalizeVipCard(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const body = compact.startsWith('VIP') ? compact.slice(3) : compact;
  if (body.length !== 8) return null;
  const card = `VIP-${body.slice(0, 4)}-${body.slice(4)}`;
  return VIP_CARD_RE.test(card) ? card : null;
}

/**
 * 到期日（顯示用，台北時間）：到期時間的前一毫秒那天
 * 後台設定「有效至 12/31」存成 1/1 00:00（含當天），付款發卡則是付款時間＋天數
 */
export function expiryDate(expiresAt: Date): string {
  return taipeiDate(new Date(expiresAt.getTime() - 1));
}

