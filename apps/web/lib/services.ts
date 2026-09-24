/**
 * 諮詢方案資料
 *
 * - SVCS：原本 4 個方案逐字複製自 design/site.dc.html 的 SVCS，另加 0004 migration 的方案（DB 沒設定或讀取失敗時的備援）
 * - getServices()：有 Supabase env 時讀 services 表（anon key + RLS，只回 active），5 分鐘 revalidate
 *
 * 欄位對照（DB → 前端）：short_name → short、description → desc、is_featured → featured、
 * topic_limit → topicLimit、question_label → questionLabel、question_required → questionRequired
 * num（壹貳參肆）不存 DB，依排序位置產生；自選主題的幾個價位合成一張卡，共用一個編號
 */

export type ServiceId = 'flow' | 'love' | 'career' | 'quick' | 'listen';

export interface Service {
  /** flow | love | career | quick | listen | topics-*（DB 若新增方案會是其他字串） */
  id: ServiceId | (string & {});
  /** 壹、貳、參、肆…（依排序位置） */
  num: string;
  /** 完整名稱：流年運勢盤 */
  name: string;
  /** 短名：流年 · 大限（首頁三格用）；自選主題的價位共用短名當方案卡名稱 */
  short: string;
  minutes: number;
  /** 新台幣整數 */
  price: number;
  tagline: string;
  desc: string;
  includes: string[];
  /** 推薦（最多人選）：方案卡緞面底＋徽章、首頁上緣 3px */
  featured: boolean;
  /** 自選主題的價位：這個價位最多幾題（一般方案為 null） */
  topicLimit: number | null;
  /** Step 3 問題欄的標題（null 用預設「想問的問題」） */
  questionLabel: string | null;
  /** Step 3 問題欄必填 */
  questionRequired: boolean;
}

/** 自選主題的一個價位 */
export type TopicTier = Service & { topicLimit: number };

/** Supabase services 表的一列（DEPLOYMENT.md §3；後三個欄位來自 0004） */
export interface ServiceRow {
  id: string;
  name: string;
  short_name: string;
  minutes: number;
  price: number;
  tagline: string | null;
  description: string | null;
  includes: string[] | null;
  is_featured: boolean | null;
  sort: number | null;
  active: boolean | null;
  topic_limit?: number | null;
  question_label?: string | null;
  question_required?: boolean | null;
}

const NUMERALS = ['壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖', '拾'];

export function toNumeral(index: number): string {
  return NUMERALS[index] ?? String(index + 1);
}

type ServiceSeed = Omit<Service, 'num'>;

const PLAN = { topicLimit: null, questionLabel: null, questionRequired: false } as const;

const TOPIC_TAGLINE = '從 15 個主題自由勾選，依題數計價。';
const TOPIC_DESC =
  '從個性、感情、財運、工作到晚年運等 15 個主題中勾選想問的方向；勾選的先後就是你的優先順序，老師會先解答最想知道的。';

function topicSeed(limit: number, name: string, minutes: number, price: number): ServiceSeed {
  return {
    ...PLAN,
    id: `topics-${limit}`,
    short: '自選主題',
    name,
    minutes,
    price,
    featured: false,
    tagline: TOPIC_TAGLINE,
    desc: TOPIC_DESC,
    includes: [],
    topicLimit: limit,
  };
}

const SEED: ServiceSeed[] = [
  {
    ...PLAN,
    id: 'flow',
    short: '流年 · 大限',
    name: '流年運勢盤',
    minutes: 60,
    price: 2800,
    featured: false,
    tagline: '今年往哪走、哪幾個月要收手，一次講清楚。',
    desc: '一年整體走勢、關鍵月份、該進該守的節奏建議。',
    includes: ['紫微 × 八字合參排盤', '十二個月逐月重點', '錄影檔 + 行動筆記'],
  },
  {
    ...PLAN,
    id: 'love',
    short: '姻緣 · 合盤',
    name: '感情合盤',
    minutes: 90,
    price: 3600,
    featured: true,
    tagline: '兩張盤一起看，相處的癥結與轉圜都在裡面。',
    desc: '雙方命盤對照，看相處模式、卡點與適合的溝通方式。',
    includes: ['雙人命盤對照', '相處模式與卡點', '適合的結婚／同居時機'],
  },
  {
    ...PLAN,
    id: 'career',
    short: '事業 · 擇時',
    name: '事業／擇時',
    minutes: 75,
    price: 3200,
    featured: false,
    tagline: '創業、轉職、簽約日子，替你挑出最順的那一天。',
    desc: '轉職、創業、簽約開幕的時機判斷與風險提醒。',
    includes: ['事業格局分析', '三個吉日吉時建議', '合作對象簡易對盤'],
  },
  {
    ...PLAN,
    id: 'quick',
    short: '單題快問',
    name: '單題快問',
    minutes: 30,
    price: 1500,
    featured: false,
    tagline: '只有一個問題，30 分鐘聚焦回答。',
    desc: '只有一個具體問題想釐清，短時段聚焦回答。',
    includes: ['單一問題深入解析', '錄影檔', '適合回訪學員'],
  },
  {
    ...PLAN,
    id: 'listen',
    short: '接住你',
    name: '接住你的諮詢室',
    minutes: 60,
    price: 5800,
    featured: false,
    tagline: '先把心裡的話說出來，我們好好聽你說。',
    desc: '以傾聽為主的一對一諮詢：預約時先寫下這次的煩惱，諮詢時陪你把心裡的事慢慢說完、理清楚。',
    includes: ['預約時先寫下這次的煩惱', '一對一傾聽與陪伴', '付款後即確認時段'],
    questionLabel: '這次的煩惱是什麼？',
    questionRequired: true,
  },
  topicSeed(4, '自選主題（4 題）', 60, 2000),
  topicSeed(6, '自選主題（5～6 題）', 75, 2600),
  topicSeed(8, '自選主題（7～8 題）', 90, 3000),
  topicSeed(15, '自選主題（9～15 題）', 120, 3600),
];

