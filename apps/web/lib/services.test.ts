import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SVCS,
  findService,
  formatPrice,
  getServices,
  isTopicTier,
  mapServiceRows,
  minPrice,
  tierFor,
  tierRangeLabel,
  topicRange,
  topicTiers,
  type ServiceRow,
} from './services';

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

describe('SVCS（原型資料＋0004 的方案）', () => {
  it('原本四個方案和原型一致；接著是接住你的諮詢室與自選主題的四個價位（共用一個編號）', () => {
    expect(SVCS.map((s) => [s.id, s.num, s.short, s.name, s.minutes, s.price, s.featured])).toEqual([
      ['flow', '壹', '流年 · 大限', '流年運勢盤', 60, 2800, false],
      ['love', '貳', '姻緣 · 合盤', '感情合盤', 90, 3600, true],
      ['career', '參', '事業 · 擇時', '事業／擇時', 75, 3200, false],
      ['quick', '肆', '單題快問', '單題快問', 30, 1500, false],
      ['listen', '伍', '接住你', '接住你的諮詢室', 60, 5800, false],
      ['topics-4', '陸', '自選主題', '自選主題（4 題）', 60, 2000, false],
      ['topics-6', '陸', '自選主題', '自選主題（5～6 題）', 75, 2600, false],
      ['topics-8', '陸', '自選主題', '自選主題（7～8 題）', 90, 3000, false],
      ['topics-15', '陸', '自選主題', '自選主題（9～15 題）', 120, 3600, false],
    ]);
    expect(SVCS.map((s) => s.topicLimit)).toEqual([null, null, null, null, null, 4, 6, 8, 15]);
    expect(SVCS.filter((s) => s.questionRequired).map((s) => [s.id, s.questionLabel])).toEqual([['listen', '這次的煩惱是什麼？']]);
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
    const plan = { topicLimit: null, questionLabel: null, questionRequired: false };
    expect(out).toEqual([
      { id: 'a', num: '壹', name: '第一', short: '一', minutes: 30, price: 1200, tagline: 't', desc: '', includes: ['x'], featured: false, ...plan },
      { id: 'b', num: '貳', name: '第二', short: '二', minutes: 45, price: 2000, tagline: '', desc: '說明', includes: [], featured: true, ...plan },
    ]);
  });

  it('0004 欄位：topic_limit、question_label（空白視為沒有）、question_required；價位共用編號', () => {
    const tier = (id: string, limit: number, sort: number): ServiceRow => ({
      ...rows[0],
      id,
      sort,
      topic_limit: limit,
    });
    const out = mapServiceRows([
      tier('t8', 8, 5),
      { ...rows[0], id: 'listen', sort: 3, question_label: '這次的煩惱是什麼？', question_required: true },
      tier('t4', 4, 4),
      { ...rows[1], question_label: '  ' },
    ])!;
    expect(out.map((s) => [s.id, s.num, s.topicLimit, s.questionLabel, s.questionRequired])).toEqual([
      ['a', '壹', null, null, false],
      ['listen', '貳', null, '這次的煩惱是什麼？', true],
      ['t4', '參', 4, null, false],
      ['t8', '參', 8, null, false],
    ]);
    expect(mapServiceRows([{ ...rows[0], topic_limit: '4' }])).toBeNull();
  });

  it('形狀不對或空陣列回傳 null', () => {
    expect(mapServiceRows([])).toBeNull();
    expect(mapServiceRows({ message: 'relation "services" does not exist' })).toBeNull();
    expect(mapServiceRows([{ id: 'x', name: 'x' }])).toBeNull();
  });
});

describe('自選主題（依題數對應價位）', () => {
  const tiers = topicTiers(SVCS);

  it('價位依題數上限排序；最少 4 題、最多 15 題', () => {
    expect(tiers.map((t) => t.id)).toEqual(['topics-4', 'topics-6', 'topics-8', 'topics-15']);
    expect(topicRange(tiers)).toEqual({ min: 4, max: 15 });
    expect(topicRange([])).toBeNull();
    expect(isTopicTier(findService(SVCS, 'topics-6'))).toBe(true);
    expect(isTopicTier(findService(SVCS, 'listen'))).toBe(false);
    expect(isTopicTier(undefined)).toBe(false);
  });

  it('n 題 → topicLimit ≥ n 的最小價位', () => {
    expect([0, 3, 4, 5, 6, 7, 8, 9, 15, 16].map((n) => tierFor(tiers, n)?.price ?? null)).toEqual([
      2000, 2000, 2000, 2600, 2600, 3000, 3000, 3600, 3600, null,
    ]);
    expect(tierFor(tiers, 9)?.minutes).toBe(120);
  });

  it('價位涵蓋的題數文字', () => {
    expect(tiers.map((_, i) => tierRangeLabel(tiers, i))).toEqual(['4 題', '5～6 題', '7～8 題', '9～15 題']);
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
