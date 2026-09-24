import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import JsonLd from '@/components/JsonLd';
import AddToCart from '@/components/shop/AddToCart';
import CartLink from '@/components/shop/CartLink';
import ProductGallery from '@/components/shop/ProductGallery';
import { pageMetadata } from '@/lib/metadata';
import { formatPrice } from '@/lib/services';
import { getShopProduct } from '@/lib/shop';
import { breadcrumbLd, productLd } from '@/lib/structured-data';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const r = await getShopProduct(slug);
  if (!r || r === 'not_found') {
    return pageMetadata({ title: '開運選物', description: '護身符、開運手鍊等老師挑選的好物。', path: '/shop', noindex: r === 'not_found' });
  }
  const p = r.product;
  return pageMetadata({
    title: p.name,
    description: (p.description?.replace(/\s+/g, ' ').trim() || `${p.name}｜緣舍命理開運選物`).slice(0, 120),
    path: `/shop/${p.slug}`,
    image: p.images[0] ? { url: p.images[0], alt: p.name } : undefined,
  });
}

/** 商品頁：圖片、價格、說明、加入購物車 */
export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const r = await getShopProduct(slug);
  if (r === 'not_found') notFound();
  if (!r) {
    return (
      <section className="px-6 py-24 text-center text-[15px] text-ink-500">
        商店暫時無法使用，請稍後再試。
        <Link href="/shop" className="ml-2 text-rose-800 underline underline-offset-4">
          回商店
        </Link>
      </section>
    );
  }
  const p = r.product;

  return (
    <>
      <JsonLd data={productLd(p)} />
      <JsonLd
        data={breadcrumbLd([
          { name: '首頁', path: '/' },
          { name: '開運選物', path: '/shop' },
          { name: p.name, path: `/shop/${p.slug}` },
        ])}
      />
      <section className="px-[clamp(16px,4vw,56px)] pb-24 pt-8 md:pt-12">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
          <div className="flex items-center justify-between gap-3">
            <Link href="/shop" className="text-[14px] text-rose-800 underline underline-offset-4">
              ‹ 回商店
            </Link>
            <CartLink />
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-8 md:gap-12">
            <ProductGallery images={p.images} name={p.name} />
            <div className="flex flex-col gap-5">
              <h1 className="font-serif text-[28px] font-bold leading-[1.5] text-ink-900 md:text-[34px]">{p.name}</h1>
              <p className="font-serif text-[30px] font-bold text-rose-800">{formatPrice(p.price)}</p>
              <p className="text-[13px] text-ink-500">
                宅配運費 {r.shippingFee > 0 ? formatPrice(r.shippingFee) : '免運'}
                {r.freeShippingOver !== null && r.shippingFee > 0 ? `・滿 ${formatPrice(r.freeShippingOver)} 免運` : ''}
              </p>
              <AddToCart product={p} />
              {p.description && (
                <div className="border-t border-rose-600/15 pt-5 text-[15px] leading-[2] text-ink-600 [white-space:pre-line]">{p.description}</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
