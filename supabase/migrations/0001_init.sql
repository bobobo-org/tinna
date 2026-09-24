-- =====================================================================
-- 緣舍命理：方案、可預約時段、預約、付款
-- 以 design_handoff_yuanshe/DEPLOYMENT.md §3 為基礎，補充欄位與權限見各段註解。
--
-- 權限模型（Supabase）：
--   * anon / authenticated：只能 select services(active)、weekly_slots、date_overrides
--   * bookings / payments：anon / authenticated 無任何權限、無任何 policy（完全不可讀寫）
--   * service_role（apps/api）：繞過 RLS；金流狀態轉換只透過下方 security invoker 函式
--   * Supabase 預設會把 public schema 新物件的權限 grant 給 anon/authenticated，
--     所以這裡一律先 revoke 再只 grant 需要的，不依賴預設值。
--   * 原規格的 taken_slots view 已移除：前端改走 API GET /availability。
-- gen_random_uuid() 自 PG13 起內建，不需要 pgcrypto。
-- =====================================================================

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.booking_status as enum (
  'pending_payment', 'awaiting_transfer', 'confirmed', 'cancelled', 'expired', 'refunded'
);
create type public.pay_method as enum ('card', 'line', 'atm');

-- ---------------------------------------------------------------------
-- updated_at 自動維護
-- ---------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 方案
-- ---------------------------------------------------------------------
create table public.services (
  id          text primary key check (id ~ '^[a-z][a-z0-9_-]{1,31}$'),  -- flow | love | career | quick
  name        text not null,
  short_name  text not null,
  minutes     int  not null check (minutes between 1 and 480),
  price       int  not null check (price > 0),                          -- TWD 整數
  tagline     text,
  description text,
  includes    text[] not null default '{}',
  is_featured boolean not null default false,
  sort        int not null default 0,
  active      boolean not null default true
);

-- ---------------------------------------------------------------------
-- 老師每週固定可預約時段（weekday：0=日 … 6=六；週一不建資料＝公休）
-- 補：unique(weekday, start_time) 讓 seed 可以 on conflict 重跑
-- ---------------------------------------------------------------------
create table public.weekly_slots (
  id         serial primary key,
  weekday    int  not null check (weekday between 0 and 6),
  start_time time not null,
  constraint weekly_slots_weekday_time_unique unique (weekday, start_time)
);

-- ---------------------------------------------------------------------
-- 單日例外（請假：closed=true；加開：extra_times）
-- ---------------------------------------------------------------------
create table public.date_overrides (
  date        date primary key,
  closed      boolean not null default false,
  extra_times time[] not null default '{}'
);

-- ---------------------------------------------------------------------
-- 預約
-- 補充欄位：
--   atm_bank_code / atm_expires_at ：GET /bookings/:orderNo 的 atm.bankCode / atm.expireDate
--   confirmed_at                   ：付款確認時間（對帳、寄信重試判斷）
--   needs_attention / attention_reason：付款成功但無法自動確認（時段被占、重複付款、金額不符…）需人工處理
--   confirmation_sent_at / transfer_info_sent_at / admin_notified_at：寄信成功時間（背景重試未寄出的信）
--   updated_at
-- 補充約束：bookings_no_overlap（占用中的預約時間區間不可重疊；加開時段時防止時長重疊）
-- ---------------------------------------------------------------------
create table public.bookings (
  id               uuid primary key default gen_random_uuid(),
  order_no         text not null check (order_no ~ '^YS[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$'),  -- 'YS' + 8 碼隨機
  service_id       text not null references public.services(id),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           public.booking_status not null default 'pending_payment',
  pay_method       public.pay_method not null,
  amount           int not null check (amount > 0),
  customer_name    text not null,
  gender           text check (gender in ('female', 'male')),
  birth_date       date not null,
  birth_time       time,
  birth_place      text,
  phone            text not null,
  email            text not null,
  questions        text,
  atm_bank_code    text,
  atm_account      text,
  atm_expires_at   timestamptz,
  hold_expires_at  timestamptz,
  meet_url         text,
  confirmed_at     timestamptz,
  needs_attention  boolean not null default false,
  attention_reason text,
  confirmation_sent_at  timestamptz,
  transfer_info_sent_at timestamptz,
  admin_notified_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint bookings_order_no_unique unique (order_no),
  constraint bookings_time_range check (ends_at > starts_at),
  constraint bookings_hold_required check (
    status not in ('pending_payment', 'awaiting_transfer') or hold_expires_at is not null
  ),
  -- 占用中的預約（待付款／待轉帳／已確認）時間區間 [starts_at, ends_at) 不可重疊
  constraint bookings_no_overlap exclude using gist (tstzrange(starts_at, ends_at) with &&)
    where (status in ('pending_payment', 'awaiting_transfer', 'confirmed'))
);

