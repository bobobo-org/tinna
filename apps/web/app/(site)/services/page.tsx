import Link from 'next/link';
import { pageMetadata } from '@/lib/metadata';
import { formatPrice, getServices } from '@/lib/services';
import { bookingHref } from '@/lib/site';

export const metadata = pageMetadata({
  title: '諮詢方案',
  description:
    '流年運勢盤、感情合盤、事業／擇時、單題快問。皆為線上視訊 · 附錄影檔與重點筆記 · 付款後即確認時段。',
  path: '/services',
});

export default async function ServicesPage() {
  const services = await getServices();

  return (
    <>
      <section className="satin px-[clamp(24px,4vw,56px)] pb-12 pt-16 text-center">
        <p className="mb-[14px] text-[13px] tracking-[.4em] text-rose-accent">SERVICES</p>
        <h1 className="mb-[14px] font-serif text-[32px] font-bold text-ink-900 md:text-[44px]">一對一諮詢方案</h1>
        <p className="text-[16px] text-ink-600">皆為線上視訊 · 附錄影檔與重點筆記 · 付款後即確認時段</p>
      </section>

      <section aria-label="方案列表" className="px-[clamp(24px,4vw,56px)] pb-20 pt-14">
        <div className="mx-auto grid max-w-[1100px] grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[22px]">
          {services.map((s) => (
            <article
              key={s.id}
              className={`flex flex-col gap-[14px] rounded-[18px] border border-rose-600/20 px-[26px] py-8 shadow-card ${
                s.featured ? 'satin' : 'bg-card'
              }`}
            >
              <div className="flex min-h-[28px] items-center justify-between gap-2">
                <span className="font-serif text-[15px] tracking-[.3em] text-rose-600">{s.num}</span>
                {s.featured && (
                  <span className="rounded-pill bg-rose-800 px-[10px] py-1 text-[12px] text-white">最多人選</span>
                )}
              </div>
              <h2 className="font-serif text-[24px] font-bold text-ink-900">{s.name}</h2>
              <p className="text-[14px] leading-[1.9] text-ink-600">{s.desc}</p>
              <p className="font-serif text-[30px] font-bold text-rose-800">
                {formatPrice(s.price)}
                <span className="text-[14px] font-normal text-ink-400"> / {s.minutes} 分鐘</span>
              </p>
              <ul className="flex flex-1 flex-col gap-2 border-t border-rose-600/15 pt-3">
                {s.includes.map((inc) => (
                  <li key={inc} className="flex gap-2 text-[14px] text-ink-700">
                    <span aria-hidden="true" className="text-rose-600">
                      ✓
                    </span>
                    <span>{inc}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={bookingHref(s.id)}
                aria-label={`預約此方案：${s.name}`}
                className="mt-[6px] rounded-pill bg-btn p-[13px] text-center text-[15px] font-bold text-white hover:brightness-[1.08]"
              >
                預約此方案
              </Link>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
