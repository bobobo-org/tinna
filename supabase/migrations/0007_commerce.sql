-- =====================================================================
-- 0007：VIP 包堂、商店（商品／訂單）、VIP 贈品共用的資料表
--
-- orders：非預約的訂單（kind = vip 購買包堂、shop 商店、gift 後台寄給 VIP 的贈品）
--   付款走綠界信用卡（order_payments，每次嘗試一筆 trade_no），apply_order_paid 冪等處理付款結果：
--   vip → 建立 VIP 會員（卡號＋堂數＋到期日）；shop → 扣庫存
-- vip_members：VIP 卡號＋Email 就能用堂數預約（不需要帳號），create_vip_booking 在單一交易內扣一堂＋建立已確認的預約
-- 0001～0006 不修改。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 商品（商店販售與 VIP 贈品共用）
-- ---------------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  name        text not null check (length(btrim(name)) between 1 and 80),
  description text,
  price       int  not null check (price >= 0),
  images      text[] not null default '{}',
  stock       int  not null default 0 check (stock >= 0),
  -- 上架販售（false：只當 VIP 贈品，不出現在商店）
  for_sale    boolean not null default true,
  active      boolean not null default true,
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- 全站設定（運費等），只給 API 讀寫
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.settings (key, value) values
  ('shipping_fee', '100'::jsonb),
  ('free_shipping_over', 'null'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- VIP 方案（包堂）
-- ---------------------------------------------------------------------
create table public.vip_plans (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  name        text not null,
  sessions    int  not null check (sessions between 1 and 200),
  price       int  not null check (price > 0),
  valid_days  int  not null default 365 check (valid_days between 1 and 3650),
  description text,
  sort        int  not null default 0,
  active      boolean not null default true
);
insert into public.vip_plans (id, name, sessions, price, valid_days, description, sort) values
  ('vip-4',  'VIP 4 堂',  4,  18000, 365, '每堂 90 分鐘，共 6 小時', 1),
  ('vip-10', 'VIP 10 堂', 10, 42000, 365, '每堂 90 分鐘，共 15 小時', 2),
  ('vip-12', 'VIP 12 堂', 12, 49200, 365, '每堂 90 分鐘，共 18 小時', 3),
  ('vip-15', 'VIP 15 堂', 15, 60000, 365, '每堂 90 分鐘，共 22.5 小時', 4),
  ('vip-20', 'VIP 20 堂', 20, 76000, 365, '每堂 90 分鐘，共 30 小時', 5)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 訂單（VIP 購買／商店／贈品）
-- ---------------------------------------------------------------------
create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_no        text not null unique check (order_no ~ '^YS[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$'),
  kind            text not null check (kind in ('vip', 'shop', 'gift')),
  status          text not null default 'pending_payment'
                  check (status in ('pending_payment', 'paid', 'shipped', 'completed', 'cancelled', 'expired')),
  subtotal        int  not null check (subtotal >= 0),
  shipping_fee    int  not null default 0 check (shipping_fee >= 0),
  discount_amount int  not null default 0 check (discount_amount >= 0),
  -- 應付金額（折扣後、含運費）；贈品為 0
  amount          int  not null check (amount >= 0),
  customer_name   text not null,
  email           text not null,
  phone           text not null,
  birth_date      date,
  ship_name       text,
  ship_phone      text,
  ship_address    text,
  note            text,
  vip_plan_id     text references public.vip_plans(id),
  vip_member_id   uuid,
  tracking_no     text,
  hold_expires_at timestamptz,
  paid_at         timestamptz,
  shipped_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint orders_amount_positive check (kind = 'gift' or amount > 0),
  constraint orders_vip_plan check (kind <> 'vip' or vip_plan_id is not null)
);
create index orders_kind_created on public.orders (kind, created_at desc);
create index orders_pending on public.orders (hold_expires_at) where status = 'pending_payment';
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  name       text not null,
  unit_price int  not null check (unit_price >= 0),
  qty        int  not null check (qty between 1 and 99)
);
create index order_items_order on public.order_items (order_id);

-- 綠界付款嘗試（每次 checkout 一個新的 trade_no）
create table public.order_payments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id),
  trade_no        text not null unique,
  amount          int  not null check (amount > 0),
  status          text not null default 'init' check (status in ('init', 'paid', 'failed')),
  provider_txn_id text,
  raw             jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);
create index order_payments_order on public.order_payments (order_id);

