import { Hono, type Context } from 'hono';
import type { AppDeps } from '../deps';
import type { Order } from '../db/types';
import { buildCheckoutFields, type EcpayParams } from '../lib/ecpay';
import { apiError, readJsonObject } from '../lib/http';
import { errorFields } from '../lib/log';
import { generateTradeNo, isOrderNo, orderNoFromTradeNo } from '../lib/order-no';
import { MAX_PAYMENT_ATTEMPTS } from '../lib/policy';
import { toTaipeiIso } from '../lib/time';
import { expiryDate, generateVipCardNo } from '../lib/vip';
import { afterOrderPaid, alertAdmin } from '../services/notify';
import { paymentRateLimited } from './payments/common';
import { ECPAY_DEFINITE_FAILURES, verifyEcpayCallback } from './payments/ecpay';

// VIP／商店訂單：查詢狀態、綠界信用卡付款（checkout → notify／result 回呼）
//   notify（server，ReturnURL）→ 回 1|OK；result（瀏覽器 POST，OrderResultURL）→ 303 到網站的訂單頁

const amountOf = (s: string | undefined): number => (s && /^\d+$/.test(s) ? Number(s) : -1);

/** 訂單頁網址 */
export const orderPageUrl = (webUrl: string, orderNo: string | null) => (orderNo ? `${webUrl}/orders/${orderNo}` : `${webUrl}/`);

/** 公開查詢：不含 Email、電話、地址 */
export async function publicOrderJson(deps: AppDeps, o: Order) {
  const now = deps.now();
  const expired = o.status === 'pending_payment' && !!o.holdExpiresAt && o.holdExpiresAt.getTime() <= now.getTime();
  const vipMember = o.kind === 'vip' && o.status !== 'pending_payment' && o.status !== 'expired' ? await deps.db.getVipMemberByOrder(o.id) : null;
  return {
    orderNo: o.orderNo,
    kind: o.kind,
    status: expired ? 'expired' : o.status,
    subtotal: o.subtotal,
    shippingFee: o.shippingFee,
    discountAmount: o.discountAmount,
    amount: o.amount,
    items: o.items.map((i) => ({ name: i.name, unitPrice: i.unitPrice, qty: i.qty })),
    holdExpiresAt: o.holdExpiresAt ? toTaipeiIso(o.holdExpiresAt) : null,
    createdAt: toTaipeiIso(o.createdAt),
    trackingNo: o.trackingNo,
    ...(vipMember
      ? {
          vip: {
            cardNo: vipMember.cardNo,
            planName: vipMember.planName,
            sessionsTotal: vipMember.sessionsTotal,
            sessionsLeft: vipMember.sessionsTotal - vipMember.sessionsUsed,
            expiresOn: expiryDate(vipMember.expiresAt),
          },
        }
      : {}),
  };
}

