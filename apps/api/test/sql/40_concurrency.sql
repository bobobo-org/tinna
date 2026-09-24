-- 兩條連線的併發情境（dblink 開第二條連線，pg_sleep 控制先後）
-- 需要 superuser 建 dblink；第二條連線字串由 psql 變數 c2conn 指定（空字串 → 用目前的資料庫與使用者）
create extension if not exists dblink;
select coalesce(nullif(:'c2conn', ''), format('dbname=%s user=%s', current_database(), current_user)) as c2conn \gset
select dblink_connect('c2', :'c2conn');

-- ① 兩人同時搶同一時段：create_booking 以 advisory lock 序列化 → 只有一人成功
select dblink_send_query('c2', $q$
  do $$ begin
    insert into sqltest.results values ('race_create', sqltest.book('YS7777777A', sqltest.day(60), 'card', 'x1@example.com', '0910101010'));
    perform pg_sleep(1);
  end $$;
$q$);
select pg_sleep(0.3);
insert into sqltest.results values ('race_create_main', sqltest.book('YS7777777B', sqltest.day(60), 'card', 'x2@example.com', '0920202020'));
select * from dblink_get_result('c2') as t(status text);
select * from dblink_get_result('c2') as t(status text);
do $$
begin
  assert (select v->>'result' from sqltest.results where k = 'race_create') = 'created', 'c2 created';
  assert (select v->>'result' from sqltest.results where k = 'race_create_main') = 'slot_taken', 'main slot_taken';
  assert (select count(*) from public.bookings where starts_at = sqltest.day(60)
            and status in ('pending_payment', 'awaiting_transfer', 'confirmed')) = 1, 'one active booking';
  raise notice 'PASS concurrent create_booking';
end $$;

-- ② 逾時後付款（reclaim）vs 新預約：新預約先寫入（未 commit）→ reclaim 等它 commit 後撞到重疊約束 → 人工處理
do $$
declare b uuid;
begin
  b := sqltest.mk_booking('YS7777777C', sqltest.day(61), 'expired', now() - interval '1 minute');
  perform sqltest.mk_payment(b, 'R2');
end $$;
select dblink_send_query('c2', $q$
  do $$ begin
    insert into sqltest.results values ('race_reclaim_new', sqltest.book('YS7777777D', sqltest.day(61), 'card', 'x3@example.com', '0930303030'));
    perform pg_sleep(1);
  end $$;
$q$);
select pg_sleep(0.3);
insert into sqltest.results values ('race_reclaim', public.apply_payment_paid('ecpay', 'R2', 3600, 'TNR2', 'notify', '{}'));
select * from dblink_get_result('c2') as t(status text);
select * from dblink_get_result('c2') as t(status text);
do $$
begin
  assert (select v->>'result' from sqltest.results where k = 'race_reclaim_new') = 'created', 'new booking created';
  assert (select v->>'reason' from sqltest.results where k = 'race_reclaim') = 'paid_after_expiry_slot_taken', 'reclaim flagged';
  assert (select status from public.bookings where order_no = 'YS7777777C') = 'expired', 'reclaimed booking stays expired';
  assert (select status from public.payments where provider_trade_no = 'R2') = 'paid', 'payment kept paid';
  raise notice 'PASS reclaim loses to committed new booking';
end $$;

-- ③ 反過來：reclaim 先確認（未 commit）→ 新預約等它 commit 後 slot_taken
do $$
declare b uuid;
begin
  b := sqltest.mk_booking('YS7777777E', sqltest.day(62), 'expired', now() - interval '1 minute');
  perform sqltest.mk_payment(b, 'R3');
end $$;
select dblink_send_query('c2', $q$
  do $$ begin
    perform pg_sleep(0.3);
    insert into sqltest.results values ('race_new_after', sqltest.book('YS7777777F', sqltest.day(62), 'card', 'x4@example.com', '0940404040'));
  end $$;
$q$);
do $$
begin
  insert into sqltest.results values ('race_reclaim_first', public.apply_payment_paid('ecpay', 'R3', 3600, 'TNR3', 'notify', '{}'));
  perform pg_sleep(1);
end $$;
select * from dblink_get_result('c2') as t(status text);
select * from dblink_get_result('c2') as t(status text);
do $$
begin
  assert (select v->>'result' from sqltest.results where k = 'race_reclaim_first') = 'confirmed', 'reclaim confirmed';
  assert (select v->>'result' from sqltest.results where k = 'race_new_after') = 'slot_taken', 'new booking blocked';
  raise notice 'PASS new booking loses to in-flight reclaim';
end $$;

-- ④ 綠界 ReturnURL 與 OrderResultURL 同時到：row lock 序列化 → 一個 confirmed、一個 already_paid
do $$
declare b uuid;
begin
  b := sqltest.mk_booking('YS7777777G', sqltest.day(63), 'pending_payment', now() + interval '15 minutes');
  perform sqltest.mk_payment(b, 'R4');
end $$;
select dblink_send_query('c2', $q$
  do $$ begin
    perform pg_sleep(0.3);
    insert into sqltest.results values ('race_notify_c2', public.apply_payment_paid('ecpay', 'R4', 3600, 'TNR4', 'result', '{}'));
  end $$;
$q$);
do $$
begin
  insert into sqltest.results values ('race_notify_main', public.apply_payment_paid('ecpay', 'R4', 3600, 'TNR4', 'notify', '{}'));
  perform pg_sleep(1);
end $$;
select * from dblink_get_result('c2') as t(status text);
select * from dblink_get_result('c2') as t(status text);
do $$
begin
  assert (select v->>'result' from sqltest.results where k = 'race_notify_main') = 'confirmed', 'first confirmed';
  assert (select v->>'result' from sqltest.results where k = 'race_notify_c2') = 'already_paid', 'second already_paid';
  raise notice 'PASS concurrent notifications';
end $$;

select dblink_disconnect('c2');