-- 同一時段不可重複（排除已取消／逾時／已退款）
create unique index bookings_slot_unique on public.bookings (starts_at)
  where status in ('pending_payment', 'awaiting_transfer', 'confirmed');
create index bookings_starts_at_idx on public.bookings (starts_at);
create index bookings_hold_idx on public.bookings (hold_expires_at)
  where status in ('pending_payment', 'awaiting_transfer');
create index bookings_attention_idx on public.bookings (created_at) where needs_attention;

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 付款（每一次付款嘗試一列）
-- 補充欄位：
--   method          ：這次嘗試的付款方式（card | atm | line）
--   provider_trade_no：送給金流商的交易編號（綠界 MerchantTradeNo／LINE Pay orderId），
--                     每次嘗試都不同；unique(provider, provider_trade_no) 是回呼的冪等鍵
--   provider_txn_id ：金流商端的交易編號（綠界 TradeNo／LINE Pay transactionId，19 位數以字串保存）
--   paid_at / updated_at
--   raw             ：依事件分 key 保存金流商的請求／回呼原文（不含顧客個資）
-- ---------------------------------------------------------------------
create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references public.bookings(id) on delete cascade,
  provider          text not null check (provider in ('ecpay', 'linepay')),
  method            public.pay_method not null,
  provider_trade_no text not null,
  provider_txn_id   text,
  amount            int not null check (amount > 0),
  status            text not null default 'init' check (status in ('init', 'paid', 'failed', 'refunded')),
  paid_at           timestamptz,
  raw               jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint payments_trade_no_unique unique (provider, provider_trade_no)
);
-- provider_txn_id 只供對帳查詢，不設 unique（冪等鍵是 provider_trade_no；撞號只會讓回呼 500 無限重送）
create index payments_txn_id_idx on public.payments (provider, provider_txn_id)
  where provider_txn_id is not null;
create index payments_booking_idx on public.payments (booking_id);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.services       enable row level security;
alter table public.weekly_slots   enable row level security;
alter table public.date_overrides enable row level security;
alter table public.bookings       enable row level security;
alter table public.payments       enable row level security;

create policy "public read active services" on public.services
  for select to anon, authenticated using (active);
create policy "public read weekly slots" on public.weekly_slots
  for select to anon, authenticated using (true);
create policy "public read date overrides" on public.date_overrides
  for select to anon, authenticated using (true);
-- bookings / payments：刻意不建立任何 policy

-- ---------------------------------------------------------------------
-- 權限（明確 revoke → 只 grant 需要的）
-- ---------------------------------------------------------------------
revoke all on table public.services, public.weekly_slots, public.date_overrides,
                    public.bookings, public.payments
  from public, anon, authenticated;
revoke all on sequence public.weekly_slots_id_seq from public, anon, authenticated;

grant select on table public.services, public.weekly_slots, public.date_overrides
  to anon, authenticated;

grant select, insert, update, delete on table public.services, public.weekly_slots,
      public.date_overrides, public.bookings, public.payments
  to service_role;
grant usage, select on sequence public.weekly_slots_id_seq to service_role;

-- =====================================================================
-- 狀態轉換函式（只給 service_role；security invoker + 空 search_path）
-- 金流回呼可能同時到（綠界 ReturnURL 與 OrderResultURL 沒有固定先後），
-- 所以在同一個交易內以 row lock（for update）序列化，保證：
--   * 重複通知不重複轉換（呼叫端只在 result='confirmed' / 'issued' 時寄信）
--   * confirmed 不會被晚到的回呼改掉
--   * 付款成功但時段已被別人約走 → 不覆蓋別人的預約，標記 needs_attention
-- =====================================================================

-- 逾時未付款 → expired，釋出時段
-- p_from / p_to 有給時只處理與 [p_from, p_to) 重疊的預約（新增預約前先釋出該時段）
create function public.expire_stale_holds(p_from timestamptz default null, p_to timestamptz default null)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with expired as (
    update public.bookings
       set status = 'expired'
     where status in ('pending_payment', 'awaiting_transfer')
       and hold_expires_at < now()
       and (p_from is null or p_to is null or (starts_at < p_to and ends_at > p_from))
    returning 1
  )
  select count(*)::int from expired;
