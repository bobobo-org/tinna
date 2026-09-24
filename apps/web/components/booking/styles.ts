/**
 * 預約表單共用 class（數值照 design/site.dc.html）
 *
 * 輸入框：padding 12px 14px、圓角 10、框線 #efcad8、16px（避免 iOS 聚焦時放大）、底 #fffafc
 * - 原型 outline:none；這裡改成聚焦時框線轉深＋淡光暈（無障礙：看得出目前在哪一格）
 * - placeholder 用瀏覽器預設色（原型沒設；Tailwind preflight 會改成灰色，這裡 revert 回去）
 * - date/time：iOS Safari 預設外觀會無視寬高（空值時又窄又矮、文字置中）→ 只在 iOS（@supports -webkit-touch-callout）
 *   改 appearance:none，再給 min-height 50px（＝文字框高度）、值靠左；桌機／Android Chrome 維持原生外觀（和原型一致）
 */

export const labelWrapCls = 'flex flex-col gap-[6px] text-[14px] text-ink-600';

export const inputCls =
  'w-full rounded-[10px] border border-line-2 bg-input px-[14px] py-3 text-[16px] text-ink-900 outline-none ' +
  '[&::placeholder]:[color:revert] focus:border-rose-600 focus:shadow-[0_0_0_3px_rgba(185,38,90,.12)]';

export const dateTimeCls =
  'min-h-[50px] supports-[-webkit-touch-callout:none]:appearance-none ' +
  '[&::-webkit-date-and-time-value]:min-h-[1.5em] [&::-webkit-date-and-time-value]:text-left';

export const errorCls = 'text-[12px] text-error';

/** 按鈕本身的鍵盤焦點框（主題選擇等） */
export const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600';

/** 珍珠圓 radio／勾選框：18px＋2px 框（content-box → 外框 22px，和原型一樣） */
export const focusRingWithin =
  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-rose-600';
