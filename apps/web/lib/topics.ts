/**
 * 自選主題的 15 個主題（老師價目表的順序）
 *
 * 客人勾選的先後就是優先順序：送出時照順序傳給 API，存進預約的「想問的問題」。
 * 價位與題數對應在 Supabase services 表（topic_limit），不在這裡。
 */
export const TOPICS = [
  '個性（優缺點）',
  '戀愛',
  '結婚',
  '小孩',
  '財運',
  '工作',
  '健康',
  '人際關係',
  '海外發展',
  '留學',
  '投資（股票＆珠寶＆不動產）',
  '家族關係（父母＆兄弟姊妹）',
  '晚年運',
  '注意事項',
  '其他',
] as const;

export function isTopic(v: unknown): v is (typeof TOPICS)[number] {
  return typeof v === 'string' && (TOPICS as readonly string[]).includes(v);
}

/** 備註上限（和 API 相同） */
export const TOPIC_NOTE_MAX = 500;
