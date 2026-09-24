'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorCls, focusRingWithin, inputCls, labelWrapCls } from '@/components/booking/styles';
import { ApiError, MSG_NETWORK, api } from '@/lib/api';
import { goToOrderPayment } from '@/lib/booking/pay';
import { taipeiToday } from '@/lib/booking/time';
import { EMAIL_RE, MIN_BIRTH_DATE } from '@/lib/booking/validate';
import { applyDiscount, loadReferral, normalizeCode, type ReferralPreview } from '@/lib/referral';
import { formatPrice } from '@/lib/services';
import { perSession, savings, validLabel, type VipPlan } from '@/lib/vip';

type Field = 'plan_id' | 'name' | 'email' | 'phone' | 'birth_date' | 'referral_code' | 'agree';
type Errors = Partial<Record<Field, string>>;

const FIELD_ORDER: Field[] = ['plan_id', 'name', 'phone', 'email', 'birth_date', 'referral_code', 'agree'];
const FIELD_ID: Record<Field, string> = {
  plan_id: 'vip-plans',
  name: 'vip-name',
  email: 'vip-email',
  phone: 'vip-phone',
  birth_date: 'vip-bdate',
  referral_code: 'vip-ref',
  agree: 'vip-agree',
};

const btnPrimary =
  'inline-flex min-h-[48px] items-center justify-center rounded-pill bg-btn px-8 py-[13px] text-[16px] font-bold text-white shadow-btn-sm hover:brightness-[1.08]';

/**
 * VIP 購買：選方案 → 填聯絡資料（生日選填，寄生日禮用）→ 推薦碼（選填）→ POST /vip/orders → 綠界信用卡付款
 * 付款完成後綠界導回 /orders/<訂單編號>，顯示 VIP 卡號
 */
