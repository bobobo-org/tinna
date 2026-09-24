'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { adminRequest, type AdminOrder, type AdminProduct, type AdminVipMember } from '@/lib/admin/api';
import { Notice, btnGhost, btnPrimary, inputSm, labelSm } from './ui';

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '發生錯誤，請稍後再試');

/**
 * 寄 VIP 贈品：選商品（啟用中、有庫存；「只當贈品」的也可以選）與數量、收件資料 → POST /admin/gifts
 * 建立後在「訂單」頁出貨（填物流單號會寄通知信給 VIP）
 */
export default function GiftSender({ member, onClose }: { member: AdminVipMember; onClose: () => void }) {
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [shipName, setShipName] = useState(member.name);
  const [shipPhone, setShipPhone] = useState(member.phone);
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminRequest<{ products: AdminProduct[] }>('/admin/products')
      .then((r) => alive && setProducts(r.products.filter((p) => p.active)))
      .catch((e) => alive && setMsg({ tone: 'error', text: errMsg(e) }));
    return () => {
      alive = false;
    };
  }, []);

  const chosen = Object.entries(qty).filter(([, n]) => n > 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (chosen.length === 0) return setMsg({ tone: 'error', text: '請選擇贈品' });
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminRequest<{ order: AdminOrder }>('/admin/gifts', {
        method: 'POST',
        body: {
          memberId: member.id,
          items: chosen.map(([productId, n]) => ({ productId, qty: n })),
          shipName: shipName.trim(),
          shipPhone: shipPhone.trim(),
          shipAddress: address.trim(),
          note: note.trim(),
        },
      });
      setCreated(r.order.orderNo);
      setQty({});
    } catch (err) {
      setMsg({ tone: 'error', text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="flex flex-col gap-3 rounded-[12px] border border-[#1f6b3f]/20 bg-[#e8f6ee] p-4 text-[14px] text-[#1f6b3f]">
        <p>
          已建立贈品訂單 <b>{created}</b>（庫存已扣除）。寄出後到「訂單」頁標記出貨，會寄通知信給 {member.name}。
        </p>
        <div className="flex gap-2">
          <Link href="/admin/orders" className={btnPrimary}>
            到訂單頁
          </Link>
          <button type="button" onClick={onClose} className={btnGhost}>
            關閉
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-[12px] border border-rose-600/20 bg-white p-4">
      <h3 className="text-[15px] font-bold text-ink-900">寄贈品給 {member.name}</h3>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {products === null && !msg && <p className="text-[13px] text-ink-500">讀取商品中…</p>}
      {products?.length === 0 && (
        <p className="text-[13px] text-ink-500">
          還沒有可選的商品，先到
          <Link href="/admin/products" className="mx-1 text-rose-800 underline">
            商品
          </Link>
          新增（可設為「只當贈品」）。
        </p>
      )}
      {products && products.length > 0 && (
        <ul className="flex flex-col divide-y divide-line-4 rounded-[10px] border border-line">
          {products.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[14px]">
              <span className={p.stock === 0 ? 'text-ink-400' : 'text-ink-900'}>
                {p.name}
                <span className="ml-2 text-[12px] text-ink-500">
                  庫存 {p.stock}
                  {!p.forSale && '・只當贈品'}
                </span>
              </span>
              <input
                type="number"
                min={0}
                max={Math.min(20, p.stock)}
                disabled={p.stock === 0}
                value={qty[p.id] ?? 0}
                onChange={(e) => setQty((q) => ({ ...q, [p.id]: Math.max(0, Math.min(Number(e.target.value) || 0, p.stock, 20)) }))}
                aria-label={`${p.name} 數量`}
                className={`${inputSm} w-[88px]`}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className={labelSm}>
          收件人
          <input required value={shipName} onChange={(e) => setShipName(e.target.value)} maxLength={50} className={inputSm} />
        </label>
        <label className={labelSm}>
          收件人手機
          <input required value={shipPhone} onChange={(e) => setShipPhone(e.target.value)} maxLength={30} className={inputSm} />
        </label>
      </div>
      <label className={labelSm}>
        收件地址
        <input required value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} placeholder="例：台北市信義區松仁路 1 號 5 樓" className={inputSm} />
      </label>
      <label className={labelSm}>
        備註（只有後台看得到）
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="例：2026 生日禮" className={inputSm} />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || chosen.length === 0} className={btnPrimary}>
          {busy ? '建立中…' : '建立贈品訂單'}
        </button>
        <button type="button" onClick={onClose} className={btnGhost}>
          取消
        </button>
      </div>
    </form>
  );
}
