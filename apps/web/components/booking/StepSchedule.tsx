import type { Ref } from 'react';
import { buildMonthCells, slotsFor, type CalendarCell } from '@/lib/booking/calendar';
import { WEEKDAY_LABELS, formatDateLabel, formatDateLong, formatMonthLabel } from '@/lib/booking/time';
import type { DayView } from '@/lib/booking/types';
import type { AvailEntry } from './useAvailability';

const STATUS_SR: Record<string, string> = {
  open: '可預約',
  closed: '公休',
  full: '已額滿',
  past: '不可預約',
  loading: '載入中',
};

/**
 * 日期格：手機 7 欄每格只有 38.6（360 寬）～42.9px（390 寬），點擊範圍用透明 ::before 往外延伸到格間距的一半
 * （inset 含 1px 框線：手機 4px 間距 → 框外各 2px；桌機 6px → 3px），視覺不變
 */
function cellClass(c: Extract<CalendarCell, { kind: 'day' }>): string {
  if (c.selected && c.selectable) return 'border border-rose-600 bg-selected-strong text-white';
  if (!c.selectable) return 'cursor-not-allowed border border-transparent bg-transparent text-disabled-text';
  return 'border border-line-3 bg-soft-2 text-ink-900';
}

/** Step 2 日期時段：月曆（本月＋之後 2 個月）＋當日時段 */
export default function StepSchedule({
  month,
  monthIndex,
  monthCount,
  entry,
  dateEntry,
  date,
  time,
  notice,
  onPrevMonth,
  onNextMonth,
  onPickDate,
  onPickTime,
  onRetry,
  headingRef,
}: {
  month: string;
  monthIndex: number;
  monthCount: number;
  entry: AvailEntry | undefined;
  /** 選好的日期所在月份的資料（可能不是目前顯示的月份） */
  dateEntry: AvailEntry | undefined;
  date: string | null;
  time: string | null;
  notice: string | null;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onPickDate: (date: string) => void;
  onPickTime: (time: string) => void;
  onRetry: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const days = entry?.status === 'ok' ? entry.days : null;
  const cells = buildMonthCells(month, days, date);
  const loading = !entry || entry.status === 'loading';
  const failed = entry?.status === 'error';
  const hasPrev = monthIndex > 0;
  const hasNext = monthIndex < monthCount - 1;
  // 時段看「選好的日期」那個月的資料（切到別的月份時，已選的時段照樣顯示）
  const dateDays: Record<string, DayView> | null = dateEntry?.status === 'ok' ? dateEntry.days : null;
  const slots = slotsFor(dateDays, date);
  const slotsLoading = !!date && (!dateEntry || dateEntry.status === 'loading');
  const monthLabel = formatMonthLabel(month);

  return (
    <div className="flex flex-col gap-[18px]">
      <h2 ref={headingRef} id="bk-step-title" tabIndex={-1} className="font-serif text-[22px] font-bold text-ink-900 outline-none">
        選擇日期與時段
      </h2>

      {notice && (
        <p role="alert" className="rounded-[12px] border border-error/25 bg-soft-2 px-4 py-3 text-[14px] leading-[1.8] text-error">
          {notice}
        </p>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onPrevMonth}
          aria-disabled={!hasPrev}
          aria-label="上個月"
          className={`flex h-11 min-w-[44px] items-center justify-center rounded-pill border border-rose-600/30 px-[14px] text-[14px] text-rose-800 ${
            hasPrev ? '' : 'opacity-[.35]'
          }`}
        >
          <span>
            ‹<span className="hidden md:inline"> 上個月</span>
          </span>
        </button>
        <div id="bk-month" aria-live="polite" className="text-[18px] font-bold text-ink-900">
          {monthLabel}
        </div>
        <button
          type="button"
          onClick={onNextMonth}
          aria-disabled={!hasNext}
          aria-label="下個月"
          className={`flex h-11 min-w-[44px] items-center justify-center rounded-pill border border-rose-600/30 px-[14px] text-[14px] text-rose-800 ${
            hasNext ? '' : 'opacity-[.35]'
          }`}
        >
          <span>
            <span className="hidden md:inline">下個月 </span>›
          </span>
        </button>
      </div>

      <div
        role="group"
        aria-labelledby="bk-month"
        aria-busy={loading}
        className={`grid grid-cols-7 gap-1 md:gap-[6px] ${loading ? 'motion-safe:animate-pulse' : ''}`}
      >
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} aria-hidden="true" className="py-[6px] text-center text-[13px] text-ink-400">
            {w}
          </div>
        ))}
        {cells.map((c) =>
          c.kind === 'blank' ? (
            <div key={c.key} aria-hidden="true" className="h-[46px] md:h-[54px]" />
          ) : (
            <button
              key={c.key}
              type="button"
              disabled={!c.selectable}
              aria-pressed={c.selectable ? c.selected : undefined}
              aria-label={`${formatDateLong(c.date)}，${STATUS_SR[c.status]}`}
              onClick={() => onPickDate(c.date)}
              className={`relative box-content flex h-[46px] min-w-0 flex-col items-center justify-center gap-[2px] rounded-[10px] text-[15px] before:absolute before:-inset-[3px] md:h-[54px] md:before:-inset-[4px] ${cellClass(c)}`}
            >
              <span className="font-semibold">{c.day}</span>
              <span className="text-[10px]">{c.note}</span>
            </button>
          ),
        )}
      </div>

      <div className="flex gap-[18px] text-[12px] text-ink-400">
        <span>週一公休</span>
        <span>灰色為已額滿</span>
      </div>

      <p className="sr-only" aria-live="polite">
        {loading ? '正在載入可預約時段' : ''}
      </p>

      {failed && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-soft-2 px-4 py-2">
          <span className="text-[14px] leading-[1.8] text-error">{entry.message}</span>
          <button
            type="button"
            onClick={onRetry}
            className="flex h-11 items-center rounded-pill border border-rose-600/30 bg-white px-5 text-[14px] font-bold text-rose-800"
          >
            重試
          </button>
        </div>
      )}

      {date && (
        <div className="flex flex-col gap-3 pt-[6px]">
          <div id="bk-slots-title" className="text-[15px] font-bold text-ink-900">
            {`${formatDateLabel(date)} 可預約時段`}
          </div>
          <div
            role="group"
            aria-labelledby="bk-slots-title"
            className="grid grid-cols-3 gap-[10px] md:grid-cols-[repeat(auto-fill,minmax(96px,1fr))]"
          >
            {slotsLoading
              ? Array.from({ length: 5 }, (_, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="rounded-pill border border-line-2 bg-disabled-slot-bg px-5 py-3 text-center text-[15px] font-semibold text-disabled-slot motion-safe:animate-pulse"
                  >
                    --:--
                  </span>
                ))
              : slots.map((s) => {
                  const sel = time === s.time && s.available;
                  return (
                    <button
                      key={s.time}
                      type="button"
                      disabled={!s.available}
                      aria-pressed={s.available ? sel : undefined}
                      aria-label={s.available ? s.time : `${s.time} 無法預約`}
                      onClick={() => onPickTime(s.time)}
                      className={`rounded-pill px-5 py-3 text-center text-[15px] font-semibold ${
                        sel
                          ? 'border border-rose-600 bg-selected-strong text-white'
                          : s.available
                            ? 'border border-line-2 bg-white text-rose-800'
                            : 'cursor-not-allowed border border-line-2 bg-disabled-slot-bg text-disabled-slot line-through'
                      }`}
                    >
                      {s.time}
                    </button>
                  );
                })}
          </div>
        </div>
      )}
    </div>
  );
}
