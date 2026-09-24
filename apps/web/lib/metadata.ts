import type { Metadata } from 'next';
import { SITE_NAME } from '@/lib/site';

/**
 * 各頁 metadata：title 會套 root 的 template「%s｜緣舍命理」。
 * openGraph 在 Next 是整包覆蓋（不會和 root 合併），所以共用欄位在這裡補齊。
 */
export function pageMetadata({
  title,
  description,
  path,
  noindex = false,
}: {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      locale: 'zh_TW',
      siteName: SITE_NAME,
      url: path,
      title: `${title}｜${SITE_NAME}`,
      description,
      // 子頁的 openGraph 會整包蓋掉 root，app/opengraph-image.png 不會自動繼承，要明寫
      images: [
        {
          url: '/opengraph-image.png',
          width: 1200,
          height: 630,
          alt: '緣舍命理分享卡：粉色緞面背景搭配珍珠圓標誌，標語「問一個人的命・答一段路的解」',
        },
      ],
    },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
