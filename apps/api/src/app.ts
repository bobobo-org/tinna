import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppDeps } from './deps';
import { apiError } from './lib/http';
import { errorFields } from './lib/log';
import { availabilityRoutes } from './routes/availability';
import { bookingRoutes } from './routes/bookings';
import { metaRoutes } from './routes/meta';
import { ecpayRoutes } from './routes/payments/ecpay';
import { linepayRoutes } from './routes/payments/linepay';

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
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 600,
    }),
  );

  app.use(
    '*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => apiError(c, 413, 'payload_too_large', '資料太大了'),
    }),
  );

  // 一律不快取（時段與訂單狀態隨時會變）。
  // 注意：要在 next() 之前用 c.header() 設定；@hono/node-server 的 lightweight Response
  // 在 next() 之後直接改 c.res.headers，遇到 cors 的 c.header('Vary') 重建 Response 時會被丟掉。
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.route('/', metaRoutes(deps));
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
