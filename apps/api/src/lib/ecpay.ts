import { createHash, timingSafeEqual } from 'node:crypto';
import type { EcpayConfig } from '../env';
import { formatEcpayDateTime } from './time';

// 綠界全方位金流 AioCheckOut V5
// 檢查碼規則（developers.ecpay.com.tw「檢查碼機制說明」、「URLEncode轉換表」）：
//  1. 參數（不含 CheckMacValue）依參數名稱 A→Z 排序（不分大小寫），以 & 串接 key=value
//  2. 前面加 HashKey=…&，後面加 &HashIV=…
//  3. 以 .NET HttpUtility.UrlEncode 規則編碼：空白→+；- _ . ! * ( ) 不編碼；其餘（含 ~ '）%xx
//  4. 整串轉小寫 → SHA256 → 轉大寫

export type EcpayParams = Record<string, string>;

/** .NET（綠界）URL encode：encodeURIComponent 再補上差異（空白、~、'） */
export function ecpayUrlEncode(s: string): string {
  return encodeURIComponent(s).replace(/%20/g, '+').replace(/~/g, '%7E').replace(/'/g, '%27');
}

export function computeCheckMacValue(
  params: Record<string, string | number>,
  hashKey: string,
  hashIv: string,
): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue')
    .sort((a, b) => {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  const raw = `HashKey=${hashKey}&${keys.map((k) => `${k}=${params[k]}`).join('&')}&HashIV=${hashIv}`;
  const encoded = ecpayUrlEncode(raw).toLowerCase();
  return createHash('sha256').update(encoded, 'utf8').digest('hex').toUpperCase();
}

export function verifyCheckMacValue(params: EcpayParams, hashKey: string, hashIv: string): boolean {
  const given = params.CheckMacValue;
  if (!given || !/^[0-9A-Fa-f]{64}$/.test(given)) return false;
  const expected = computeCheckMacValue(params, hashKey, hashIv);
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(given.toUpperCase(), 'utf8'));
}

export interface CheckoutInput {
  method: 'card' | 'atm';
  tradeNo: string; // MerchantTradeNo（20 字內英數字，每次不同）
  orderNo: string;
  amount: number;
  itemName: string;
  tradeDate: Date;
  apiUrl: string;
  webUrl: string;
}

export const ECPAY_TRADE_DESC = '緣舍命理線上諮詢';

/** 產生前端要 POST 到綠界的全部欄位（含 CheckMacValue） */
export function buildCheckoutFields(cfg: EcpayConfig, input: CheckoutInput): EcpayParams {
  const successUrl = `${input.webUrl}/booking/success?order=${input.orderNo}`;
  const fields: EcpayParams = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: input.tradeNo,
    MerchantTradeDate: formatEcpayDateTime(input.tradeDate),
    PaymentType: 'aio',
    TotalAmount: String(input.amount),
    TradeDesc: ECPAY_TRADE_DESC,
    ItemName: sanitizeItemName(input.itemName),
    ReturnURL: `${input.apiUrl}/payments/ecpay/notify`,
    ChoosePayment: input.method === 'card' ? 'Credit' : 'ATM',
    EncryptType: '1',
    ClientBackURL: successUrl,
    CustomField1: input.orderNo,
  };
  if (input.method === 'card') {
    // 付款完成後瀏覽器 POST 回 API，驗簽後 303 到完成頁（ATM 不支援此參數）
    fields.OrderResultURL = `${input.apiUrl}/payments/ecpay/result`;
  } else {
    fields.ExpireDate = '1'; // 繳費期限天數：隔天 23:59 截止
    fields.PaymentInfoURL = `${input.apiUrl}/payments/ecpay/atm-info`;
    fields.ClientRedirectURL = `${input.apiUrl}/payments/ecpay/atm-redirect`;
  }
  fields.CheckMacValue = computeCheckMacValue(fields, cfg.hashKey, cfg.hashIv);
  return fields;
}

/** 綠界不接受 html tag 與部分特殊符號，ItemName 上限 400 字 */
function sanitizeItemName(s: string): string {
  return s.replace(/[<>&"'#%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** 解析 application/x-www-form-urlencoded（綠界回呼；不含顧客個資，整包存進 payments.raw 供對帳） */
export function parseFormBody(text: string): EcpayParams {
  const out: EcpayParams = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}
