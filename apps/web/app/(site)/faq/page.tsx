import FaqAccordion from '@/components/FaqAccordion';
import JsonLd from '@/components/JsonLd';
import { FAQS } from '@/lib/content';
import { pageMetadata } from '@/lib/metadata';
import { breadcrumbLd, faqLd } from '@/lib/structured-data';

export const metadata = pageMetadata({
  title: '常見問題',
  description: '需要準備什麼資料、諮詢方式、改期與退款、付款方式、可否幫別人問——預約前常見的問題一次看。',
  path: '/faq',
});

export default function FaqPage() {
  return (
    <section className="px-[clamp(24px,4vw,56px)] pb-[88px] pt-16">
      <JsonLd data={faqLd(FAQS)} />
      <JsonLd
        data={breadcrumbLd([
          { name: '首頁', path: '/' },
          { name: '常見問題', path: '/faq' },
        ])}
      />
      <div className="mx-auto flex max-w-[820px] flex-col gap-3">
        <p className="text-[13px] tracking-[.4em] text-rose-accent">FAQ</p>
        <h1 className="mb-6 font-serif text-[32px] font-bold text-ink-900 md:text-[44px]">常見問題</h1>
        <div data-reveal>
          <FaqAccordion items={FAQS} />
        </div>
      </div>
    </section>
  );
}
