-- =====================================================================
-- 0004：新增「自選主題」與「接住你的諮詢室」兩種方案
-- 0001～0003 不修改。之後的價格、時間與文案都可以直接在 Supabase 後台改 services 表。
--
-- 自選主題：客人從 15 個主題（apps/web/lib/topics.ts）勾選，依題數計價。
--   每個價位是 services 的一列，topic_limit = 這個價位最多幾題：
--   n 題 → topic_limit ≥ n 的最小價位；最少要選幾題 = 啟用中價位裡最小的 topic_limit。
--   網站把這幾列合成一張方案卡（卡片名稱用 short_name）；API 依題數驗證價位，金額仍取 services.price。
-- 接住你的諮詢室：以傾聽為主；預約 Step 3 的問題欄改用 question_label 當標題，且必填（question_required）。
--
-- services 的權限是整張表設定（anon / authenticated 只能 select），新欄位沿用，不必另外 grant。
-- =====================================================================

alter table public.services
  add column topic_limit       int check (topic_limit between 1 and 15),
  add column question_label    text,
  add column question_required boolean not null default false;

insert into public.services
  (id, name, short_name, minutes, price, tagline, description, includes,
   is_featured, sort, active, topic_limit, question_label, question_required)
values
  ('listen', '接住你的諮詢室', '接住你', 60, 5800,
   '先把心裡的話說出來，我們好好聽你說。',
   '以傾聽為主的一對一諮詢：預約時先寫下這次的煩惱，諮詢時陪你把心裡的事慢慢說完、理清楚。',
   array['預約時先寫下這次的煩惱', '一對一傾聽與陪伴', '付款後即確認時段'],
   false, 5, true, null, '這次的煩惱是什麼？', true),
  ('topics-4', '自選主題（4 題）', '自選主題', 60, 2000,
   '從 15 個主題自由勾選，依題數計價。',
   '從個性、感情、財運、工作到晚年運等 15 個主題中勾選想問的方向；勾選的先後就是你的優先順序，老師會先解答最想知道的。',
   '{}', false, 6, true, 4, null, false),
  ('topics-6', '自選主題（5～6 題）', '自選主題', 75, 2600,
   '從 15 個主題自由勾選，依題數計價。',
   '從個性、感情、財運、工作到晚年運等 15 個主題中勾選想問的方向；勾選的先後就是你的優先順序，老師會先解答最想知道的。',
   '{}', false, 7, true, 6, null, false),
  ('topics-8', '自選主題（7～8 題）', '自選主題', 90, 3000,
   '從 15 個主題自由勾選，依題數計價。',
   '從個性、感情、財運、工作到晚年運等 15 個主題中勾選想問的方向；勾選的先後就是你的優先順序，老師會先解答最想知道的。',
   '{}', false, 8, true, 8, null, false),
  ('topics-15', '自選主題（9～15 題）', '自選主題', 120, 3600,
   '從 15 個主題自由勾選，依題數計價。',
   '從個性、感情、財運、工作到晚年運等 15 個主題中勾選想問的方向；勾選的先後就是你的優先順序，老師會先解答最想知道的。',
   '{}', false, 9, true, 15, null, false)
on conflict (id) do nothing;
