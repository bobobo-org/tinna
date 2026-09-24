import type { MetadataRoute } from 'next';
import { SITE_NAME } from '@/lib/site';

/**
 * PWA manifest（Next 檔案慣例，自動掛到 /manifest.webmanifest）。
 * theme_color 需與 app/layout.tsx 的 viewport.themeColor 一致。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    start_url: '/',
    display: 'standalone',
    background_color: '#fff8fa',
    theme_color: '#ffd9e6',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
