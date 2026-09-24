import { createHmac, randomUUID } from 'node:crypto';
import type { LinePayConfig } from '../env';

// LINE Pay Online API v3（developers-pay.line.me/online-api-v3）
// X-LINE-Authorization = Base64(HMAC-SHA256(ChannelSecret, ChannelSecret + URI + RequestBody + nonce))
// GET 時 RequestBody 改為 query string。

export function linePaySignature(
  channelSecret: string,
  uri: string,
  bodyOrQuery: string,
  nonce: string,
): string {
  return createHmac('sha256', channelSecret)
    .update(channelSecret + uri + bodyOrQuery + nonce, 'utf8')
    .digest('base64');
}

/**
 * transactionId 是 19 位整數，超過 JS 安全整數範圍；
 * 依官方建議，在 JSON.parse 之前把 16 位以上的數字轉成字串。
 */
export function parseLinePayJson(text: string): unknown {
  return JSON.parse(text.replace(/:\s*(\d{16,})\b/g, ': "$1"'));
}

export const TRANSACTION_ID_RE = /^\d{1,20}$/;

export interface LinePayResult<T> {
  returnCode: string;
  returnMessage: string;
  info?: T;
}

export interface LinePayRequestInfo {
  paymentUrl: { web: string; app?: string };
  transactionId: string;
  paymentAccessToken?: string;
}

export interface LinePayConfirmInfo {
  orderId: string;
  transactionId: string;
  payInfo?: { method: string; amount: number }[];
}

/**
 * Check payment request status 的 returnCode：
 * 0000 尚未完成 LINE Pay 認證｜0110 已認證、可以 Confirm｜0121 使用者取消或逾時｜0122 付款失敗｜0123 付款已完成
 */
export const LINEPAY_STATUS = {
  waiting: '0000',
  authorized: '0110',
  cancelled: '0121',
  failed: '0122',
  completed: '0123',
} as const;

export class LinePayError extends Error {
  constructor(message: string, readonly kind: 'http' | 'network' | 'format') {
    super(message);
    this.name = 'LinePayError';
  }
}

export interface LinePayRequestInput {
  tradeNo: string; // orderId（每次請求唯一；LINE Pay 不接受重複 orderId）
  orderNo: string;
  amount: number;
  serviceId: string;
  productName: string;
  confirmUrl: string;
  cancelUrl: string;
}

export function buildLinePayRequestBody(i: LinePayRequestInput) {
  return {
    amount: i.amount,
    currency: 'TWD',
    orderId: i.tradeNo,
    packages: [
      {
        id: i.orderNo,
        amount: i.amount,
        name: '緣舍命理',
        products: [{ id: i.serviceId, name: i.productName, quantity: 1, price: i.amount }],
      },
    ],
    redirectUrls: { confirmUrl: i.confirmUrl, cancelUrl: i.cancelUrl },
  };
}

export class LinePayClient {
  constructor(
    private readonly cfg: LinePayConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(
    method: 'GET' | 'POST',
    uri: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<LinePayResult<T>> {
    // POST 簽 body；GET 簽 query string（這裡用到的 GET 都沒有 query，簽空字串）
    const json = method === 'POST' ? JSON.stringify(body) : '';
    const nonce = randomUUID();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.apiBase}${uri}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-LINE-ChannelId': this.cfg.channelId,
          'X-LINE-Authorization-Nonce': nonce,
          'X-LINE-Authorization': linePaySignature(this.cfg.channelSecret, uri, json, nonce),
        },
        ...(method === 'POST' ? { body: json } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new LinePayError(`network: ${(e as Error).name}`, 'network');
    }
    const text = await res.text();
    if (!res.ok) throw new LinePayError(`http ${res.status}`, 'http');
    let data: unknown;
    try {
      data = parseLinePayJson(text);
    } catch {
      throw new LinePayError('invalid json', 'format');
    }
    const r = data as Partial<LinePayResult<T>>;
    if (typeof r.returnCode !== 'string') throw new LinePayError('missing returnCode', 'format');
    return { returnCode: r.returnCode, returnMessage: String(r.returnMessage ?? ''), info: r.info };
  }

  /** Request API：讀取逾時官方建議至少 10 秒 */
  requestPayment(input: LinePayRequestInput): Promise<LinePayResult<LinePayRequestInfo>> {
    return this.call<LinePayRequestInfo>('POST', '/v3/payments/request', buildLinePayRequestBody(input), 20_000);
  }

  /** Confirm API：讀取逾時官方建議至少 40 秒 */
  confirmPayment(transactionId: string, amount: number): Promise<LinePayResult<LinePayConfirmInfo>> {
    if (!TRANSACTION_ID_RE.test(transactionId)) {
      return Promise.reject(new LinePayError('invalid transactionId', 'format'));
    }
    return this.call<LinePayConfirmInfo>(
      'POST',
      `/v3/payments/${transactionId}/confirm`,
      { amount, currency: 'TWD' },
      45_000,
    );
  }

  /** Check payment request status：對帳用（結果不明、或使用者沒回到 confirmUrl） */
  checkRequestStatus(transactionId: string): Promise<LinePayResult<unknown>> {
    if (!TRANSACTION_ID_RE.test(transactionId)) {
      return Promise.reject(new LinePayError('invalid transactionId', 'format'));
    }
    return this.call<unknown>('GET', `/v3/payments/requests/${transactionId}/check`, null, 20_000);
  }
}
