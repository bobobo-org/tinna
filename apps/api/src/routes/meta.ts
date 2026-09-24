import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import { ATM_MIN_LEAD_HOURS } from '../lib/policy';
import { toTaipeiIso } from '../lib/time';

export function metaRoutes(deps: AppDeps) {
  const app = new Hono();

  // version：CI 部署後以 /health 回應是否含本次 commit SHA 判斷新版上線（apps/api/BUILD_SHA）
  app.get('/health', (c) => c.json({ ok: true, time: toTaipeiIso(deps.now()), version: deps.env.buildSha }));

  app.get('/config', (c) => {
    const ecpay = deps.env.ecpay;
    return c.json({
      payments: { card: !!ecpay, atm: !!ecpay && deps.env.atmEnabled, line: !!deps.linepay },
      // 綠界未設定 → null（前端只在 "stage" 時顯示測試環境字樣）
      paymentEnv: ecpay ? ecpay.env : null,
      atmMinLeadHours: ATM_MIN_LEAD_HOURS,
    });
  });

  return app;
}
