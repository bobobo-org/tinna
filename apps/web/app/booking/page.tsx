import { connection } from 'next/server';
import BookingFlow from '@/components/booking/BookingFlow';
import { pageMetadata } from '@/lib/metadata';
import { getServices } from '@/lib/services';

export const metadata = pageMetadata({
  title: '線上預約',
  description: '線上選方案、選時段、填寫排盤資料並完成付款，付款完成即確認時段。',
  path: '/booking',
});

/**
 * 線上預約（4 步）。不在 (site) group → 沒有手機浮動 CTA，改用頁面內的 sticky 結帳列。
 *
 * 每次請求動態產生：?svc=&step= 深連結在伺服器端就畫出正確的步驟（不會先閃 Step 1），
 * 伺服器時間傳給前端當「今天」的基準（月曆、可預約月份不受裝置時鐘影響）。
 */
export default async function BookingPage() {
  await connection();
  const services = await getServices();
  return <BookingFlow services={services} serverNow={Date.now()} />;
}
