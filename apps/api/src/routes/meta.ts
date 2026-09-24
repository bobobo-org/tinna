import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import { toTaipeiIso } from '../lib/time';

export function metaRoutes(deps: AppDeps) {
  const app = new Hono();

  // version：CI 部署後以 /health 回應是否含本次 commit SHA 判斷新版上線（apps/api/BUILD_SHA）
  app.get('/health', (c) => c.json({ ok: true, time: toTaipeiIso(deps.now()), version: deps.env.buildSha }));

  app.get('/config', (c) => {
    const ecpay = !!deps.env.ecpay;
    return c.json({
      payments: { card: ecpay, atm: ecpay, line: !!deps.linepay },
      paymentEnv: deps.env.ecpay?.env === 'prod' ? 'prod' : 'stage',
    });
  });

  return app;
}
