'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { normalizeCode, storeReferral } from '@/lib/referral';

/** KOL 分享連結（任何頁面 ?ref=CODE）→ 記住推薦碼 30 天，結帳時自動帶入 */
export default function ReferralCapture() {
  const pathname = usePathname();
  useEffect(() => {
    const code = normalizeCode(new URLSearchParams(window.location.search).get('ref') ?? '');
    if (code) storeReferral(code);
  }, [pathname]);
  return null;
}
