import { LABELS } from '@/lib/booking/steps';
import type { Step } from '@/lib/booking/types';

/** 4 段進度條（完成／目前＝漸層，未到 #f3d9e3；完成的號碼顯示 ✓） */
export default function Stepper({ step }: { step: Step }) {
  return (
    <ol aria-label="預約步驟" className="grid grid-cols-4 gap-2">
      {LABELS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const cur = n === step;
        return (
          <li key={label} aria-current={cur ? 'step' : undefined} className="flex flex-col gap-2">
            <span aria-hidden="true" className={`block h-1 rounded-[4px] ${done || cur ? 'bg-step-bar' : 'bg-step-idle'}`} />
            <span
              className={`flex items-center gap-[6px] overflow-hidden whitespace-nowrap text-[12px] md:text-[14px] ${
                cur ? 'font-bold text-rose-800' : done ? 'font-medium text-rose-600' : 'font-medium text-step-idle-text'
              }`}
            >
              <span aria-hidden="true">{done ? '✓' : n}</span>
              <span>{label}</span>
              <span className="sr-only">{done ? '（已完成）' : cur ? '（目前步驟）' : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
