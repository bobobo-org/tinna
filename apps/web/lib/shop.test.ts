import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CART_KEY,
  CART_ORDER_KEY,
  MAX_QTY,
  addLine,
  cartCount,
  clearCartForOrder,
  getCatalog,
  getShopProduct,
  loadCart,
  rememberCartOrder,
  sanitizeCart,
  saveCart,
  shippingFor,
} from './shop';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ENV = { NEXT_PUBLIC_API_URL: 'https://api.example/' };

class MemoryStorage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('購物車', () => {
  it('sanitizeCart：只留合法的 id、數量取整數且 1～20、去重複', () => {
    expect(
      sanitizeCart([
        { id: A, qty: 2.7 },
        { id: A, qty: 1 },
        { id: 'hack', qty: 1 },
        { id: B, qty: 99 },
        { id: B.replace('2', '3'), qty: 0 },
        null,
      ]),
    ).toEqual([
      { id: A, qty: 2 },
      { id: B, qty: MAX_QTY },
    ]);
    expect(sanitizeCart('x')).toEqual([]);
  });

  it('addLine：同一商品累加，不超過庫存與上限；cartCount 算件數', () => {
    let lines = addLine([], A, 2, 5);
    lines = addLine(lines, A, 5, 5);
    expect(lines).toEqual([{ id: A, qty: 5 }]);
    lines = addLine(lines, B, 1, 0); // 售完不加
    expect(lines).toEqual([{ id: A, qty: 5 }]);
    lines = addLine(lines, B, 30, 100);
    expect(lines).toEqual([
      { id: A, qty: 5 },
      { id: B, qty: MAX_QTY },
    ]);
    expect(cartCount(lines)).toBe(25);
  });

  it('存取來回一致；空的就刪掉；付款完成只清同一筆訂單的購物車', () => {
    const s = new MemoryStorage() as unknown as Storage;
    saveCart([{ id: A, qty: 1 }], s);
    expect(loadCart(s)).toEqual([{ id: A, qty: 1 }]);
    rememberCartOrder('YS22222222', s);
    clearCartForOrder('YS33333333', s);
    expect(loadCart(s)).toHaveLength(1);
    clearCartForOrder('YS22222222', s);
    expect(loadCart(s)).toEqual([]);
    expect(s.getItem(CART_KEY)).toBeNull();
    expect(s.getItem(CART_ORDER_KEY)).toBeNull();
    s.setItem(CART_KEY, '{oops');
    expect(loadCart(s)).toEqual([]);
  });
});

describe('運費', () => {
  it('滿額免運（以折扣前的商品小計判斷）', () => {
    expect(shippingFor(1500, { shippingFee: 100, freeShippingOver: null })).toBe(100);
    expect(shippingFor(1999, { shippingFee: 100, freeShippingOver: 2000 })).toBe(100);
    expect(shippingFor(2000, { shippingFee: 100, freeShippingOver: 2000 })).toBe(0);
  });
});

describe('讀商品（API）', () => {
  const product = { id: A, slug: 'amulet', name: '護身符', description: null, price: 800, images: [], stock: 3 };

  it('getCatalog：過濾形狀不對的商品；讀不到回 null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ products: [product, { id: 1 }], shippingFee: 100, freeShippingOver: 2000 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await getCatalog({}, ENV)).toEqual({ products: [product], shippingFee: 100, freeShippingOver: 2000 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example/shop/products');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ next: { revalidate: 60 } });
    await getCatalog({ fresh: true }, ENV);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ cache: 'no-store' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    expect(await getCatalog({}, ENV)).toBeNull();
    expect(await getCatalog({}, {})).toBeNull();
  });

  it('getShopProduct：404 → not_found；網址代號格式不對不打 API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ product, shippingFee: 100, freeShippingOver: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getShopProduct('Amulet', ENV)).toEqual({ product, shippingFee: 100, freeShippingOver: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example/shop/products/amulet');
    expect(await getShopProduct('gone', ENV)).toBe('not_found');
    expect(await getShopProduct('../etc', ENV)).toBe('not_found');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