/** 依排序編號；自選主題的價位共用第一個價位的編號（畫面上是同一張卡） */
function withNumerals(list: ServiceSeed[]): Service[] {
  let next = 0;
  let topicNum: string | null = null;
  return list.map((s) => {
    if (s.topicLimit === null) return { ...s, num: toNumeral(next++) };
    if (topicNum === null) topicNum = toNumeral(next++);
    return { ...s, num: topicNum };
  });
}

/** 靜態方案資料（原型 SVCS＋0004 的方案） */
export const SVCS: Service[] = withNumerals(SEED);

/** NT$2,800（和原型 'NT$' + n.toLocaleString() 相同；固定 en-US 避免伺服器語系不同） */
export function formatPrice(n: number): string {
  return 'NT$' + n.toLocaleString('en-US');
}

function isServiceRow(v: unknown): v is ServiceRow {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.name === 'string' &&
    typeof r.short_name === 'string' &&
    typeof r.minutes === 'number' &&
    typeof r.price === 'number' &&
    (r.includes == null || (Array.isArray(r.includes) && r.includes.every((x) => typeof x === 'string'))) &&
    (r.topic_limit == null || typeof r.topic_limit === 'number') &&
    (r.question_label == null || typeof r.question_label === 'string') &&
    (r.question_required == null || typeof r.question_required === 'boolean')
  );
}

/** DB rows → Service[]；形狀不對（或空陣列）回傳 null 讓呼叫端退回 SVCS */
export function mapServiceRows(rows: unknown): Service[] | null {
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isServiceRow)) return null;
  const sorted = [...rows]
    .filter((r) => r.active !== false)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  if (sorted.length === 0) return null;
  return withNumerals(
    sorted.map((r) => ({
      id: r.id,
      name: r.name,
      short: r.short_name,
      minutes: r.minutes,
      price: r.price,
      tagline: r.tagline ?? '',
      desc: r.description ?? '',
      includes: r.includes ?? [],
      featured: r.is_featured === true,
      topicLimit: r.topic_limit ?? null,
      questionLabel: r.question_label?.trim() ? r.question_label : null,
      questionRequired: r.question_required === true,
    })),
  );
}

const FETCH_TIMEOUT_MS = 5000;

/**
 * 讀方案清單（Server Component 用）。
 * 有 NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY 才打 Supabase REST；
 * 沒設 env、逾時、非 2xx、形狀不對 → 一律回傳靜態 SVCS，頁面不會壞。
 */
export async function getServices(
  env: Record<string, string | undefined> = process.env,
): Promise<Service[]> {
  const base = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!base || !key) return SVCS;

  const url = `${base.replace(/\/+$/, '')}/rest/v1/services?select=*&active=eq.true&order=sort`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      next: { revalidate: 300 },
    }).catch(() => null);
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), FETCH_TIMEOUT_MS);
    });
    const res = await Promise.race([request, timeout]);
    if (!res || !res.ok) return SVCS;
    return mapServiceRows(await res.json()) ?? SVCS;
  } catch {
    return SVCS;
  } finally {
    clearTimeout(timer);
  }
}

export function findService(services: Service[], id: string | null | undefined): Service | undefined {
  if (!id) return undefined;
  return services.find((s) => s.id === id);
}

/** 最低價（手機浮動 CTA「NT$1,500 起」） */
export function minPrice(services: Service[]): number {
  return services.reduce((min, s) => Math.min(min, s.price), Number.POSITIVE_INFINITY);
}

// ---------- 自選主題 ----------

export function isTopicTier(s: Service | undefined): s is TopicTier {
  return s != null && s.topicLimit !== null;
}

/** 自選主題的價位（topicLimit 由小到大） */
export function topicTiers(services: Service[]): TopicTier[] {
  return services.filter(isTopicTier).sort((a, b) => a.topicLimit - b.topicLimit);
}

/** 可選題數：最少 = 最低價位的上限（例：4 題起）、最多 = 最高價位的上限 */
export function topicRange(tiers: TopicTier[]): { min: number; max: number } | null {
  if (tiers.length === 0) return null;
  return { min: tiers[0].topicLimit, max: tiers[tiers.length - 1].topicLimit };
}

/** n 題對應的價位：topicLimit ≥ n 的最小者（還沒選到最少題數時是最低價位，用來顯示「起」價） */
export function tierFor(tiers: TopicTier[], n: number): TopicTier | undefined {
  return tiers.find((t) => t.topicLimit >= n);
}

/** 價位涵蓋的題數：「4 題」「5～6 題」 */
export function tierRangeLabel(tiers: TopicTier[], index: number): string {
  const hi = tiers[index].topicLimit;
  const lo = index === 0 ? hi : tiers[index - 1].topicLimit + 1;
  return lo === hi ? `${hi} 題` : `${lo}～${hi} 題`;
}
