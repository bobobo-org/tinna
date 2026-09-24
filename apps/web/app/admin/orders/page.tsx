'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, Empty, Notice, btnGhost, btnPrimary, inputSm, labelSm } from '@/components/admin/ui';
import { ApiError } from '@/lib/api';
import {
  COMMERCE_KIND_LABELS,
  ORDER_STATUS_LABELS,
  adminRequest,
  type AdminOrder,
  type OrderStatus,
} from '@/lib/admin/api';
import { addDays, downloadCsv } from '@/lib/admin/format';
import { taipeiToday } from '@/lib/booking/time';
import { formatPrice } from '@/lib/services';

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '發生錯誤，請稍後再試');

const KIND_OPTIONS = [
  { value: '', label: '全部類型' },
  { value: 'vip', label: 'VIP 包堂' },
  { value: 'shop', label: '商店' },
  { value: 'gift', label: 'VIP 贈品' },
];

const STATUS_OPTIONS = [
  { value: '', label: '全部狀態' },
  { value: 'paid', label: '已付款（待出貨）' },
  { value: 'shipped', label: '已出貨' },
  { value: 'completed', label: '已完成' },
  { value: 'pending_payment', label: '待付款' },
  { value: 'cancelled,expired', label: '已取消／逾時' },
];

const tone = (s: OrderStatus) =>
  s === 'paid' ? 'amber' : s === 'shipped' || s === 'completed' ? 'green' : s === 'pending_payment' ? 'rose' : 'gray';

const itemsText = (o: AdminOrder) => o.items.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join('、');
const dt = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 16) : '');

/** 展開的訂單：顧客、收件資料、出貨（物流單號＋寄通知信）、完成、取消、備註 */
function OrderDetail({ o, onSaved }: { o: AdminOrder; onSaved: (o: AdminOrder) => void }) {
  const [tracking, setTracking] = useState(o.trackingNo ?? '');
  const [note, setNote] = useState(o.note ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const shippable = o.kind !== 'vip' && (o.status === 'paid' || o.status === 'shipped');

  const patch = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminRequest<{ order: AdminOrder }>(`/admin/orders/${o.orderNo}`, { method: 'PATCH', body });
      onSaved(r.order);
      setMsg({ tone: 'ok', text: done });
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-[12px] border border-rose-600/20 bg-soft-2 p-4 text-[14px] text-ink-700">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        <div>
          <dt className="text-ink-500">顧客</dt>
          <dd>
            {o.customer.name}・{o.customer.phone}
            <br />
            <span className="[overflow-wrap:anywhere]">{o.customer.email}</span>
            {o.customer.birthDate && (
              <>
                <br />
                生日 {o.customer.birthDate}
              </>
            )}
          </dd>
        </div>
        {o.shipping && (
          <div>
            <dt className="text-ink-500">收件資料</dt>
            <dd>
              {o.shipping.name}・{o.shipping.phone}
              <br />
              {o.shipping.address}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-ink-500">金額</dt>
          <dd>
            小計 {formatPrice(o.subtotal)}
            {o.shippingFee > 0 && `＋運費 ${formatPrice(o.shippingFee)}`}
            {o.discountAmount > 0 && `－折扣 ${formatPrice(o.discountAmount)}`}
            <br />
            <b>應付 {formatPrice(o.amount)}</b>
          </dd>
        </div>
        <div>
          <dt className="text-ink-500">時間</dt>
          <dd>
            下單 {dt(o.createdAt)}
            {o.paidAt && (
              <>
                <br />
                付款 {dt(o.paidAt)}
              </>
            )}
            {o.shippedAt && (
              <>
                <br />
                出貨 {dt(o.shippedAt)}
              </>
            )}
          </dd>
        </div>
      </dl>

      {shippable && (
        <div className="flex flex-wrap items-end gap-3">
          <label className={`${labelSm} min-w-[200px] flex-1`}>
            物流單號（選填）
            <input value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={60} className={inputSm} />
          </label>
          {o.status === 'paid' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void patch({ status: 'shipped', trackingNo: tracking.trim() || null }, '已標記出貨，並寄出出貨通知信')}
              className={btnPrimary}
            >
              標記已出貨（寄通知信）
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void patch({ trackingNo: tracking.trim() || null }, '已更新物流單號')} className={btnGhost}>
              更新物流單號
            </button>
          )}
          {o.status === 'shipped' && (
            <button type="button" disabled={busy} onClick={() => void patch({ status: 'completed' }, '已標記完成')} className={btnGhost}>
              標記完成
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className={`${labelSm} min-w-[220px] flex-1`}>
          備註（只有後台看得到）
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputSm} />
        </label>
        <button type="button" disabled={busy} onClick={() => void patch({ note: note.trim() || null }, '已儲存備註')} className={btnGhost}>
          儲存備註
        </button>
        {(o.status === 'pending_payment' || o.status === 'paid') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const warn =
                o.status === 'paid'
                  ? '確定取消這筆已付款的訂單？\n取消不會自動退款，請另外到綠界後台辦理退款；VIP 卡也不會自動停用（可到 VIP 會員調整堂數）。'
                  : '確定取消這筆訂單？';
              if (window.confirm(warn)) void patch({ status: 'cancelled' }, '已取消訂單');
            }}
            className="text-[13px] text-error underline underline-offset-4"
          >
            取消訂單
          </button>
        )}
      </div>
    </div>
  );
}

