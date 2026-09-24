'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * 捲動出現：有 data-reveal 的元素捲進畫面時加上 .is-visible（樣式在 globals.css）
 * - <html class="reveal-ready"> 由 layout 的 inline script 在第一次繪製前加上；沒有 JS 時內容照常顯示
 * - 換頁（pathname 改變）後重新找一次新頁面的元素
 * - 不支援 IntersectionObserver 的瀏覽器：拿掉 reveal-ready，全部直接顯示
 */
export default function RevealObserver() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    if (!('IntersectionObserver' in window)) {
      root.classList.remove('reveal-ready');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    document.querySelectorAll('[data-reveal]:not(.is-visible)').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);

  return null;
}
