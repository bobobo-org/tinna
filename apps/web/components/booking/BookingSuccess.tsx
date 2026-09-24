'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Pearl from '@/components/Pearl';
import { ApiError, MSG_NETWORK, api } from '@/lib/api';
import { clearDraftForOrder, forgetOrder } from '@/lib/booking/draft';
import { buildIcs, icsFileName } from '@/lib/booking/ics';
import { holdExpired } from '@/lib/booking/payload';
import { goToPayment } from '@/lib/booking/pay';
import { formatDateLabel, formatEcpayExpire, taipeiClock } from '@/lib/booking/time';
import type { PublicBooking } from '@/lib/booking/types';
import { formatPrice } from '@/lib/services';
import { BOOKING_PATH, bookingHref } from '@/lib/site';

const ORDER_RE = /^YS[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
/** docs/API.md：pending_payment 每 3 秒輪詢，最多 10 次 */
export const POLL_MS = 3000;
export const POLL_MAX = 10;

type View =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'notfound' }
  | { kind: 'error'; message: string }
  | { kind: 'booking'; b: PublicBooking };

const outlineBtn =
  'inline-flex min-h-[44px] items-center justify-center rounded-pill border border-rose-600/35 px-[26px] py-[13px] text-[15px] text-rose-800 hover:bg-soft';
