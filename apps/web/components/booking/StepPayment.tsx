import type { Ref } from 'react';
import type { PayAvailability } from '@/lib/booking/payments';
import type { FieldErrors, PayMethod, PaymentConfig } from '@/lib/booking/types';
import { errorCls, focusRingWithin } from './styles';

const PAY_DEFS: { id: PayMethod; label: string; sub: string }[] = [
  { id: 'card', label: '信用卡', sub: 'VISA / Master / JCB' },
  { id: 'line', label: 'LINE Pay', sub: '跳轉 LINE 完成付款' },
  { id: 'atm', label: 'ATM 轉帳', sub: '24 小時內完成' },
];

const infoCls = 'rounded-[14px] bg-pay-info p-[22px] text-[15px] leading-[1.9] text-ink-600';

/**
 * Step 4 付款
 * - 信用卡不在本站收卡號：原型的卡號／有效期／CVC 欄位改成付款資訊框說明，按下確認付款後前往綠界付款頁
 * - GET /config 未開通的付款方式：停用＋「即將開放」
 * - ATM：時段距離開始不到 atmMinLeadHours 小時 → 停用＋一行小字說明
 * - paymentEnv=stage：一行小字提示測試環境
 */
export default function StepPayment({
  pay,
  agree,
  errors,
  config,
  availability,
  notice,
  payError,
  busy,
  onPickPay,
  onToggleAgree,
  headingRef,
}: {
  pay: PayMethod;
  agree: boolean;
  errors: FieldErrors;
  config: PaymentConfig | null;
  availability: PayAvailability;
  /** 例：改了近期時段，ATM 不能用 → 已自動改成信用卡 */
  notice: string | null;
  payError: string | null;
  /** 付款處理中：鎖住選項，避免送出途中改付款方式 */
  busy: boolean;
  onPickPay: (m: PayMethod) => void;
  onToggleAgree: (v: boolean) => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const { enabled, atmTooSoon, leadHours } = availability;
  // ATM 預設關閉：API 明確開放（config atm=true）才顯示這個選項
  const atmOffered = config?.payments.atm === true;
  const atmLeadBlocked = atmTooSoon && atmOffered;
  const defs = PAY_DEFS.filter((p) => p.id !== 'atm' || atmOffered);

  return (
    <div className="flex flex-col gap-[18px]">
      <h2 ref={headingRef} id="bk-step-title" tabIndex={-1} className="font-serif text-[22px] font-bold text-ink-900 outline-none">
        選擇付款方式
      </h2>

      {notice && (
        <p role="status" className="rounded-[12px] bg-soft-2 px-4 py-3 text-[14px] leading-[1.8] text-ink-600">
          {notice}
        </p>
      )}

      <div
        role="radiogroup"
        aria-labelledby="bk-step-title"
        aria-describedby={errors.pay ? 'bk-pay-err' : undefined}
        className="grid grid-cols-[minmax(0,1fr)] gap-[10px] md:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]"
      >
        {defs.map((p) => {
          const on = enabled[p.id];
          const sel = pay === p.id && on;
          const leadBlocked = p.id === 'atm' && atmLeadBlocked;
          return (
            <label
              key={p.id}
              className={`relative flex flex-col gap-1 rounded-[12px] p-4 ${focusRingWithin} ${
                sel ? 'border-2 border-rose-600 bg-selected' : 'border border-line bg-white'
              } ${on ? 'cursor-pointer' : 'cursor-not-allowed opacity-[.45]'}`}
            >
              <input
                id={`bk-pay-${p.id}`}
                type="radio"
                name="pay"
                value={p.id}
                checked={sel}
                disabled={!on || busy}
                onChange={() => onPickPay(p.id)}
                aria-describedby={leadBlocked ? 'bk-atm-note' : undefined}
                className="sr-only"
              />
              <span className="text-[16px] font-bold text-ink-900">{p.label}</span>
              <span className="text-[12px] text-ink-500">{on || leadBlocked ? p.sub : '即將開放'}</span>
            </label>
          );
        })}
      </div>
      {atmLeadBlocked && (
        <p id="bk-atm-note" className="-mt-2 text-[12px] leading-[1.8] text-ink-400">
          {`ATM 轉帳需於諮詢開始 ${leadHours} 小時前預約`}
        </p>
      )}
      {errors.pay && (
        <span id="bk-pay-err" className={errorCls}>
          {errors.pay}
        </span>
      )}

      {pay === 'card' && (
        <div className={infoCls}>
          按下「確認付款」後，將前往綠界 ECPay 安全付款頁輸入卡號完成付款；本站不經手、也不儲存你的卡號。
        </div>
      )}
      {pay === 'line' && <div className={infoCls}>點擊付款後將跳轉至 LINE Pay 完成付款，完成後自動返回本頁。</div>}
      {pay === 'atm' && <div className={infoCls}>送出後會產生專屬虛擬帳號，請於 24 小時內完成轉帳；逾時時段將自動釋出。</div>}

      {config?.paymentEnv === 'stage' && (
        <p className="-mt-2 text-[12px] leading-[1.8] text-ink-400">
          目前為測試環境，不會實際扣款（測試卡號 <span className="whitespace-nowrap">4311-9522-2222-2222</span>）
        </p>
      )}

      <label className="relative -my-[11px] flex cursor-pointer items-center gap-[10px] py-[11px] text-[14px] text-ink-600">
        <input
          id="bk-agree"
          type="checkbox"
          checked={agree}
          disabled={busy}
          onChange={(e) => onToggleAgree(e.target.checked)}
          aria-invalid={errors.agree ? true : undefined}
          aria-describedby={errors.agree ? 'bk-agree-err' : undefined}
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
        {errors.agree ?? ''}
      </span>

      {payError && (
        <p id="bk-pay-error" role="alert" tabIndex={-1} className="rounded-[12px] border border-error/25 bg-soft-2 px-4 py-3 text-[14px] leading-[1.8] text-error outline-none">
          {payError}
        </p>
      )}
    </div>
  );
}
