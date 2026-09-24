'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { errorCls, inputCls, labelWrapCls } from '@/components/booking/styles';
import { ApiError, MSG_NETWORK, api } from '@/lib/api';
import { EMAIL_RE } from '@/lib/booking/validate';
import { bookingHref } from '@/lib/site';
import { normalizeVipCard, slashDate, type VipLookupResponse } from '@/lib/vip';

const STATUS_LABEL: Record<string, string> = {
  confirmed: '已確認',
  cancelled: '已取消',
  refunded: '已退款',
  expired: '已逾時',
};

/** 查詢剩餘堂數：VIP 卡號＋購買時的 Email（POST /vip/lookup） */
export default function VipLookup() {
  const [card, setCard] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VipLookupResponse | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cardNo = normalizeVipCard(card);
    if (!cardNo) return setError('請輸入正確的 VIP 卡號（例：VIP-AB2C-D3EF）');
    if (!EMAIL_RE.test(email.trim())) return setError('請填寫購買時的 Email');
    setBusy(true);
    setError(null);
    try {
      setResult(await api.vipLookup(cardNo, email.trim()));
      setCard(cardNo);
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : MSG_NETWORK);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4 rounded-[20px] border border-rose-600/[.16] bg-white px-4 py-6 shadow-form md:p-8"
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4">
          <div className={labelWrapCls}>
            <label htmlFor="lookup-card">VIP 卡號</label>
            <input
              id="lookup-card"
              value={card}
              onChange={(e) => setCard(e.target.value)}
              placeholder="VIP-XXXX-XXXX"
              maxLength={20}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} uppercase tracking-[.08em]`}
            />
          </div>
          <div className={labelWrapCls}>
            <label htmlFor="lookup-email">購買時的 Email</label>
            <input
              id="lookup-email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={254}
              className={inputCls}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className={`${errorCls} text-[14px]`}>
            {error}
          </p>
        )}
        <button
          type="submit"
          aria-disabled={busy}
          className={`self-start rounded-pill border border-rose-600/40 bg-white px-7 py-3 text-[15px] font-bold text-rose-800 hover:bg-soft ${busy ? 'opacity-50' : ''}`}
        >
          {busy ? '查詢中…' : '查詢'}
        </button>
      </form>

      {result && (
        <section aria-live="polite" className="flex flex-col gap-4 rounded-[20px] border border-rose-600/20 bg-card px-5 py-6 shadow-card md:px-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-serif text-[22px] font-bold text-ink-900">
              {result.name}・{result.planName}
            </h3>
            <span className="text-[14px] tracking-[.08em] text-ink-500">{result.cardNo}</span>
          </div>
          <div className="flex flex-wrap gap-6">
            <p className="flex flex-col">
              <span className="text-[13px] text-ink-500">剩餘堂數</span>
              <span className="font-serif text-[36px] font-bold text-rose-800">
                {result.sessionsLeft}
                <span className="text-[16px] font-normal text-ink-500"> / {result.sessionsTotal} 堂</span>
              </span>
            </p>
            <p className="flex flex-col">
              <span className="text-[13px] text-ink-500">使用期限</span>
              <span className="pt-3 text-[18px] font-bold text-ink-900">
                {slashDate(result.expiresOn)} 止
                {result.expired && <span className="ml-2 text-[14px] font-normal text-error">（已過期）</span>}
              </span>
            </p>
          </div>
          {result.bookings.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-[14px] font-bold text-ink-700">預約紀錄</h4>
              <ul className="flex flex-col divide-y divide-line-4 rounded-[12px] bg-white px-4">
                {result.bookings.map((b) => (
                  <li key={b.orderNo} className="flex flex-wrap justify-between gap-2 py-3 text-[14px] text-ink-700">
                    <span>
                      {slashDate(b.date)} {b.time}・{b.serviceName}
                    </span>
                    <span className="text-ink-500">{STATUS_LABEL[b.status] ?? b.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!result.expired && result.sessionsLeft > 0 && (
            <Link
              href={bookingHref('vip')}
              className="self-start rounded-pill bg-btn px-7 py-3 text-[15px] font-bold text-white shadow-btn-sm hover:brightness-[1.08]"
            >
              用 VIP 堂數預約
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
