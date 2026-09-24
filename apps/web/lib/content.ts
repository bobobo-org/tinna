/**
 * 靜態文案，逐字複製自 design/site.dc.html（改文案改這裡）
 */

export const FLOW_STEPS = [
  { n: '1', t: '選擇方案', d: '依想問的主題挑選適合的諮詢方案。' },
  { n: '2', t: '選日期時段', d: '即時顯示老師可預約的空檔。' },
  { n: '3', t: '填寫排盤資料', d: '出生資料與想問的問題，老師事前準備。' },
  { n: '4', t: '線上付款', d: '信用卡／LINE Pay，完成即確認。' },
] as const;

export const TESTIMONIALS = [
  {
    quote: '「原本只是想問要不要離職，結果老師把我未來三年的節奏都排出來了，離開的時候心是定的。」',
    by: '— L 小姐 · 行銷企劃',
  },
  {
    quote: '「不會嚇你，也不會亂給保證。講到我自己都沒發現的相處習慣，很準也很務實。」',
    by: '— 陳先生 · 工程師',
  },
] as const;

export const HERO_POINTS = ['· 線上刷卡／LINE Pay，即時確認時段', '· 全程錄影，事後可重看', '· 附一頁重點行動建議'] as const;

export const TEACHER_TAGS = ['紫微斗數', '八字', '擇日', '姓名學'] as const;

export const TIMELINE = [
  { year: '2014', text: '拜師學習紫微斗數與八字' },
  { year: '2017', text: '開始一對一實體諮詢' },
  { year: '2021', text: '轉為線上諮詢，服務海內外學員' },
  { year: '至今', text: '累積諮詢 3,200+ 場' },
] as const;

export const PRINCIPLES = [
  { title: '不販賣恐懼', body: '不推銷改運商品、不做法事。命盤是地圖，不是判決。' },
  { title: '給能執行的建議', body: '每場結束都附一頁行動筆記：做什麼、什麼時候做。' },
  { title: '資料保密', body: '出生資料與諮詢內容僅用於本次排盤，不外流。' },
] as const;

export const FAQS = [
  {
    q: '需要準備什麼資料？',
    a: '國曆出生年月日、出生時間（越精確越好）與出生地。不確定出生時間也可以預約，老師會以其他方式校正。',
  },
  {
    q: '諮詢是用什麼方式進行？',
    a: '以 Google Meet 視訊進行，付款完成後會把連結寄到你的 Email，也可選擇只開聲音。',
  },
  {
    q: '可以改期或退款嗎？',
    a: '諮詢前 48 小時可免費改期一次；48 小時內取消恕不退款，但可轉讓給親友使用。',
  },
  {
    q: '付款方式有哪些？',
    a: '支援信用卡（VISA / Master / JCB）與 LINE Pay，皆可開立電子發票。',
  },
  {
    q: '可以幫別人問嗎？',
    a: '可以，但需要對方同意並提供完整出生資料。合盤方案請填寫雙方資料。',
  },
] as const;

export type Faq = (typeof FAQS)[number];

export const FOOTER_ITEMS = ['信用卡', 'LINE Pay', '隱私權政策', '退款規則'] as const;
