import { describe, expect, it, vi } from 'vitest';
import { ApiError, MSG_NETWORK, MSG_NOT_CONFIGURED, MSG_TIMEOUT, createApiClient } from './api';
import { goToPayment, isAllowedEcpayAction, isAllowedLinePayUrl } from './booking/pay';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createApiClient', () => {
  it('組網址（去掉結尾斜線）、GET 帶 service、POST 送 JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { month: '2026-10', timezone: 'Asia/Taipei', days: {} }));
    const c = createApiClient('http://localhost:8787/', fetchMock);
    await c.getAvailability('2026-10', 'love');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:8787/availability?month=2026-10&service=love');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit' });

    fetchMock.mockResolvedValueOnce(json(200, { action: 'https://payment-stage.ecpay.com.tw/x', fields: {} }));
    await c.ecpayCheckout('YS8K2M4Q7T');
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('http://localhost:8787/payments/ecpay/checkout');
    expect(init).toMatchObject({ method: 'POST', body: '{"orderNo":"YS8K2M4Q7T"}' });
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('錯誤回應 → ApiError（保留 error code、message、fields）', async () => {
    const c = createApiClient('http://api', vi.fn().mockResolvedValue(
      json(409, { error: 'slot_taken', message: '這個時段剛被預約，請重新選擇時段' }),
    ));
    const e = await c.getBooking('YS8K2M4Q7T').catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, code: 'slot_taken', message: '這個時段剛被預約，請重新選擇時段' });

    const c2 = createApiClient('http://api', vi.fn().mockResolvedValue(
      json(400, { error: 'validation', message: '請填寫姓名', fields: { name: '請填寫姓名', bad: 1 } }),
    ));
    const e2 = await c2.getConfig().catch((x) => x);
    expect(e2).toMatchObject({ status: 400, code: 'validation', fields: { name: '請填寫姓名' } });
  });

  it('非 JSON 的錯誤（例如 502 HTML）→ 通用中文訊息', async () => {
    const c = createApiClient('http://api', vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })));
    await expect(c.getConfig()).rejects.toMatchObject({ status: 502, code: 'http_502', message: '系統忙碌中，請稍後再試' });
    const c429 = createApiClient('http://api', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(c429.getConfig()).rejects.toMatchObject({ status: 429, message: '送出次數太多了，請稍後再試' });
  });

  it('網路斷線 → status 0 + 中文訊息；沒設定 API 網址 → not_configured', async () => {
    const c = createApiClient('http://api', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(c.getConfig()).rejects.toMatchObject({ status: 0, code: 'network', message: MSG_NETWORK });
    const none = createApiClient('', vi.fn());
    await expect(none.getConfig()).rejects.toMatchObject({ status: 0, code: 'not_configured', message: MSG_NOT_CONFIGURED });
  });

  it('逾時 → timeout', async () => {
    vi.useFakeTimers();
    const hang = vi.fn((_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const c = createApiClient('http://api', hang as unknown as typeof fetch);
    const p = c.getConfig().catch((x) => x);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await p).toMatchObject({ status: 0, code: 'timeout', message: MSG_TIMEOUT });
    vi.useRealTimers();
  });

  it('呼叫端自己 abort → 原樣丟出 AbortError（不是錯誤訊息）', async () => {
    const hang = vi.fn((_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const c = createApiClient('http://api', hang as unknown as typeof fetch);
    const ctrl = new AbortController();
    const p = c.getAvailability('2026-10', null, ctrl.signal).catch((x) => x);
    ctrl.abort();
    const e = await p;
    expect(e).not.toBeInstanceOf(ApiError);
    expect(e.name).toBe('AbortError');
  });
});

describe('導向金流頁', () => {
  it('只允許綠界／LINE Pay 的 https 網域', () => {
    expect(isAllowedEcpayAction('https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5')).toBe(true);
    expect(isAllowedEcpayAction('https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5')).toBe(true);
    expect(isAllowedEcpayAction('http://payment.ecpay.com.tw/x')).toBe(false);
    expect(isAllowedEcpayAction('https://ecpay.com.tw.evil.com/x')).toBe(false);
    expect(isAllowedEcpayAction('javascript:alert(1)')).toBe(false);
    expect(isAllowedLinePayUrl('https://sandbox-web-pay.line.me/web/payment/wait?transactionReserveId=x')).toBe(true);
    expect(isAllowedLinePayUrl('https://evil.example/line.me')).toBe(false);
  });

  it('card/atm → checkout 後 POST 表單；line → location', async () => {
    const client = {
      ecpayCheckout: vi.fn().mockResolvedValue({ action: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5', fields: { MerchantID: '3002607' } }),
      linepayRequest: vi.fn().mockResolvedValue({ paymentUrl: 'https://sandbox-web-pay.line.me/web/payment/wait?x=1' }),
    } as unknown as Parameters<typeof goToPayment>[2];
    const nav = { assign: vi.fn(), post: vi.fn() };
    await expect(goToPayment('YS8K2M4Q7T', 'card', client, nav)).resolves.toBe('redirecting');
    expect(nav.post).toHaveBeenCalledWith('https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5', { MerchantID: '3002607' });
    await goToPayment('YS8K2M4Q7T', 'line', client, nav);
    expect(nav.assign).toHaveBeenCalledWith('https://sandbox-web-pay.line.me/web/payment/wait?x=1');
  });

  it('API 回的網址不對 → 不導向，丟 bad_redirect', async () => {
    const client = {
      ecpayCheckout: vi.fn().mockResolvedValue({ action: 'https://evil.example/pay', fields: {} }),
    } as unknown as Parameters<typeof goToPayment>[2];
    const nav = { assign: vi.fn(), post: vi.fn() };
    await expect(goToPayment('YS8K2M4Q7T', 'atm', client, nav)).rejects.toMatchObject({ code: 'bad_redirect' });
    expect(nav.post).not.toHaveBeenCalled();
  });
});