export function orderRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get('/orders/:orderNo', async (c) => {
    const orderNo = c.req.param('orderNo').toUpperCase();
    if (!isOrderNo(orderNo)) return apiError(c, 404, 'not_found', '找不到這筆訂單');
    const o = await deps.db.getOrder(orderNo);
    if (!o || o.kind === 'gift') return apiError(c, 404, 'not_found', '找不到這筆訂單');
    return c.json(await publicOrderJson(deps, o));
  });

  app.post('/payments/ecpay/order-checkout', async (c) => {
    const cfg = deps.env.ecpay;
    const apiUrl = deps.env.apiUrl;
    if (!cfg || !apiUrl) return apiError(c, 503, 'payment_unavailable', '線上付款暫停服務，請稍後再試');
    const body = await readJsonObject(c);
    const orderNo = typeof body?.orderNo === 'string' ? body.orderNo.toUpperCase() : '';
    if (!isOrderNo(orderNo)) return apiError(c, 400, 'validation', '訂單編號不正確', { orderNo: '訂單編號不正確' });
    const limited = paymentRateLimited(deps, c, orderNo);
    if (limited) return limited;
    const o = await deps.db.getOrder(orderNo);
    if (!o || o.kind === 'gift') return apiError(c, 404, 'not_found', '找不到這筆訂單');
    const now = deps.now();
    if (o.status !== 'pending_payment') {
      if (o.status === 'expired' || o.status === 'cancelled') return apiError(c, 409, 'expired', '這筆訂單已逾時，請重新下單');
      return apiError(c, 409, 'already_paid', '這筆訂單已付款');
    }
    if (o.holdExpiresAt && o.holdExpiresAt.getTime() <= now.getTime()) {
      return apiError(c, 409, 'expired', '這筆訂單已逾時，請重新下單');
    }
    if ((await deps.db.countOrderPayments(o.id)) >= MAX_PAYMENT_ATTEMPTS) {
      return apiError(c, 429, 'too_many_attempts', '付款嘗試次數已達上限，請聯繫客服協助處理');
    }
    const tradeNo = generateTradeNo(orderNo);
    const itemName = o.items.map((i) => `${i.name}${i.qty > 1 ? ` x${i.qty}` : ''}`).join('#') || '緣舍命理訂單';
    const fields = buildCheckoutFields(cfg, {
      method: 'card',
      tradeNo,
      orderNo,
      amount: o.amount,
      itemName,
      tradeDate: now,
      apiUrl,
      webUrl: deps.env.webUrl,
      urls: {
        returnPath: '/payments/ecpay/order-notify',
        resultPath: '/payments/ecpay/order-result',
        clientBackUrl: orderPageUrl(deps.env.webUrl, orderNo),
      },
    });
    await deps.db.insertOrderPayment({
      orderId: o.id,
      tradeNo,
      amount: o.amount,
      raw: { checkout: { MerchantTradeNo: fields.MerchantTradeNo, MerchantTradeDate: fields.MerchantTradeDate, TotalAmount: fields.TotalAmount } },
    });
    deps.logger.info('order.checkout', { order: orderNo, kind: o.kind, trade_no: tradeNo });
    return c.json({ action: cfg.checkoutUrl, fields });
  });

  /** 付款結果（notify／result 共用）；回傳訂單編號 */
  async function handle(params: EcpayParams, event: 'order_notify' | 'order_result'): Promise<string | null> {
    const cfg = deps.env.ecpay!;
    const tradeNo = params.MerchantTradeNo!;
    if (params.RtnCode === '1') {
      if (params.SimulatePaid === '1' && cfg.env === 'prod') {
        deps.logger.warn('ecpay.simulated_paid_ignored', { event, trade_no: tradeNo });
        return orderNoFromTradeNo(tradeNo);
      }
      const r = await deps.db.applyOrderPaid({
        tradeNo,
        amount: amountOf(params.TradeAmt),
        providerTxnId: params.TradeNo || null,
        raw: params,
        cardNo: generateVipCardNo(),
      });
      afterOrderPaid(deps, r, { tradeNo, event });
      return r.order_no ?? orderNoFromTradeNo(tradeNo);
    }
    if (ECPAY_DEFINITE_FAILURES.has(params.RtnCode ?? '')) {
      await deps.db.markOrderPaymentFailed(tradeNo, params);
      deps.logger.info('order.payment_failed', { event, trade_no: tradeNo, rtn_code: params.RtnCode });
      return orderNoFromTradeNo(tradeNo);
    }
    // 結果不明（10300066 待確認、不認得的代碼）：不改狀態，通知老師到綠界後台確認
    deps.logger.warn('order.payment_unclear', { event, trade_no: tradeNo, rtn_code: params.RtnCode });
    deps.defer('admin_alert', () =>
      alertAdmin(deps, {
        orderNo: orderNoFromTradeNo(tradeNo),
        reason: 'payment_unknown_status',
        detail: `綠界 RtnCode ${params.RtnCode ?? ''}：${params.RtnMsg ?? ''}（交易編號 ${tradeNo}）`,
      }),
    );
    return orderNoFromTradeNo(tradeNo);
  }

  app.post('/payments/ecpay/order-notify', async (c) => {
    const v = await verifyEcpayCallback(deps, c, 'order_notify');
    if (!v.ok) return c.text(v.reason === 'disabled' ? '0|disabled' : '0|CheckMacValue Error', 400);
    await handle(v.params, 'order_notify');
    return c.text('1|OK');
  });

  // 瀏覽器導回：處理失敗也照樣導到訂單頁（訂單頁會輪詢狀態，server 端通知會再補上）
  app.post('/payments/ecpay/order-result', async (c: Context) => {
    const v = await verifyEcpayCallback(deps, c, 'order_result');
    let orderNo = orderNoFromTradeNo(v.params.MerchantTradeNo);
    if (v.ok) {
      try {
        orderNo = (await handle(v.params, 'order_result')) ?? orderNo;
      } catch (e) {
        deps.logger.error('ecpay.order_redirect_failed', { trade_no: v.params.MerchantTradeNo, ...errorFields(e) });
      }
    }
    return c.redirect(orderPageUrl(deps.env.webUrl, orderNo), 303);
  });

  return app;
}
