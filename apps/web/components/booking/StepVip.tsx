import Link from 'next/link';
import type { Ref } from 'react';
import type { FieldErrors } from '@/lib/booking/types';
import { AgreeField, PayError } from './AgreeField';
import { errorCls, inputCls, labelWrapCls } from './styles';

const infoCls = 'rounded-[14px] bg-pay-info p-[22px] text-[15px] leading-[1.9] text-ink-600';

/**
 * Step 4（VIP 諮詢）：不選付款方式，輸入 VIP 卡號使用堂數
 * 卡號＋Step 3 的 Email 要和購買 VIP 時相同（API 核對），每次預約扣 1 堂
 */
export default function StepVip({
  vipCard,
  email,
  agree,
  errors,
  payError,
  busy,
  onVipCard,
  onToggleAgree,
  headingRef,
}: {
  vipCard: string;
  /** Step 3 填的 Email（提醒要和購買 VIP 時相同） */
  email: string;
  agree: boolean;
  errors: FieldErrors;
  payError: string | null;
  busy: boolean;
  onVipCard: (v: string) => void;
  onToggleAgree: (v: boolean) => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex flex-col gap-[18px]">
      <h2 ref={headingRef} id="bk-step-title" tabIndex={-1} className="font-serif text-[22px] font-bold text-ink-900 outline-none">
        使用 VIP 堂數
      </h2>

      <div className={infoCls}>
        VIP 諮詢使用 VIP 堂數預約，每次扣 1 堂，不需另外付款；送出後立即確認時段。
        <br />
        請確認第 3 步填寫的 Email
        {email.trim() ? <b className="text-ink-900 [overflow-wrap:anywhere]">（{email.trim()}）</b> : null}
        與購買 VIP 時相同。
      </div>

      <div className={labelWrapCls}>
        <label htmlFor="bk-vip">VIP 卡號 *</label>
        <input
          id="bk-vip"
          name="vip-card"
          value={vipCard}
          onChange={(e) => onVipCard(e.target.value)}
          placeholder="VIP-XXXX-XXXX"
          maxLength={20}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          aria-required="true"
          aria-invalid={errors.vip ? true : undefined}
          aria-describedby={errors.vip ? 'bk-vip-err' : undefined}
          className={`${inputCls} uppercase tracking-[.08em]`}
        />
        {errors.vip && (
          <span id="bk-vip-err" className={errorCls}>
            {errors.vip}
          </span>
        )}
        <p className="text-[13px] leading-[1.8] text-ink-500">
          卡號在購買 VIP 後的 Email 裡。
          <Link href="/vip#lookup" className="text-rose-800 underline underline-offset-4">
            查詢剩餘堂數
          </Link>
          <span aria-hidden="true"> · </span>
          <Link href="/vip" className="text-rose-800 underline underline-offset-4">
            還不是 VIP？看包堂方案
          </Link>
        </p>
      </div>

      <AgreeField agree={agree} busy={busy} error={errors.agree} onToggle={onToggleAgree} />
      <PayError message={payError} />
    </div>
  );
}
