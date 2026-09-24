'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Card, Empty, Notice, btnGhost, btnPrimary, inputSm, labelSm } from '@/components/admin/ui';
import { ApiError } from '@/lib/api';
import { adminRequest, adminUpload, type AdminProduct, type ShopSettings } from '@/lib/admin/api';
import { IMAGE_ACCEPT, prepareImage } from '@/lib/admin/image';
import { formatPrice } from '@/lib/services';

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : '發生錯誤，請稍後再試');

// ---------------------------------------------------------------------
// 商品表單（新增／編輯）
// ---------------------------------------------------------------------

type Form = {
  name: string;
  slug: string;
  price: string;
  stock: string;
  sort: string;
  description: string;
  images: string[];
  forSale: boolean;
  active: boolean;
};

const EMPTY: Form = { name: '', slug: '', price: '', stock: '0', sort: '0', description: '', images: [], forSale: true, active: true };

function toForm(p: AdminProduct): Form {
  return {
    name: p.name,
    slug: p.slug,
    price: String(p.price),
    stock: String(p.stock),
    sort: String(p.sort),
    description: p.description ?? '',
    images: [...p.images],
    forSale: p.forSale,
    active: p.active,
  };
}

function ProductEditor({ editing, onDone, onCancel }: { editing: AdminProduct | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState<Form>(editing ? toForm(editing) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const list = Array.from(files).slice(0, 8);
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const url = await adminUpload(await prepareImage(file));
        setF((p) => (p.images.length >= 8 ? p : { ...p, images: [...p.images, url] }));
      } catch (e) {
        setError(`${file.name}：${errMsg(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const move = (i: number, d: -1 | 1) =>
    setF((p) => {
      const j = i + d;
      if (j < 0 || j >= p.images.length) return p;
      const images = [...p.images];
      [images[i], images[j]] = [images[j], images[i]];
      return { ...p, images };
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: f.name.trim(),
      price: Number(f.price),
      stock: Number(f.stock || 0),
      sort: Number(f.sort || 0),
      description: f.description.trim() || null,
      images: f.images,
      forSale: f.forSale,
      active: f.active,
      ...(f.slug.trim() ? { slug: f.slug.trim().toLowerCase() } : {}),
    };
    try {
      if (editing) await adminRequest(`/admin/products/${editing.id}`, { method: 'PATCH', body });
      else await adminRequest('/admin/products', { method: 'POST', body });
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-[12px] border border-rose-600/20 bg-soft-2 p-4">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]">
        <label className={`${labelSm} col-span-2`}>
          商品名稱
          <input required value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder="例：開運粉晶手鍊" className={inputSm} />
        </label>
        <label className={labelSm}>
          價格（元）
          <input required type="number" min={0} value={f.price} onChange={(e) => set('price', e.target.value)} className={inputSm} />
        </label>
        <label className={labelSm}>
          庫存
          <input required type="number" min={0} value={f.stock} onChange={(e) => set('stock', e.target.value)} className={inputSm} />
        </label>
        <label className={`${labelSm} col-span-2`}>
          網址代號（選填，英文小寫／數字／-；例：rose-quartz）
          <input value={f.slug} onChange={(e) => set('slug', e.target.value)} maxLength={60} placeholder="不填會自動產生" className={inputSm} />
        </label>
        <label className={labelSm}>
          排序（小的在前）
          <input type="number" value={f.sort} onChange={(e) => set('sort', e.target.value)} className={inputSm} />
        </label>
      </div>
      <label className={labelSm}>
        商品說明（顯示在商品頁，可換行）
        <textarea value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} rows={4} className={inputSm} />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-ink-600">商品圖片（最多 8 張，第一張是封面；上傳前會自動縮小）</span>
        <div className="flex flex-wrap gap-3">
          {f.images.map((url, i) => (
            <div key={url} className="flex w-[96px] flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`圖片 ${i + 1}`} className="h-[96px] w-[96px] rounded-[10px] border border-line object-cover" />
              <div className="flex justify-between text-[12px]">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="往前" className="px-1 text-rose-800 disabled:opacity-30">
                  ‹
                </button>
                <button type="button" onClick={() => set('images', f.images.filter((x) => x !== url))} className="text-error underline">
                  刪除
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === f.images.length - 1}
                  aria-label="往後"
                  className="px-1 text-rose-800 disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            </div>
          ))}
          {f.images.length < 8 && (
            <label className="flex h-[96px] w-[96px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-rose-600/40 bg-white text-center text-[12px] text-rose-800 hover:bg-soft">
              <span className="text-[22px] leading-none">＋</span>
              {uploading > 0 ? '上傳中…' : '上傳圖片'}
              <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} multiple className="sr-only" onChange={(e) => void upload(e.target.files)} />
            </label>
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-[14px] text-ink-700">
        <input type="checkbox" checked={f.forSale} onChange={(e) => set('forSale', e.target.checked)} />
        在商店販售（不勾＝只當 VIP 贈品，客人在商店看不到）
      </label>
      <label className="flex items-center gap-2 text-[14px] text-ink-700">
        <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
        啟用（不勾＝下架，商店與贈品都不能選）
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || uploading > 0} className={btnPrimary}>
          {busy ? '儲存中…' : editing ? '儲存' : '新增商品'}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>
          取消
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------
// 商品列表
// ---------------------------------------------------------------------

function ProductsCard() {
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminProduct | 'new' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await adminRequest<{ products: AdminProduct[] }>('/admin/products');
      setProducts(r.products);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const done = () => {
    setEditing(null);
    void load();
  };

  return (
    <Card
      title="商品"
      actions={
        <>
          <Link href="/shop" target="_blank" rel="noreferrer" className={btnGhost}>
            看商店
          </Link>
          <button type="button" onClick={() => setEditing('new')} className={btnPrimary}>
            新增商品
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-[1.8] text-ink-500">
        商店販售的商品價格至少 1 元；只當 VIP 贈品的商品可以是 0 元（到「VIP」會員資料裡寄贈品）。庫存在客人付款成功、或寄出贈品時自動扣除。
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {editing === 'new' && <ProductEditor editing={null} onCancel={() => setEditing(null)} onDone={done} />}
      {products && products.length === 0 && editing !== 'new' && <Empty>還沒有商品，按「新增商品」開始上架</Empty>}
      {products && products.length > 0 && (
        <ul className="flex flex-col gap-3">
          {products.map((p) =>
            editing !== 'new' && editing?.id === p.id ? (
              <li key={p.id}>
                <ProductEditor editing={p} onCancel={() => setEditing(null)} onDone={done} />
              </li>
            ) : (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line px-3 py-3">
                <div className="h-14 w-14 flex-none overflow-hidden rounded-[10px] bg-soft-2">
                  {p.images[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0]} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="flex min-w-[180px] flex-1 flex-col gap-1">
                  <span className="text-[15px] font-bold text-ink-900">
                    {p.name}{' '}
                    {!p.active ? <Badge>已下架</Badge> : p.forSale ? <Badge tone="green">商店販售</Badge> : <Badge tone="rose">只當贈品</Badge>}
                    {p.active && p.stock === 0 && (
                      <>
                        {' '}
                        <Badge tone="amber">缺貨</Badge>
                      </>
                    )}
                  </span>
                  <span className="text-[13px] text-ink-500">
                    {formatPrice(p.price)}・庫存 {p.stock}・/shop/{p.slug}
                  </span>
                </div>
                <button type="button" onClick={() => setEditing(p)} className={btnGhost}>
                  編輯
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// 運費
// ---------------------------------------------------------------------

function ShippingCard() {
  const [fee, setFee] = useState('');
  const [freeOver, setFreeOver] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    adminRequest<ShopSettings>('/admin/settings')
      .then((s) => {
        if (!alive) return;
        setFee(String(s.shippingFee));
        setFreeOver(s.freeShippingOver === null ? '' : String(s.freeShippingOver));
        setLoaded(true);
      })
      .catch((e) => alive && setMsg({ tone: 'error', text: errMsg(e) }));
    return () => {
      alive = false;
    };
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const s = await adminRequest<ShopSettings>('/admin/settings', {
        method: 'PATCH',
        body: { shippingFee: Number(fee || 0), freeShippingOver: freeOver.trim() ? Number(freeOver) : null },
      });
      setFee(String(s.shippingFee));
      setFreeOver(s.freeShippingOver === null ? '' : String(s.freeShippingOver));
      setMsg({ tone: 'ok', text: '已儲存' });
    } catch (err) {
      setMsg({ tone: 'error', text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="運費">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <label className={labelSm}>
          宅配運費（元）
          <input type="number" min={0} required disabled={!loaded} value={fee} onChange={(e) => setFee(e.target.value)} className={`${inputSm} w-[160px]`} />
        </label>
        <label className={labelSm}>
          滿額免運（元，空白＝不提供）
          <input type="number" min={1} disabled={!loaded} value={freeOver} onChange={(e) => setFreeOver(e.target.value)} className={`${inputSm} w-[200px]`} />
        </label>
        <button type="submit" disabled={busy || !loaded} className={btnPrimary}>
          {busy ? '儲存中…' : '儲存'}
        </button>
      </form>
    </Card>
  );
}

export default function AdminProductsPage() {
  return (
    <div className="flex flex-col gap-5">
      <ProductsCard />
      <ShippingCard />
    </div>
  );
}
