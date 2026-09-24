import Image from 'next/image';
import Link from 'next/link';
import { PRINCIPLES, TEACHER_TAGS, TIMELINE } from '@/lib/content';
import { pageMetadata } from '@/lib/metadata';
import { TEACHER_IMAGE, TEACHER_IMAGE_ALT, bookingHref } from '@/lib/site';

export const metadata = pageMetadata({
  title: '老師介紹',
  description:
    '沐妍老師：師承正統紫微斗數，十二年實務諮詢經驗，累積諮詢 3,200+ 場。擅長把命盤翻譯成人話，不販賣恐懼、給能執行的建議。',
  path: '/about',
});

export default function AboutPage() {
  return (
    <>
      <section className="satin grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-7 px-5 pb-12 pt-10 md:gap-12 md:px-[clamp(24px,4vw,56px)] md:py-[72px]">
        {/* 原型為 content-box：width:100% + 3px 邊框（和原型一樣會比欄寬多 6px） */}
        <div className="relative box-content h-[360px] w-full max-w-[400px] justify-self-center overflow-hidden rounded-arch-lg border-[3px] border-white/85 shadow-arch md:h-[460px]">
          <Image
            src={TEACHER_IMAGE}
            alt={TEACHER_IMAGE_ALT}
            fill
            sizes="(min-width: 760px) 400px, 100vw"
            className="object-cover"
          />
        </div>
        <div className="flex max-w-[560px] flex-col justify-center gap-5">
          <p className="text-[13px] tracking-[.4em] text-rose-accent">ABOUT THE READER</p>
          <h1 className="font-serif text-[32px] font-bold text-ink-900 md:text-[44px]">沐妍老師</h1>
          <p className="text-pretty text-[17px] leading-[2.1] text-ink-600">
            師承正統紫微斗數，十二年實務諮詢經驗。擅長把命盤翻譯成人話——你會離開時知道下一步要做什麼，而不是更焦慮。
          </p>
          <ul className="flex flex-wrap gap-[10px]">
            {TEACHER_TAGS.map((tag) => (
              <li
                key={tag}
                className="rounded-pill border border-rose-600/25 bg-white px-4 py-2 text-[13px] text-rose-800"
              >
                {tag}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-page px-[clamp(24px,4vw,56px)] py-[72px]">
        <div className="mx-auto grid max-w-[1100px] grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-12">
          <div className="flex flex-col gap-5">
            <h2 className="font-serif text-[28px] font-bold text-ink-900">經歷</h2>
            <ol className="flex flex-col">
              {TIMELINE.map((row, i) => (
                <li
                  key={row.year}
                  className={`grid grid-cols-[80px_1fr] gap-4 border-t border-line py-4 text-[15px] text-ink-600 ${
                    i === TIMELINE.length - 1 ? 'border-b' : ''
                  }`}
                >
                  <span className="font-bold text-rose-600">{row.year}</span>
                  <span>{row.text}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-col gap-5">
            <h2 className="font-serif text-[28px] font-bold text-ink-900">諮詢原則</h2>
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="rounded-2xl border border-rose-600/[.18] bg-white p-6">
                <h3 className="mb-2 text-[17px] font-bold text-rose-800">{p.title}</h3>
                <p className="text-[14px] leading-[1.9] text-ink-600">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="pt-14 text-center">
          <Link
            href={bookingHref()}
            className="inline-block rounded-pill bg-btn px-[46px] py-4 text-[16px] font-bold text-white"
          >
            預約沐妍老師
          </Link>
        </div>
      </section>
    </>
  );
}
