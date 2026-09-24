import type { Metadata, Viewport } from 'next';
import Footer from '@/components/Footer';
import Nav from '@/components/Nav';
import SatinSweep from '@/components/SatinSweep';
import { FONT_CSS_URL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME}｜紫微斗數 × 八字 一對一線上諮詢`,
    template: `%s｜${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
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
    <html lang="zh-Hant-TW">
      <head>
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
        <div className="flex min-h-screen flex-col bg-page">
          <SatinSweep />
          <Nav />
          <main id="main" className="flex flex-col">
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
