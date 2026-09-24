'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorCls, inputCls, labelWrapCls } from '@/components/booking/styles';
import { ApiError, MSG_NETWORK, api } from '@/lib/api';
import { goToOrderPayment } from '@/lib/booking/pay';
import { EMAIL_RE } from '@/lib/booking/validate';
import { applyDiscount, loadReferral, normalizeCode, type ReferralPreview } from '@/lib/referral';
import { formatPrice } from '@/lib/services';
import {
  MAX_QTY,
  loadCart,
  rememberCartOrder,
  saveCart,
  shippingFor,
  type CartLine,
  type ShopCatalog,
  type ShopProduct,
} from '@/lib/shop';

type Field = 'items' | 'name' | 'phone' | 'email' | 'ship_name' | 'ship_phone' | 'ship_address' | 'note' | 'referral_code' | 'agree';
type Errors = Partial<Record<Field, string>>;

const FIELD_ORDER: Field[] = ['items', 'name', 'phone', 'email', 'ship_name', 'ship_phone', 'ship_address', 'note', 'referral_code', 'agree'];
const FIELD_ID: Record<Field, string> = {
  items: 'cart-items',
  name: 'co-name',
  phone: 'co-phone',
  email: 'co-email',
  ship_name: 'co-ship-name',
  ship_phone: 'co-ship-phone',
  ship_address: 'co-address',
  note: 'co-note',
  referral_code: 'co-ref',
  agree: 'co-agree',
};

const card = 'flex flex-col gap-4 rounded-[20px] border border-rose-600/[.16] bg-white px-4 py-6 shadow-form md:p-8';
const stepBtn = 'flex h-9 w-9 items-center justify-center text-[18px] text-rose-800 disabled:opacity-30';
const phoneOk = (s: string) => s.replace(/\D/g, '').length >= 9;

type Row = { line: CartLine; product: ShopProduct | null; available: boolean; qty: number };

/**
 * 購物車＋結帳（單頁）：數量、移除、推薦碼、收件資料 → POST /shop/orders → 綠界信用卡付款
 * 付款完成後綠界導回 /orders/<訂單編號>（那裡才清空購物車，付款失敗回來購物車還在）
 */
