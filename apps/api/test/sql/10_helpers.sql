-- 測試用 helper（放在 sqltest schema，第二條連線也用得到）
create schema if not exists sqltest;

create table if not exists sqltest.results (k text primary key, v jsonb);

-- 直接塞一筆預約（繞過 create_booking，用來佈置各種狀態）
create or replace function sqltest.mk_booking(
  p_order_no text,
  p_starts   timestamptz,
  p_status   public.booking_status,
  p_hold     timestamptz,
  p_method   public.pay_method default 'card',
  p_amount   int default 3600,
  p_email    text default 't@example.com',
  p_phone    text default '0912345678'
) returns uuid
language sql
as $$
  insert into public.bookings (order_no, service_id, starts_at, ends_at, status, pay_method, amount,
    customer_name, gender, birth_date, phone, email, hold_expires_at)
  values (p_order_no, 'love', p_starts, p_starts + interval '90 minutes', p_status, p_method, p_amount,
    'T', 'female', '1990-01-01', p_phone, p_email, p_hold)
  returning id;
$$;

create or replace function sqltest.mk_payment(
  p_booking  uuid,
  p_trade    text,
  p_amount   int default 3600,
  p_provider text default 'ecpay',
  p_method   public.pay_method default 'card',
  p_status   text default 'init'
) returns uuid
language sql
as $$
  insert into public.payments (booking_id, provider, method, provider_trade_no, amount, status)
  values (p_booking, p_provider, p_method, p_trade, p_amount, p_status)
  returning id;
$$;

-- 用 create_booking 建單（參數名稱與 apps/api/src/db/supabase.ts 呼叫 RPC 時完全相同，名稱不對會直接報錯）
create or replace function sqltest.book(
  p_order_no text,
  p_starts   timestamptz,
  p_method   text default 'card',
  p_email    text default 'a@example.com',
  p_phone    text default '0911111111',
  p_minutes  int default 90,
  p_hold     interval default interval '15 minutes'
) returns jsonb
language sql
as $$
  select public.create_booking(
    p_order_no => p_order_no,
    p_service_id => 'love',
    p_starts_at => p_starts,
    p_ends_at => p_starts + make_interval(mins => p_minutes),
    p_pay_method => p_method,
    p_amount => 3600,
    p_hold_expires_at => now() + p_hold,
    p_customer_name => 'T',
    p_gender => 'female',
    p_birth_date => '1990-01-01',
    p_birth_time => null,
    p_birth_place => null,
    p_phone => p_phone,
    p_email => p_email,
    p_questions => null,
    p_max_pending_per_customer => 2,
    p_max_pending_atm => 5
  );
$$;

-- 測試日期：固定在未來（相對於 now），避免過了日期後測試失效
create or replace function sqltest.day(n int, hhmi text default '19:00') returns timestamptz
language sql stable
as $$ select (date_trunc('day', now() at time zone 'Asia/Taipei') + make_interval(days => n) + hhmi::time) at time zone 'Asia/Taipei' $$;
