/**
 * 預約摘要：桌機右側白卡（SummaryCard）／手機 sticky 底部結帳列（MobileBar）
 */

export interface SummaryValues {
  svc: string;
  date: string;
  time: string;
  price: string;
}

export function SummaryCard({ sum }: { sum: SummaryValues }) {
  return (
    <aside
      aria-labelledby="bk-sum-title"
      className="box-content hidden min-w-0 flex-[1_1_280px] flex-col gap-4 rounded-[20px] border border-t-4 border-rose-600/[.16] border-t-rose-300 bg-white p-7 shadow-summary md:flex"
    >
      <h2 id="bk-sum-title" className="font-serif text-[20px] font-bold text-ink-900">
        預約摘要
      </h2>
      <dl className="flex flex-col gap-3 text-[14px] text-ink-700">
        <div className="flex justify-between gap-3">
          <dt>方案</dt>
          <dd className="text-right font-bold">{sum.svc}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>日期</dt>
          <dd className="font-bold">{sum.date}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>時段</dt>
          <dd className="font-bold">{sum.time}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>形式</dt>
          <dd className="font-bold">線上視訊</dd>
        </div>
      </dl>
      <div aria-hidden="true" className="h-px bg-rose-800/20" />
      <div className="flex items-baseline justify-between">
        <span className="text-[15px] text-ink-700">應付金額</span>
        <span className="font-serif text-[30px] font-bold text-rose-800">{sum.price}</span>
      </div>
      <p className="text-[12px] leading-[1.8] text-ink-600">付款完成即保留時段，確認信將寄至您的 Email。</p>
    </aside>
  );
}

export function MobileBar({
  sum,
  open,
  onToggle,
  onBack,
  onNext,
  backDisabled,
  backBusy,
  nextDisabled,
  nextLabel,
  busy,
  hidden,
}: {
  sum: SummaryValues;
  open: boolean;
  onToggle: () => void;
  onBack: () => void;
  onNext: () => void;
  backDisabled: boolean;
  /** 付款處理中：上一步無作用（外觀不變） */
  backBusy: boolean;
  nextDisabled: boolean;
  nextLabel: string;
  busy: boolean;
  /** 輸入框聚焦（虛擬鍵盤開啟）時收起，不遮住正在輸入的欄位 */
  hidden: boolean;
}) {
  return (
    <div
      className={`sticky bottom-0 z-[15] flex flex-col border-t border-line-3 bg-white shadow-booking-bar md:hidden [html.menu-open_&]:hidden ${
        hidden ? 'invisible' : ''
      }`}
    >
      {open && (
        <dl id="bk-sum-panel" className="flex flex-col gap-[10px] px-5 pb-1 pt-[18px] text-[14px] text-ink-700">
          <div className="flex justify-between">
            <dt>方案</dt>
            <dd className="font-bold">{sum.svc}</dd>
          </div>
          <div className="flex justify-between">
            <dt>日期時段</dt>
            <dd className="font-bold">{`${sum.date} ${sum.time}`}</dd>
          </div>
          <div className="flex justify-between">
            <dt>形式</dt>
            <dd className="font-bold">線上視訊</dd>
          </div>
        </dl>
      )}
      <div className="flex items-center gap-[10px] pb-[calc(12px+env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] pt-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="上一步"
          aria-disabled={backDisabled || backBusy}
          className={`box-content flex h-12 w-12 flex-none items-center justify-center rounded-full border border-rose-600/30 text-[20px] text-rose-800 ${
            backDisabled ? 'opacity-[.35]' : ''
          }`}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={open ? 'bk-sum-panel' : undefined}
          aria-label={`應付金額 ${sum.price}，${open ? '收起' : '展開'}預約摘要`}
          className="flex min-w-0 flex-1 flex-col text-left"
        >
          <span className="text-[12px] text-ink-400">{`應付金額 ${open ? '▾' : '▴'}`}</span>
          <span className="font-serif text-[22px] font-bold text-rose-800">{sum.price}</span>
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-disabled={nextDisabled}
          aria-busy={busy || undefined}
          className={`flex h-12 flex-none items-center whitespace-nowrap rounded-pill bg-btn px-6 text-[15px] font-bold text-white shadow-btn-sm ${
            nextDisabled ? 'opacity-[.45]' : ''
          }`}
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
