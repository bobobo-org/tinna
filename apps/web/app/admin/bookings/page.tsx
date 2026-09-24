'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, Empty, Notice, btnGhost, btnPrimary, inputSm, labelSm } from '@/components/admin/ui';
import { ApiError } from '@/lib/api';
import { BOOKING_STATUS_LABELS, PAY_METHOD_LABELS, adminRequest, type AdminBookingRow } from '@/lib/admin/api';
import { addDays, downloadCsv } from '@/lib/admin/format';
import { formatDateLabel, taipeiToday } from '@/lib/booking/time';
import { formatPrice } from '@/lib/services';

const STATUS_OPTIONS = [
  { value: '', label: '全部狀態' },
  { value: 'confirmed', label: '已確認' },
  { value: 'pending_payment,awaiting_transfer', label: '待付款' },
  { value: 'cancelled,expired', label: '已取消／逾時' },
  { value: 'refunded', label: '已退款' },
];

const tone = (s: AdminBookingRow['status']) =>
  s === 'confirmed' ? 'green' : s === 'pending_payment' || s === 'awaiting_transfer' ? 'amber' : 'gray';

/** 預約列表：日期區間＋狀態篩選、展開看顧客資料與問題、下載 CSV */
export default function AdminBookingsPage() {
  const today = taipeiToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 30));
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<AdminBookingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (q: { from: string; to: string; status: string }) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: q.from, to: q.to });
      if (q.status) params.set('status', q.status);
      const r = await adminRequest<{ bookings: AdminBookingRow[] }>(`/admin/bookings?${params}`);
      setRows(r.bookings);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '讀取失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({ from: today, to: addDays(today, 30), status: '' });
  }, [load, today]);

  const exportCsv = () => {
    if (!rows) return;
    downloadCsv(`bookings-${from}-${to}.csv`, [
      ['日期', '時間', '方案', '狀態', '付款方式', '金額', '姓名', '性別', '生日', '出生時間', '出生地', '手機', 'Email', '問題', '訂單編號'],
      ...rows.map((r) => [
        r.date,
        r.time,
        r.service.name,
        BOOKING_STATUS_LABELS[r.status],
        PAY_METHOD_LABELS[r.payMethod] ?? r.payMethod,
        r.amount,
        r.customer.name,
        r.customer.gender === 'male' ? '男' : r.customer.gender === 'female' ? '女' : '',
        r.customer.birthDate,
        r.customer.birthTime ?? '',
        r.customer.birthPlace ?? '',
        r.customer.phone,
        r.customer.email,
        r.questions ?? '',
        r.orderNo,
      ]),
    ]);
  };

  return (
    <Card
      title="預約"
      actions={
        <button type="button" onClick={exportCsv} disabled={!rows || rows.length === 0} className={btnGhost}>
          下載 CSV
        </button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load({ from, to, status });
        }}
        className="grid grid-cols-2 items-end gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]"
      >
        <label className={labelSm}>
          開始日期
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputSm} />
        </label>
        <label className={labelSm}>
          結束日期（含當天）
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputSm} />
        </label>
        <label className={labelSm}>
          狀態
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputSm}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={loading} className={btnPrimary}>
          {loading ? '讀取中…' : '查詢'}
        </button>
      </form>

      {error && <Notice tone="error">{error}</Notice>}
      {rows && rows.length === 0 && <Empty>這段期間沒有符合條件的預約</Empty>}
      {rows && rows.length > 0 && (
        <>
          <p className="text-[13px] text-ink-500">共 {rows.length} 筆（點一下看詳細資料）</p>
          <ul className="flex flex-col divide-y divide-line-4 rounded-[12px] border border-line-4">
            {rows.map((r) => {
              const expanded = open === r.orderNo;
              return (
                <li key={r.orderNo}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : r.orderNo)}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-[14px] hover:bg-soft-2"
                  >
                    <span className="w-[120px] font-bold text-ink-900">
                      {formatDateLabel(r.date)} {r.time}
                    </span>
                    <span className="min-w-[160px] flex-1 text-ink-700">
                      {r.customer.name}・{r.service.name}
                    </span>
                    <span className="text-ink-600">{formatPrice(r.amount)}</span>
                    <Badge tone={tone(r.status)}>{BOOKING_STATUS_LABELS[r.status]}</Badge>
                    {r.needsAttention && <Badge tone="rose">需人工處理</Badge>}
                  </button>
                  {expanded && (
                    <dl className="grid grid-cols-[88px_1fr] gap-x-4 gap-y-2 bg-soft-2 px-4 py-4 text-[14px] text-ink-700 md:grid-cols-[88px_1fr_88px_1fr]">
                      <dt className="text-ink-500">訂單編號</dt>
                      <dd>{r.orderNo}</dd>
                      <dt className="text-ink-500">付款方式</dt>
                      <dd>{PAY_METHOD_LABELS[r.payMethod] ?? r.payMethod}</dd>
                      <dt className="text-ink-500">手機</dt>
                      <dd>
                        <a href={`tel:${r.customer.phone}`} className="text-rose-800 underline">
                          {r.customer.phone}
                        </a>
                      </dd>
                      <dt className="text-ink-500">Email</dt>
                      <dd className="break-all">
                        <a href={`mailto:${r.customer.email}`} className="text-rose-800 underline">
                          {r.customer.email}
                        </a>
                      </dd>
                      <dt className="text-ink-500">性別</dt>
                      <dd>{r.customer.gender === 'male' ? '男' : r.customer.gender === 'female' ? '女' : '—'}</dd>
                      <dt className="text-ink-500">國曆生日</dt>
                      <dd>
                        {r.customer.birthDate} {r.customer.birthTime ?? '（未提供時間）'}
                      </dd>
                      <dt className="text-ink-500">出生地</dt>
                      <dd>{r.customer.birthPlace || '—'}</dd>
                      {r.attentionReason && (
                        <>
                          <dt className="text-ink-500">異常</dt>
                          <dd>{r.attentionReason}</dd>
                        </>
                      )}
                      <dt className="text-ink-500 md:col-start-1">問題</dt>
                      <dd className="whitespace-pre-line md:col-span-3">{r.questions || '（未填）'}</dd>
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
