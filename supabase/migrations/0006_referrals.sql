-- =====================================================================
-- 0006：KOL 推薦碼
-- 後台為每位 KOL 建立推薦碼（打折或折抵金額、佣金比例、有效期間、可用次數、適用範圍）。
-- 客人下單時輸入推薦碼 → API 依 DB 的設定計算折扣後金額（不信任前端），並記一筆 referral_uses。
-- 成效與佣金只算「訂單已付款」的使用紀錄（查詢時對照訂單狀態）；可用次數只算未取消／未逾時的訂單。
-- 0001～0005 不修改。
-- =====================================================================

create table public.kols (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  contact    text,
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.referral_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^[A-Z0-9_-]{3,20}$'),
  kol_id          uuid not null references public.kols(id),
  discount_type   text not null check (discount_type in ('percent', 'amount')),
  -- percent：折扣百分比 1–90（10 = 打 9 折）；amount：折抵金額（元）
  discount_value  int  not null check (discount_value > 0),
  -- 佣金：折扣後實付金額的百分比
  commission_rate numeric(5,2) not null default 0 check (commission_rate between 0 and 100),
  applies_booking boolean not null default true,
  applies_vip     boolean not null default true,
  applies_shop    boolean not null default true,
  starts_at       timestamptz,
  ends_at         timestamptz,
  max_uses        int check (max_uses > 0),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint referral_percent_range check (discount_type <> 'percent' or discount_value between 1 and 90),
  constraint referral_period check (starts_at is null or ends_at is null or starts_at < ends_at)
);
create index referral_codes_kol on public.referral_codes (kol_id);

create table public.referral_uses (
  id                uuid primary key default gen_random_uuid(),
  code_id           uuid not null references public.referral_codes(id),
  order_kind        text not null check (order_kind in ('booking', 'vip', 'shop')),
  order_no          text not null,
  -- 預約用的推薦碼：連到 bookings（統計時看付款狀態）；VIP／商店訂單在之後的 migration 加欄位
  booking_id        uuid references public.bookings(id),
  original_amount   int  not null check (original_amount > 0),
  discount_amount   int  not null check (discount_amount >= 0),
  final_amount      int  not null check (final_amount > 0),
  commission_amount int  not null check (commission_amount >= 0),
  created_at        timestamptz not null default now(),
  unique (order_kind, order_no)
);
create index referral_uses_code on public.referral_uses (code_id, created_at);
create index referral_uses_created on public.referral_uses (created_at);

-- RLS 開啟、不建立 policy：只有 service_role（API）讀寫
alter table public.kols           enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referral_uses  enable row level security;

revoke all on table public.kols, public.referral_codes, public.referral_uses from public, anon, authenticated;
grant select, insert, update, delete on table public.kols, public.referral_codes, public.referral_uses to service_role;
