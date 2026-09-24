import { afterEach, describe, expect, it } from 'vitest';
import type { BusyBooking } from '../src/db/types';
import { allowedMonths, computeDay, computeMonth, isAllowedMonth } from '../src/lib/availability';
import { fromTaipei } from '../src/lib/time';
import { SEED_WEEKLY } from './helpers/memory-db';
import { makeHarness } from './helpers/harness';

// 基準時間：2026-09-24（四）10:00 台北；now + 24h = 09-25（五）10:00
const NOW = new Date('2026-09-24T10:00:00+08:00');

const busy = (date: string, time: string, minutes: number, status: BusyBooking['status'], hold: Date | null): BusyBooking => {
  const startsAt = fromTaipei(date, time);
  return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000), status, holdExpiresAt: hold };
};

const base = { now: NOW, weekly: SEED_WEEKLY, overrides: [], busy: [] as BusyBooking[] };
const TIMES = ['10:00', '13:30', '15:30', '19:00', '20:30'];

describe('computeDay：狀態', () => {
  it('昨天 → past（slots 全部不可約）', () => {
    const d = computeDay('2026-09-23', base);
    expect(d.status).toBe('past');
    expect(d.slots.every((s) => !s.available)).toBe(true);
  });

  it('今天所有時段都早於 now+24h → past', () => {
    expect(computeDay('2026-09-24', base).status).toBe('past');
  });

  it('明天：剛好等於 now+24h 的時段可約（不早於）', () => {
    const d = computeDay('2026-09-25', base);
    expect(d.status).toBe('open');
    expect(d.slots).toEqual(TIMES.map((time) => ({ time, available: true })));
  });

  it('明天：早於 now+24h 的時段不可約，其餘可約 → open', () => {
    const d = computeDay('2026-09-25', { ...base, now: new Date(NOW.getTime() + 1000) });
    expect(d.status).toBe('open');
    expect(d.slots[0]).toEqual({ time: '10:00', available: false });
    expect(d.slots[1]).toEqual({ time: '13:30', available: true });
  });

  it('週一公休 → closed、slots = []', () => {
    expect(computeDay('2026-09-28', base)).toEqual({ status: 'closed', slots: [] });
  });

  it('過去的週一 → past（不顯示休）', () => {
    expect(computeDay('2026-09-21', base)).toEqual({ status: 'past', slots: [] });
  });

  it('date_overrides.closed → closed', () => {
    const d = computeDay('2026-10-07', { ...base, overrides: [{ date: '2026-10-07', closed: true, extraTimes: ['21:00'] }] });
    expect(d).toEqual({ status: 'closed', slots: [] });
  });

  it('extra_times 與每週時段取聯集並排序', () => {
    const d = computeDay('2026-10-07', {
      ...base,
      overrides: [{ date: '2026-10-07', closed: false, extraTimes: ['21:00', '09:00', '13:30'] }],
    });
    expect(d.slots.map((s) => s.time)).toEqual(['09:00', '10:00', '13:30', '15:30', '19:00', '20:30', '21:00']);
    expect(d.status).toBe('open');
  });

  it('週一加開（extra_times）→ open', () => {
    const d = computeDay('2026-10-05', {
      ...base,
      overrides: [{ date: '2026-10-05', closed: false, extraTimes: ['14:00'] }],
    });
    expect(d).toEqual({ status: 'open', slots: [{ time: '14:00', available: true }] });
  });

  it('全部被占用 → full', () => {
    const hold = new Date(NOW.getTime() + 10 * 60_000);
    const d = computeDay('2026-10-07', {
      ...base,
      busy: [
        busy('2026-10-07', '10:00', 60, 'confirmed', null),
        busy('2026-10-07', '13:30', 90, 'pending_payment', hold),
        busy('2026-10-07', '15:30', 30, 'awaiting_transfer', new Date(NOW.getTime() + 20 * 3600_000)),
        busy('2026-10-07', '19:00', 90, 'confirmed', null),
        busy('2026-10-07', '20:30', 75, 'confirmed', null),
      ],
    });
    expect(d.status).toBe('full');
    expect(d.slots.every((s) => !s.available)).toBe(true);
  });

  it('hold 已逾時的 pending 不占位；confirmed 占位', () => {
    const d = computeDay('2026-10-07', {
      ...base,
      busy: [
        busy('2026-10-07', '10:00', 60, 'pending_payment', new Date(NOW.getTime() - 1)),
        busy('2026-10-07', '13:30', 60, 'confirmed', null),
      ],
    });
    expect(d.slots.find((s) => s.time === '10:00')!.available).toBe(true);
    expect(d.slots.find((s) => s.time === '13:30')!.available).toBe(false);
  });

  it('指定方案時長：與既有預約重疊的時段不可約', () => {
    const input = {
      ...base,
      overrides: [{ date: '2026-10-07', closed: false, extraTimes: ['20:00'] }],
      busy: [busy('2026-10-07', '20:00', 30, 'confirmed', null)],
    };
    // 不指定方案：19:00 開始時不在任何占用區間內 → 可約
    expect(computeDay('2026-10-07', input).slots.find((s) => s.time === '19:00')!.available).toBe(true);
    // 90 分鐘方案：19:00–20:30 與 20:00–20:30 重疊 → 不可約；60 分鐘剛好接上 → 可約
    expect(computeDay('2026-10-07', { ...input, durationMinutes: 90 }).slots.find((s) => s.time === '19:00')!.available).toBe(false);
    expect(computeDay('2026-10-07', { ...input, durationMinutes: 60 }).slots.find((s) => s.time === '19:00')!.available).toBe(true);
    // 20:30 落在既有預約之後 → 可約
    expect(computeDay('2026-10-07', input).slots.find((s) => s.time === '20:30')!.available).toBe(true);
  });
});