-- ---------------------------------------------------------------------
-- VIP 會員（卡號＋Email 使用堂數）
-- ---------------------------------------------------------------------
create table public.vip_members (
  id             uuid primary key default gen_random_uuid(),
  card_no        text not null unique check (card_no ~ '^VIP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$'),
  name           text not null,
  email          text not null,
  email_norm     text generated always as (lower(btrim(email))) stored,
  phone          text not null,
  birth_date     date,
  plan_id        text references public.vip_plans(id),
  sessions_total int  not null check (sessions_total >= 0),
  sessions_used  int  not null default 0 check (sessions_used >= 0),
  expires_at     timestamptz not null,
  order_id       uuid unique references public.orders(id),
  note           text,
  created_at     timestamptz not null default now(),
  constraint vip_sessions_range check (sessions_used <= sessions_total)
);
create index vip_members_email on public.vip_members (email_norm);

alter table public.orders
  add constraint orders_vip_member_fk foreign key (vip_member_id) references public.vip_members(id);

-- 推薦碼用在 VIP／商店訂單時連到 orders
alter table public.referral_uses add column order_id uuid references public.orders(id);

-- ---------------------------------------------------------------------
-- VIP 預約：專用方案（90 分鐘）、付款方式 vip、預約連到 VIP 會員
-- ---------------------------------------------------------------------
alter type public.pay_method add value if not exists 'vip';
alter table public.bookings add column vip_member_id uuid references public.vip_members(id);
alter table public.services add column vip_only boolean not null default false;

insert into public.services
  (id, name, short_name, minutes, price, tagline, description, includes,
   is_featured, sort, active, topic_limit, question_label, question_required, vip_only)
