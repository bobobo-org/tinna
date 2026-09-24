import { createApp } from '../../src/app';
import type { AppDeps } from '../../src/deps';
import { loadEnv, type Env } from '../../src/env';
import { computeCheckMacValue } from '../../src/lib/ecpay';
import { LinePayClient } from '../../src/lib/linepay';
import type { LogFields, Logger } from '../../src/lib/log';
import type { MailMessage, Mailer, SendResult } from '../../src/lib/mailer';
import { BOOKING_RATE_LIMIT, PAYMENT_RATE_LIMIT } from '../../src/lib/policy';
import { FixedWindowRateLimiter } from '../../src/lib/rate-limit';
import { MemoryDb } from './memory-db';

export const ECPAY_TEST = {
  merchantId: '3002607',
  hashKey: 'pwFHCqoQZGmho4w6',
  hashIv: 'EkRm7iFT261dpevs',
};

export const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  WEB_URL: 'https://yuanshe.example',
  API_URL: 'https://api.yuanshe.example',
  ECPAY_MERCHANT_ID: ECPAY_TEST.merchantId,
  ECPAY_HASH_KEY: ECPAY_TEST.hashKey,
  ECPAY_HASH_IV: ECPAY_TEST.hashIv,
  ECPAY_ENV: 'stage',
  ADMIN_EMAIL: 'teacher@example.com',
};

export class FakeMailer implements Mailer {
  readonly dryRun = false;
  sent: MailMessage[] = [];
  fail = false;
  async send(msg: MailMessage): Promise<SendResult> {
    if (this.fail) return { ok: false, dryRun: false };
    this.sent.push(msg);
    return { ok: true, dryRun: false, id: `m${this.sent.length}` };
  }
  tags() {
    return this.sent.map((m) => m.tag);
  }
}

export class MemoryLogger implements Logger {
  lines: { level: string; msg: string; fields?: LogFields }[] = [];
  debug(msg: string, fields?: LogFields) {
    this.lines.push({ level: 'debug', msg, fields });
  }
  info(msg: string, fields?: LogFields) {
    this.lines.push({ level: 'info', msg, fields });
  }
  warn(msg: string, fields?: LogFields) {
    this.lines.push({ level: 'warn', msg, fields });
  }
  error(msg: string, fields?: LogFields) {
    this.lines.push({ level: 'error', msg, fields });
  }
  text() {
    return JSON.stringify(this.lines);
  }
}

export interface Harness {
  app: ReturnType<typeof createApp>;
  db: MemoryDb;
  mailer: FakeMailer;
  logger: MemoryLogger;
  env: Env;
  deps: AppDeps;
  clock: { now: Date };
  flush: () => Promise<void>;
  linepayFetch?: FakeFetch;
}

export type FakeFetch = ((url: string | URL | Request, init?: RequestInit) => Promise<Response>) & {
  calls: { url: string; init?: RequestInit }[];
  respond: (url: string) => { status?: number; body: string } | Error;
};

export function makeFakeFetch(respond: FakeFetch['respond']): FakeFetch {
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    f.calls.push({ url: u, init });
    const r = f.respond(u);
    if (r instanceof Error) throw r;
    return new Response(r.body, { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as FakeFetch;
  f.calls = [];
  f.respond = respond;
  return f;
}

export function makeHarness(
  opts: { env?: Record<string, string | undefined>; now?: Date; linepayFetch?: FakeFetch } = {},
): Harness {
  const clock = { now: opts.now ?? new Date('2026-09-24T10:00:00+08:00') };
  const loaded = loadEnv({ ...BASE_ENV, ...opts.env });
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const env = loaded.env;
  const db = new MemoryDb(() => clock.now);
  const mailer = new FakeMailer();
  const logger = new MemoryLogger();
  const pending: Promise<void>[] = [];
  const deps: AppDeps = {
    env,
    db,
    mailer,
    linepay: env.linepay ? new LinePayClient(env.linepay, (opts.linepayFetch ?? fetch) as typeof fetch) : null,
    logger,
    now: () => clock.now,
    bookingLimiter: new FixedWindowRateLimiter(BOOKING_RATE_LIMIT.limit, BOOKING_RATE_LIMIT.windowMs, () => clock.now.getTime()),
    paymentLimiter: new FixedWindowRateLimiter(PAYMENT_RATE_LIMIT.limit, PAYMENT_RATE_LIMIT.windowMs, () => clock.now.getTime()),
    defer: (_label, task) => {
      pending.push(task());
    },
  };
  const app = createApp(deps);
  const flush = async () => {
    while (pending.length) await pending.shift();
  };
  return { app, db, mailer, logger, env, deps, clock, flush, linepayFetch: opts.linepayFetch };
}

/** 以測試金鑰簽一個綠界回呼 */
export function signedEcpayForm(params: Record<string, string>, key = ECPAY_TEST.hashKey, iv = ECPAY_TEST.hashIv) {
  const all = { ...params, CheckMacValue: computeCheckMacValue(params, key, iv) };
  return new URLSearchParams(all).toString();
}

export function postForm(h: Harness, path: string, body: string) {
  return h.app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

export function postJson(h: Harness, path: string, body: unknown, headers: Record<string, string> = {}) {
  return h.app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
