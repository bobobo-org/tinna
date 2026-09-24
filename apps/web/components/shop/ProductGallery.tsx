'use client';

import { useState } from 'react';

/** 商品圖片：大圖＋縮圖切換（沒有圖片時顯示品名底圖） */
export default function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [i, setI] = useState(0);
  const src = images[i] ?? images[0];
  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-square w-full overflow-hidden rounded-[20px] border border-rose-600/15 bg-card shadow-card">
        {src ? (
          // 商品圖放在 Supabase Storage（外部網域），直接用 img
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-serif text-[28px] text-rose-800/60">{name}</div>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="商品圖片">
          {images.map((img, idx) => (
            <button
              key={img}
              type="button"
              onClick={() => setI(idx)}
              aria-label={`第 ${idx + 1} 張圖片`}
              aria-pressed={idx === i}
              className={`h-16 w-16 overflow-hidden rounded-[10px] border-2 ${idx === i ? 'border-rose-600' : 'border-transparent opacity-70 hover:opacity-100'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
