import { FOOTER_ITEMS } from '@/lib/content';
import { SITE_NAME } from '@/lib/site';

/** 共用 Footer。手機底部多留 112px（＋safe area）給浮動 CTA，內容不會被遮住。 */
export default function Footer() {
  return (
    <footer className="mt-auto flex flex-wrap items-center justify-between gap-6 bg-ink-900 pb-[calc(112px+env(safe-area-inset-bottom))] pl-[max(20px,env(safe-area-inset-left))] pr-[max(20px,env(safe-area-inset-right))] pt-8 text-footer-text md:py-10 md:pl-[max(clamp(24px,4vw,56px),env(safe-area-inset-left))] md:pr-[max(clamp(24px,4vw,56px),env(safe-area-inset-right))]">
      <div className="flex flex-col gap-[6px]">
        <span className="font-serif text-[20px] tracking-[.18em] text-footer-title">{SITE_NAME}</span>
        <span className="text-[13px]">© 2026 緣舍命理工作室 · 統一編號 00000000</span>
      </div>
      <div className="flex flex-wrap gap-5 text-[13px]">
        {FOOTER_ITEMS.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </footer>
  );
}
