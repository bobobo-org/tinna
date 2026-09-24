import Link from 'next/link';
import JsonLd from '@/components/JsonLd';
import CartLink from '@/components/shop/CartLink';
import { pageMetadata } from '@/lib/metadata';
import { formatPrice } from '@/lib/services';
import { getCatalog } from '@/lib/shop';
import { breadcrumbLd } from '@/lib/structured-data';

export const metadata = pageMetadata({
  title: '開運選物',
  description: '護身符、開運手鍊等老師挑選的好物，線上刷卡、宅配到府。',
  path: '/shop',
});

/** 商店首頁：商品列表（API /shop/products，1 分鐘 revalidate） */
export default async function ShopPage() {
  const catalog = await getCatalog();

  return (
    <>
      <JsonLd
        data={breadcrumbLd([
          { name: '首頁', path: '/' },
          { name: '開運選物', path: '/shop' },
        ])}
      />
      <section className="satin px-[clamp(24px,4vw,56px)] pb-12 pt-16 text-center">
        <p className="mb-[14px] text-[13px] tracking-[.4em] text-rose-accent">SHOP</p>
        <h1 className="mb-[14px] font-serif text-[32px] font-bold text-ink-900 md:text-[44px]">開運選物</h1>
        <p className="text-[16px] text-ink-600">
          老師挑選的護身符與開運小物・線上刷卡・宅配到府
          {catalog && catalog.freeShippingOver !== null ? `・滿 ${formatPrice(catalog.freeShippingOver)} 免運` : ''}
        </p>
      </section>

      <section aria-label="商品列表" className="px-[clamp(16px,4vw,56px)] pb-24 pt-10">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
          <div className="flex justify-end">
            <CartLink />
          </div>
          {!catalog && <p className="rounded-[14px] bg-soft-2 px-4 py-10 text-center text-[15px] text-ink-500">商店暫時無法使用，請稍後再試。</p>}
          {catalog && catalog.products.length === 0 && (
            <p className="rounded-[14px] bg-soft-2 px-4 py-10 text-center text-[15px] text-ink-500">商品準備中，敬請期待。</p>
          )}
          {catalog && catalog.products.length > 0 && (
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-[repeat(auto-fill,minmax(230px,1fr))] md:gap-6">
              {catalog.products.map((p, i) => (
                <li key={p.id} data-reveal style={{ '--reveal-delay': `${(i % 4) * 90}ms` } as React.CSSProperties}>
                  <Link
                    href={`/shop/${p.slug}`}
                    className="lift flex h-full flex-col overflow-hidden rounded-[18px] border border-rose-600/15 bg-white shadow-card"
                  >
                    <div className="relative aspect-square w-full bg-card">
                      {p.images[0] ? (
                        // 商品圖放在 Supabase Storage（外部網域），直接用 img
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.images[0]} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center px-3 text-center font-serif text-[20px] text-rose-800/60">
                          {p.name}
                        </div>
                      )}
                      {p.stock < 1 && (
                        <span className="absolute left-3 top-3 rounded-pill bg-ink-900/80 px-3 py-1 text-[12px] text-white">已售完</span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1 px-4 py-4">
                      <h2 className="text-[15px] font-bold leading-[1.6] text-ink-900 md:text-[16px]">{p.name}</h2>
                      <p className="mt-auto font-serif text-[18px] font-bold text-rose-800">{formatPrice(p.price)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
