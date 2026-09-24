/**
 * 步驟 ↔ 網址（?svc=&step=）與「上一步」要不要用瀏覽器返回
 *
 * 瀏覽器歷史要和步驟一致：下一步 push 一筆；上一步如果前一筆歷史就是上一步，
 * 直接 history.back()（歷史不會越疊越長、瀏覽器上一頁也還是上一步），否則 replace。
 * NavHistory 只記「本頁面內」由我們 push/replace 的步驟，外部導覽（上一頁、下一頁、點連結）
 * 用 syncExternal 對齊。
 */

import type { Step } from './types';

export const LABELS = ['選擇方案', '選日期時段', '填寫資料', '付款'] as const;

export function parseStep(raw: string | null | undefined): Step {
  const n = Number(raw);
  return n === 2 || n === 3 || n === 4 ? n : 1;
}

/** svc=love&step=2（沒選方案就只帶 step；step=1 且沒方案 → 空字串） */
export function buildSearch(svc: string | null, step: Step): string {
  const q = new URLSearchParams();
  if (svc) q.set('svc', svc);
  if (svc || step !== 1) q.set('step', String(step));
  return q.toString();
}

export interface NavHistory {
  entries: Step[];
  idx: number;
}

export function initNav(step: Step): NavHistory {
  return { entries: [step], idx: 0 };
}

export function navPush(h: NavHistory, step: Step): NavHistory {
  return { entries: [...h.entries.slice(0, h.idx + 1), step], idx: h.idx + 1 };
}

export function navReplace(h: NavHistory, step: Step): NavHistory {
  const entries = [...h.entries];
  entries[h.idx] = step;
  return { entries, idx: h.idx };
}

/**
 * 要回到 target：前面的歷史裡有 target（而且中間都是更後面的步驟）→ 回傳要 history.go 的負數；
 * 沒有 → null（改用 replace）
 */
export function navBackDelta(h: NavHistory, target: Step): number | null {
  for (let j = h.idx - 1; j >= 0; j--) {
    const s = h.entries[j]!;
    if (s === target) return j - h.idx;
    if (s < target) return null;
  }
  return null;
}

/** 外部造成的網址變化（瀏覽器上一頁／下一頁、點連結）→ 對齊記錄 */
export function syncExternal(h: NavHistory, step: Step): NavHistory {
  if (h.entries[h.idx] === step) return h;
  // 往回：找最近一筆相同步驟
  for (let j = h.idx - 1; j >= 0; j--) {
    if (h.entries[j] === step) return { entries: h.entries, idx: j };
  }
  // 往前（瀏覽器下一頁）
  for (let j = h.idx + 1; j < h.entries.length; j++) {
    if (h.entries[j] === step) return { entries: h.entries, idx: j };
  }
  return initNav(step);
}
