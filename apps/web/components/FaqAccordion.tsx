'use client';

import { useId, useState } from 'react';

export interface FaqItem {
  q: string;
  a: string;
}

/**
 * FAQ 手風琴：一次只開一題（預設第 1 題），再點一次已開的題目會收起。
 * 收起的答案仍在 HTML（hidden），搜尋引擎讀得到。
 */
export default function FaqAccordion({ items, defaultOpen = 0 }: { items: readonly FaqItem[]; defaultOpen?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  const baseId = useId();

  return (
    <>
      {items.map((item, i) => {
        const isOpen = open === i;
        const btnId = `${baseId}-q${i}`;
        const panelId = `${baseId}-a${i}`;
        return (
          <div key={item.q} className="overflow-hidden rounded-[14px] border border-rose-600/[.18] bg-white">
            <h2>
              <button
                id={btnId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? -1 : i)}
                className="flex w-full items-center justify-between gap-4 px-[18px] py-[18px] text-left text-[16px] font-medium leading-[1.6] text-ink-900 hover:bg-soft focus-visible:-outline-offset-2 md:px-6 md:py-5"
              >
                <span>{item.q}</span>
                <span aria-hidden="true" className="text-[22px] text-rose-600">
                  {isOpen ? '−' : '+'}
                </span>
              </button>
            </h2>
            <div
              id={panelId}
              role="region"
              aria-labelledby={btnId}
              hidden={!isOpen}
              className="px-6 pb-[22px] text-[15px] leading-[2] text-ink-600"
            >
              {item.a}
            </div>
          </div>
        );
      })}
    </>
  );
}