export default function CartCheckout({ catalog }: { catalog: ShopCatalog | null }) {
  const [ready, setReady] = useState(false);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sameShip, setSameShip] = useState(true);
  const [shipName, setShipName] = useState('');
  const [shipPhone, setShipPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [agree, setAgree] = useState(false);
  const [refInput, setRefInput] = useState('');
  const [referral, setReferral] = useState<ReferralPreview | null>(null);
  const [refBusy, setRefBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

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
      const r = await api.getReferral(code, 'shop');
      setReferral(r);
      setRefInput(r.code);
      clearError('referral_code');
    } catch (e) {
      if (!silent) setErrors((p) => ({ ...p, referral_code: e instanceof ApiError ? e.message : MSG_NETWORK }));
    } finally {
      setRefBusy(false);
    }
  };

  useEffect(() => {
    setLines(loadCart());
    setReady(true);
    const code = loadReferral();
    if (code) {
      setRefInput(code);
      void applyReferral(code, true);
    }
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      submitting.current = false;
      setBusy(false);
      setLines(loadCart());
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
    // 只在掛載時讀購物車與推薦碼
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (next: CartLine[]) => {
    setLines(next);
    saveCart(next);
    clearError('items');
  };

  if (!catalog) {
    return (
      <section className="px-6 py-24 text-center text-[15px] text-ink-500">
        商店暫時無法使用，請稍後再試。
        <Link href="/shop" className="ml-2 text-rose-800 underline underline-offset-4">
          回商店
        </Link>
      </section>
    );
  }

  const rows: Row[] = lines.map((l) => {
    const p = catalog.products.find((x) => x.id === l.id) ?? null;
    const available = !!p && p.stock > 0;
    return { line: l, product: p, available, qty: p ? Math.min(l.qty, p.stock, MAX_QTY) : 0 };
  });
  const buyable = rows.filter((r): r is Row & { product: ShopProduct } => r.available && r.product !== null);
  const subtotal = buyable.reduce((t, r) => t + r.product.price * r.qty, 0);
  const discount = referral && subtotal > 0 ? applyDiscount(subtotal, referral).discount : 0;
  const shipping = subtotal > 0 ? shippingFor(subtotal, catalog) : 0;
  const total = subtotal - discount + shipping;
  const freeGap = catalog.freeShippingOver !== null && shipping > 0 ? catalog.freeShippingOver - subtotal : null;

  const focusFirst = (e: Errors) => {
    const first = FIELD_ORDER.find((k) => e[k]);
    if (!first) return;
    const el = document.getElementById(FIELD_ID[first]);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (buyable.length === 0) e.items = '購物車是空的';
    if (!name.trim()) e.name = '請填寫姓名';
    if (!phoneOk(phone)) e.phone = '請填寫手機號碼';
    if (!EMAIL_RE.test(email.trim())) e.email = '請填寫有效的 Email';
    if (!sameShip && !shipName.trim()) e.ship_name = '請填寫收件人';
    if (!sameShip && !phoneOk(shipPhone)) e.ship_phone = '請填寫收件人手機';
    if (address.trim().length < 6) e.ship_address = '請填寫完整的收件地址';
    if (!agree) e.agree = '請勾選同意購物與退換貨規則';
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (submitting.current) return;
    const e = validate();
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length > 0) {
      focusFirst(e);
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const { orderNo } = await api.createShopOrder({
        items: buyable.map((r) => ({ product_id: r.product.id, qty: r.qty })),
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        ship_name: (sameShip ? name : shipName).trim(),
        ship_phone: (sameShip ? phone : shipPhone).trim(),
        ship_address: address.trim(),
        note: note.trim(),
        referral_code: referral?.code ?? '',
        agree,
      });
      rememberCartOrder(orderNo);
      await goToOrderPayment(orderNo);
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
        // 收件人欄位出錯但勾了「同訂購人」：顯示在訂購人欄位
        if (sameShip && fe.ship_name && !fe.name) fe.name = fe.ship_name;
        if (sameShip && fe.ship_phone && !fe.phone) fe.phone = fe.ship_phone;
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

  const input = (k: Field, value: string, set: (v: string) => void, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={FIELD_ID[k]}
      value={value}
      onChange={(e) => {
        set(e.target.value);
        clearError(k);
      }}
      disabled={busy}
      aria-invalid={inv(k)}
      aria-describedby={desc(k)}
      className={inputCls}
      {...props}
    />
  );

  return (
    <section className="bg-booking px-[clamp(16px,4vw,56px)] pb-24 pt-8 md:pt-12">
      <form onSubmit={submit} noValidate className="mx-auto flex max-w-[860px] flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-serif text-[28px] font-bold text-ink-900 md:text-[34px]">購物車</h1>
          <Link href="/shop" className="text-[14px] text-rose-800 underline underline-offset-4">
            繼續購物
          </Link>
        </div>

        <div id="cart-items" tabIndex={-1} className={`${card} outline-none`} aria-describedby={desc('items')}>
          {!ready && <p className="py-6 text-center text-[15px] text-ink-500">讀取購物車中…</p>}
          {ready && rows.length === 0 && (
            <p className="py-6 text-center text-[15px] text-ink-500">
              購物車是空的。
              <Link href="/shop" className="ml-2 text-rose-800 underline underline-offset-4">
                去逛逛
              </Link>
            </p>
          )}
          {rows.length > 0 && (
            <ul className="flex flex-col divide-y divide-line-4">
              {rows.map(({ line, product: p, available, qty }) => (
                <li key={line.id} className="flex items-center gap-3 py-3">
                  <div className="h-16 w-16 flex-none overflow-hidden rounded-[10px] bg-card">
                    {p?.images[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.images[0]} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    {p ? (
                      <Link href={`/shop/${p.slug}`} className="text-[15px] font-bold text-ink-900 hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="text-[15px] text-ink-500">這個商品已下架</span>
                    )}
                    {p && available && <span className="text-[14px] text-ink-600">{formatPrice(p.price)}</span>}
                    {p && !available && <span className="text-[13px] text-error">已售完</span>}
                    {p && available && qty < line.qty && <span className="text-[12px] text-ink-500">庫存只剩 {p.stock} 件</span>}
                  </div>
                  {p && available && (
                    <div className="flex items-center rounded-pill border border-rose-600/30 bg-white" role="group" aria-label={`${p.name} 數量`}>
                      <button
                        type="button"
                        disabled={busy || qty <= 1}
                        onClick={() => update(lines.map((l) => (l.id === line.id ? { ...l, qty: qty - 1 } : l)))}
                        aria-label="減少數量"
                        className={stepBtn}
                      >
                        −
                      </button>
                      <span className="min-w-[2em] text-center text-[15px] font-bold">{qty}</span>
                      <button
                        type="button"
                        disabled={busy || qty >= Math.min(p.stock, MAX_QTY)}
                        onClick={() => update(lines.map((l) => (l.id === line.id ? { ...l, qty: qty + 1 } : l)))}
                        aria-label="增加數量"
                        className={stepBtn}
                      >
                        ＋
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => update(lines.filter((l) => l.id !== line.id))}
                    className="flex-none text-[13px] text-rose-800 underline underline-offset-4"
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
          {errText('items')}
        </div>

        {buyable.length > 0 && (
          <div className={card}>
            <h2 className="font-serif text-[22px] font-bold text-ink-900">訂購與收件資料</h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4">
              <div className={labelWrapCls}>
                <label htmlFor="co-name">訂購人姓名 *</label>
                {input('name', name, setName, { autoComplete: 'name', maxLength: 50 })}
                {errText('name')}
              </div>
              <div className={labelWrapCls}>
                <label htmlFor="co-phone">手機 *</label>
                {input('phone', phone, setPhone, { type: 'tel', inputMode: 'tel', autoComplete: 'tel', maxLength: 30, placeholder: '0912 345 678' })}
                {errText('phone')}
              </div>
            </div>
            <div className={labelWrapCls}>
              <label htmlFor="co-email">Email *（寄送訂單確認與出貨通知）</label>
              {input('email', email, setEmail, {
                type: 'email',
                inputMode: 'email',
                autoComplete: 'email',
                autoCapitalize: 'off',
                spellCheck: false,
                maxLength: 254,
                placeholder: 'you@example.com',
              })}
              {errText('email')}
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-[14px] text-ink-700">
              <input type="checkbox" checked={sameShip} disabled={busy} onChange={(e) => setSameShip(e.target.checked)} className="h-4 w-4 accent-rose-600" />
              收件人同訂購人
            </label>
            {!sameShip && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4">
                <div className={labelWrapCls}>
                  <label htmlFor="co-ship-name">收件人姓名 *</label>
                  {input('ship_name', shipName, setShipName, { autoComplete: 'shipping name', maxLength: 50 })}
                  {errText('ship_name')}
                </div>
                <div className={labelWrapCls}>
                  <label htmlFor="co-ship-phone">收件人手機 *</label>
                  {input('ship_phone', shipPhone, setShipPhone, { type: 'tel', inputMode: 'tel', autoComplete: 'shipping tel', maxLength: 30 })}
                  {errText('ship_phone')}
                </div>
              </div>
            )}
            <div className={labelWrapCls}>
              <label htmlFor="co-address">收件地址 *（宅配）</label>
              {input('ship_address', address, setAddress, { autoComplete: 'shipping street-address', maxLength: 200, placeholder: '例：台北市信義區松仁路 1 號 5 樓' })}
              {errText('ship_address')}
            </div>
            <div className={labelWrapCls}>
              <label htmlFor="co-note">備註（選填）</label>
              {input('note', note, setNote, { maxLength: 500, placeholder: '例：方便收件的時段' })}
              {errText('note')}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="co-ref" className="text-[14px] text-ink-600">
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
                    id="co-ref"
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

            <dl className="flex flex-col gap-2 rounded-[14px] bg-soft-2 p-5 text-[14px] text-ink-700">
              <div className="flex justify-between gap-3">
                <dt>商品小計</dt>
                <dd>{formatPrice(subtotal)}</dd>
              </div>
              {discount > 0 && (
                <div className="flex justify-between gap-3">
                  <dt>推薦碼折抵</dt>
                  <dd>−{formatPrice(discount)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt>運費</dt>
                <dd>{shipping > 0 ? formatPrice(shipping) : '免運'}</dd>
              </div>
              {freeGap !== null && freeGap > 0 && <p className="text-[12px] text-ink-500">再買 {formatPrice(freeGap)} 就免運</p>}
              <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-rose-600/15 pt-3">
                <dt className="text-[15px]">應付金額</dt>
                <dd className="font-serif text-[28px] font-bold text-rose-800">{formatPrice(total)}</dd>
              </div>
            </dl>

            <label className="relative -my-[11px] flex cursor-pointer items-start gap-[10px] py-[11px] text-[14px] leading-[1.8] text-ink-600">
              <input
                id="co-agree"
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
              <span>我已了解：付款完成後安排出貨，出貨時會寄 Email 通知；商品到貨後享 7 天鑑賞期（非試用期），退換貨請來信聯繫。</span>
            </label>
            {errText('agree')}

            {formError && (
              <p role="alert" className="rounded-[12px] border border-error/25 bg-soft-2 px-4 py-3 text-[14px] leading-[1.8] text-error">
                {formError}
              </p>
            )}
            <button
              type="submit"
              aria-disabled={busy}
              aria-busy={busy || undefined}
              className={`inline-flex min-h-[48px] items-center justify-center rounded-pill bg-btn px-8 py-[13px] text-[16px] font-bold text-white shadow-btn-sm hover:brightness-[1.08] ${busy ? 'opacity-[.45]' : ''}`}
            >
              {busy ? '付款處理中…' : `前往信用卡付款 ${formatPrice(total)}`}
            </button>
            <p className="text-center text-[12px] leading-[1.8] text-ink-400">
              將前往綠界 ECPay 安全付款頁輸入卡號；本站不經手、也不儲存你的卡號。
            </p>
          </div>
        )}
      </form>
    </section>
  );
}