const primaryBtn =
  'inline-flex min-h-[44px] items-center justify-center rounded-pill bg-btn px-[30px] py-[13px] text-[15px] font-bold text-white hover:brightness-[1.08]';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-right font-bold [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function downloadIcs(b: PublicBooking) {
  const url = `${window.location.origin}/booking/success?order=${encodeURIComponent(b.orderNo)}`;
  const note =
    b.status === 'awaiting_transfer' && b.atm
      ? `尚待轉帳：請於 ${formatEcpayExpire(b.atm.expireDate)} 前轉帳至 ${b.atm.bankCode}-${b.atm.account}，入帳後即確認預約。`
      : undefined;
  const text = buildIcs({
    orderNo: b.orderNo,
    serviceName: b.service.name,
    minutes: b.service.minutes,
    date: b.date,
    time: b.time,
    url,
    note,
    host: window.location.hostname,
  });
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = icsFileName(b.orderNo);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * 預約完成頁 /booking/success?order=（docs/API.md「完成頁」）
 * - confirmed：預約成功；awaiting_transfer：預約已保留＋虛擬帳號與繳費期限
 * - pending_payment：付款確認中…（每 3 秒輪詢、最多 10 次）→ 尚未完成付款＋重新付款
 * - expired / cancelled（或保留已逾時）：預約已逾時＋重新預約
 * - needsAttention（已收款但時段被他人約走）：款項已收到，會聯繫改期或退款（不顯示重新預約）
 * - 缺 order／查無：友善訊息＋回預約頁
 */
export default function BookingSuccess({ orderNo: rawOrderNo, serverNow }: { orderNo: string | null; serverNow: number }) {
  const orderNo = rawOrderNo?.trim().toUpperCase() ?? '';
  const valid = ORDER_RE.test(orderNo);
  const [view, setView] = useState<View>(() => (!rawOrderNo ? { kind: 'missing' } : valid ? { kind: 'loading' } : { kind: 'notfound' }));
  const [polls, setPolls] = useState(0);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const clockSkew = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    clockSkew.current = serverNow - Date.now();
  }, [serverNow]);

  const fetchBooking = useCallback(
    async (quiet = false) => {
      if (!valid) return;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      if (!quiet) setView({ kind: 'loading' });
      try {
        const b = await api.getBooking(orderNo, c.signal);
        if (c.signal.aborted) return;
        setView({ kind: 'booking', b });
      } catch (e) {
        if (c.signal.aborted) return;
        if (e instanceof ApiError && e.status === 404) setView({ kind: 'notfound' });
        else if (!quiet) setView({ kind: 'error', message: e instanceof ApiError ? e.message : MSG_NETWORK });
      }
    },
    [orderNo, valid],
  );

  useEffect(() => {
    void fetchBooking();
    return () => ctrl.current?.abort();
  }, [fetchBooking]);

  const b = view.kind === 'booking' ? view.b : null;
  const expiredHold = !!b && b.status === 'pending_payment' && holdExpired(b, Date.now() + clockSkew.current);
  // 已收到款項但時段已被他人約走（需人工處理）：不顯示「預約已逾時／重新預約」，也不再輪詢或重新付款
  const attention =
    !!b && b.needsAttention === true && (b.status === 'expired' || b.status === 'cancelled' || b.status === 'pending_payment');
  const status = b ? (attention ? 'attention' : expiredHold ? 'expired' : b.status) : null;
  const polling = status === 'pending_payment' && polls < POLL_MAX;

  // 付款確認中：每 3 秒再查一次，最多 10 次
  useEffect(() => {
    if (!polling) return;
    const t = window.setTimeout(() => {
      setPolls((n) => n + 1);
      void fetchBooking(true);
    }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [polling, polls, fetchBooking]);

  // 完成／已取得轉帳帳號：清掉這筆的預約草稿；逾時：只忘掉訂單（資料留著方便重新預約）
  useEffect(() => {
    if (!b) return;
    if (status === 'confirmed' || status === 'awaiting_transfer' || status === 'attention') clearDraftForOrder(b.orderNo);
    else if (status === 'expired' || status === 'cancelled') forgetOrder(b.orderNo);
  }, [b, status]);

  // 從金流頁按返回（bfcache）：解除「付款處理中…」並重查狀態
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setPaying(false);
      setPolls(0);
      void fetchBooking(true);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [fetchBooking]);

  const repay = async () => {
    // VIP 堂數預約建立時就已確認，不會走到重新付款
    if (!b || paying || b.payMethod === 'vip') return;
    setPaying(true);
    setPayError(null);
    try {
      await goToPayment(b.orderNo, b.payMethod);
      window.setTimeout(() => setPaying(false), 20_000);
    } catch (e) {
      setPaying(false);
      if (e instanceof ApiError && ['already_paid', 'awaiting_transfer', 'expired'].includes(e.code)) {
        setPolls(POLL_MAX);
        void fetchBooking(true);
        return;
      }
      setPayError(e instanceof ApiError ? e.message : MSG_NETWORK);
    }
  };

  // ---------- 文案 ----------
  let mark = '!';
  let title = '';
  let sub = '';
  if (view.kind === 'loading') {
    mark = '…';
    title = '查詢訂單中…';
    sub = '正在取得你的預約資料，請稍候。';
  } else if (view.kind === 'missing' || view.kind === 'notfound') {
    title = '找不到這筆訂單';
    sub =
      view.kind === 'missing'
        ? '網址少了訂單編號。請從確認信中的連結開啟，或重新預約。'
        : '請確認網址是否完整；如果剛完成付款，請稍候再重新整理本頁。';
  } else if (view.kind === 'error') {
    title = '暫時無法取得訂單';
    sub = view.message;
  } else if (b) {
    if (status === 'confirmed') {
      mark = '✓';
      title = '預約成功';
      sub =
        b.payMethod === 'vip'
          ? '已使用 1 堂 VIP 堂數。確認信與視訊連結已寄到你的 Email，諮詢前一天會再提醒你。'
          : '確認信與視訊連結已寄到你的 Email。諮詢前一天會再提醒你。';
    } else if (status === 'awaiting_transfer') {
      mark = '✓';
      title = '預約已保留';
      sub = '請於繳費期限前轉帳至下方帳號，入帳後即寄出確認信與視訊連結。';
    } else if (status === 'pending_payment' && polling) {
      mark = '…';
      title = '付款確認中…';
      sub = '正在向金流確認付款結果，請稍候，不要關閉這個頁面。';
    } else if (status === 'pending_payment') {
      title = '尚未完成付款';
      const until = taipeiClock(b.holdExpiresAt);
      sub =
        b.payMethod === 'atm'
          ? `還沒有取得轉帳帳號，請在 30 分鐘內完成取號${until ? `（時段保留至 ${until}）` : ''}；已取號請稍後重新整理本頁。`
          : `還沒有收到這筆訂單的付款結果。已付款請稍後重新整理本頁；尚未付款可以重新付款${until ? `，時段保留至 ${until}` : ''}。`;
    } else if (status === 'attention') {
      if (b.status === 'pending_payment') {
        // 金流回報「付款結果待確認」或結果不明：還不能說已收款
        title = '付款確認中';
        sub = '我們已收到您的付款資訊，需要由專人確認付款結果，會儘快與您聯繫。請勿重複付款。';
      } else {
        mark = '✓';
        title = '款項已收到';
        sub = '已收到您的款項，此時段已被預約，我們會儘快與您聯繫改期或退款。';
      }
    } else if (status === 'refunded') {
      title = '訂單已退款';
      sub = '這筆訂單已完成退款。如仍需要諮詢，歡迎重新預約。';
    } else if (status === 'cancelled') {
      title = '預約已取消';
      sub = '這筆預約已取消，時段已釋出。如仍需要諮詢，請重新預約。';
    } else {
      title = '預約已逾時';
      sub = '付款保留時間已過，這個時段已釋出。如仍需要諮詢，請重新預約。';
    }
  }

  const amountLabel =
    status === 'confirmed' || status === 'attention' ? '已付金額' : status === 'refunded' ? '退款金額' : status === 'pending_payment' || status === 'awaiting_transfer' ? '待付金額' : '訂單金額';
  const showCalendar = status === 'confirmed' || status === 'awaiting_transfer';

  return (
    <section className="satin px-6 pb-24 pt-[72px]">
      <div
        aria-live="polite"
        aria-busy={view.kind === 'loading' || polling}
        className="mx-auto box-content flex max-w-[560px] flex-col gap-[18px] rounded-3xl bg-white px-9 py-11 text-center shadow-done"
      >
        <Pearl className={`mx-auto h-[72px] w-[72px] text-[32px] font-bold text-white shadow-done-check ${mark === '…' ? 'motion-safe:animate-pulse' : ''}`}>
          <span aria-hidden="true">{mark}</span>
        </Pearl>
        <h1 className="font-serif text-[32px] font-bold text-ink-900">{title}</h1>
        <p className="text-[15px] leading-[1.9] text-ink-600">{sub}</p>

        {b && (
          <dl className="flex flex-col gap-[10px] rounded-[14px] bg-soft-2 p-5 text-left text-[14px] text-ink-700">
            <Row label="訂單編號" value={b.orderNo} />
            <Row label="方案" value={b.service.name} />
            <Row label="時間" value={`${formatDateLabel(b.date)} ${b.time}`} />
            {b.payMethod === 'vip' ? (
              <Row label="付款方式" value="VIP 堂數（1 堂）" />
            ) : (
              <Row label={amountLabel} value={formatPrice(b.amount)} />
            )}
            {status === 'awaiting_transfer' && b.atm && (
              <>
                <Row label="虛擬帳號" value={`${b.atm.bankCode}-${b.atm.account}`} />
                {b.atm.expireDate && <Row label="繳費期限" value={formatEcpayExpire(b.atm.expireDate)} />}
              </>
            )}
          </dl>
        )}

        {payError && (
          <p role="alert" className="text-[14px] leading-[1.8] text-error">
            {payError}
          </p>
        )}

        {view.kind !== 'loading' && !polling && (
          <div className="flex flex-wrap justify-center gap-3 pt-[6px]">
            {showCalendar && b && (
              <button type="button" onClick={() => downloadIcs(b)} className={outlineBtn}>
                加入行事曆
              </button>
            )}
            {!showCalendar && (
              <Link href="/" className={status === 'attention' ? primaryBtn : outlineBtn}>
                返回首頁
              </Link>
            )}
            {showCalendar && (
              <Link href="/" className={primaryBtn}>
                返回首頁
              </Link>
            )}
            {status === 'pending_payment' && (
              <button type="button" onClick={repay} aria-disabled={paying} className={`${primaryBtn} ${paying ? 'opacity-[.45]' : ''}`}>
                {paying ? '付款處理中…' : '重新付款'}
              </button>
            )}
            {(status === 'expired' || status === 'cancelled' || status === 'refunded') && b && (
              <Link href={bookingHref(b.service.id)} className={primaryBtn}>
                重新預約
              </Link>
            )}
            {(view.kind === 'missing' || view.kind === 'notfound') && (
              <Link href={BOOKING_PATH} className={primaryBtn}>
                回預約頁
              </Link>
            )}
            {view.kind === 'error' && (
              <button type="button" onClick={() => void fetchBooking()} className={primaryBtn}>
                重試
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
