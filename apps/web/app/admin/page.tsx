'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Card, Empty, Notice, btnGhost } from '@/components/admin/ui';
import { ApiError } from '@/lib/api';
import { BOOKING_STATUS_LABELS, adminRequest, type AdminBookingRow } from '@/lib/admin/api';
import { addDays } from '@/lib/admin/format';
import { formatDateLabel, taipeiToday } from '@/lib/booking/time';
import { formatPrice } from '@/lib/services';

/** 後台總覽：接下來 7 天的預約 */
export default function AdminHome() {
  const [rows, setRows] = useState<AdminBookingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const from = taipeiToday();
    const q = new URLSearchParams({ from, to: addDays(from, 6), status: 'confirmed,pending_payment,awaiting_transfer' });
    adminRequest<{ bookings: AdminBookingRow[] }>(`/admin/bookings?${q}`)
      .then((r) => setRows(r.bookings))
      .catch((e) => setError(e instanceof ApiError ? e.message : '讀取失敗'));
  }, []);

  const confirmed = rows?.filter((r) => r.status === 'confirmed') ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="接下來 7 天"
        actions={
          <Link href="/admin/bookings" className={btnGhost}>
            看全部預約
          </Link>
        }
      >
        {error && <Notice tone="error">{error}</Notice>}
        {!rows && !error && <p className="text-[14px] text-ink-500">讀取中…</p>}
        {rows && (
          <>
            <p className="text-[14px] text-ink-600">
              已確認 <b className="text-rose-800">{confirmed.length}</b> 場，合計{' '}
              <b className="text-rose-800">{formatPrice(confirmed.reduce((sum, r) => sum + r.amount, 0))}</b>
            </p>
            {rows.length === 0 ? (
              <Empty>這 7 天還沒有預約</Empty>
            ) : (
              <ul className="flex flex-col divide-y divide-line-4">
                {rows.map((r) => (
                  <li key={r.orderNo} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-[14px]">
                    <span className="w-[120px] font-bold text-ink-900">
                      {formatDateLabel(r.date)} {r.time}
                    </span>
                    <span className="flex-1 text-ink-700">
                      {r.customer.name}・{r.service.name}
                    </span>
                    <Badge tone={r.status === 'confirmed' ? 'green' : 'amber'}>{BOOKING_STATUS_LABELS[r.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
