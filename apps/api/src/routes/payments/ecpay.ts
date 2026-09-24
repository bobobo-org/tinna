import { Hono, type Context } from 'hono';
import type { AppDeps } from '../../deps';
import type { PayMethod } from '../../db/types';
import {
  buildCheckoutFields,
  parseFormBody,
  verifyCheckMacValue,
  type EcpayParams,
} from '../../lib/ecpay';
import { apiError, readJsonObject } from '../../lib/http';
import { errorFields } from '../../lib/log';
import { generateTradeNo, isOrderNo, orderNoFromTradeNo } from '../../lib/order-no';
import { parseEcpayDateTime } from '../../lib/time';
import { afterAtmIssued, afterPaid } from '../../services/notify';
import { checkPayable, itemName, successUrl } from './common';

// 綠界全方位金流：checkout 產生表單欄位；四個回呼驗簽後交給 SQL 函式做冪等狀態轉換。
//   notify       ReturnURL（server）         → 回 1|OK
//   result       OrderResultURL（瀏覽器 POST）→ 303 完成頁
//   atm-info     PaymentInfoURL（server）     → 回 1|OK
//   atm-redirect ClientRedirectURL（瀏覽器）  → 303 完成頁

type Verified = { ok: true; params: EcpayParams } | { ok: false; params: EcpayParams; reason: string };

const amountOf = (s: string | undefined): number => (s && /^\d+$/.test(s) ? Number(s) : -1);

