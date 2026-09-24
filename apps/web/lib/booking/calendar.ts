/**
 * 月曆格子（原型 renderVals 的 calendar 區塊），資料改成 GET /availability 的 days
 *
 * - 前面補空白格：該月 1 日是星期幾（日=0）
 * - past：不可選、無註記；closed：不可選、註記「休」；full：不可選、註記「額滿」；open：可選
 * - 資料還沒到（loading）：照樣排出同樣的格子（不跳版），全部不可選
 */

import { addMonths, daysInMonth, pad2, parseMonth, weekdayOf } from './time';
import type { DayStatus, DayView, SlotView } from './types';

/** 本月 + 之後 2 個月（和 API 的 BOOKABLE_MONTHS 一致） */
export const BOOKABLE_MONTHS = 3;

export type CellStatus = DayStatus | 'loading';

export type CalendarCell =
  | { kind: 'blank'; key: string }
  | {
      kind: 'day';
      key: string;
      date: string;
      day: number;
      status: CellStatus;
      note: '' | '休' | '額滿';
      selectable: boolean;
      selected: boolean;
    };

export function noteFor(status: CellStatus): '' | '休' | '額滿' {
  if (status === 'closed') return '休';
  if (status === 'full') return '額滿';
  return '';
}

export function buildMonthCells(
  month: string,
  days: Record<string, DayView> | null | undefined,
  selected: string | null,
): CalendarCell[] {
  const p = parseMonth(month);
  if (!p) return [];
  const first = `${month}-01`;
  const cells: CalendarCell[] = [];
  const lead = weekdayOf(first);
  for (let i = 0; i < lead; i++) cells.push({ kind: 'blank', key: `b${i}` });
  const n = daysInMonth(p.year, p.month);
  for (let d = 1; d <= n; d++) {
    const date = `${month}-${pad2(d)}`;
    // 資料有缺的日期（理論上 API 每天都有 key）當成不可選
    const status: CellStatus = days ? (days[date]?.status ?? 'past') : 'loading';
    const selectable = status === 'open';
    cells.push({
      kind: 'day',
      key: date,
      date,
      day: d,
      status,
      note: noteFor(status),
      selectable,
      selected: selected === date,
    });
  }
  return cells;
}

/** 可預約月份：[本月, 下個月, 下下個月] */
export function bookableMonths(currentMonth: string): string[] {
  return Array.from({ length: BOOKABLE_MONTHS }, (_, i) => addMonths(currentMonth, i));
}

export function slotsFor(days: Record<string, DayView> | null | undefined, date: string | null): SlotView[] {
  if (!days || !date) return [];
  return days[date]?.slots ?? [];
}

export type Reconciled =
  | { changed: false }
  | { changed: true; date: string | null; time: null; reason: 'date' | 'time' };

/**
 * 拿到最新時段後檢查原本選的日期／時段是否還能約：
 * - 日期不再是 open → 日期、時段都清掉
 * - 日期還能約但時段不在、或已不可約 → 只清時段
 */
export function reconcileSelection(
  days: Record<string, DayView>,
  date: string | null,
  time: string | null,
): Reconciled {
  if (!date) return { changed: false };
  const day = days[date];
  if (!day) return { changed: false }; // 不是這個月的資料
  if (day.status !== 'open') return { changed: true, date: null, time: null, reason: 'date' };
  if (!time) return { changed: false };
  const slot = day.slots.find((s) => s.time === time);
  if (!slot || !slot.available) return { changed: true, date, time: null, reason: 'time' };
  return { changed: false };
}
