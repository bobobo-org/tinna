'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Pearl from '@/components/Pearl';
import { ApiError, MSG_NETWORK, api } from '@/lib/api';
import { goToOrderPayment } from '@/lib/booking/pay';
import { taipeiClock } from '@/lib/booking/time';
import { formatPrice } from '@/lib/services';
import { bookingHref } from '@/lib/site';
import { slashDate, type PublicOrder } from '@/lib/vip';

const ORDER_RE = /^YS[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
/** 付款確認中：每 3 秒輪詢，最多 10 次（和預約完成頁相同） */
const POLL_MS = 3000;
const POLL_MAX = 10;

type View =
  | { kind: 'loading' }
  | { kind: 'notfound' }
  | { kind: 'error'; message: string }
  | { kind: 'order'; o: PublicOrder };

const outlineBtn =
  'inline-flex min-h-[44px] items-center justify-center rounded-pill border border-rose-600/35 px-[26px] py-[13px] text-[15px] text-rose-800 hover:bg-soft';
const primaryBtn =
  'inline-flex min-h-[44px] items-center justify-center rounded-pill bg-btn px-[30px] py-[13px] text-[15px] font-bold text-white hover:brightness-[1.08]';

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className={`text-right [overflow-wrap:anywhere] ${strong ? 'font-bold text-ink-900' : ''}`}>{value}</dd>
    </div>
  );
}

/** 付款完成的 VIP 卡：卡號（可複製）、方案、堂數、期限 */
function VipCard({ vip }: { vip: NonNullable<PublicOrder['vip']> }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(vip.cardNo);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 不支援剪貼簿：使用者自己抄
    }
  };
  return (
    <div className="satin flex flex-col gap-3 rounded-[18px] border border-white/80 px-6 py-6 text-left shadow-card">
      <p className="text-[12px] tracking-[.4em] text-rose-accent">VIP CARD</p>
      <p className="font-serif text-[26px] font-bold tracking-[.12em] text-ink-900 [overflow-wrap:anywhere]">{vip.cardNo}</p>
      <div className="flex flex-wrap items-center justify-between gap-3 text-[14px] text-ink-700">
        <span>
          {vip.planName}・剩 {vip.sessionsLeft} / {vip.sessionsTotal} 堂・{slashDate(vip.expiresOn)} 止
        </span>
        <button type="button" onClick={() => void copy()} className="text-[13px] text-rose-800 underline underline-offset-4">
          {copied ? '已複製' : '複製卡號'}
        </button>
      </div>
    </div>
  );
}

/**
 * 訂單頁 /orders/<訂單編號>（VIP 購買、商店）
 * - pending_payment：付款確認中…（輪詢）→ 尚未完成付款＋重新付款
 * - paid（VIP）：顯示 VIP 卡號＋用堂數預約；paid／shipped／completed（商店）：付款完成／已出貨
 * - expired／cancelled：訂單已逾時／已取消
 */
