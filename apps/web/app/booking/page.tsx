import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: '線上預約',
  description: '線上選方案、選時段、填寫排盤資料並完成付款，付款完成即確認時段。',
  path: '/booking',
});

/**
 * 占位頁：預約 4 步流程由下一位 agent 取代（app/booking/page.tsx）。
 * 注意：這裡不在 (site) group，所以沒有手機浮動 CTA；Nav/Footer 由 root layout 提供。
 */
export default function BookingPage() {
  return (
    <section className="bg-booking px-4 pb-6 pt-6 md:px-[clamp(20px,4vw,48px)] md:pb-20 md:pt-10">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-[18px] md:gap-7">
        <h1 className="font-serif text-[26px] font-bold text-ink-900 md:text-[34px]">線上預約</h1>
        <p className="text-[15px] text-ink-600">建置中</p>
      </div>
    </section>
  );
}
