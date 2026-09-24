import type { KeyboardEvent, Ref } from 'react';
import { MIN_BIRTH_DATE } from '@/lib/booking/validate';
import type { BookingForm, FieldErrors, Gender } from '@/lib/booking/types';
import { dateTimeCls, errorCls, focusRingWithin, inputCls, labelWrapCls } from './styles';

/** Enter 依序跳到下一格（輸入法選字中的 Enter 不算） */
const NEXT_FIELD: Record<string, string> = {
  'bk-name': 'bk-bdate',
  'bk-bdate': 'bk-btime',
  'bk-btime': 'bk-bplace',
  'bk-bplace': 'bk-phone',
  'bk-phone': 'bk-email',
  'bk-email': 'bk-q',
};

function onEnterNext(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
  const el = e.target as HTMLElement;
  if (!(el instanceof HTMLInputElement) || el.type === 'radio') return;
  const next = NEXT_FIELD[el.id];
  if (!next) return;
  e.preventDefault();
  document.getElementById(next)?.focus();
}

function ErrorText({ id, msg, always }: { id: string; msg?: string; always?: boolean }) {
  if (!always && !msg) return null;
  return (
    <span id={id} className={errorCls}>
      {msg ?? ''}
    </span>
  );
}

/** Step 3 填寫排盤資料（欄位順序、文案、placeholder 逐字同原型） */
export default function StepDetails({
  f,
  errors,
  today,
  onChange,
  qLabel = null,
  qRequired = false,
  emailNote = null,
  headingRef,
}: {
  f: BookingForm;
  errors: FieldErrors;
  today: string;
  onChange: <K extends keyof BookingForm>(key: K, value: BookingForm[K]) => void;
  /** 方案自訂的問題欄標題（接住你的諮詢室：「這次的煩惱是什麼？」）；null 用預設 */
  qLabel?: string | null;
  qRequired?: boolean;
  /** Email 欄的說明（VIP 諮詢：需與購買 VIP 時相同）；null 用預設 */
  emailNote?: string | null;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const inv = (k: keyof FieldErrors) => (errors[k] ? true : undefined);
  const desc = (k: keyof FieldErrors, id: string) => (errors[k] ? id : undefined);

  return (
    <div className="flex flex-col gap-[18px]" onKeyDown={onEnterNext}>
      <h2 ref={headingRef} id="bk-step-title" tabIndex={-1} className="font-serif text-[22px] font-bold text-ink-900 outline-none">
        填寫排盤資料
      </h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
        <div className={labelWrapCls}>
          <label htmlFor="bk-name">姓名 *</label>
          <input
            id="bk-name"
            name="name"
            value={f.name}
            onChange={(e) => onChange('name', e.target.value)}
            placeholder="王小美"
            autoComplete="name"
            enterKeyHint="next"
            maxLength={50}
            aria-required="true"
            aria-invalid={inv('name')}
            aria-describedby={desc('name', 'bk-name-err')}
            className={inputCls}
          />
          <ErrorText id="bk-name-err" msg={errors.name} always />
        </div>

        <div className={labelWrapCls}>
          <span id="bk-gender-label">性別</span>
          <div role="radiogroup" aria-labelledby="bk-gender-label" className="flex gap-2">
            {(['女', '男'] as Gender[]).map((g) => {
              const sel = f.gender === g;
              return (
                <label
                  key={g}
                  className={`relative flex-1 cursor-pointer rounded-[10px] p-3 text-center text-[15px] ${focusRingWithin} ${
                    sel ? 'border-2 border-rose-600 bg-soft text-rose-800' : 'border border-line-2 bg-input text-ink-600'
                  }`}
                >
                  <input
                    id={g === '女' ? 'bk-gender' : undefined}
                    type="radio"
                    name="gender"
                    value={g}
                    checked={sel}
                    onChange={() => onChange('gender', g)}
                    className="sr-only"
                  />
                  {g}
                </label>
              );
            })}
          </div>
          <ErrorText id="bk-gender-err" msg={errors.gender} />
        </div>

        <div className={labelWrapCls}>
          <label htmlFor="bk-bdate">國曆出生日期 *</label>
          <input
            id="bk-bdate"
            name="bday"
            type="date"
            value={f.bdate}
            onChange={(e) => onChange('bdate', e.target.value)}
            min={MIN_BIRTH_DATE}
            max={today}
            autoComplete="bday"
            aria-required="true"
            aria-invalid={inv('bdate')}
            aria-describedby={desc('bdate', 'bk-bdate-err')}
            className={`${inputCls} ${dateTimeCls}`}
          />
          <ErrorText id="bk-bdate-err" msg={errors.bdate} always />
        </div>

        <div className={labelWrapCls}>
          <label htmlFor="bk-btime">出生時間（不確定可留空）</label>
          <input
            id="bk-btime"
            name="btime"
            type="time"
            value={f.btime}
            onChange={(e) => onChange('btime', e.target.value)}
            autoComplete="off"
            aria-invalid={inv('btime')}
            aria-describedby={desc('btime', 'bk-btime-err')}
            className={`${inputCls} ${dateTimeCls}`}
          />
          <ErrorText id="bk-btime-err" msg={errors.btime} />
        </div>

        <div className={labelWrapCls}>
          <label htmlFor="bk-bplace">出生地</label>
          <input
            id="bk-bplace"
            name="bplace"
            value={f.bplace}
            onChange={(e) => onChange('bplace', e.target.value)}
            placeholder="台北市"
            autoComplete="off"
            enterKeyHint="next"
            maxLength={100}
            aria-invalid={inv('bplace')}
            aria-describedby={desc('bplace', 'bk-bplace-err')}
            className={inputCls}
          />
          <ErrorText id="bk-bplace-err" msg={errors.bplace} />
        </div>

        <div className={labelWrapCls}>
          <label htmlFor="bk-phone">手機 *</label>
          <input
            id="bk-phone"
            name="tel"
            type="tel"
            inputMode="tel"
            value={f.phone}
            onChange={(e) => onChange('phone', e.target.value)}
            placeholder="0912 345 678"
            autoComplete="tel"
            enterKeyHint="next"
            maxLength={30}
            aria-required="true"
            aria-invalid={inv('phone')}
            aria-describedby={desc('phone', 'bk-phone-err')}
            className={inputCls}
          />
          <ErrorText id="bk-phone-err" msg={errors.phone} always />
        </div>
      </div>

      <div className={labelWrapCls}>
        <label htmlFor="bk-email">{`Email *（${emailNote ?? '寄送視訊連結與收據'}）`}</label>
        <input
          id="bk-email"
          name="email"
          type="email"
          inputMode="email"
          value={f.email}
          onChange={(e) => onChange('email', e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="next"
          maxLength={254}
          aria-required="true"
          aria-invalid={inv('email')}
          aria-describedby={desc('email', 'bk-email-err')}
          className={inputCls}
        />
        <ErrorText id="bk-email-err" msg={errors.email} always />
      </div>

      <div className={labelWrapCls}>
        <label htmlFor="bk-q">
          {qLabel ?? '想問的問題（最多三個，讓老師事先準備）'}
          {qRequired ? ' *' : ''}
        </label>
        <textarea
          id="bk-q"
          name="questions"
          value={f.q}
          onChange={(e) => onChange('q', e.target.value)}
          rows={4}
          placeholder={qLabel ? '想到什麼就寫什麼，讓我們事先了解你的狀況' : '例：今年適合換工作嗎？和伴侶明年適合結婚嗎？'}
          maxLength={2000}
          aria-required={qRequired ? 'true' : undefined}
          aria-invalid={inv('q')}
          aria-describedby={desc('q', 'bk-q-err')}
          className={`${inputCls} resize-y`}
        />
        <ErrorText id="bk-q-err" msg={errors.q} always={qRequired} />
      </div>
    </div>
  );
}
