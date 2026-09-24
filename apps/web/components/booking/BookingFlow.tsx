'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, MSG_NETWORK, api } from '@/lib/api';
import { bookableMonths, reconcileSelection } from '@/lib/booking/calendar';
import { EMPTY_FORM, loadDraft, saveDraft } from '@/lib/booking/draft';
import { goToPayment } from '@/lib/booking/pay';
import { fallbackPay, payAvailability } from '@/lib/booking/payments';
import {
  PAY_LABELS,
  canReuseOrder,
  formFingerprint,
  isOwnHold,
  mapApiFieldErrors,
  toBookingBody,
} from '@/lib/booking/payload';
import { buildSearch, initNav, navBackDelta, navPush, navReplace, parseStep, syncExternal } from '@/lib/booking/steps';
import { formatDateLabel, monthDiff, taipeiClock, taipeiMonth, taipeiToday } from '@/lib/booking/time';
import type {
  BookingForm,
  FieldErrors,
  PayMethod,
  PaymentConfig,
  PendingOrder,
  Step,
} from '@/lib/booking/types';
import { canGoNext, clampStep, firstErrorField, validateStep, type ValidationInput } from '@/lib/booking/validate';
import { findService, formatPrice, type Service } from '@/lib/services';
import { MobileBar, SummaryCard, type SummaryValues } from './BookingSummary';
import StepDetails from './StepDetails';
import StepPayment from './StepPayment';
import StepSchedule from './StepSchedule';
import StepService from './StepService';
import Stepper from './Stepper';
import { availKey, STALE_MS, useAvailability } from './useAvailability';
import { useTextEntryFocus } from './useTextEntryFocus';

const MSG_DATE_GONE = '你先前選擇的日期已無法預約，請重新選擇日期與時段';
const MSG_TIME_GONE = '你先前選擇的時段已無法預約，請重新選擇時段';

/** 錯誤欄位 → 要捲過去並 focus 的元素 id */
const FIELD_ELEMENT: Record<string, string> = {
  name: 'bk-name',
  gender: 'bk-gender',
  bdate: 'bk-bdate',
  btime: 'bk-btime',
  bplace: 'bk-bplace',
  phone: 'bk-phone',
  email: 'bk-email',
  q: 'bk-q',
  agree: 'bk-agree',
  payError: 'bk-pay-error',
};

function ownHoldMessage(o: PendingOrder): string {
  const until = taipeiClock(o.holdExpiresAt);
  return (
    `這個時段目前保留給你剛才建立的訂單（${o.orderNo}，${PAY_LABELS[o.pay]}），保留期間無法更改付款方式或資料。` +
    `請改回原本的選擇完成付款，或回上一步改選其他時段${until ? `（保留至 ${until}）` : ''}。`
  );
}

/**
 * 線上預約 4 步流程（design/site.dc.html 的 BOOKING 區塊）
 *
 * - 步驟與方案同步到網址（?svc=&step=）：下一步 push、上一步能用瀏覽器返回就返回；深連結 ?svc=love&step=2 直接進 Step 2
 *   網址更新用 history.pushState/replaceState（Next 會同步 useSearchParams），不必每一步都向伺服器重抓頁面
 * - 表單資料存 sessionStorage：從綠界按返回時資料還在；網址 step 超前 → 退回第一個未完成的步驟
 * - Step 4：POST /bookings → 綠界（表單 POST）或 LINE Pay（導向）；409 回 Step 2 並重新載入時段
 */
