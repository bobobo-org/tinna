// 結構化 log（一行一個 JSON）。規則：不記錄個資（姓名/電話/Email/生日/問題）。
// 呼叫端只傳訂單編號、狀態等非個資欄位；這裡再以欄位名稱做一次保險遮蔽。

type Level = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

const PII_KEYS = new Set([
  'name',
  'customer_name',
  'email',
  'phone',
  'birth_date',
  'birth_time',
  'birth_place',
  'questions',
  'gender',
  'to',
]);

function scrub(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) out[k] = PII_KEYS.has(k) ? '[redacted]' : v;
  return out;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

function write(level: Level, msg: string, fields?: LogFields): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(fields ? scrub(fields) : {}) });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log: Logger = {
  debug: (m, f) => {
    if (process.env.LOG_LEVEL === 'debug') write('debug', m, f);
  },
  info: (m, f) => write('info', m, f),
  warn: (m, f) => write('warn', m, f),
  error: (m, f) => write('error', m, f),
};

/** 錯誤只記名稱、代碼與訊息；Postgres 的 details（可能含整列資料）一律不記 */
export function errorFields(e: unknown): LogFields {
  if (e && typeof e === 'object') {
    const o = e as { name?: unknown; code?: unknown; message?: unknown };
    return {
      err: typeof o.name === 'string' ? o.name : 'Error',
      code: typeof o.code === 'string' ? o.code : undefined,
      message: typeof o.message === 'string' ? o.message.slice(0, 300) : undefined,
    };
  }
  return { err: String(e).slice(0, 300) };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
