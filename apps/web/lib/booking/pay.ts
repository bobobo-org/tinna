/**
 * 前往金流付款頁（卡號只在綠界／LINE Pay 頁面輸入，不經過本站）
 *
 * - 信用卡／ATM：POST /payments/ecpay/checkout → 用回傳的 action + fields 建
 *   <form method="POST">（全部 hidden input）submit，整頁導向綠界
 * - LINE Pay：POST /payments/linepay/request → location.href = paymentUrl
 * - 導向前檢查網址是綠界／LINE Pay 的 https 網域（API 回應被竄改也不會把人導去別處）
 */

import { ApiError, api, type ApiClient } from '../api';
import type { PayMethod } from './types';

export function isAllowedEcpayAction(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'ecpay.com.tw' || u.hostname.endsWith('.ecpay.com.tw'));
  } catch {
    return false;
  }
}

export function isAllowedLinePayUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'line.me' || u.hostname.endsWith('.line.me'));
  } catch {
    return false;
  }
}

/** 建一個 POST 表單（每個欄位一個 hidden input）並送出；回傳表單方便測試 */
export function submitPostForm(action: string, fields: Record<string, string>, doc: Document = document): HTMLFormElement {
  const form = doc.createElement('form');
  form.method = 'POST';
  form.action = action;
  form.acceptCharset = 'UTF-8';
  form.style.display = 'none';
  for (const [name, value] of Object.entries(fields)) {
    const input = doc.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  doc.body.appendChild(form);
  form.submit();
  return form;
}

const MSG_BAD_REDIRECT = '付款頁網址異常，已停止導向，請稍後再試';

/**
 * 導向付款頁。成功時頁面即將離開（回傳 'redirecting'）；失敗丟 ApiError
 * （呼叫端依 error code 處理：already_paid / awaiting_transfer / expired / payment_unavailable…）
 */
export async function goToPayment(
  orderNo: string,
  method: PayMethod,
  client: ApiClient = api,
  nav: { assign: (url: string) => void; post: (action: string, fields: Record<string, string>) => void } = {
    assign: (url) => window.location.assign(url),
    post: (action, fields) => {
      submitPostForm(action, fields);
    },
  },
): Promise<'redirecting'> {
  if (method === 'line') {
    const { paymentUrl } = await client.linepayRequest(orderNo);
    if (!isAllowedLinePayUrl(paymentUrl)) throw new ApiError(502, 'bad_redirect', MSG_BAD_REDIRECT);
    nav.assign(paymentUrl);
    return 'redirecting';
  }
  const { action, fields } = await client.ecpayCheckout(orderNo);
  if (!isAllowedEcpayAction(action) || !fields || typeof fields !== 'object') {
    throw new ApiError(502, 'bad_redirect', MSG_BAD_REDIRECT);
  }
  nav.post(action, fields);
  return 'redirecting';
}
