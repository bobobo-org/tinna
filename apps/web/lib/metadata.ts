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
    },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