values
  ('vip', 'VIP 諮詢（90 分鐘）', 'VIP 諮詢', 90, 4500,
   'VIP 會員使用堂數預約，每堂 90 分鐘。',
   'VIP 會員專屬：輸入 VIP 卡號即可使用堂數預約，不必另外付款。',
   '{}', false, 10, true, null, null, false, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 付款成功（冪等）：同一個 trade_no 重複通知只處理一次
-- ---------------------------------------------------------------------
create function public.apply_order_paid(
  p_trade_no text,
  p_amount   integer,
  p_txn      text,
  p_raw      jsonb,
  p_card_no  text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pay    public.order_payments%rowtype;
  v_order  public.orders%rowtype;
  v_plan   public.vip_plans%rowtype;
  v_member uuid;
  v_card   text;
begin
  select * into v_pay from public.order_payments where trade_no = p_trade_no for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  select * into v_order from public.orders where id = v_pay.order_id for update;

  if v_pay.status = 'paid' then
    return jsonb_build_object('result', 'already_paid', 'order_no', v_order.order_no, 'kind', v_order.kind);
  end if;
  if p_amount <> v_pay.amount or v_pay.amount <> v_order.amount then
    update public.order_payments
       set raw = raw || jsonb_build_object('amount_mismatch', p_raw)
     where id = v_pay.id;
    return jsonb_build_object('result', 'amount_mismatch', 'order_no', v_order.order_no, 'kind', v_order.kind);
  end if;

  update public.order_payments
     set status = 'paid', provider_txn_id = p_txn, paid_at = now(), raw = raw || jsonb_build_object('paid', p_raw)
   where id = v_pay.id;

  -- 另一次付款已經讓訂單完成（可能重複扣款）→ 不重複建立會員／扣庫存
  if v_order.status not in ('pending_payment', 'expired', 'cancelled') then
    return jsonb_build_object('result', 'duplicate_payment', 'order_no', v_order.order_no, 'kind', v_order.kind);
  end if;

  -- 逾時才付款的訂單一樣接受（客人已經付錢了）
  update public.orders set status = 'paid', paid_at = now(), hold_expires_at = null where id = v_order.id;

  if v_order.kind = 'vip' then
    select * into v_plan from public.vip_plans where id = v_order.vip_plan_id;
    insert into public.vip_members (card_no, name, email, phone, birth_date, plan_id, sessions_total, expires_at, order_id)
    values (p_card_no, v_order.customer_name, v_order.email, v_order.phone, v_order.birth_date,
            v_plan.id, v_plan.sessions, now() + make_interval(days => v_plan.valid_days), v_order.id)
    returning id, card_no into v_member, v_card;
    update public.orders set vip_member_id = v_member where id = v_order.id;
  elsif v_order.kind = 'shop' then
    update public.products p
       set stock = greatest(0, p.stock - i.qty)
      from public.order_items i
     where i.order_id = v_order.id and i.product_id = p.id;
  end if;

  return jsonb_build_object('result', 'paid', 'order_no', v_order.order_no, 'kind', v_order.kind, 'card_no', v_card);
end;
$$;

-- ---------------------------------------------------------------------
-- VIP 用堂數預約：卡號＋Email 對得上、未到期、還有堂數 → 建立已確認的預約並扣一堂（單一交易）
-- 與 create_booking 共用 advisory lock，時段衝突一樣由 unique index／重疊約束擋下
-- ---------------------------------------------------------------------
create function public.create_vip_booking(
  p_order_no      text,
  p_service_id    text,
  p_starts_at     timestamptz,
  p_ends_at       timestamptz,
  p_card_no       text,
  p_customer_name text,
  p_gender        text,
  p_birth_date    date,
  p_birth_time    time,
  p_birth_place   text,
  p_phone         text,
  p_email         text,
  p_questions     text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_member     public.vip_members%rowtype;
  v_amount     integer;
  v_id         uuid;
  v_constraint text;
begin
  perform pg_advisory_xact_lock(727260001);
  perform public.expire_stale_holds(p_starts_at, p_ends_at);

  select * into v_member from public.vip_members where card_no = upper(btrim(p_card_no)) for update;
  if not found or v_member.email_norm <> lower(btrim(p_email)) then
    return jsonb_build_object('result', 'vip_not_found');
  end if;
  if v_member.expires_at <= now() then
    return jsonb_build_object('result', 'vip_expired');
  end if;
  if v_member.sessions_used >= v_member.sessions_total then
    return jsonb_build_object('result', 'vip_no_sessions');
  end if;

  -- 每堂的價值（方案價格 ÷ 堂數，統計用；bookings.amount 必須 > 0）
  select greatest(1, round(p.price::numeric / p.sessions)::integer) into v_amount
    from public.vip_plans p where p.id = v_member.plan_id;
  v_amount := coalesce(v_amount, 1);

  begin
    insert into public.bookings (
      order_no, service_id, starts_at, ends_at, status, pay_method, amount, hold_expires_at, confirmed_at,
      customer_name, gender, birth_date, birth_time, birth_place, phone, email, questions, vip_member_id
    ) values (
      p_order_no, p_service_id, p_starts_at, p_ends_at, 'confirmed', 'vip'::public.pay_method, v_amount, null, now(),
      p_customer_name, p_gender, p_birth_date, p_birth_time, p_birth_place, p_phone, p_email, p_questions, v_member.id
    )
    returning id into v_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'bookings_order_no_unique' then
        return jsonb_build_object('result', 'order_no_taken');
      end if;
      return jsonb_build_object('result', 'slot_taken');
    when exclusion_violation then
      return jsonb_build_object('result', 'slot_taken');
  end;

  update public.vip_members set sessions_used = sessions_used + 1 where id = v_member.id;
  return jsonb_build_object(
    'result', 'created',
    'id', v_id,
    'sessions_left', v_member.sessions_total - v_member.sessions_used - 1
  );
end;
$$;

-- ---------------------------------------------------------------------
-- RLS 與權限
--   商品（上架中）與 VIP 方案（啟用中）開放 anon 讀取；其餘只給 service_role
-- ---------------------------------------------------------------------
alter table public.products       enable row level security;
alter table public.settings       enable row level security;
alter table public.vip_plans      enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.order_payments enable row level security;
alter table public.vip_members    enable row level security;

create policy "public read products for sale" on public.products
  for select to anon, authenticated using (active and for_sale);
create policy "public read active vip plans" on public.vip_plans
  for select to anon, authenticated using (active);

revoke all on table public.products, public.settings, public.vip_plans, public.orders, public.order_items,
                    public.order_payments, public.vip_members
  from public, anon, authenticated;
grant select on table public.products, public.vip_plans to anon, authenticated;
grant select, insert, update, delete on table public.products, public.settings, public.vip_plans, public.orders,
      public.order_items, public.order_payments, public.vip_members
  to service_role;

revoke all on function public.apply_order_paid(text, integer, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.create_vip_booking(text, text, timestamptz, timestamptz, text, text, text, date, time, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_order_paid(text, integer, text, jsonb, text) to service_role;
grant execute on function public.create_vip_booking(text, text, timestamptz, timestamptz, text, text, text, date, time, text, text, text, text)
  to service_role;
