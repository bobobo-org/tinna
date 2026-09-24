import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 驗收時可用不同的 NEXT_DIST_DIR 並行起多個 dev server，避免互相寫壞 .next
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
