'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CART_EVENT, cartCount, loadCart } from '@/lib/shop';

/** 購物車連結＋件數（localStorage；其他分頁改了也會同步） */
export default function CartLink() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const sync = () => setN(cartCount(loadCart()));
    sync();
    window.addEventListener(CART_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CART_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return (
    <Link
      href="/shop/cart"
      className="inline-flex items-center gap-2 rounded-pill border border-rose-600/30 bg-white/80 px-5 py-[10px] text-[14px] font-bold text-rose-800 hover:bg-soft"
    >
      購物車
      {n > 0 && <span className="rounded-pill bg-rose-600 px-2 py-[1px] text-[12px] text-white">{n}</span>}
    </Link>
  );
}
