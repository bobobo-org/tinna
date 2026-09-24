-- =====================================================================
-- 0005：網站後台（/admin）的管理者名單
-- 登入用 Supabase Auth（Email＋密碼，第一次需收信確認）；API 驗證 access token 後，
-- 以 sha256(lower(trim(email))) 比對這張表。
-- 這個 repo 是公開的：初始管理者只存雜湊、不存 Email（email 欄位留給之後在後台新增的管理者）。
-- =====================================================================

create table public.admins (
  email_sha256 text primary key check (email_sha256 ~ '^[0-9a-f]{64}$'),
  email        text,
  created_at   timestamptz not null default now()
);

alter table public.admins enable row level security;
-- 刻意不建立任何 policy：只有 service_role（API）讀寫得到
revoke all on table public.admins from public, anon, authenticated;
grant select, insert, update, delete on table public.admins to service_role;

insert into public.admins (email_sha256)
values ('71c571082e21626d70120de4a6b5843ec64167f7a6d88a64202093af0d23e1fb')
on conflict do nothing;
