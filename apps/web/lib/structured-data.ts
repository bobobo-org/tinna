/**
 * 結構化資料（JSON-LD，schema.org）：讓 Google 看懂這是什麼網站、提供什麼服務與價格
 *
 * - 全站：ProfessionalService（商家）＋ WebSite（放在 root layout）
 * - 各頁：BreadcrumbList、諮詢方案 OfferCatalog、常見問題 FAQPage、老師 Person
 * 網址一律用 SITE_URL 組成絕對網址；@id 讓各段資料互相引用同一個商家
 */

import type { Service } from './services';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, TEACHER_IMAGE } from './site';

type Json = Record<string, unknown>;

export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

const abs = (path: string) => `${SITE_URL}${path === '/' ? '' : path}`;

export const KNOWS_ABOUT = ['紫微斗數', '八字', '流年運勢', '感情合盤', '事業擇時', '命理諮詢'];

/** 全站：商家＋網站（@graph 一次輸出） */
export function siteGraphLd(): Json {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ProfessionalService',
        '@id': ORG_ID,
        name: SITE_NAME,
        url: abs('/'),
        logo: abs('/apple-icon.png'),
        image: abs('/opengraph-image.png'),
        description: SITE_DESCRIPTION,
        areaServed: { '@type': 'Country', name: '台灣' },
        availableLanguage: 'zh-Hant-TW',
        knowsAbout: KNOWS_ABOUT,
      },
      {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        url: abs('/'),
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: 'zh-Hant-TW',
        publisher: { '@id': ORG_ID },
      },
    ],
  };
}

/** 麵包屑：[{ name: '首頁', path: '/' }, { name: '諮詢方案', path: '/services' }] */
export function breadcrumbLd(items: { name: string; path: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: abs(it.path),
    })),
  };
}

/** 諮詢方案與價格（新台幣） */
export function servicesLd(services: Service[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'OfferCatalog',
    name: '一對一諮詢方案',
    url: abs('/services'),
    itemListElement: services.map((s) => ({
      '@type': 'Offer',
      price: s.price,
      priceCurrency: 'TWD',
      availability: 'https://schema.org/InStock',
      url: abs('/booking'),
      itemOffered: {
        '@type': 'Service',
        name: s.name,
        description: s.desc || s.tagline,
        serviceType: '命理諮詢',
        provider: { '@id': ORG_ID },
        areaServed: { '@type': 'Country', name: '台灣' },
      },
    })),
  };
}

/** 商店商品（價格、庫存） */
export function productLd(p: { slug: string; name: string; description: string | null; price: number; images: string[]; stock: number }): Json {
  const url = abs(`/shop/${p.slug}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    ...(p.images.length > 0 ? { image: p.images } : {}),
    url,
    brand: { '@type': 'Brand', name: SITE_NAME },
    offers: {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: 'TWD',
      availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url,
      seller: { '@id': ORG_ID },
    },
  };
}

/** 常見問題 */
export function faqLd(faqs: readonly { q: string; a: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/** 老師 */
export function teacherLd(description: string): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: '沐妍老師',
    jobTitle: '命理師',
    description,
    image: abs(TEACHER_IMAGE),
    url: abs('/about'),
    worksFor: { '@id': ORG_ID },
    knowsAbout: KNOWS_ABOUT,
  };
}

/** 輸出到 <script type="application/ld+json">：跳脫 < 避免內容被當成 HTML 結束標籤 */
export function jsonLdString(data: Json): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
