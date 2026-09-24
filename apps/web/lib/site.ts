/**
 * 全站共用設定。換真圖、改網址、關流光都只改這裡。
 */

export const SITE_NAME = '緣舍命理';

export const SITE_DESCRIPTION =
  '一對一線上諮詢，紫微斗數 × 八字合參。每一場都為你單獨排盤，不販賣恐懼。';

/**
 * 人物圖（目前是 SVG 佔位；設計稿的 uploads/images.jpeg 有他站浮水印，不可上線）
 * 換真圖：把檔案放進 apps/web/public/images/ 後改下面這一行即可
 *   - Hero：Q 版命理師（粉色緞面旗袍，去背 PNG，建議 1200×1500）
 *   - 老師頁：例 '/images/teacher.png'
 */
export const HERO_IMAGE = '/images/hero-placeholder.svg';
export const HERO_IMAGE_ALT = '緣舍命理 沐妍老師形象圖';
export const TEACHER_IMAGE = '/images/teacher-placeholder.svg';
export const TEACHER_IMAGE_ALT = '沐妍老師';

/** 全頁流光動畫（原型的 shine 設定，預設開；prefers-reduced-motion 時一律不顯示） */
export const SHINE = true;

/**
 * Google Fonts（不用 next/font/google：CJK 子集在 Vercel build 時會隨機 404 讓部署失敗）
 * 權重照設計交接：Noto Serif TC 400/500/600/700/900、Noto Sans TC 300/400/500/700
 */
export const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;500;600;700;900&family=Noto+Sans+TC:wght@300;400;500;700&display=swap';

export const NAV_ITEMS = [
  { href: '/', label: '首頁' },
  { href: '/services', label: '諮詢方案' },
  { href: '/vip', label: 'VIP 包堂' },
  { href: '/shop', label: '開運選物' },
  { href: '/about', label: '老師介紹' },
  { href: '/faq', label: '常見問題' },
] as const;

export const BOOKING_PATH = '/booking';

/** 「立即預約」→ /booking；帶方案 → 直接進 Step 2（和原型 book(id) 一致） */
export function bookingHref(serviceId?: string): string {
  if (!serviceId) return BOOKING_PATH;
  return `${BOOKING_PATH}?svc=${encodeURIComponent(serviceId)}&step=2`;
}

/** 正式網址：NEXT_PUBLIC_SITE_URL → Vercel 正式網域 → 本機 */
export function resolveSiteUrl(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
}

export const SITE_URL = resolveSiteUrl();
