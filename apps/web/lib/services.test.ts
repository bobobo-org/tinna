import { afterEach, describe, expect, it, vi } from 'vitest';
import { SVCS, findService, formatPrice, getServices, mapServiceRows, minPrice, type ServiceRow } from './services';

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co/', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key' };

const rows: ServiceRow[] = [
  {
    id: 'b',
    name: '第二',
    short_name: '二',
    minutes: 45,
    price: 2000,
    tagline: null,
    description: '說明',
    includes: null,
    is_featured: true,
    sort: 2,
    active: true,
  },
  {
    id: 'a',
    name: '第一',
    short_name: '一',
    minutes: 30,
    price: 1200,
    tagline: 't',
    description: null,
    includes: ['x'],
    is_featured: false,
    sort: 1,
    active: true,
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SVCS（原型資料）', () => {
  it('四個方案、順序與數值和原型一致', () => {
    expect(SVCS.map((s) => [s.id, s.num, s.short, s.name, s.minutes, s.price, s.featured])).toEqual([
      ['flow', '壹', '流年 · 大限', '流年運勢盤', 60, 2800, false],
      ['love', '貳', '姻緣 · 合盤', '感情合盤', 90, 3600, true],
      ['career', '參', '事業 · 擇時', '事業／擇時', 75, 3200, false],
      ['quick', '肆', '單題快問', '單題快問', 30, 1500, false],
    ]);
  });

  it('formatPrice / minPrice / findService', () => {
    expect(formatPrice(2800)).toBe('NT$2,800');
    expect(formatPrice(1500)).toBe('NT$1,500');
    expect(minPrice(SVCS)).toBe(1500);
    expect(findService(SVCS, 'love')?.name).toBe('感情合盤');
    expect(findService(SVCS, 'nope')).toBeUndefined();
    expect(findService(SVCS, null)).toBeUndefined();
  });
});

describe('mapServiceRows', () => {
  it('依 sort 排序、欄位改名、null 補預設、重新編號', () => {
    const out = mapServiceRows(rows);
    expect(out).toEqual([
      { id: 'a', num: '壹', name: '第一', short: '一', minutes: 30, price: 1200, tagline: 't', desc: '', includes: ['x'], featured: false },
      { id: 'b', num: '貳', name: '第二', short: '二', minutes: 45, price: 2000, tagline: '', desc: '說明', includes: [], featured: true },
    ]);
  });

  it('形狀不對或空陣列回傳 null', () => {
    expect(mapServiceRows([])).toBeNull();
    expect(mapServiceRows({ message: 'relation "services" does not exist' })).toBeNull();
    expect(mapServiceRows([{ id: 'x', name: 'x' }])).toBeNull();
  });
});

describe('getServices', () => {
  it('沒設 env 不打 API，直接回傳 SVCS', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getServices({})).resolves.toBe(SVCS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('有 env：打 Supabase REST（anon headers、revalidate 300）並回傳 DB 資料', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await getServices(ENV);
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://demo.supabase.co/rest/v1/services?select=*&active=eq.true&order=sort');
    expect(init.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer anon-key' });
    expect(init.next).toEqual({ revalidate: 300 });
  });

  it('非 2xx、網路錯誤、回傳格式不對 → SVCS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(getServices(ENV)).resolves.toBe(SVCS);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(getServices(ENV)).resolves.toBe(SVCS);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    await expect(getServices(ENV)).resolves.toBe(SVCS);
  });

  it('逾時（5 秒）→ SVCS', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const pending = getServices(ENV);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBe(SVCS);
    vi.useRealTimers();
  });
});
