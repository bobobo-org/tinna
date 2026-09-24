import { errorCls } from './styles';

/** Step 4 共用：同意改期與退款規則（付款／VIP 堂數都要勾） */
export function AgreeField({
  agree,
  busy,
  error,
  onToggle,
}: {
  agree: boolean;
  busy: boolean;
  error: string | undefined;
  onToggle: (v: boolean) => void;
}) {
  return (
    <>
      <label className="relative -my-[11px] flex cursor-pointer items-center gap-[10px] py-[11px] text-[14px] text-ink-600">
        <input
          id="bk-agree"
          type="checkbox"
          checked={agree}
          disabled={busy}
          onChange={(e) => onToggle(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'bk-agree-err' : undefined}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`box-content flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border-2 border-rose-600 text-[12px] text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-rose-600 ${
            agree ? 'bg-rose-600' : 'bg-transparent'
          }`}
        >
          ✓
        </span>
        <span>我已閱讀並同意改期與退款規則（諮詢前 48 小時可免費改期一次）</span>
      </label>
      <span id="bk-agree-err" className={errorCls}>
        {error ?? ''}
      </span>
    </>
  );
}

/** Step 4 共用：送出失敗的訊息（focus 目標 bk-pay-error） */
export function PayError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p id="bk-pay-error" role="alert" tabIndex={-1} className="rounded-[12px] border border-error/25 bg-soft-2 px-4 py-3 text-[14px] leading-[1.8] text-error outline-none">
      {message}
    </p>
  );
}