describe('月份', () => {
  it('每一天都有 key', () => {
    const days = computeMonth('2026-10', base);
    expect(Object.keys(days)).toHaveLength(31);
    expect(Object.keys(days)[0]).toBe('2026-10-01');
    expect(Object.keys(days)[30]).toBe('2026-10-31');
    expect(days['2026-10-05']!.status).toBe('closed');
    expect(days['2026-10-06']!.status).toBe('open');
  });

  it('只接受本月～之後 2 個月', () => {
    expect(allowedMonths(NOW)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(isAllowedMonth('2026-11', NOW)).toBe(true);
    expect(isAllowedMonth('2026-12', NOW)).toBe(false);
    expect(isAllowedMonth('2026-08', NOW)).toBe(false);
    expect(isAllowedMonth('2026-9', NOW)).toBe(false);
    expect(isAllowedMonth('abc', NOW)).toBe(false);
  });

  it('跨年', () => {
    expect(allowedMonths(new Date('2026-11-15T12:00:00+08:00'))).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('時區：以台北時間計算，不依賴系統 TZ', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('UTC 還是 9/30、台北已是 10/1 → 本月是 10 月', () => {
    process.env.TZ = 'UTC';
    const now = new Date('2026-09-30T20:00:00Z'); // 台北 10/01 04:00
    expect(allowedMonths(now)).toEqual(['2026-10', '2026-11', '2026-12']);
    const days = computeMonth('2026-10', { ...base, now });
    expect(days['2026-10-01']!.status).toBe('past'); // 今天
    expect(days['2026-10-02']!.slots[0]).toEqual({ time: '10:00', available: true }); // 10/02 10:00 > now+24h
  });

  it('系統 TZ 設成美西也一樣', () => {
    process.env.TZ = 'America/Los_Angeles';
    const d = computeDay('2026-09-25', base);
    expect(d.slots[0]).toEqual({ time: '10:00', available: true });
    expect(computeDay('2026-09-28', base).status).toBe('closed');
  });
});

describe('GET /availability', () => {
  it('回傳該月每天 + timezone', async () => {
    const h = makeHarness({ now: NOW });
    h.db.addBooking({ startsAt: fromTaipei('2026-10-07', '19:00'), status: 'confirmed', holdExpiresAt: null });
    const res = await h.app.request('/availability?month=2026-10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { month: string; timezone: string; days: Record<string, { status: string; slots: { time: string; available: boolean }[] }> };
    expect(body.month).toBe('2026-10');
    expect(body.timezone).toBe('Asia/Taipei');
    expect(Object.keys(body.days)).toHaveLength(31);
    expect(body.days['2026-10-07']!.slots.find((s) => s.time === '19:00')).toEqual({ time: '19:00', available: false });
    expect(body.days['2026-10-05']).toEqual({ status: 'closed', slots: [] });
  });

  it('月份超出範圍或格式錯誤 → 400', async () => {
    const h = makeHarness({ now: NOW });
    for (const m of ['2026-12', '2026-08', '2026-1', '']) {
      const res = await h.app.request(`/availability?month=${m}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('validation');
    }
  });

  it('service 參數：未知方案 400；已知方案依時長判斷重疊', async () => {
    const h = makeHarness({ now: NOW });
    expect((await h.app.request('/availability?month=2026-10&service=nope')).status).toBe(400);
    h.db.overrides.push({ date: '2026-10-07', closed: false, extraTimes: ['20:00'] });
    h.db.addBooking({ startsAt: fromTaipei('2026-10-07', '20:00'), serviceId: 'quick', status: 'confirmed', holdExpiresAt: null });
    const love = (await (await h.app.request('/availability?month=2026-10&service=love')).json()) as {
      days: Record<string, { slots: { time: string; available: boolean }[] }>;
    };
    expect(love.days['2026-10-07']!.slots.find((s) => s.time === '19:00')!.available).toBe(false);
    const flow = (await (await h.app.request('/availability?month=2026-10&service=flow')).json()) as {
      days: Record<string, { slots: { time: string; available: boolean }[] }>;
    };
    expect(flow.days['2026-10-07']!.slots.find((s) => s.time === '19:00')!.available).toBe(true);
  });
});
