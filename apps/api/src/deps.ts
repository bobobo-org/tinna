import type { Db } from './db/types';
import type { Env } from './env';
import type { LinePayClient } from './lib/linepay';
import { errorFields, type Logger } from './lib/log';
import type { Mailer } from './lib/mailer';
import type { FixedWindowRateLimiter } from './lib/rate-limit';

export interface AppDeps {
  env: Env;
  db: Db;
  mailer: Mailer;
  linepay: LinePayClient | null;
  logger: Logger;
  now: () => Date;
  /** POST /bookings：每個 IP */
  bookingLimiter: FixedWindowRateLimiter;
  /** 付款端點：每個「IP＋訂單編號」 */
  paymentLimiter: FixedWindowRateLimiter;
  /** 回應後才做的事（寄信）；失敗只記 log。測試會換成可 await 的版本。 */
  defer: (label: string, task: () => Promise<void>) => void;
}

export function fireAndForget(logger: Logger): AppDeps['defer'] {
  return (label, task) => {
    void task().catch((e) => logger.error('task.failed', { task: label, ...errorFields(e) }));
  };
}