export default function BookingFlow({ services, serverNow }: { services: Service[]; serverNow: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  // ---------- 時間：以伺服器時間為準（裝置時鐘不準也不會算錯月份） ----------
  const clockSkew = useRef(0);
  const [nowMs, setNowMs] = useState(serverNow);
  const now = useCallback(() => Date.now() + clockSkew.current, []);
  const today = taipeiToday(nowMs);
  const months = useMemo(() => bookableMonths(taipeiMonth(nowMs)), [nowMs]);

  // ---------- state（原型 state） ----------
  const validSvc = useCallback((id: string | null) => (id && findService(services, id) ? id : null), [services]);
  const [svc, setSvc] = useState<string | null>(() => validSvc(searchParams.get('svc')));
  const [step, setStep] = useState<Step>(() => (validSvc(searchParams.get('svc')) ? parseStep(searchParams.get('step')) : 1));
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [f, setF] = useState<BookingForm>(EMPTY_FORM);
  const [pay, setPay] = useState<PayMethod>('card');
  const [agree, setAgree] = useState(false);
  const [order, setOrder] = useState<PendingOrder | null>(null);
  const [err, setErr] = useState<FieldErrors>({});
  const [paying, setPaying] = useState(false);
  const [sumOpen, setSumOpen] = useState(false);
  const [mo, setMo] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [payNotice, setPayNotice] = useState<string | null>(null);
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [restored, setRestored] = useState(false);
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(null);

  const service = findService(services, svc);
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const keyboardOpen = useTextEntryFocus();
  const { cache: avail, load: loadAvail } = useAvailability();

  // 付款方式：config 開通狀態＋ATM 需在諮詢開始 atmMinLeadHours 小時前（以伺服器時間計）
  const payAv = payAvailability(config, date, time, nowMs);
  const vin: ValidationInput = { svc: service ? svc : null, date, time, f, pay, agree, payEnabled: payAv.enabled };
  // 讓 effect／非同步流程讀到最新值（不必把每個 state 都列進 deps）
  const latest = useRef({ svc, step, date, time, f, pay, agree, order, vin, today });
  latest.current = { svc, step, date, time, f, pay, agree, order, vin, today };

  const requestFocus = useCallback((id: string) => setFocusReq((p) => ({ id, n: (p?.n ?? 0) + 1 })), []);

  // ---------- 網址同步 ----------
  const nav = useRef(initNav(step));
  const ownSearches = useRef<string[]>([]);
  const lastSearch = useRef(search);

  const writeUrl = useCallback((nextSvc: string | null, nextStep: Step, mode: 'push' | 'replace') => {
    const qs = buildSearch(nextSvc, nextStep);
    ownSearches.current.push(qs);
    if (ownSearches.current.length > 20) ownSearches.current.shift();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (mode === 'push') {
      window.history.pushState(null, '', url);
      nav.current = navPush(nav.current, nextStep);
    } else {
      window.history.replaceState(null, '', url);
      nav.current = navReplace(nav.current, nextStep);
    }
  }, []);

  /** 往前一步（push 一筆歷史） */
  const goForward = useCallback(
    (target: Step) => {
      setErr({});
      setNotice(null);
      setPayError(null);
      setPayNotice(null);
      setStep(target);
      writeUrl(latest.current.svc, target, 'push');
    },
    [writeUrl],
  );

  /** 回到前面的步驟：歷史裡有就 history.go（瀏覽器上一頁一致），沒有就 replace */
  const goBackTo = useCallback(
    (target: Step) => {
      setErr({});
      setPayError(null);
      setPayNotice(null);
      setStep(target);
      const delta = navBackDelta(nav.current, target);
      if (delta !== null) {
        ownSearches.current.push(buildSearch(latest.current.svc, target));
        nav.current = { ...nav.current, idx: nav.current.idx + delta };
        window.history.go(delta);
      } else {
        writeUrl(latest.current.svc, target, 'replace');
      }
    },
    [writeUrl],
  );

  // 外部造成的網址變化（瀏覽器上一頁／下一頁、點 Nav 的「立即預約」）→ 對齊 state
  useEffect(() => {
    if (search === lastSearch.current) return;
    lastSearch.current = search;
    const own = ownSearches.current.lastIndexOf(search);
    if (own >= 0) {
      ownSearches.current.splice(0, own + 1);
      return;
    }
    ownSearches.current = [];
    const q = new URLSearchParams(search);
    const nextSvc = validSvc(q.get('svc')) ?? (q.has('svc') ? null : latest.current.svc);
    const nextStep = nextSvc ? parseStep(q.get('step')) : 1;
    nav.current = syncExternal(nav.current, nextStep);
    setSvc(nextSvc);
    setStep(nextStep);
    setErr({});
    setPayError(null);
    // 例：Nav「立即預約」→ /booking（沒帶方案）：沿用已選的方案，網址補上 ?svc=&step=
    if (buildSearch(nextSvc, nextStep) !== search) writeUrl(nextSvc, nextStep, 'replace');
  }, [search, validSvc, writeUrl]);

  // ---------- 掛載：時間、還原草稿、退回未完成的步驟 ----------
  useEffect(() => {
    clockSkew.current = serverNow - Date.now();
    const t = now();
    setNowMs(t);
    const todayNow = taipeiToday(t);
    const base = taipeiMonth(t);
    const cur = latest.current;
    const d = loadDraft();
    let nextSvc = cur.svc;
    let nextDate: string | null = null;
    let nextTime: string | null = null;
    let nextF = cur.f;
    if (d) {
      if (!nextSvc) nextSvc = validSvc(d.svc);
      const off = d.date ? monthDiff(base, d.date.slice(0, 7)) : Number.NaN;
      // 已過去或超出可預約月份的日期不還原
      if (d.date && d.date >= todayNow && off >= 0 && off <= 2) {
        nextDate = d.date;
        nextTime = d.time;
        setMo(off);
      }
      nextF = d.f;
      setDate(nextDate);
      setTime(nextTime);
      setF(d.f);
      setPay(d.pay);
      setAgree(d.agree);
      setOrder(d.order);
    }
    const requested = nextSvc ? cur.step : 1;
    const nextStep = clampStep(
      requested,
      { svc: nextSvc, date: nextDate, time: nextTime, f: nextF, pay: 'card', agree: false },
      todayNow,
    );
    setSvc(nextSvc);
    setStep(nextStep);
    if (buildSearch(nextSvc, nextStep) !== new URLSearchParams(window.location.search).toString()) {
      writeUrl(nextSvc, nextStep, 'replace');
    }
    setRestored(true);
    // 只在掛載時跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 步驟超前（例：時段被清掉、資料不完整）→ 退回第一個未完成的步驟
  useEffect(() => {
    if (!restored) return;
    const c = clampStep(step, vin, today);
    if (c !== step) {
      setStep(c);
      writeUrl(svc, c, 'replace');
    }
    // vin 每次 render 都是新物件：改列出實際影響判斷的欄位
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, step, svc, date, time, f, today, writeUrl]);

  // 存草稿（關分頁即清）
  useEffect(() => {
    if (!restored) return;
    saveDraft({ svc, date, time, f, pay, agree, order });
  }, [restored, svc, date, time, f, pay, agree, order]);

  // 從綠界按返回（bfcache 還原）：解除「付款處理中…」
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      submitting.current = false;
      setPaying(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  // 「上一步」走 history.go，瀏覽器預設會還原離開那一步時的捲動位置（常停在頁底），
  // 蓋掉下面「換步驟捲到表單卡頂端」→ 預約頁期間改由我們自己管理捲動
  useEffect(() => {
    const prev = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = prev;
    };
  }, []);

  // ---------- 換步驟：捲到表單卡頂端、焦點移到步驟標題 ----------
  const prevStep = useRef(step);
  useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    const card = cardRef.current;
    if (card) {
      const navBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
      const top = card.getBoundingClientRect().top;
      if (top < navBottom + 8) window.scrollTo({ top: Math.max(0, window.scrollY + top - navBottom - 12) });
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  // 錯誤欄位：捲到畫面中間並 focus（在換步驟之後執行，會蓋過步驟標題的 focus）
  useEffect(() => {
    if (!focusReq) return;
    const id = focusReq.id === 'pay' ? `bk-pay-${latest.current.pay}` : (FIELD_ELEMENT[focusReq.id] ?? focusReq.id);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  }, [focusReq]);

  // ---------- Step 2：時段資料 ----------
  const month = months[mo]!;
  const monthEntry = svc ? avail[availKey(svc, month)] : undefined;
  const dateMonth = date ? date.slice(0, 7) : null;
  const dateEntry = svc && dateMonth ? avail[availKey(svc, dateMonth)] : undefined;

  useEffect(() => {
    if (!restored || step !== 2 || !svc) return;
    const e = avail[availKey(svc, month)];
    if (!e) loadAvail(svc, month);
    else if (e.status === 'ok' && !e.refreshing && Date.now() - e.fetchedAt > STALE_MS) loadAvail(svc, month, { force: true, silent: true });
    // 目前月份到了之後，順便預抓另外兩個月（切換月份不必等）
    if (e?.status === 'ok') for (const m of months) if (!avail[availKey(svc, m)]) loadAvail(svc, m);
  }, [restored, step, svc, month, months, avail, loadAvail]);

  // 拿到最新時段後，原本選的日期／時段不能約了 → 清掉並提示
  useEffect(() => {
    if (step !== 2 || !svc || !date) return;
    const e = avail[availKey(svc, date.slice(0, 7))];
    if (e?.status !== 'ok' || e.refreshing) return;
    const r = reconcileSelection(e.days, date, time);
    if (!r.changed) return;
    setDate(r.date);
    setTime(null);
    setNotice((prev) => prev ?? (r.reason === 'date' ? MSG_DATE_GONE : MSG_TIME_GONE));
  }, [step, svc, date, time, avail]);

  // ---------- Step 4：付款方式開通狀態 ----------
  useEffect(() => {
    if (step !== 4 || config) return;
    const ctrl = new AbortController();
    api
      .getConfig(ctrl.signal)
      .then((c) => setConfig(c))
      .catch(() => {
        // 讀不到就不停用任何方式，送出時由 API 判斷
      });
    return () => ctrl.abort();
  }, [step, config]);

  // 目前的付款方式不能用（未開通／改成近期時段後 ATM 不適用）→ 自動改回可用的方式並提示
  const { card: canCard, line: canLine, atm: canAtm } = payAv.enabled;
  useEffect(() => {
    if (step !== 4) return;
    const alt = fallbackPay(pay, { card: canCard, line: canLine, atm: canAtm });
    if (!alt) return;
    setPay(alt);
    if (pay === 'atm' && payAv.atmTooSoon) {
      setPayNotice(`所選時段距離諮詢開始不到 ${payAv.leadHours} 小時，無法使用 ATM 轉帳，已改為${PAY_LABELS[alt]}付款。`);
    }
  }, [step, pay, canCard, canLine, canAtm, payAv.atmTooSoon, payAv.leadHours]);

  // ---------- 動作 ----------
  const pickSvc = (id: string) => {
    setSvc(id);
    writeUrl(id, 1, 'replace');
  };

  const pickDate = (d: string) => {
    setDate(d);
    setTime(null);
    setNotice(null);
  };

  const pickTime = (t: string) => {
    setTime(t);
    setNotice(null);
  };

  const setField = <K extends keyof BookingForm>(key: K, value: BookingForm[K]) => {
    setF((prev) => ({ ...prev, [key]: value }));
    setErr((prev) => {
      if (!prev[key as keyof FieldErrors]) return prev;
      const next = { ...prev };
      delete next[key as keyof FieldErrors];
      return next;
    });
  };

  /** 409：時段被搶走 → 回 Step 2、重新載入該月時段、顯示 API 的訊息 */
  const handleSlotConflict = (message: string) => {
    const cur = latest.current;
    setTime(null);
    if (cur.svc && cur.date) {
      const m = cur.date.slice(0, 7);
      const off = monthDiff(months[0]!, m);
      if (off >= 0 && off <= 2) setMo(off);
      loadAvail(cur.svc, m, { force: true });
    }
    goBackTo(2);
    setNotice(message);
  };

  /** 400 validation：回到有錯的那一步顯示欄位錯誤（Step 1/2 的錯誤以提示框顯示） */
  const showFieldErrors = (e: ApiError) => {
    const m = mapApiFieldErrors(e.fields);
    if (m.step <= 2) {
      goBackTo(m.step);
      setNotice(e.message);
      return;
    }
    if (m.step === 3) {
      goBackTo(3);
      setErr(m.errors);
      requestFocus(firstErrorField(m.errors) ?? 'name');
      return;
    }
    setErr(m.errors);
    const extra = m.unknown.length > 0 ? m.unknown.join('、') : !m.errors.agree && !m.errors.pay ? e.message : null;
    if (extra) setPayError(extra);
    requestFocus(firstErrorField(m.errors) ?? 'payError');
  };

  const failPayment = (message: string) => {
    submitting.current = false;
    setPaying(false);
    setPayError(message);
    requestFocus('payError');
  };

  /** 導向金流頁；成功就保持「付款處理中…」直到頁面離開 */
  const redirectToPayment = async (o: PendingOrder, retried = false): Promise<void> => {
    try {
      await goToPayment(o.orderNo, o.pay);
      // 萬一導向被擋（沒有離開頁面），20 秒後讓按鈕恢復
      window.setTimeout(() => {
        submitting.current = false;
        setPaying(false);
      }, 20_000);
    } catch (e) {
      if (!(e instanceof ApiError)) return failPayment(MSG_NETWORK);
      if (e.code === 'already_paid' || e.code === 'awaiting_transfer') {
        router.push(`/booking/success?order=${encodeURIComponent(o.orderNo)}`);
        return;
      }
      if (e.code === 'expired' && !retried) {
        // 保留逾時：重建一筆（時段若已被別人約走會拿到 409）
        setOrder(null);
        return createAndPay(null, true);
      }
      if (e.code === 'payment_unavailable') setConfig(null);
      failPayment(e.message);
    }
  };

  const createAndPay = async (reuse: PendingOrder | null, retried = false): Promise<void> => {
    const cur = latest.current;
    if (!cur.svc || !cur.date || !cur.time) return failPayment('請重新選擇方案與時段');
    if (reuse) return redirectToPayment(reuse, retried);
    try {
      const res = await api.createBooking(
        toBookingBody({ svc: cur.svc, date: cur.date, time: cur.time, f: cur.f, pay: cur.pay, agree: cur.agree }),
      );
      const o: PendingOrder = {
        orderNo: res.orderNo,
        svc: cur.svc,
        date: cur.date,
        time: cur.time,
        pay: res.payMethod ?? cur.pay,
        amount: res.amount,
        holdExpiresAt: res.holdExpiresAt ?? null,
        fp: formFingerprint(cur.f),
      };
      setOrder(o);
      // 馬上寫進 sessionStorage：下一刻就要離開頁面，等不到 effect
      saveDraft({ svc: cur.svc, date: cur.date, time: cur.time, f: cur.f, pay: cur.pay, agree: cur.agree, order: o });
      return redirectToPayment(o, retried);
    } catch (e) {
      if (!(e instanceof ApiError)) return failPayment(MSG_NETWORK);
      if (e.status === 409 && (e.code === 'slot_taken' || e.code === 'slot_unavailable')) {
        const mine = cur.order;
        if (e.code === 'slot_taken' && isOwnHold(mine, { date: cur.date, time: cur.time }, now())) {
          // 擋住的可能是自己剛才建立、還在保留中的訂單（從綠界返回後改了付款方式或資料）
          const b = await api.getBooking(mine.orderNo).catch(() => null);
          if (b?.status === 'confirmed' || b?.status === 'awaiting_transfer') {
            router.push(`/booking/success?order=${encodeURIComponent(mine.orderNo)}`);
            return;
          }
          if (b?.status === 'pending_payment') return failPayment(ownHoldMessage(mine));
        }
        submitting.current = false;
        setPaying(false);
        return handleSlotConflict(e.message);
      }
      if (e.status === 400 && e.code === 'validation' && e.fields && Object.keys(e.fields).length > 0) {
        submitting.current = false;
        setPaying(false);
        return showFieldErrors(e);
      }
      failPayment(e.message);
    }
  };

  const submit = () => {
    if (submitting.current) return;
    const cur = latest.current;
    const e = validateStep(4, cur.vin, cur.today);
    setErr(e);
    if (Object.keys(e).length > 0) {
      requestFocus(firstErrorField(e) ?? 'agree');
      return;
    }
    if (!cur.svc || !cur.date || !cur.time) return;
    submitting.current = true;
    setPaying(true);
    setPayError(null);
    const reuse = canReuseOrder(cur.order, { svc: cur.svc, date: cur.date, time: cur.time, pay: cur.pay, f: cur.f }, now())
      ? cur.order
      : null;
    void createAndPay(reuse);
  };

  const next = () => {
    if (paying) return;
    if (step === 1 || step === 2) {
      if (!canGoNext(step, vin, today)) return;
      goForward((step + 1) as Step);
      return;
    }
    if (step === 3) {
      const e = validateStep(3, vin, today);
      setErr(e);
      if (Object.keys(e).length > 0) {
        requestFocus(firstErrorField(e) ?? 'name');
        return;
      }
      goForward(4);
      return;
    }
    submit();
  };

  const back = () => {
    if (paying || step === 1) return;
    goBackTo((step - 1) as Step);
  };

  // ---------- 畫面 ----------
  const nextEnabled = canGoNext(step, vin, today) && !paying;
  const price = service ? formatPrice(service.price) : 'NT$0';
  const nextLabel = paying ? '付款處理中…' : step === 4 ? (pay === 'atm' ? '取得轉帳帳號' : `確認付款 ${service ? price : ''}`) : '下一步';
  const nextLabelM = paying ? '處理中…' : step === 4 ? (pay === 'atm' ? '取得帳號' : '確認付款') : '下一步';
  const sum: SummaryValues = {
    svc: service ? service.name : '尚未選擇',
    date: formatDateLabel(date),
    time: time || '—',
    price,
  };

  return (
    <>
      <section className="bg-booking pb-6 pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] pt-6 md:pb-20 md:pl-[max(clamp(20px,4vw,48px),env(safe-area-inset-left))] md:pr-[max(clamp(20px,4vw,48px),env(safe-area-inset-right))] md:pt-10">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-[18px] md:gap-7">
          <h1 className="font-serif text-[26px] font-bold text-ink-900 md:text-[34px]">線上預約</h1>
          <Stepper step={step} />

          <div className="flex flex-wrap items-start gap-7">
            <div
              ref={cardRef}
              className="box-content flex min-w-0 flex-[2_1_480px] flex-col gap-[22px] rounded-[20px] border border-rose-600/[.16] bg-white px-4 py-5 shadow-form md:p-8"
            >
              {step === 1 && <StepService services={services} selected={svc} onPick={pickSvc} headingRef={headingRef} />}
              {step === 2 && (
                <StepSchedule
                  month={month}
                  monthIndex={mo}
                  monthCount={months.length}
                  entry={monthEntry}
                  dateEntry={dateEntry}
                  date={date}
                  time={time}
                  notice={notice}
                  onPrevMonth={() => setMo((m) => Math.max(0, m - 1))}
                  onNextMonth={() => setMo((m) => Math.min(months.length - 1, m + 1))}
                  onPickDate={pickDate}
                  onPickTime={pickTime}
                  onRetry={() => svc && loadAvail(svc, month, { force: true })}
                  headingRef={headingRef}
                />
              )}
              {step === 3 && <StepDetails f={f} errors={err} today={today} onChange={setField} headingRef={headingRef} />}
              {step === 4 && (
                <StepPayment
                  pay={pay}
                  agree={agree}
                  errors={err}
                  config={config}
                  availability={payAv}
                  notice={payNotice}
                  payError={payError}
                  busy={paying}
                  onPickPay={(m) => {
                    setPay(m);
                    setErr({});
                    setPayError(null);
                    setPayNotice(null);
                  }}
                  onToggleAgree={(v) => {
                    setAgree(v);
                    if (v) setErr((prev) => ({ ...prev, agree: undefined }));
                  }}
                  headingRef={headingRef}
                />
              )}

              <div className="hidden items-center justify-between gap-3 border-t border-line-4 pt-[18px] md:flex">
                <button
                  type="button"
                  onClick={back}
                  aria-disabled={step === 1 || paying}
                  className={`rounded-pill border border-rose-600/30 px-6 py-[13px] text-[15px] text-rose-800 ${step > 1 ? '' : 'opacity-[.35]'}`}
                >
                  上一步
                </button>
                <button
                  type="button"
                  onClick={next}
                  aria-disabled={!nextEnabled}
                  aria-busy={paying || undefined}
                  className={`rounded-pill bg-btn px-[34px] py-[14px] text-[15px] font-bold text-white shadow-btn-sm ${nextEnabled ? '' : 'opacity-[.45]'}`}
                >
                  {nextLabel}
                </button>
              </div>
            </div>

            <SummaryCard sum={sum} />
          </div>
        </div>
      </section>

      <MobileBar
        sum={sum}
        open={sumOpen}
        onToggle={() => setSumOpen((v) => !v)}
        onBack={back}
        onNext={next}
        backDisabled={step === 1}
        backBusy={paying}
        nextDisabled={!nextEnabled}
        nextLabel={nextLabelM}
        busy={paying}
        hidden={keyboardOpen}
      />
    </>
  );
}
