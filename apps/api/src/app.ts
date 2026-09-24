import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppDeps } from './deps';
import { apiError } from './lib/http';
import { errorFields } from './lib/log';
import { adminRoutes } from './routes/admin';
import { availabilityRoutes } from './routes/availability';
import { bookingRoutes } from './routes/bookings';
import { metaRoutes } from './routes/meta';
import { ecpayRoutes } from './routes/payments/ecpay';
import { linepayRoutes } from './routes/payments/linepay';

/** 只接受 application/json、且檢查 Origin 的 POST 端點（瀏覽器由前端呼叫的那些） */
export const JSON_POST_ENDPOINTS = ['/bookings', '/payments/ecpay/checkout', '/payments/linepay/request'];

export function createApp(deps: AppDeps) {
  const app = new Hono();

  // 存取紀錄：只記 method、path（不含 query）、狀態碼、耗時
  app.use('*', async (c, next) => {
    const started = Date.now();
    await next();
    deps.logger.info('http', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  });

  // 前端（不同網域）以 CORS fetch 讀取，不設 Cross-Origin-Resource-Policy
  app.use('*', secureHeaders({ crossOriginResourcePolicy: false }));

  // CORS：只允許 WEB_URL（逗號分隔多個）＋非 production 時 http://localhost:3000
  app.use(
    '*',
    cors({
      origin: (origin) => (deps.env.webOrigins.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      // Authorization：後台（/admin/*）帶 Supabase Auth 的 access token
      allowHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );

  // 一律不快取（時段與訂單狀態隨時會變）。
  // 注意：要在 next() 之前用 c.header() 設定；@hono/node-server 的 lightweight Response
  // 在 next() 之後直接改 c.res.headers，遇到 cors 的 c.header('Vary') 重建 Response 時會被丟掉。
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.use(
    '*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => apiError(c, 413, 'payload_too_large', '資料太大了'),
    }),
  );

  // E. 跨站建單防護：瀏覽器端的 JSON POST 端點
  //  * Content-Type 必須是 application/json（text/plain 等「簡單請求」不會觸發 CORS 預檢，任何網站都能送）→ 否則 415
  //  * 有 Origin 且不在 WEB_URL 白名單 → 403
  //  綠界／LINE Pay 回呼（form POST、GET 導回）不在這裡，不受影響
  for (const path of JSON_POST_ENDPOINTS) {
    app.use(path, async (c, next) => {
      if (c.req.method !== 'POST') return next();
      const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (type !== 'application/json') {
        return apiError(c, 415, 'unsupported_media_type', '請以 JSON 格式送出（Content-Type: application/json）');
      }
      const origin = c.req.header('origin');
      if (origin !== undefined && !deps.env.webOrigins.includes(origin)) {
        deps.logger.warn('http.forbidden_origin', { path: c.req.path });
        return apiError(c, 403, 'forbidden_origin', '不允許從這個網站送出');
      }
      return next();
    });
  }

  // 後台的寫入請求：同樣只接受白名單 Origin；有 body 的（POST / PATCH）必須是 JSON（上傳圖片除外，另行檢查）
  app.use('/admin/*', async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    const origin = c.req.header('origin');
    if (origin !== undefined && !deps.env.webOrigins.includes(origin)) {
      deps.logger.warn('http.forbidden_origin', { path: c.req.path });
      return apiError(c, 403, 'forbidden_origin', '不允許從這個網站送出');
    }
    if ((method === 'POST' || method === 'PATCH') && !c.req.path.startsWith('/admin/uploads')) {
      const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (type !== 'application/json') {
        return apiError(c, 415, 'unsupported_media_type', '請以 JSON 格式送出（Content-Type: application/json）');
      }
    }
    return next();
  });

  app.route('/', metaRoutes(deps));
  app.route('/', adminRoutes(deps));
  app.route('/', availabilityRoutes(deps));
  app.route('/', bookingRoutes(deps));
  app.route('/', ecpayRoutes(deps));
  app.route('/', linepayRoutes(deps));

  app.notFound((c) => apiError(c, 404, 'not_found', '找不到這個網址'));

  app.onError((e, c) => {
    deps.logger.error('http.unhandled', { method: c.req.method, path: c.req.path, ...errorFields(e) });
    return apiError(c, 500, 'internal', '系統忙碌中，請稍後再試');
  });

  return app;
}