$$;

-- 付款成功（綠界 ReturnURL / OrderResultURL、LINE Pay Confirm 成功後呼叫）
-- 回傳 jsonb：{ result, reason?, reclaimed?, booking_id?, order_no?, booking_status? }
--   result = not_found | already_paid | ignored | amount_mismatch | confirmed | needs_attention
create function public.apply_payment_paid(
  p_provider        text,
  p_trade_no        text,
  p_amount          integer,
  p_provider_txn_id text,
  p_event           text,
  p_raw             jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pay    public.payments%rowtype;
  v_bk     public.bookings%rowtype;
  v_reason text;
begin
  select * into v_pay
    from public.payments
   where provider = p_provider and provider_trade_no = p_trade_no
   for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into v_bk from public.bookings where id = v_pay.booking_id for update;

  update public.payments
     set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(p_event, coalesce(p_raw, '{}'::jsonb)),
         provider_txn_id = coalesce(provider_txn_id, p_provider_txn_id)
   where id = v_pay.id;

  if v_pay.status = 'paid' then
    return jsonb_build_object('result', 'already_paid', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', v_bk.status);
  end if;

  -- 已退款的付款：重送的舊回呼不可再改回 paid
  if v_pay.status = 'refunded' then
    return jsonb_build_object('result', 'ignored', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', v_bk.status);
  end if;

  if p_amount is distinct from v_pay.amount or v_pay.amount <> v_bk.amount then
    update public.bookings
       set needs_attention = true, attention_reason = 'amount_mismatch'
     where id = v_bk.id;
    return jsonb_build_object('result', 'amount_mismatch', 'reason', 'amount_mismatch',
                              'booking_id', v_bk.id, 'order_no', v_bk.order_no,
                              'booking_status', v_bk.status);
  end if;

  update public.payments set status = 'paid', paid_at = now() where id = v_pay.id;

  if v_bk.status in ('pending_payment', 'awaiting_transfer') then
    if v_bk.starts_at <= now() then
      -- 諮詢時間已過才入帳（ATM 繳費期限可能晚於諮詢時間）
      update public.bookings
         set status = 'confirmed', confirmed_at = now(), hold_expires_at = null,
             needs_attention = true, attention_reason = 'paid_after_start'
       where id = v_bk.id;
      return jsonb_build_object('result', 'needs_attention', 'reason', 'paid_after_start',
                                'booking_id', v_bk.id, 'order_no', v_bk.order_no,
                                'booking_status', 'confirmed');
    end if;
    update public.bookings
       set status = 'confirmed', confirmed_at = now(), hold_expires_at = null
     where id = v_bk.id;
    return jsonb_build_object('result', 'confirmed', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', 'confirmed');
  end if;

  if v_bk.status = 'expired' and v_bk.starts_at > now() then
    -- 保留逾時後才付款成功：時段沒被別人約走就直接確認
    begin
      update public.bookings
         set status = 'confirmed', confirmed_at = now(), hold_expires_at = null
       where id = v_bk.id;
      return jsonb_build_object('result', 'confirmed', 'reclaimed', true, 'booking_id', v_bk.id,
                                'order_no', v_bk.order_no, 'booking_status', 'confirmed');
    exception when unique_violation or exclusion_violation then
      update public.bookings
         set needs_attention = true, attention_reason = 'paid_after_expiry_slot_taken'
       where id = v_bk.id;
      return jsonb_build_object('result', 'needs_attention', 'reason', 'paid_after_expiry_slot_taken',
                                'booking_id', v_bk.id, 'order_no', v_bk.order_no,
                                'booking_status', v_bk.status);
    end;
  end if;

  v_reason := case v_bk.status
    when 'confirmed' then 'duplicate_payment'
    when 'expired'   then 'paid_after_expiry_past'
    when 'cancelled' then 'paid_after_cancel'
    else 'paid_after_refund'
  end;
  update public.bookings
     set needs_attention = true, attention_reason = v_reason
   where id = v_bk.id;
  return jsonb_build_object('result', 'needs_attention', 'reason', v_reason, 'booking_id', v_bk.id,
                            'order_no', v_bk.order_no, 'booking_status', v_bk.status);
end;
$$;

-- ATM 取號成功（綠界 PaymentInfoURL / ClientRedirectURL）
-- 回傳 jsonb：result = not_found | ignored | amount_mismatch | issued | already_issued | slot_taken
create function public.apply_atm_issued(
  p_trade_no        text,
  p_amount          integer,
  p_provider_txn_id text,
  p_bank_code       text,
  p_account         text,
  p_expires_at      timestamptz,
  p_event           text,
  p_raw             jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_bk  public.bookings%rowtype;
begin
  select * into v_pay
    from public.payments
   where provider = 'ecpay' and provider_trade_no = p_trade_no
   for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into v_bk from public.bookings where id = v_pay.booking_id for update;

  update public.payments
     set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(p_event, coalesce(p_raw, '{}'::jsonb)),
         provider_txn_id = coalesce(provider_txn_id, p_provider_txn_id)
   where id = v_pay.id;

  if v_pay.status <> 'init' then
    return jsonb_build_object('result', 'ignored', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', v_bk.status);
  end if;

  if p_amount is distinct from v_pay.amount then
    update public.bookings
       set needs_attention = true, attention_reason = 'amount_mismatch'
     where id = v_bk.id;
    return jsonb_build_object('result', 'amount_mismatch', 'reason', 'amount_mismatch',
                              'booking_id', v_bk.id, 'order_no', v_bk.order_no,
                              'booking_status', v_bk.status);
  end if;

  -- 繳費期限已過（例如重送舊的取號結果）→ 不處理
  if p_expires_at <= now() then
    return jsonb_build_object('result', 'ignored', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', v_bk.status);
  end if;

  if v_bk.status = 'awaiting_transfer' and v_bk.atm_account is not distinct from p_account then
    return jsonb_build_object('result', 'already_issued', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', v_bk.status);
  end if;

  if v_bk.status in ('pending_payment', 'awaiting_transfer')
     or (v_bk.status = 'expired' and v_bk.starts_at > now()) then
    begin
      update public.bookings
         set status = 'awaiting_transfer',
             atm_bank_code = p_bank_code,
             atm_account = p_account,
             atm_expires_at = p_expires_at,
             hold_expires_at = p_expires_at,
             transfer_info_sent_at = null
       where id = v_bk.id;
      return jsonb_build_object('result', 'issued', 'booking_id', v_bk.id,
                                'order_no', v_bk.order_no, 'booking_status', 'awaiting_transfer');
    exception when unique_violation or exclusion_violation then
      return jsonb_build_object('result', 'slot_taken', 'booking_id', v_bk.id,
                                'order_no', v_bk.order_no, 'booking_status', v_bk.status);
    end;
  end if;

  return jsonb_build_object('result', 'ignored', 'booking_id', v_bk.id,
                            'order_no', v_bk.order_no, 'booking_status', v_bk.status);
end;
$$;

-- 付款失敗／取消（只把 init 改成 failed；paid 不會被改回）
-- 回傳 jsonb：result = not_found | failed | ignored
create function public.mark_payment_failed(
  p_provider text,
  p_trade_no text,
  p_event    text,
  p_raw      jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pay   public.payments%rowtype;
  v_order text;
begin
  select * into v_pay
    from public.payments
   where provider = p_provider and provider_trade_no = p_trade_no
   for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  update public.payments
     set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(p_event, coalesce(p_raw, '{}'::jsonb)),
         status = case when status = 'init' then 'failed' else status end
   where id = v_pay.id;

  select order_no into v_order from public.bookings where id = v_pay.booking_id;
  return jsonb_build_object('result', case when v_pay.status = 'init' then 'failed' else 'ignored' end,
                            'booking_id', v_pay.booking_id, 'order_no', v_order);
end;
$$;

-- 函式權限：Supabase 預設會 grant execute 給 anon/authenticated，必須明確收回
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.expire_stale_holds(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.apply_payment_paid(text, text, integer, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.apply_atm_issued(text, integer, text, text, text, timestamptz, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.mark_payment_failed(text, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.expire_stale_holds(timestamptz, timestamptz) to service_role;
grant execute on function public.apply_payment_paid(text, text, integer, text, text, jsonb) to service_role;
grant execute on function public.apply_atm_issued(text, integer, text, text, text, timestamptz, text, jsonb)
  to service_role;
grant execute on function public.mark_payment_failed(text, text, text, jsonb) to service_role;