export default function VipPurchase({ plans }: { plans: VipPlan[] }) {
  const [planId, setPlanId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [bdate, setBdate] = useState('');
  const [agree, setAgree] = useState(false);
  const [refInput, setRefInput] = useState('');
  const [referral, setReferral] = useState<ReferralPreview | null>(null);
  const [refBusy, setRefBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const discount = plan && referral ? applyDiscount(plan.price, referral).discount : 0;
  const total = plan ? plan.price - discount : 0;
  const today = taipeiToday();

  const clearError = (k: Field) =>
    setErrors((prev) => {
      if (!prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });

  const applyReferral = async (raw: string, silent = false) => {
    const code = normalizeCode(raw);
    if (!code) {
      if (!silent) setErrors((p) => ({ ...p, referral_code: '推薦碼請輸入 3–20 個英文或數字' }));
      return;
    }
    setRefBusy(true);
    try {
      const r = await api.getReferral(code, 'vip');
      setReferral(r);
      setRefInput(r.code);
      clearError('referral_code');
    } catch (e) {
      if (!silent) setErrors((p) => ({ ...p, referral_code: e instanceof ApiError ? e.message : MSG_NETWORK }));
    } finally {
      setRefBusy(false);
    }
  };

  // KOL 分享連結帶進來的推薦碼：自動套用（不能用就安靜略過）
  useEffect(() => {
    const code = loadReferral();
    if (code) {
      setRefInput(code);
      void applyReferral(code, true);
    }
    // 只在掛載時檢查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 從綠界按瀏覽器返回（bfcache 還原）：解除「付款處理中…」
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      submitting.current = false;
      setBusy(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const focusFirst = (e: Errors) => {
    const first = FIELD_ORDER.find((k) => e[k]);
    if (!first) return;
    const el = document.getElementById(FIELD_ID[first]);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (!plan) e.plan_id = '請選擇方案';
    if (!name.trim()) e.name = '請填寫姓名';
    if (!EMAIL_RE.test(email.trim())) e.email = '請填寫有效的 Email';
    if (phone.replace(/\D/g, '').length < 9) e.phone = '請填寫手機號碼';
    if (bdate && (bdate < MIN_BIRTH_DATE || bdate > today)) e.birth_date = '請確認生日';
    if (!agree) e.agree = '請勾選同意購買與使用規則';
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (submitting.current) return;
    const e = validate();
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length > 0 || !plan) {
      focusFirst(e);
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const { orderNo } = await api.createVipOrder({
        plan_id: plan.id,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        birth_date: bdate,
        referral_code: referral?.code ?? '',
        agree,
      });
      await goToOrderPayment(orderNo);
      // 萬一導向被擋（沒有離開頁面），20 秒後讓按鈕恢復
      window.setTimeout(() => {
        submitting.current = false;
        setBusy(false);
      }, 20_000);
    } catch (err) {
      submitting.current = false;
      setBusy(false);
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length > 0) {
        const fe: Errors = {};
        for (const [k, v] of Object.entries(err.fields)) if (k in FIELD_ID) fe[k as Field] = v;
        if (fe.referral_code) setReferral(null);
        setErrors(fe);
        if (Object.keys(fe).length === 0) setFormError(err.message);
        focusFirst(fe);
        return;
      }
      setFormError(err instanceof ApiError ? err.message : MSG_NETWORK);
    }
  };

  const inv = (k: Field) => (errors[k] ? true : undefined);
  const desc = (k: Field) => (errors[k] ? `${FIELD_ID[k]}-err` : undefined);
  const errText = (k: Field) =>
    errors[k] ? (
      <span id={`${FIELD_ID[k]}-err`} className={errorCls}>
        {errors[k]}
      </span>
    ) : null;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <div
        id="vip-plans"
        role="radiogroup"
        aria-label="VIP 方案"
        aria-describedby={desc('plan_id')}
        tabIndex={-1}
        className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-4 outline-none"
      >
        {plans.map((p) => {
          const on = p.id === planId;
          const save = savings(p, plans);
          return (
            <label
              key={p.id}
              className={`lift flex cursor-pointer flex-col gap-2 rounded-[18px] px-5 py-6 shadow-card ${focusRingWithin} ${
                on ? 'border-2 border-rose-600 bg-selected' : 'border border-rose-600/20 bg-card'
              }`}
            >
              <input
                type="radio"
                name="vip-plan"
                value={p.id}
                checked={on}
                disabled={busy}
                onChange={() => {
                  setPlanId(p.id);
                  clearError('plan_id');
                }}
                className="sr-only"
              />
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-serif text-[22px] font-bold text-ink-900">{p.sessions} 堂</span>
                {save > 0 && (
                  <span className="rounded-pill bg-rose-800 px-[10px] py-1 text-[12px] text-white">省 {formatPrice(save)}</span>
                )}
              </span>
              <span className="font-serif text-[28px] font-bold text-rose-800">{formatPrice(p.price)}</span>
              <span className="text-[14px] text-ink-600">每堂 {formatPrice(perSession(p))}</span>
              <span className="text-[13px] leading-[1.7] text-ink-500">
                {p.description ?? `每堂 90 分鐘`} · {validLabel(p.validDays)}內有效
              </span>
              <span
                aria-hidden="true"
                className={`mt-1 rounded-pill py-2 text-center text-[14px] font-bold ${on ? 'bg-rose-600 text-white' : 'border border-rose-600/30 text-rose-800'}`}
              >
                {on ? '已選擇' : '選擇這個方案'}
              </span>
            </label>
          );
        })}
      </div>
      {errText('plan_id')}

      <div
        className="mx-auto flex w-full max-w-[720px] flex-col gap-[18px] rounded-[20px] border border-rose-600/[.16] bg-white px-4 py-6 shadow-form md:p-8"
      >
        <h3 className="font-serif text-[22px] font-bold text-ink-900">購買資料</h3>
        {plan ? (
          <p className="rounded-[12px] bg-soft-2 px-4 py-3 text-[15px] text-ink-700">
            已選：<b className="text-ink-900">{plan.name}</b>（{plan.sessions} 堂，{validLabel(plan.validDays)}內有效）
          </p>
        ) : (
          <p className="rounded-[12px] bg-soft-2 px-4 py-3 text-[15px] text-ink-500">請先在上方選擇方案</p>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4">
          <div className={labelWrapCls}>
            <label htmlFor="vip-name">姓名 *</label>
            <input
              id="vip-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearError('name');
              }}
              autoComplete="name"
              maxLength={50}
              disabled={busy}
              aria-required="true"
              aria-invalid={inv('name')}
              aria-describedby={desc('name')}
              className={inputCls}
            />
            {errText('name')}
          </div>
          <div className={labelWrapCls}>
            <label htmlFor="vip-phone">手機 *</label>
            <input
              id="vip-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                clearError('phone');
              }}
              autoComplete="tel"
              maxLength={30}
              placeholder="0912 345 678"
              disabled={busy}
              aria-required="true"
              aria-invalid={inv('phone')}
              aria-describedby={desc('phone')}
              className={inputCls}
            />
            {errText('phone')}
          </div>
        </div>

        <div className={labelWrapCls}>
          <label htmlFor="vip-email">Email *（寄送 VIP 卡號；之後預約要用同一個 Email）</label>
          <input
            id="vip-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError('email');
            }}
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={254}
            placeholder="you@example.com"
            disabled={busy}
            aria-required="true"
            aria-invalid={inv('email')}
            aria-describedby={desc('email')}
            className={inputCls}
          />
          {errText('email')}
        </div>

        <div className={labelWrapCls}>
          <label htmlFor="vip-bdate">生日（選填，寄生日禮用）</label>
          <input
            id="vip-bdate"
            type="date"
            value={bdate}
            min={MIN_BIRTH_DATE}
            max={today}
            onChange={(e) => {
              setBdate(e.target.value);
              clearError('birth_date');
            }}
            disabled={busy}
            aria-invalid={inv('birth_date')}
            aria-describedby={desc('birth_date')}
            className={`${inputCls} min-h-[50px]`}
          />
          {errText('birth_date')}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="vip-ref" className="text-[14px] text-ink-600">
            推薦碼（選填）
          </label>
          {referral ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-rose-600/30 bg-soft px-4 py-3 text-[14px] text-ink-700">
              <span>
                已套用 <b className="text-rose-800">{referral.code}</b>：{referral.label}
                {discount > 0 ? `，折抵 ${formatPrice(discount)}` : ''}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setReferral(null);
                  setRefInput('');
                }}
                className="text-[13px] text-rose-800 underline underline-offset-4"
              >
                移除
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                id="vip-ref"
                value={refInput}
                onChange={(e) => {
                  setRefInput(e.target.value);
                  clearError('referral_code');
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  void applyReferral(refInput);
                }}
                placeholder="例：AMY10"
                maxLength={20}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                aria-invalid={inv('referral_code')}
                aria-describedby={desc('referral_code')}
                className={`${inputCls} min-w-0 flex-1 uppercase`}
              />
              <button
                type="button"
                onClick={() => void applyReferral(refInput)}
                disabled={busy || refBusy || !refInput.trim()}
                className="shrink-0 rounded-[10px] border border-rose-600/40 bg-white px-4 text-[15px] text-rose-800 hover:bg-soft disabled:opacity-50"
              >
                {refBusy ? '確認中…' : '套用'}
              </button>
            </div>
          )}
          {errText('referral_code')}
        </div>

        <label className="relative -my-[11px] flex cursor-pointer items-start gap-[10px] py-[11px] text-[14px] leading-[1.8] text-ink-600">
          <input
            id="vip-agree"
            type="checkbox"
            checked={agree}
            disabled={busy}
            onChange={(e) => {
              setAgree(e.target.checked);
              if (e.target.checked) clearError('agree');
            }}
            aria-invalid={inv('agree')}
            aria-describedby={desc('agree')}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={`mt-[4px] box-content flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border-2 border-rose-600 text-[12px] text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-rose-600 ${
              agree ? 'bg-rose-600' : 'bg-transparent'
            }`}
          >
            ✓
          </span>
          <span>
            我已了解：VIP 堂數自付款日起{plan ? ` ${validLabel(plan.validDays)}` : '於方案期限'}內有效；預約時需輸入 VIP 卡號與購買時的 Email，每次預約扣 1 堂。
          </span>
        </label>
        {errText('agree')}

        <div className="flex flex-col gap-3 border-t border-line-4 pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] text-ink-700">應付金額</span>
            <span className="font-serif text-[30px] font-bold text-rose-800">{plan ? formatPrice(total) : '—'}</span>
          </div>
          {formError && (
            <p role="alert" className="rounded-[12px] border border-error/25 bg-soft-2 px-4 py-3 text-[14px] leading-[1.8] text-error">
              {formError}
            </p>
          )}
          <button type="submit" aria-disabled={busy} aria-busy={busy || undefined} className={`${btnPrimary} ${busy ? 'opacity-[.45]' : ''}`}>
            {busy ? '付款處理中…' : '前往信用卡付款'}
          </button>
          <p className="text-center text-[12px] leading-[1.8] text-ink-400">
            將前往綠界 ECPay 安全付款頁輸入卡號；本站不經手、也不儲存你的卡號。
          </p>
        </div>
      </div>
    </form>
  );
}
