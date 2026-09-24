import type { Ref } from 'react';
import { formatPrice, type Service } from '@/lib/services';
import { focusRingWithin } from './styles';

/** Step 1 選擇方案：單選列表（原生 radio，方向鍵可切換） */
export default function StepService({
  services,
  selected,
  onPick,
  headingRef,
}: {
  services: Service[];
  selected: string | null;
  onPick: (id: string) => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex flex-col gap-[14px]">
      <h2 ref={headingRef} id="bk-step-title" tabIndex={-1} className="font-serif text-[22px] font-bold text-ink-900 outline-none">
        選擇諮詢方案
      </h2>
      <div role="radiogroup" aria-labelledby="bk-step-title" className="flex flex-col gap-[14px]">
        {services.map((s) => {
          const on = selected === s.id;
          return (
            <label
              key={s.id}
              className={`relative grid cursor-pointer grid-cols-[22px_1fr_auto] items-center gap-3 rounded-[14px] px-[14px] py-4 md:gap-4 md:px-5 md:py-[18px] ${focusRingWithin} ${
                on ? 'border-2 border-rose-600 bg-selected' : 'border border-line bg-white'
              }`}
            >
              <input
                type="radio"
                name="bk-svc"
                value={s.id}
                checked={on}
                onChange={() => onPick(s.id)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className="box-content flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-rose-600"
              >
                <span className={`h-[10px] w-[10px] rounded-full ${on ? 'bg-rose-600' : 'bg-transparent'}`} />
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-[17px] font-bold text-ink-900">{s.name}</span>
                <span className="text-[13px] text-ink-500">{`${s.minutes} 分鐘 · ${s.tagline}`}</span>
              </span>
              <span className="text-[18px] font-bold text-rose-800">{formatPrice(s.price)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
