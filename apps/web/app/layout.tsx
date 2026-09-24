import type { Metadata, Viewport } from 'next';
import Footer from '@/components/Footer';
import JsonLd from '@/components/JsonLd';
import Nav from '@/components/Nav';
import RevealObserver from '@/components/RevealObserver';
import SatinSweep from '@/components/SatinSweep';
import { FONT_CSS_URL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';
import { siteGraphLd } from '@/lib/structured-data';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME}｜紫微斗數 × 八字 一對一線上諮詢`,
    template: `%s｜${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ['紫微斗數', '八字', '命理諮詢', '線上算命', '一對一諮詢', '流年運勢', '感情合盤', '擇日', SITE_NAME],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: '命理諮詢',
  // 允許 Google 顯示大圖預覽與完整摘要
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
  },
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'zh_TW',
    siteName: SITE_NAME,
    url: '/',
    title: `${SITE_NAME}｜紫微斗數 × 八字 一對一線上諮詢`,
    description: SITE_DESCRIPTION,
  },
  // iOS 會把「統一編號 00000000」這類數字自動變成電話連結（改變設計樣式）
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffd9e6',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning：<html> 的 class 由下面的 inline script（reveal-ready）與 Nav（menu-open）在瀏覽器端加上
    <html lang="zh-Hant-TW" suppressHydrationWarning>
      <head>
        {/* 有 JS 才啟用「捲動出現」（第一次繪製前加上，沒有 JS 時內容照常顯示） */}
        <script dangerouslySetInnerHTML={{ __html: `document.documentElement.classList.add('reveal-ready')` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* 字型 CSS 有 1MB（CJK 分片 @font-face 近千條）：用 script 插入就不擋首次繪製；display=swap 先用系統字 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var l=document.createElement('link');l.rel='stylesheet';l.href=${JSON.stringify(FONT_CSS_URL)};document.head.appendChild(l)})()`,
          }}
        />
        <noscript>
          <link rel="stylesheet" href={FONT_CSS_URL} />
        </noscript>
      </head>
      <body>
        <JsonLd data={siteGraphLd()} />
        <div className="flex min-h-screen flex-col bg-page">
          <SatinSweep />
          <Nav />
          <main id="main" className="flex flex-col">
            {children}
          </main>
          <Footer />
        </div>
        <RevealObserver />
      </body>
    </html>
  );
}
