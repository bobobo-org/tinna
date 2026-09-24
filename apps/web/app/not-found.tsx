import type { Metadata } from 'next';
import Link from 'next/link';
import Pearl from '@/components/Pearl';

// 404 回應 Next 會自動加 <meta name="robots" content="noindex">
export const metadata: Metadata = {
  title: '找不到頁面',
};

export default function NotFound() {
  return (
    <section className="satin flex flex-1 flex-col items-center justify-center gap-5 px-6 py-20 text-center md:py-28">
      <Pearl className="h-[72px] w-[72px] shadow-done-check" />
      <p className="text-[13px] tracking-[.4em] text-rose-accent">404 · NOT FOUND</p>
      <h1 className="font-serif text-[32px] font-bold text-ink-900 md:text-[44px]">找不到這個頁面</h1>
      <p className="max-w-[420px] text-[15px] leading-[1.9] text-ink-600">
        網址可能打錯了，或這個頁面已經移除。回到首頁看看諮詢方案，或直接預約一對一諮詢。
      </p>
      <div className="flex flex-wrap justify-center gap-3 pt-[6px]">
        <Link
          href="/"
          className="rounded-pill border border-rose-600/35 bg-white/55 px-[26px] py-[13px] text-[15px] text-rose-800 hover:bg-white"
        >
          返回首頁
        </Link>
        <Link
          href="/booking"
          className="rounded-pill bg-btn px-[30px] py-[13px] text-[15px] font-bold text-white shadow-btn hover:brightness-[1.08]"
        >
          立即預約
        </Link>
      </div>
    </section>
  );
}
