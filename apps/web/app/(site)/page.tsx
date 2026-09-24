import Image from 'next/image';
import Link from 'next/link';
import Pearl from '@/components/Pearl';
import { FLOW_STEPS, HERO_POINTS, TESTIMONIALS } from '@/lib/content';
import { formatPrice, getServices } from '@/lib/services';
import { HERO_IMAGE, HERO_IMAGE_ALT, bookingHref } from '@/lib/site';

export default async function HomePage() {
  const services = await getServices();
  const homeServices = services.slice(0, 3);

  return (
    <>
      {/* Hero */}
      <section className="satin relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] overflow-hidden md:min-h-[580px]">
        <div className="relative flex items-center justify-center px-5 pb-2 pt-7 md:px-8 md:py-12">
          <div
            aria-hidden="true"
            className="absolute aspect-square h-[280px] w-[280px] max-w-[90%] rounded-full bg-halo shadow-halo md:h-[400px] md:w-[400px]"
          />
          <div className="relative box-content h-[310px] w-[250px] max-w-full overflow-hidden rounded-arch border-[3px] border-white/85 shadow-arch md:h-[450px] md:w-[360px]">
            <Image
              src={HERO_IMAGE}
              alt={HERO_IMAGE_ALT}
              fill
              priority
              sizes="(min-width: 760px) 360px, 250px"
              className="object-cover"
            />
          </div>
        </div>

        <div className="relative flex flex-wrap items-center gap-5 px-[22px] pb-11 pt-3 md:gap-10 md:px-[clamp(24px,4vw,56px)] md:py-12">
          <h1 className="font-serif text-[32px] font-bold leading-[1.4] tracking-[.16em] text-ink-900 xs:text-[38px] md:text-[clamp(44px,5vw,64px)] md:leading-[1.5] md:[writing-mode:vertical-rl]">
            問一個人的命
            <br />
            <span className="text-rose-600">答一段路的解</span>
          </h1>
          <div className="flex max-w-[400px] flex-[1_1_260px] flex-col gap-6">
            <div aria-hidden="true" className="h-[2px] w-14 bg-hero-line" />
            <p className="text-pretty text-[17px] leading-[2.1] text-ink-600">
              一對一線上諮詢，紫微斗數 × 八字合參。每一場都為你單獨排盤，不套模板、不販賣恐懼。
            </p>
            <ul className="flex flex-col gap-[10px] text-[14px] text-ink-600">
              {HERO_POINTS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-[14px] pt-[6px]">
              {/* 原型是 content-box：手機 flex:1 1 0 時兩鈕寬度差 = 內距差，box-content 才會一致 */}
              <Link
                href={bookingHref()}
                className="box-content flex-[1_1_0] rounded-pill bg-btn px-8 py-[15px] text-center text-[15px] font-bold tracking-[.08em] text-white shadow-btn hover:brightness-[1.08] md:flex-none"
              >
                立即預約
              </Link>
              <Link
                href="/services"
                className="box-content flex-[1_1_0] rounded-pill border border-rose-800/35 bg-white/55 px-7 py-[15px] text-center text-[15px] text-rose-800 hover:bg-white md:flex-none"
              >
                查看價目
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 三格服務（整格可點 → 預約 Step 2 並帶入方案） */}
      <section
        aria-label="諮詢方案"
        className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] border-t border-white/90 bg-svc-row"
      >
        {homeServices.map((s) => (
          <Link
            key={s.id}
            href={bookingHref(s.id)}
            className={`relative flex flex-col gap-[14px] border-b border-r border-t-[3px] border-b-rose-600/10 border-r-rose-600/10 bg-transparent px-[22px] py-[26px] [transition:background_.2s] hover:bg-white/60 md:border-b-0 md:px-9 md:py-12 ${
              s.featured ? 'border-t-rose-600' : 'border-t-transparent'
            }`}
          >
            <span className="font-serif text-[15px] tracking-[.3em] text-rose-600">{s.num}</span>
            <h2 className="font-serif text-[26px] font-bold text-ink-900">{s.short}</h2>
            <p className="text-[14px] leading-[2] text-ink-600">{s.tagline}</p>
            <span className="mt-[6px] flex items-center justify-between">
              <span className="text-[15px] font-bold text-rose-800">
                {formatPrice(s.price)} / {s.minutes} 分
              </span>
              <span className="text-[14px] text-rose-600">預約 →</span>
            </span>
          </Link>
        ))}
      </section>

      {/* 四步完成預約 */}
      <section className="bg-page px-[clamp(24px,4vw,56px)] py-[72px]">
        <div className="mx-auto max-w-[1100px]">
          <h2 className="mb-9 font-serif text-[30px] font-bold tracking-[.1em] text-ink-900">四步完成預約</h2>
          <ol className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-6 md:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
            {FLOW_STEPS.map((p) => (
              <li key={p.n} className="flex flex-col gap-3">
                <Pearl className="h-11 w-11 font-bold text-white shadow-step">{p.n}</Pearl>
                <h3 className="font-serif text-[19px] font-semibold text-ink-900">{p.t}</h3>
                <p className="text-[14px] leading-[1.9] text-ink-600">{p.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 諮詢者說 */}
      <section className="bg-review px-[clamp(24px,4vw,56px)] py-16">
        <div className="mx-auto max-w-[1100px]">
          <h2 className="mb-8 font-serif text-[30px] font-bold tracking-[.1em] text-ink-900">諮詢者說</h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-[22px]">
            {TESTIMONIALS.map((t) => (
              <figure key={t.by} className="rounded-2xl border border-rose-600/[.18] bg-white p-[30px]">
                <blockquote className="text-[15px] leading-[2.1] text-ink-600">{t.quote}</blockquote>
                <figcaption className="mt-4 text-[13px] text-ink-400">{t.by}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* 底部 CTA */}
      <section className="satin relative overflow-hidden border-t border-white/90 px-8 py-16 text-center">
        <h2 className="relative mb-[10px] font-serif text-[34px] font-bold text-ink-900">下一個時段，留給你</h2>
        <p className="relative mb-6 text-[15px] text-ink-600">線上選時段、付款完成即確認</p>
        <Link
          href={bookingHref()}
          className="relative inline-block rounded-pill bg-btn px-[46px] py-4 text-[16px] font-bold tracking-[.08em] text-white shadow-btn"
        >
          預約一對一諮詢
        </Link>
      </section>
    </>
  );
}