/** 訂單列表（VIP 購買、商店、VIP 贈品）：類型／狀態／日期篩選、出貨、CSV */
export default function AdminOrdersPage() {
  const today = taipeiToday();
  const [from, setFrom] = useState(addDays(today, -59));
  const [to, setTo] = useState(today);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<AdminOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (q: { from: string; to: string; kind: string; status: string }) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: q.from, to: q.to });
      if (q.kind) params.set('kind', q.kind);
      if (q.status) params.set('status', q.status);
      const r = await adminRequest<{ orders: AdminOrder[] }>(`/admin/orders?${params}`);
      setRows(r.orders);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({ from: addDays(today, -59), to: today, kind: '', status: '' });
  }, [load, today]);

  const exportCsv = () => {
    if (!rows) return;
    downloadCsv(`orders-${from}-${to}.csv`, [
      ['下單時間', '訂單編號', '類型', '狀態', '內容', '小計', '運費', '折扣', '應付', '姓名', 'Email', '手機', '收件人', '收件電話', '地址', '物流單號', '備註'],
      ...rows.map((o) => [
        dt(o.createdAt),
        o.orderNo,
        COMMERCE_KIND_LABELS[o.kind],
        ORDER_STATUS_LABELS[o.status],
        itemsText(o),
        o.subtotal,
        o.shippingFee,
        o.discountAmount,
        o.amount,
        o.customer.name,
        o.customer.email,
        o.customer.phone,
        o.shipping?.name ?? '',
        o.shipping?.phone ?? '',
        o.shipping?.address ?? '',
        o.trackingNo ?? '',
        o.note ?? '',
      ]),
    ]);
  };

  const paidTotal = rows?.filter((o) => o.status !== 'pending_payment' && o.status !== 'cancelled' && o.status !== 'expired').reduce((t, o) => t + o.amount, 0) ?? 0;

  return (
    <Card
      title="訂單"
      actions={
        <button type="button" onClick={exportCsv} disabled={!rows || rows.length === 0} className={btnGhost}>
          下載 CSV
        </button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load({ from, to, kind, status });
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className={labelSm}>
          從
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputSm} />
        </label>
        <label className={labelSm}>
          到
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputSm} />
        </label>
        <label className={labelSm}>
          類型
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputSm}>
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelSm}>
          狀態
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputSm}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={loading} className={btnPrimary}>
          {loading ? '查詢中…' : '查詢'}
        </button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {rows && rows.length === 0 && <Empty>這段期間沒有訂單</Empty>}
      {rows && rows.length > 0 && (
        <>
          <p className="text-[13px] text-ink-500">
            共 {rows.length} 筆・已付款金額 {formatPrice(paidTotal)}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-500">
                  <th className="py-2 pr-3 font-normal">下單時間</th>
                  <th className="py-2 pr-3 font-normal">訂單編號</th>
                  <th className="py-2 pr-3 font-normal">類型</th>
                  <th className="py-2 pr-3 font-normal">狀態</th>
                  <th className="py-2 pr-3 font-normal">顧客</th>
                  <th className="py-2 pr-3 font-normal">內容</th>
                  <th className="py-2 pr-3 text-right font-normal">金額</th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <OrderRow
                    key={o.orderNo}
                    o={o}
                    open={open === o.orderNo}
                    onToggle={() => setOpen((x) => (x === o.orderNo ? null : o.orderNo))}
                    onSaved={(next) => setRows((list) => list?.map((x) => (x.orderNo === next.orderNo ? next : x)) ?? null)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function OrderRow({ o, open, onToggle, onSaved }: { o: AdminOrder; open: boolean; onToggle: () => void; onSaved: (o: AdminOrder) => void }) {
  return (
    <>
      <tr className="border-b border-line-4 align-top">
        <td className="whitespace-nowrap py-2 pr-3">{dt(o.createdAt)}</td>
        <td className="py-2 pr-3 font-mono text-[13px] text-ink-900">{o.orderNo}</td>
        <td className="py-2 pr-3">{COMMERCE_KIND_LABELS[o.kind]}</td>
        <td className="py-2 pr-3">
          <Badge tone={tone(o.status)}>{ORDER_STATUS_LABELS[o.status]}</Badge>
        </td>
        <td className="py-2 pr-3 text-ink-900">{o.customer.name}</td>
        <td className="max-w-[260px] py-2 pr-3">{itemsText(o)}</td>
        <td className="py-2 pr-3 text-right">{o.kind === 'gift' ? '贈品' : formatPrice(o.amount)}</td>
        <td className="py-2 text-right">
          <button type="button" onClick={onToggle} aria-expanded={open} className="text-[13px] text-rose-800 underline underline-offset-4">
            {open ? '收起' : '詳細'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="pb-4 pt-2">
            <OrderDetail o={o} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  );
}
