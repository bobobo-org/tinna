'use client';

import { useEffect, useState } from 'react';

// 不會叫出虛擬鍵盤的 input：日期／時間是原生選擇器（iOS 浮層、Android 對話框）蓋在頁面上，
// 選完後焦點還留在欄位上，若照樣收起結帳列，使用者會找不到「下一步」
const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'hidden',
  'image',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
]);

function opensKeyboard(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * 觸控裝置上，會叫出虛擬鍵盤的輸入框聚焦時回傳 true。
 *
 * 手機底部結帳列在這段時間隱藏：iOS Safari 開鍵盤時 layout viewport 不縮，sticky/fixed 在底部的
 * 元素會跑到鍵盤後面或畫面中間，擋住正在輸入的欄位；直接收起最可靠（Android 同樣適用）。
 * 用 focusin/focusout ＋ 下一個 frame 再讀 activeElement（欄位間切換不會閃一下）。
 */
export function useTextEntryFocus(): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const touch = window.matchMedia('(hover: none) and (pointer: coarse)');
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setActive(touch.matches && opensKeyboard(document.activeElement)));
    };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);

  return active;
}
