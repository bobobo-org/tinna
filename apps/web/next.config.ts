import type { NextConfig } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
const canonicalHost = SITE_URL ? new URL(SITE_URL).host : undefined;

const nextConfig: NextConfig = {
  // 驗收時可用不同的 NEXT_DIST_DIR 並行起多個 dev server，避免互相寫壞 .next
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  // 正式環境只用一個網址：Vercel 自動配的別名（tinna-beta.vercel.app 等）一律轉到 NEXT_PUBLIC_SITE_URL。
  // API 只接受 WEB_URL 白名單網域送出的預約（防跨站），從別名下單會被 403 擋掉
  async redirects() {
    if (process.env.VERCEL_ENV !== 'production' || !SITE_URL || !canonicalHost) return [];
    return [
      {
        source: '/:path*',
        missing: [{ type: 'host', value: `^${canonicalHost.replace(/\./g, '\\.')}$` }],
        destination: `${SITE_URL}/:path*`,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
