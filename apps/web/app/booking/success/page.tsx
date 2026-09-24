import BookingSuccess from '@/components/booking/BookingSuccess';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: '預約完成',
  description: '預約完成與訂單明細。',
  path: '/booking/success',
  noindex: true,
});

/**
 * 預約完成頁：金流完成後由 API 303 導回 /booking/success?order=<orderNo>
 * 訂單狀態在瀏覽器端查 GET /bookings/:orderNo（付款確認中要輪詢）
 */
export default async function BookingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const order = typeof sp.order === 'string' ? sp.order : Array.isArray(sp.order) ? (sp.order[0] ?? null) : null;
  return <BookingSuccess key={order ?? ''} orderNo={order} serverNow={Date.now()} />;
}
