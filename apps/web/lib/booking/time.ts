/**
 * 台北時間工具（台灣沒有日光節約，固定 UTC+8）
 *
 * 月曆、「今天」、可預約月份都以台北時間計算，不看使用者裝置的時區
 * （人在國外也看得到和 API 一致的日期）。日期字串一律 YYYY-MM-DD。
 */

const OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

export const WEEKDAY_LABELS = WEEKDAYS;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 台北「今天」YYYY-MM-DD */
export function taipeiToday(now: number = Date.now()): string {
  const t = new Date(now + OFFSET_MS);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** 台北「本月」YYYY-MM */
export function taipeiMonth(now: number = Date.now()): string {
  return taipeiToday(now).slice(0, 7);
}

export function parseMonth(month: string): { year: number; month: number } | null {
  const m = MONTH_RE.exec(month);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function isValidDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** YYYY-MM 往後 n 個月 */
export function addMonths(month: string, n: number): string {
  const p = parseMonth(month);
  if (!p) throw new Error(`invalid month ${month}`);
  const idx = p.year * 12 + (p.month - 1) + n;
  return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`;
}

/** target 比 base 晚幾個月（可為負） */
export function monthDiff(base: string, target: string): number {
  const a = parseMonth(base);
  const b = parseMonth(target);
  if (!a || !b) return Number.NaN;
  return b.year * 12 + b.month - (a.year * 12 + a.month);
}

/** 曆法上的星期（0=日），與時區無關 */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 10/7（三）；沒選為「—」（原型 fmt） */
export function formatDateLabel(date: string | null | undefined): string {
  if (!date || !isValidDate(date)) return '—';
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}（${WEEKDAYS[weekdayOf(date)]}）`;
}

/** 2026 年 10 月（原型 monthLabel） */
export function formatMonthLabel(month: string): string {
  const p = parseMonth(month);
  if (!p) return '';
  return `${p.year} 年 ${p.month} 月`;
}

/** 螢幕報讀用：2026 年 10 月 7 日 星期三 */
export function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${y} 年 ${m} 月 ${d} 日 星期${WEEKDAYS[weekdayOf(date)]}`;
}

/** ISO 時間（任意時區）→ 台北 HH:MM；無法解析回 '' */
export function taipeiClock(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + OFFSET_MS);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** ISO 時間 → 台北 YYYY/MM/DD HH:MM；無法解析回 '' */
export function taipeiDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + OFFSET_MS);
  return `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** 綠界的繳費期限「2026/10/02 23:59:59」→「2026/10/02 23:59」；格式不認得就原樣回傳 */
export function formatEcpayExpire(s: string | null | undefined): string {
  if (!s) return '';
  const m = /^(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2})(?::\d{2})?)?$/.exec(s.trim());
  if (!m) return s;
  const [, y, mo, d, h, mi] = m;
  return h === undefined ? `${y}/${mo}/${d} 23:59` : `${y}/${mo}/${d} ${h}:${mi}`;
}
