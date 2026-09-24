import Link from 'next/link';
import { formatPrice } from '@/lib/services';
import { BOOKING_PATH } from '@/lib/site';

/**
 * 手機浮動 CTA（首頁／方案／老師／FAQ）。
 * 只放在 app/(site)/layout.tsx，所以 /booking 不會出現；桌機寬度與選單開啟時隱藏。
 */
export default function MobileCta({ fromPrice }: { fromPrice: number }) {
  return (
    <div className="fixed bottom-[calc(16px+env(safe-area-inset-bottom))] left-[max(16px,env(safe-area-inset-left))] right-[max(16px,env(safe-area-inset-right))] z-[15] flex items-center gap-3 rounded-pill border border-white/90 bg-white/[.92] py-2 pl-5 pr-2 shadow-cta backdrop-blur-[12px] md:hidden [html.menu-open_&]:hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-bold text-ink-900">一對一線上諮詢</span>
        <span className="text-[12px] text-ink-400">{`${formatPrice(fromPrice)} 起 · 付款即確認`}</span>
      </div>
      <Link
        href={BOOKING_PATH}
        className="flex h-12 items-center rounded-pill bg-btn px-6 text-[15px] font-bold text-white"
      >
        立即預約
      </Link>
    </div>
  );
}