export default function OrderResult({ orderNo: rawOrderNo }: { orderNo: string }) {
  const orderNo = rawOrderNo.trim().toUpperCase();
  const valid = ORDER_RE.test(orderNo);
  const [view, setView] = useState<View>(() => (valid ? { kind: 'loading' } : { kind: 'notfound' }));
  const [polls, setPolls] = useState(0);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const fetchOrder = useCallback(
    async (quiet = false) => {
      if (!valid) return;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      if (!quiet) setView({ kind: 'loading' });
      try {
        const o = await api.getOrder(orderNo, c.signal);
        if (c.signal.aborted) return;
        setView({ kind: 'order', o });
      } catch (e) {
        if (c.signal.aborted) return;
        if (e instanceof ApiError && e.status === 404) setView({ kind: 'notfound' });
        else if (!quiet) setView({ kind: 'error', message: e instanceof ApiError ? e.message : MSG_NETWORK });
      }
    },
    [orderNo, valid],
  );

  useEffect(() => {
    void fetchOrder();
    return () => ctrl.current?.abort();
  }, [fetchOrder]);

  const o = view.kind === 'order' ? view.o : null;
  const polling = o?.status === 'pending_payment' && polls < POLL_MAX;

  useEffect(() => {
    if (!polling) return;
    const t = window.setTimeout(() => {
      setPolls((n) => n + 1);
      void fetchOrder(true);
    }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [polling, polls, fetchOrder]);

  // 從綠界按返回（bfcache）：解除「付款處理中…」並重查
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setPaying(false);
      setPolls(0);
      void fetchOrder(true);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [fetchOrder]);

  const repay = async () => {
    if (!o || paying) return;
    setPaying(true);
    setPayError(null);
    try {
      await goToOrderPayment(o.orderNo);
      window.setTimeout(() => setPaying(false), 20_000);
    } catch (e) {
      setPaying(false);
      if (e instanceof ApiError && (e.code === 'already_paid' || e.code === 'expired')) {
        setPolls(POLL_MAX);
        void fetchOrder(true);
        return;
      }
      setPayError(e instanceof ApiError ? e.message : MSG_NETWORK);
    }
  };

  // ---------- 文案 ----------
  let mark = '!';
  let title = '';
  let sub = '';
  const isVip = o?.kind === 'vip';
  const again = isVip ? { href: '/vip', label: '重新選購 VIP' } : null;
  if (view.kind === 'loading') {
    mark = '…';
    title = '查詢訂單中…';
    sub = '正在取得你的訂單資料，請稍候。';
  } else if (view.kind === 'notfound') {
    title = '找不到這筆訂單';
    sub = '請確認網址是否完整；如果剛完成付款，請稍候再重新整理本頁。';
  } else if (view.kind === 'error') {
    title = '暫時無法取得訂單';
    sub = view.message;
  } else if (o) {
    if (o.status === 'paid' || o.status === 'shipped' || o.status === 'completed') {
      mark = '✓';
      if (isVip) {
        title = '歡迎成為 VIP';
        sub = 'VIP 卡號已寄到你的 Email。預約時選「VIP 諮詢」，輸入卡號與購買時的 Email，每次扣 1 堂。';
      } else if (o.status === 'paid') {
        title = '付款完成';
        sub = '我們已收到你的訂單，出貨後會寄 Email 通知你。';
      } else {
        title = o.status === 'shipped' ? '商品已出貨' : '訂單已完成';
        sub = o.trackingNo ? `物流單號：${o.trackingNo}` : '感謝你的購買。';
      }
    } else if (o.status === 'pending_payment' && polling) {
      mark = '…';
      title = '付款確認中…';
      sub = '正在向金流確認付款結果，請稍候，不要關閉這個頁面。';
    } else if (o.status === 'pending_payment') {
      title = '尚未完成付款';
      const until = taipeiClock(o.holdExpiresAt);
      sub = `還沒有收到這筆訂單的付款結果。已付款請稍後重新整理本頁；尚未付款可以重新付款${until ? `（${until} 前）` : ''}。`;
    } else if (o.status === 'cancelled') {
      title = '訂單已取消';
      sub = '這筆訂單已取消。如有疑問，歡迎與我們聯繫。';
    } else {
      title = '訂單已逾時';
      sub = '付款期限已過，這筆訂單已失效，請重新下單。';
    }
  }

  const paid = !!o && (o.status === 'paid' || o.status === 'shipped' || o.status === 'completed');

  return (
    <section className="satin px-4 pb-24 pt-[72px] md:px-6">
      <div
        aria-live="polite"
        aria-busy={view.kind === 'loading' || polling}
        className="mx-auto box-content flex max-w-[560px] flex-col gap-[18px] rounded-3xl bg-white px-5 py-11 text-center shadow-done md:px-9"
      >
        <Pearl className={`mx-auto h-[72px] w-[72px] text-[32px] font-bold text-white shadow-done-check ${mark === '…' ? 'motion-safe:animate-pulse' : ''}`}>
          <span aria-hidden="true">{mark}</span>
        </Pearl>
        <h1 className="font-serif text-[30px] font-bold text-ink-900">{title}</h1>
        <p className="text-[15px] leading-[1.9] text-ink-600">{sub}</p>

        {o?.vip && paid && <VipCard vip={o.vip} />}

        {o && (
          <dl className="flex flex-col gap-[10px] rounded-[14px] bg-soft-2 p-5 text-left text-[14px] text-ink-700">
            <Row label="訂單編號" value={o.orderNo} strong />
            {o.items.map((i, idx) => (
              <Row key={`${i.name}-${idx}`} label={i.qty > 1 ? `${i.name} × ${i.qty}` : i.name} value={formatPrice(i.unitPrice * i.qty)} />
            ))}
            {o.shippingFee > 0 && <Row label="運費" value={formatPrice(o.shippingFee)} />}
            {o.discountAmount > 0 && <Row label="推薦碼折抵" value={`−${formatPrice(o.discountAmount)}`} />}
            <Row label={paid ? '已付金額' : '應付金額'} value={formatPrice(o.amount)} strong />
          </dl>
        )}

        {payError && (
          <p role="alert" className="text-[14px] leading-[1.8] text-error">
            {payError}
          </p>
        )}

        {view.kind !== 'loading' && !polling && (
          <div className="flex flex-wrap justify-center gap-3 pt-[6px]">
            {paid && isVip && (
              <Link href={bookingHref('vip')} className={primaryBtn}>
                用 VIP 堂數預約
              </Link>
            )}
            {o?.status === 'pending_payment' && (
              <button type="button" onClick={() => void repay()} aria-disabled={paying} className={`${primaryBtn} ${paying ? 'opacity-[.45]' : ''}`}>
                {paying ? '付款處理中…' : '重新付款'}
              </button>
            )}
            {again && o && (o.status === 'expired' || o.status === 'cancelled') && (
              <Link href={again.href} className={primaryBtn}>
                {again.label}
              </Link>
            )}
            {view.kind === 'error' && (
              <button type="button" onClick={() => void fetchOrder()} className={primaryBtn}>
                重試
              </button>
            )}
            <Link href="/" className={outlineBtn}>
              返回首頁
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
