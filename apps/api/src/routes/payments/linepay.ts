import { Hono } from 'hono';
import type { AppDeps } from '../../deps';
import { apiError, readJsonObject } from '../../lib/http';
import { TRANSACTION_ID_RE } from '../../lib/linepay';
import { errorFields } from '../../lib/log';
import { generateTradeNo, isOrderNo, orderNoFromTradeNo } from '../../lib/order-no';
import { confirmLinePay, resolvePendingLinePay } from '../../services/linepay';
import { checkPayable, itemName, successUrl } from './common';

// LINE Pay v3：request 取得付款網址；使用者授權後 LINE Pay 把瀏覽器導到 confirmUrl，
// 這裡呼叫 Confirm API 成功才算付款完成（confirmUrl 本身沒有簽章，不能單憑它就確認）。

const MSG_UNAVAILABLE = 'LINE Pay 即將開放，請改用信用卡或 ATM 轉帳';
const MSG_ERROR = 'LINE Pay 暫時無法使用，請稍後再試或改用其他付款方式';

export function linepayRoutes(deps: AppDeps) {
  const app = new Hono();

  app.post('/payments/linepay/request', async (c) => {
    const client = deps.linepay;
    const apiUrl = deps.env.apiUrl;
    if (!client || !apiUrl) return apiError(c, 503, 'payment_unavailable', MSG_UNAVAILABLE);

    const body = await readJsonObject(c);
    const orderNo = typeof body?.orderNo === 'string' ? body.orderNo.toUpperCase() : '';
    if (!isOrderNo(orderNo)) {
      return apiError(c, 400, 'validation', '訂單編號不正確', { orderNo: '訂單編號不正確' });
    }
    const b = await deps.db.getBookingPublic(orderNo);
    if (!b) return apiError(c, 404, 'not_found', '找不到這筆訂單');
    if (b.payMethod !== 'line') {
      return apiError(c, 409, 'invalid_method', '這筆訂單不是 LINE Pay 付款，請改用原本選擇的付款方式');
    }
    const blocked = checkPayable(b, deps.now());
    if (blocked) return apiError(c, blocked.status, blocked.error, blocked.message);

    // 先收尾之前的嘗試：可能已經扣款但結果不明（避免重複扣款）
    for (const prev of await deps.db.listBookingPayments(b.id)) {
      if (prev.provider !== 'linepay' || prev.status !== 'init' || !prev.providerTxnId) continue;
      const outcome = await resolvePendingLinePay(deps, prev);
      if (outcome === 'paid') return apiError(c, 409, 'already_paid', '這筆訂單已完成付款');
      if (outcome === 'unknown') return apiError(c, 502, 'payment_error', MSG_ERROR);
    }

    const tradeNo = generateTradeNo(orderNo); // LINE Pay 不接受重複的 orderId，每次請求都換
    const payment = await deps.db.insertPayment({
      bookingId: b.id,
      provider: 'linepay',
      method: 'line',
      tradeNo,
      amount: b.amount,
      raw: { request: { orderId: tradeNo, amount: b.amount } },
    });

    try {
      const res = await client.requestPayment({
        tradeNo,
        orderNo,
        amount: b.amount,
        serviceId: b.service.id,
        productName: itemName(b),
        confirmUrl: `${apiUrl}/payments/linepay/confirm`,
        cancelUrl: successUrl(deps.env.webUrl, orderNo),
      });
      const txId = res.info?.transactionId ? String(res.info.transactionId) : '';
      const url = res.info?.paymentUrl?.web;
      if (res.returnCode === '0000' && txId && url) {
        await deps.db.setPaymentTxn(payment.id, txId, {
          request: { orderId: tradeNo, amount: b.amount, returnCode: res.returnCode, transactionId: txId },
        });
        deps.logger.info('payment.checkout', { order: orderNo, provider: 'linepay', method: 'line', trade_no: tradeNo });
        return c.json({ paymentUrl: url });
      }
      await deps.db.markPaymentFailed({
        provider: 'linepay',
        tradeNo,
        event: 'request',
        raw: { returnCode: res.returnCode, returnMessage: res.returnMessage },
      });
      deps.logger.warn('linepay.request_failed', { order: orderNo, return_code: res.returnCode });
    } catch (e) {
      await deps.db
        .markPaymentFailed({ provider: 'linepay', tradeNo, event: 'request', raw: { error: (e as Error).name } })
        .catch(() => undefined);
      deps.logger.error('linepay.request_error', { order: orderNo, ...errorFields(e) });
    }
    return apiError(c, 502, 'payment_error', MSG_ERROR);
  });

  app.get('/payments/linepay/confirm', async (c) => {
    const transactionId = c.req.query('transactionId') ?? '';
    const tradeNo = c.req.query('orderId') ?? '';
    let orderNo = orderNoFromTradeNo(tradeNo);
    const done = () => c.redirect(successUrl(deps.env.webUrl, orderNo), 302);

    if (!deps.linepay || !TRANSACTION_ID_RE.test(transactionId) || !tradeNo) {
      deps.logger.warn('linepay.confirm_rejected', { reason: deps.linepay ? 'bad_params' : 'disabled' });
      return done();
    }

    try {
      const payment = await deps.db.getPayment('linepay', tradeNo);
      if (!payment) {
        deps.logger.warn('linepay.confirm_unknown_trade', { trade_no: tradeNo });
        return done();
      }
      orderNo = orderNoFromTradeNo(payment.tradeNo);
      if (payment.providerTxnId && payment.providerTxnId !== transactionId) {
        deps.logger.warn('linepay.confirm_txn_mismatch', { order: orderNo, trade_no: tradeNo });
        return done();
      }
      if (payment.status !== 'init') return done(); // 重新整理／重複導回（已付款或已判定失敗）
      await confirmLinePay(deps, payment, transactionId, 'confirm');
    } catch (e) {
      // 例如 DB 暫時失敗：付款維持 init，背景對帳會補上
      deps.logger.error('linepay.confirm_handler_failed', { order: orderNo, ...errorFields(e) });
    }
    return done();
  });

  return app;
}