export function ecpayRoutes(deps: AppDeps) {
  const app = new Hono();

  async function verify(c: Context, endpoint: string): Promise<Verified> {
    const params = parseFormBody(await c.req.text());
    const cfg = deps.env.ecpay;
    if (!cfg) return { ok: false, params, reason: 'disabled' };
    if (!verifyCheckMacValue(params, cfg.hashKey, cfg.hashIv)) {
      deps.logger.warn('ecpay.bad_signature', { endpoint, trade_no: params.MerchantTradeNo });
      return { ok: false, params, reason: 'checkmac' };
    }
    if (params.MerchantID !== cfg.merchantId) {
      deps.logger.warn('ecpay.wrong_merchant', { endpoint, trade_no: params.MerchantTradeNo });
      return { ok: false, params, reason: 'merchant' };
    }
    if (!params.MerchantTradeNo) return { ok: false, params, reason: 'trade_no' };
    return { ok: true, params };
  }

  /** 付款結果（notify / result 共用）；回傳訂單編號 */
  async function handlePayment(params: EcpayParams, event: 'notify' | 'result'): Promise<string | null> {
    const cfg = deps.env.ecpay!;
    const tradeNo = params.MerchantTradeNo!;
    if (params.RtnCode === '1') {
      if (params.SimulatePaid === '1' && cfg.env === 'prod') {
        // 廠商後台「模擬付款」不是真的付款（綠界文件：請勿變更訂單狀態）
        deps.logger.warn('ecpay.simulated_paid_ignored', { event, trade_no: tradeNo });
        return orderNoFromTradeNo(tradeNo);
      }
      const r = await deps.db.applyPaymentPaid({
        provider: 'ecpay',
        tradeNo,
        amount: amountOf(params.TradeAmt),
        providerTxnId: params.TradeNo || null,
        event,
        raw: params,
      });
      afterPaid(deps, r, { provider: 'ecpay', tradeNo, event });
      return r.order_no ?? orderNoFromTradeNo(tradeNo);
    }
    // 非 1：信用卡授權失敗才標記 failed；ATM 的付款通知只有入帳成功才有意義，其他代碼不改狀態
    const payment = await deps.db.getPayment('ecpay', tradeNo);
    if (payment?.method === 'atm') {
      deps.logger.warn('payment.atm_notice_ignored', { event, trade_no: tradeNo, rtn_code: params.RtnCode });
      return orderNoFromTradeNo(tradeNo);
    }
    const r = await deps.db.markPaymentFailed({ provider: 'ecpay', tradeNo, event, raw: params });
    deps.logger.info('payment.failed', { event, order: r.order_no ?? null, rtn_code: params.RtnCode, result: r.result });
    return r.order_no ?? orderNoFromTradeNo(tradeNo);
  }

  /** ATM 取號結果（atm-info / atm-redirect 共用） */
  async function handleAtmInfo(params: EcpayParams, event: 'atm_info' | 'atm_redirect'): Promise<string | null> {
    const tradeNo = params.MerchantTradeNo!;
    if (params.RtnCode !== '2') {
      const r = await deps.db.markPaymentFailed({ provider: 'ecpay', tradeNo, event, raw: params });
      deps.logger.info('payment.atm_failed', { event, order: r.order_no ?? null, rtn_code: params.RtnCode });
      return r.order_no ?? orderNoFromTradeNo(tradeNo);
    }
    const expiresAt = parseEcpayDateTime(params.ExpireDate ?? '');
    if (!expiresAt || !params.vAccount) {
      deps.logger.warn('ecpay.atm_info_malformed', { event, trade_no: tradeNo });
      return orderNoFromTradeNo(tradeNo);
    }
    const r = await deps.db.applyAtmIssued({
      tradeNo,
      amount: amountOf(params.TradeAmt),
      providerTxnId: params.TradeNo || null,
      bankCode: params.BankCode ?? '',
      account: params.vAccount,
      expiresAt,
      event,
      raw: params,
    });
    afterAtmIssued(deps, r, { tradeNo, event });
    return r.order_no ?? orderNoFromTradeNo(tradeNo);
  }

  app.post('/payments/ecpay/checkout', async (c) => {
    const cfg = deps.env.ecpay;
    const apiUrl = deps.env.apiUrl;
    if (!cfg || !apiUrl) {
      return apiError(c, 503, 'payment_unavailable', '線上付款暫停服務，請稍後再試');
    }
    const body = await readJsonObject(c);
    const orderNo = typeof body?.orderNo === 'string' ? body.orderNo.toUpperCase() : '';
    if (!isOrderNo(orderNo)) {
      return apiError(c, 400, 'validation', '訂單編號不正確', { orderNo: '訂單編號不正確' });
    }
    const b = await deps.db.getBookingPublic(orderNo);
    if (!b) return apiError(c, 404, 'not_found', '找不到這筆訂單');
    if (b.payMethod === 'line') {
      return apiError(c, 409, 'invalid_method', '這筆訂單選擇 LINE Pay 付款，請改用 LINE Pay');
    }
    const now = deps.now();
    const blocked = checkPayable(b, now);
    if (blocked) return apiError(c, blocked.status, blocked.error, blocked.message);

    const method = b.payMethod as Exclude<PayMethod, 'line'>;
    const tradeNo = generateTradeNo(orderNo);
    const fields = buildCheckoutFields(cfg, {
      method,
      tradeNo,
      orderNo,
      amount: b.amount,
      itemName: itemName(b),
      tradeDate: now,
      apiUrl,
      webUrl: deps.env.webUrl,
    });
    await deps.db.insertPayment({
      bookingId: b.id,
      provider: 'ecpay',
      method,
      tradeNo,
      amount: b.amount,
      raw: {
        checkout: {
          MerchantTradeNo: fields.MerchantTradeNo,
          MerchantTradeDate: fields.MerchantTradeDate,
          TotalAmount: fields.TotalAmount,
          ChoosePayment: fields.ChoosePayment,
        },
      },
    });
    deps.logger.info('payment.checkout', { order: orderNo, provider: 'ecpay', method, trade_no: tradeNo });
    return c.json({ action: cfg.checkoutUrl, fields });
  });

  app.post('/payments/ecpay/notify', async (c) => {
    const v = await verify(c, 'notify');
    if (!v.ok) return c.text(v.reason === 'disabled' ? '0|disabled' : '0|CheckMacValue Error', 400);
    await handlePayment(v.params, 'notify');
    return c.text('1|OK');
  });

  /** 瀏覽器導回的端點：處理失敗也照樣導到完成頁（完成頁會輪詢狀態），server 端通知會再補上 */
  async function browserRedirect(
    c: Context,
    endpoint: 'result' | 'atm_redirect',
    handle: (p: EcpayParams) => Promise<string | null>,
  ) {
    const v = await verify(c, endpoint);
    let orderNo = orderNoFromTradeNo(v.params.MerchantTradeNo);
    if (v.ok) {
      try {
        orderNo = (await handle(v.params)) ?? orderNo;
      } catch (e) {
        deps.logger.error('ecpay.redirect_handler_failed', {
          endpoint,
          trade_no: v.params.MerchantTradeNo,
          ...errorFields(e),
        });
      }
    }
    return c.redirect(successUrl(deps.env.webUrl, orderNo), 303);
  }

  app.post('/payments/ecpay/result', (c) => browserRedirect(c, 'result', (p) => handlePayment(p, 'result')));

  app.post('/payments/ecpay/atm-info', async (c) => {
    const v = await verify(c, 'atm_info');
    if (!v.ok) return c.text(v.reason === 'disabled' ? '0|disabled' : '0|CheckMacValue Error', 400);
    await handleAtmInfo(v.params, 'atm_info');
    return c.text('1|OK');
  });

  app.post('/payments/ecpay/atm-redirect', (c) =>
    browserRedirect(c, 'atm_redirect', (p) => handleAtmInfo(p, 'atm_redirect')),
  );

  return app;
}
