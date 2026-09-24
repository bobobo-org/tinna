-- =====================================================================
-- 緣舍命理 seed：4 個方案 + 每週可預約時段。可重跑（on conflict）。
-- 方案的 name / short_name / tagline / description / includes 逐字取自
-- design_handoff_yuanshe/design/site.dc.html 的 SVCS 陣列；分鐘與價格同 README §6。
-- 注意：重跑會把 4 個方案的文案與價格重設為下列值（on conflict do update）；
--       每週時段只補缺的（已存在的不動、不刪除另外新增的，但會補回被刪掉的預設時段）。
--       CI 只跑 migration、不會自動跑 seed。
-- =====================================================================

insert into public.services
  (id, name, short_name, minutes, price, tagline, description, includes, is_featured, sort, active)
values
  ('flow', '流年運勢盤', '流年 · 大限', 60, 2800,
   '今年往哪走、哪幾個月要收手，一次講清楚。',
   '一年整體走勢、關鍵月份、該進該守的節奏建議。',
   array['紫微 × 八字合參排盤', '十二個月逐月重點', '錄影檔 + 行動筆記'],
   false, 1, true),
  ('love', '感情合盤', '姻緣 · 合盤', 90, 3600,
   '兩張盤一起看，相處的癥結與轉圜都在裡面。',
   '雙方命盤對照，看相處模式、卡點與適合的溝通方式。',
   array['雙人命盤對照', '相處模式與卡點', '適合的結婚／同居時機'],
   true, 2, true),
  ('career', '事業／擇時', '事業 · 擇時', 75, 3200,
   '創業、轉職、簽約日子，替你挑出最順的那一天。',
   '轉職、創業、簽約開幕的時機判斷與風險提醒。',
   array['事業格局分析', '三個吉日吉時建議', '合作對象簡易對盤'],
   false, 3, true),
  ('quick', '單題快問', '單題快問', 30, 1500,
   '只有一個問題，30 分鐘聚焦回答。',
   '只有一個具體問題想釐清，短時段聚焦回答。',
   array['單一問題深入解析', '錄影檔', '適合回訪學員'],
   false, 4, true)
on conflict (id) do update set
  name        = excluded.name,
  short_name  = excluded.short_name,
  minutes     = excluded.minutes,
  price       = excluded.price,
  tagline     = excluded.tagline,
  description = excluded.description,
  includes    = excluded.includes,
  is_featured = excluded.is_featured,
  sort        = excluded.sort,
  active      = excluded.active;

-- 每週時段：週二～週日（weekday 2..6 與 0）× 10:00, 13:30, 15:30, 19:00, 20:30；週一（1）公休不建資料
insert into public.weekly_slots (weekday, start_time)
select d.weekday, t.start_time
  from (values (0), (2), (3), (4), (5), (6)) as d(weekday)
 cross join (values (time '10:00'), (time '13:30'), (time '15:30'),
                    (time '19:00'), (time '20:30')) as t(start_time)
on conflict (weekday, start_time) do nothing;
