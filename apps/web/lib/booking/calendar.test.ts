import { describe, expect, it } from 'vitest';
import { bookableMonths, buildMonthCells, reconcileSelection, slotsFor } from './calendar';
import {
  addMonths,
  formatDateLabel,
  formatEcpayExpire,
  formatMonthLabel,
  monthDiff,
  taipeiClock,
  taipeiDateTime,
  taipeiMonth,
  taipeiToday,
  weekdayOf,
} from './time';
import type { DayView } from './types';

const open = (times: [string, boolean][] = [['10:00', true]]): DayView => ({
  status: 'open',
  slots: times.map(([time, available]) => ({ time, available })),
});

describe('台北時間', () => {
  it('taipeiToday / taipeiMonth 以 UTC+8 計算（不看裝置時區）', () => {
    // 2026-09-30 16:30 UTC = 台北 10/1 00:30
    const t = Date.UTC(2026, 8, 30, 16, 30);
    expect(taipeiToday(t)).toBe('2026-10-01');
    expect(taipeiMonth(t)).toBe('2026-10');
    // 2026-09-30 15:59 UTC = 台北 9/30 23:59
    expect(taipeiToday(Date.UTC(2026, 8, 30, 15, 59))).toBe('2026-09-30');
  });

  it('addMonths / monthDiff 跨年', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-12', 3)).toBe('2027-03');
    expect(monthDiff('2026-11', '2027-01')).toBe(2);
    expect(monthDiff('2026-11', '2026-10')).toBe(-1);
    expect(bookableMonths('2026-11')).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('formatDateLabel 同原型 fmt：10/7（三）；沒選為 —', () => {
    expect(formatDateLabel('2026-10-07')).toBe('10/7（三）');
    expect(formatDateLabel('2026-09-27')).toBe('9/27（日）');
    expect(formatDateLabel(null)).toBe('—');
    expect(formatDateLabel('2026-02-30')).toBe('—');
    expect(formatMonthLabel('2026-10')).toBe('2026 年 10 月');
    expect(weekdayOf('2026-10-01')).toBe(4);
  });

  it('ISO → 台北時鐘、綠界期限格式', () => {
    expect(taipeiClock('2026-10-07T11:00:00Z')).toBe('19:00');
    expect(taipeiClock('2026-10-07T19:15:00+08:00')).toBe('19:15');
    expect(taipeiClock('nope')).toBe('');
    expect(taipeiDateTime('2026-10-07T16:30:00Z')).toBe('2026/10/08 00:30');
    expect(formatEcpayExpire('2026/10/02 23:59:59')).toBe('2026/10/02 23:59');
    expect(formatEcpayExpire('2026/10/02')).toBe('2026/10/02 23:59');
    expect(formatEcpayExpire('明天')).toBe('明天');
    expect(formatEcpayExpire(null)).toBe('');
  });
});

describe('buildMonthCells', () => {
  it('前面補空白格＝1 日的星期；每天一格', () => {
    const cells = buildMonthCells('2026-10', null, null);
    // 2026-10-01 是星期四 → 4 個空白格
    expect(cells.slice(0, 4).every((c) => c.kind === 'blank')).toBe(true);
    expect(cells[4]).toMatchObject({ kind: 'day', date: '2026-10-01', day: 1 });
    expect(cells.filter((c) => c.kind === 'day')).toHaveLength(31);
    // 2026-02 從星期日開始、28 天
    const feb = buildMonthCells('2026-02', null, null);
    expect(feb[0]).toMatchObject({ kind: 'day', date: '2026-02-01' });
    expect(feb).toHaveLength(28);
  });

  it('資料還沒到：同樣的格子全部 loading、不可選（不跳版）', () => {
    const cells = buildMonthCells('2026-10', null, '2026-10-07');
    const days = cells.filter((c) => c.kind === 'day');
    expect(days.every((c) => c.kind === 'day' && c.status === 'loading' && !c.selectable && c.note === '')).toBe(true);
    expect(days.find((c) => c.kind === 'day' && c.selected)).toMatchObject({ date: '2026-10-07' });
  });

  it('past 不可選無註記、closed 顯示「休」、full 顯示「額滿」、open 可選', () => {
    const days: Record<string, DayView> = {
      '2026-10-01': { status: 'past', slots: [] },
      '2026-10-05': { status: 'closed', slots: [] },
      '2026-10-06': { status: 'full', slots: [{ time: '10:00', available: false }] },
      '2026-10-07': open(),
    };
    const cells = buildMonthCells('2026-10', days, '2026-10-07');
    const byDate = Object.fromEntries(cells.flatMap((c) => (c.kind === 'day' ? [[c.date, c]] : [])));
    expect(byDate['2026-10-01']).toMatchObject({ status: 'past', note: '', selectable: false });
    expect(byDate['2026-10-05']).toMatchObject({ status: 'closed', note: '休', selectable: false });
    expect(byDate['2026-10-06']).toMatchObject({ status: 'full', note: '額滿', selectable: false });
    expect(byDate['2026-10-07']).toMatchObject({ status: 'open', note: '', selectable: true, selected: true });
    // API 漏掉的日期當成不可選
    expect(byDate['2026-10-08']).toMatchObject({ status: 'past', selectable: false });
  });

  it('slotsFor', () => {
    const days = { '2026-10-07': open([['10:00', true], ['13:30', false]]) };
    expect(slotsFor(days, '2026-10-07').map((s) => s.time)).toEqual(['10:00', '13:30']);
    expect(slotsFor(days, null)).toEqual([]);
    expect(slotsFor(null, '2026-10-07')).toEqual([]);
  });
});

describe('reconcileSelection（拿到最新時段後檢查原本的選擇）', () => {
  const days: Record<string, DayView> = {
    '2026-10-06': { status: 'full', slots: [{ time: '10:00', available: false }] },
    '2026-10-07': open([['10:00', true], ['19:00', false]]),
  };
  it('日期已不能約 → 日期時段都清掉', () => {
    expect(reconcileSelection(days, '2026-10-06', '10:00')).toEqual({ changed: true, date: null, time: null, reason: 'date' });
  });
  it('時段被約走或不存在 → 只清時段', () => {
    expect(reconcileSelection(days, '2026-10-07', '19:00')).toEqual({ changed: true, date: '2026-10-07', time: null, reason: 'time' });
    expect(reconcileSelection(days, '2026-10-07', '11:11')).toEqual({ changed: true, date: '2026-10-07', time: null, reason: 'time' });
  });
  it('仍可約、沒選、不是這個月 → 不變', () => {
    expect(reconcileSelection(days, '2026-10-07', '10:00')).toEqual({ changed: false });
    expect(reconcileSelection(days, '2026-10-07', null)).toEqual({ changed: false });
    expect(reconcileSelection(days, null, null)).toEqual({ changed: false });
    expect(reconcileSelection(days, '2026-11-03', '10:00')).toEqual({ changed: false });
  });
});
