'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MAX_QTY, addLine, loadCart, saveCart, type ShopProduct } from '@/lib/shop';

const stepBtn =
  'flex h-11 w-11 items-center justify-center text-[20px] text-rose-800 disabled:opacity-30';

/** 數量＋加入購物車 */
export default function AddToCart({ product }: { product: ShopProduct }) {
  const max = Math.max(0, Math.min(product.stock, MAX_QTY));
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);

  if (max < 1) {
    return <p className="rounded-[12px] bg-soft-2 px-4 py-3 text-[15px] text-ink-500">已售完，補貨後會再上架</p>;
  }

  const add = () => {
    const lines = loadCart();
    const before = lines.find((l) => l.id === product.id)?.qty ?? 0;
    const next = addLine(lines, product.id, qty, product.stock);
    const after = next.find((l) => l.id === product.id)?.qty ?? 0;
    saveCart(next);
    setMsg(after === before ? `購物車裡已經有 ${after} 件（已達可購買上限）` : `已加入購物車（共 ${after} 件）`);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-pill border border-rose-600/30 bg-white" role="group" aria-label="數量">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="減少數量" className={stepBtn}>
            −
          </button>
          <span className="min-w-[2.5em] text-center text-[16px] font-bold text-ink-900" aria-live="polite">
            {qty}
          </span>
          <button type="button" onClick={() => setQty((q) => Math.min(max, q + 1))} disabled={qty >= max} aria-label="增加數量" className={stepBtn}>
            ＋
          </button>
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex min-h-[46px] items-center rounded-pill bg-btn px-8 text-[16px] font-bold text-white shadow-btn-sm hover:brightness-[1.08]"
        >
          加入購物車
        </button>
      </div>
      {product.stock <= 5 && <p className="text-[13px] text-ink-500">剩 {product.stock} 件</p>}
      {msg && (
        <p role="status" className="flex flex-wrap items-center gap-3 rounded-[12px] bg-soft px-4 py-3 text-[14px] text-ink-700">
          {msg}
          <Link href="/shop/cart" className="font-bold text-rose-800 underline underline-offset-4">
            前往結帳
          </Link>
        </p>
      )}
    </div>
  );
}
