import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createSupabaseAuth, createSupabaseDb } from './db/supabase';
import { fireAndForget, type AppDeps } from './deps';
import { loadEnv } from './env';
import { startJobs } from './jobs/expire-holds';
import { LinePayClient } from './lib/linepay';
import { log } from './lib/log';
import { ResendMailer } from './lib/mailer';
import { BOOKING_RATE_LIMIT, PAYMENT_RATE_LIMIT } from './lib/policy';
import { FixedWindowRateLimiter } from './lib/rate-limit';

/**
 * 讀 apps/api/BUILD_SHA（CI 在 railway up 前 echo $GITHUB_SHA 寫入）。
 * 開發：src/index.ts → apps/api/BUILD_SHA；Docker 映像：/app/dist/index.js → /app/BUILD_SHA。
 * 檔案不存在（或空白）→ null，env.ts 改用 GIT_SHA ?? "dev"。
 */
function readBuildSha(): string | null {
  try {
    return readFileSync(new URL('../BUILD_SHA', import.meta.url), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

const loaded = loadEnv(process.env, { buildShaFromFile: readBuildSha() });
if (!loaded.ok) {
  process.stderr.write(`\n[api] 環境變數設定有誤，無法啟動：\n${loaded.errors.map((e) => `  - ${e}`).join('\n')}\n\n參考 apps/api/.env.example\n`);
  process.exit(1);
}
const env = loaded.env;
for (const w of env.warnings) log.warn('config.warning', { detail: w });

const deps: AppDeps = {
  env,
  db: createSupabaseDb(env.supabaseUrl, env.supabaseServiceRoleKey),
  auth: createSupabaseAuth(env.supabaseUrl, env.supabaseServiceRoleKey),
  mailer: new ResendMailer(env.mail, log),
  linepay: env.linepay ? new LinePayClient(env.linepay) : null,
  logger: log,
  now: () => new Date(),
  bookingLimiter: new FixedWindowRateLimiter(BOOKING_RATE_LIMIT.limit, BOOKING_RATE_LIMIT.windowMs),
  paymentLimiter: new FixedWindowRateLimiter(PAYMENT_RATE_LIMIT.limit, PAYMENT_RATE_LIMIT.windowMs),
  defer: fireAndForget(log),
};

const app = createApp(deps);
const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  log.info('server.listening', {
    port: info.port,
    node_env: env.nodeEnv,
    version: env.buildSha,
    payments: { card: !!env.ecpay, atm: !!env.ecpay, line: !!env.linepay },
    ecpay_env: env.ecpay?.env ?? null,
    mail: env.mail.resendApiKey ? 'resend' : 'dry-run',
  });
});

const stopJobs = startJobs(deps);

function shutdown(signal: string) {
  log.info('server.shutdown', { signal });
  stopJobs();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
