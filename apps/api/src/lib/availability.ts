import type { BusyBooking, DateOverrideRow, WeeklySlotRow } from '../db/types';
import {
  HOUR_MS,
  MINUTE_MS,
  addMonths,
  daysInMonth,
  fromTaipei,
  monthKey,
  pad2,
  parseMonth,
  taipeiDate,
  taipeiParts,
  weekdayOf,
} from './time';

// 可預約時段計算（純函式，所有「今天／現在」都由呼叫端傳入的 now 以台北時間換算）
//
// 每一天：
//   slots   = weekly_slots(該 weekday) ∪ date_overrides.extra_times，排序；closed 覆寫為 []
//   past    = 日期早於今天，或當天所有時段都早於 now + 24h
//   closed  = 沒有任何時段（週一公休／date_overrides.closed）
//   full    = 有時段但全部不可約
//   open    = 至少一個可約
// 時段不可約 = 早於 now + 24h，或與占用中的預約重疊
//   （confirmed，或 pending_payment/awaiting_transfer 且 hold 未逾時）

export type DayStatus = 'open' | 'closed' | 'full' | 'past';
export interface SlotView {
  time: string;
  available: boolean;
}
export interface DayView {
  status: DayStatus;
  slots: SlotView[];
}

export const BOOKING_LEAD_MS = 24 * HOUR_MS;
export const BOOKABLE_MONTHS = 3; // 本月 + 之後 2 個月

export interface Interval {
  start: number;
  end: number;
}

/** 目前真的占住時段的預約（hold 逾時但背景工作還沒跑到的，視為已釋出） */
export function activeIntervals(busy: BusyBooking[], now: Date): Interval[] {
  const t = now.getTime();
  return busy
    .filter(
      (b) =>
        b.status === 'confirmed' ||
        ((b.status === 'pending_payment' || b.status === 'awaiting_transfer') &&
          (b.holdExpiresAt === null || b.holdExpiresAt.getTime() > t)),
    )
    .map((b) => ({ start: b.startsAt.getTime(), end: b.endsAt.getTime() }));
}

/**
 * 時段是否被占用。
 * 有 durationMinutes（指定方案）：[start, start+duration) 與任一占用區間重疊
 * 沒有：開始時間落在任一占用區間 [start, end) 內
 */
export function isSlotBusy(start: Date, intervals: Interval[], durationMinutes?: number): boolean {
  const s = start.getTime();
  const e = durationMinutes ? s + durationMinutes * MINUTE_MS : s + 1;
  return intervals.some((iv) => s < iv.end && iv.start < e);
}

export function allowedMonths(now: Date): string[] {
  const p = taipeiParts(now);
  return Array.from({ length: BOOKABLE_MONTHS }, (_, i) => {
    const m = addMonths(p.year, p.month, i);
    return monthKey(m.year, m.month);
  });
}

export function isAllowedMonth(month: string, now: Date): boolean {
  return parseMonth(month) !== null && allowedMonths(now).includes(month);
}

/** 該月第一天 00:00 ～ 下個月第一天 00:00（台北），外加前後一天的緩衝給重疊判斷 */
export function monthRange(month: string): { from: Date; to: Date; firstDate: string; lastDate: string } {
  const m = parseMonth(month);
  if (!m) throw new Error(`invalid month ${month}`);
  const next = addMonths(m.year, m.month, 1);
  const firstDate = `${monthKey(m.year, m.month)}-01`;
  const lastDate = `${monthKey(m.year, m.month)}-${pad2(daysInMonth(m.year, m.month))}`;
  return {
    from: new Date(fromTaipei(firstDate, '00:00').getTime() - 24 * HOUR_MS),
    to: new Date(fromTaipei(`${monthKey(next.year, next.month)}-01`, '00:00').getTime() + 24 * HOUR_MS),
    firstDate,
    lastDate,
  };
}

export interface ScheduleInput {
  now: Date;
  weekly: WeeklySlotRow[];
  overrides: DateOverrideRow[];
  busy: BusyBooking[];
  durationMinutes?: number;
}

/** 某一天所有候選時段（HH:MM，已排序去重）；closed 回 [] */
export function slotTimesFor(date: string, weekly: WeeklySlotRow[], overrides: DateOverrideRow[]): string[] {
  const ov = overrides.find((o) => o.date === date);
  if (ov?.closed) return [];
  const wd = weekdayOf(date);
  const set = new Set<string>(weekly.filter((w) => w.weekday === wd).map((w) => w.time));
  for (const t of ov?.extraTimes ?? []) set.add(t);
  return [...set].sort();
}

export function computeDay(date: string, input: ScheduleInput, intervals?: Interval[]): DayView {
  const { now } = input;
  const ivs = intervals ?? activeIntervals(input.busy, now);
  const times = slotTimesFor(date, input.weekly, input.overrides);
  const threshold = now.getTime() + BOOKING_LEAD_MS;
  const today = taipeiDate(now);

  const slots: SlotView[] = times.map((time) => {
    const start = fromTaipei(date, time);
    const tooSoon = start.getTime() < threshold;
    return { time, available: !tooSoon && !isSlotBusy(start, ivs, input.durationMinutes) };
  });

  if (date < today) return { status: 'past', slots };
  if (times.length === 0) return { status: 'closed', slots: [] };
  if (times.every((t) => fromTaipei(date, t).getTime() < threshold)) return { status: 'past', slots };
  if (slots.some((s) => s.available)) return { status: 'open', slots };
  return { status: 'full', slots };
}

export function computeMonth(month: string, input: ScheduleInput): Record<string, DayView> {
  const m = parseMonth(month);
  if (!m) throw new Error(`invalid month ${month}`);
  const ivs = activeIntervals(input.busy, input.now);
  const days: Record<string, DayView> = {};
  const n = daysInMonth(m.year, m.month);
  for (let d = 1; d <= n; d++) {
    const date = `${monthKey(m.year, m.month)}-${pad2(d)}`;
    days[date] = computeDay(date, input, ivs);
  }
  return days;
}
