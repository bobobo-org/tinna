import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: '預約完成',
  description: '預約完成與訂單明細。',
  path: '/booking/success',
  noindex: true,
});

/** 占位頁：預約完成頁由下一位 agent 取代（讀 ?order= 查 GET /bookings/:orderNo，見 docs/API.md）。 */
export default function BookingSuccessPage() {
  return (
    <section className="satin px-6 pb-24 pt-[72px]">
      <div className="mx-auto flex max-w-[560px] flex-col gap-[18px] rounded-3xl bg-white px-9 py-11 text-center shadow-done">
        <h1 className="font-serif text-[32px] font-bold text-ink-900">預約完成</h1>
        <p className="text-[15px] leading-[1.9] text-ink-600">建置中</p>
      </div>
    </section>
  );
}
