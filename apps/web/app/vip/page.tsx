import JsonLd from '@/components/JsonLd';
import VipLookup from '@/components/vip/VipLookup';
import VipPurchase from '@/components/vip/VipPurchase';
import { pageMetadata } from '@/lib/metadata';
import { formatPrice } from '@/lib/services';
import { breadcrumbLd } from '@/lib/structured-data';
import { getVipPlans, perSession } from '@/lib/vip';

export const metadata = pageMetadata({
  title: 'VIP 包堂',
  description: 'VIP 包堂方案：每堂 90 分鐘一對一深度諮詢，堂數越多每堂越划算；VIP 專屬生日禮與不定期贈品。',
  path: '/vip',
});

const PERKS = [
  { title: '每堂 90 分鐘', body: '比一般方案更從容的深度諮詢，一次把想問的事情慢慢談清楚。' },
  { title: '堂數越多越划算', body: '一次購買多堂，每堂價格更低；有效期限內隨時用 VIP 卡號預約，不必每次付款。' },
  { title: 'VIP 專屬禮遇', body: '生日當月的小禮物，以及不定期寄出的 VIP 專屬贈品（護身符、手鍊等實體好物）。' },
];

const STEPS = [
  '選擇方案並完成信用卡付款',
  'VIP 卡號寄到你的 Email（付款完成頁也會顯示）',
  '預約時選「VIP 諮詢」，輸入 VIP 卡號與購買時的 Email，每次扣 1 堂',
];

/**
 * VIP 包堂（/vip）：方案與價格（Supabase vip_plans，5 分鐘 revalidate）＋購買表單＋查詢剩餘堂數
 * 不在 (site) group：沒有手機浮動「立即預約」，避免蓋住購買按鈕
 */
export default async function VipPage() {
  const plans = await getVipPlans();
  const cheapest = plans.length > 0 ? Math.min(...plans.map(perSession)) : null;

  return (
    <>
      <JsonLd
        data={breadcrumbLd([
          { name: '首頁', path: '/' },
          { name: 'VIP 包堂', path: '/vip' },
        ])}
      />
      <section className="satin px-[clamp(24px,4vw,56px)] pb-12 pt-16 text-center">
        <p className="mb-[14px] text-[13px] tracking-[.4em] text-rose-accent">VIP MEMBERSHIP</p>
        <h1 className="mb-[14px] font-serif text-[32px] font-bold text-ink-900 md:text-[44px]">VIP 包堂方案</h1>
        <p className="mx-auto max-w-[620px] text-[16px] leading-[1.9] text-ink-600">
          一次購買多堂 90 分鐘的一對一諮詢，堂數越多越划算
          {cheapest !== null ? `，每堂最低 ${formatPrice(cheapest)}` : ''}。
        </p>
      </section>

      <section aria-label="VIP 禮遇" className="px-[clamp(24px,4vw,56px)] pt-12">
        <div className="mx-auto grid max-w-[1100px] grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[22px]">
          {PERKS.map((p, i) => (
            <div key={p.title} data-reveal style={{ '--reveal-delay': `${i * 110}ms` } as React.CSSProperties}>
              <article className="flex h-full flex-col gap-3 rounded-[18px] border border-rose-600/20 bg-card px-[26px] py-7 shadow-card">
                <h2 className="font-serif text-[21px] font-bold text-ink-900">{p.title}</h2>
                <p className="text-[14px] leading-[1.9] text-ink-600">{p.body}</p>
              </article>
            </div>
          ))}
        </div>
      </section>

      <section id="buy" aria-labelledby="vip-buy-title" className="scroll-mt-24 px-[clamp(16px,4vw,56px)] pt-14">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
          <div className="flex flex-col gap-2 text-center">
            <p className="text-[13px] tracking-[.4em] text-rose-accent">PLANS</p>
            <h2 id="vip-buy-title" className="font-serif text-[28px] font-bold text-ink-900 md:text-[34px]">
              選擇 VIP 方案
            </h2>
          </div>
          <VipPurchase plans={plans} />
        </div>
      </section>

      <section aria-labelledby="vip-how-title" className="px-[clamp(24px,4vw,56px)] pt-14">
        <div className="mx-auto flex max-w-[820px] flex-col gap-4 rounded-[18px] bg-soft-2 px-6 py-7 md:px-9">
          <h2 id="vip-how-title" className="font-serif text-[22px] font-bold text-ink-900">
            怎麼使用 VIP 堂數？
          </h2>
          <ol className="flex flex-col gap-3 text-[15px] leading-[1.9] text-ink-600">
            {STEPS.map((s, i) => (
              <li key={s} className="flex gap-3">
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-rose-600 text-[14px] font-bold text-white">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="lookup" aria-labelledby="vip-lookup-title" className="scroll-mt-24 px-[clamp(16px,4vw,56px)] pb-24 pt-14">
        <div className="mx-auto flex max-w-[820px] flex-col gap-5">
          <div className="flex flex-col gap-2 text-center">
            <p className="text-[13px] tracking-[.4em] text-rose-accent">MY VIP</p>
            <h2 id="vip-lookup-title" className="font-serif text-[28px] font-bold text-ink-900">
              查詢剩餘堂數
            </h2>
          </div>
          <VipLookup />
        </div>
      </section>
    </>
  );
}
