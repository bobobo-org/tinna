# 部署與系統架構：GitHub × Vercel × Supabase × Railway

## 1. 架構總覽
```
使用者 ──► Vercel (Next.js 前端 + 輕量 API Route)
              │  讀方案/可預約時段（Supabase anon key + RLS）
              ▼
          Railway (Node API：預約、金流、Webhook、寄信、排程)
              │  service_role key
              ▼
          Supabase (Postgres + Auth(後台) + Storage(圖片))
              ▲
   金流商 ────┘ Webhook（綠界 ECPay / LINE Pay）→ Railway
```
- **GitHub**：monorepo，push 到 `main` → Vercel 與 Railway 自動部署
- **Vercel**：`apps/web`（Next.js 14 App Router, TS, Tailwind）
- **Railway**：`apps/api`（Node 20 + Fastify/Hono, TS）— 金流簽章、Webhook、寄信、清除逾時保留
- **Supabase**：資料庫、後台登入、Storage

## 2. Repo 結構
```
yuanshe/
├─ apps/
│  ├─ web/                 # Vercel
│  │  ├─ app/(site)/page.tsx            首頁
│  │  ├─ app/(site)/services/page.tsx
│  │  ├─ app/(site)/about/page.tsx
│  │  ├─ app/(site)/faq/page.tsx
│  │  ├─ app/booking/page.tsx           4 步流程（client component）
│  │  ├─ app/booking/success/page.tsx
│  │  ├─ app/admin/...                  後台（Supabase Auth）
│  │  ├─ components/ (Nav, Footer, SatinSweep, MobileCta, BookingBar, Calendar...)
│  │  ├─ lib/supabase.ts, lib/api.ts
│  │  └─ tailwind.config.ts             ← 放 README 的 design tokens
│  └─ api/                 # Railway
│     ├─ src/index.ts
│     ├─ src/routes/bookings.ts
│     ├─ src/routes/payments/ecpay.ts
│     ├─ src/routes/payments/linepay.ts
│     ├─ src/jobs/expire-holds.ts
│     └─ src/lib/{supabase,mailer,ecpay,linepay}.ts
├─ supabase/
│  ├─ migrations/0001_init.sql
│  └─ seed.sql
├─ design/                 # 本 handoff 的原型（保留作對照）
└─ package.json (pnpm workspaces)
```

## 3. 資料庫（supabase/migrations/0001_init.sql）
```sql
create extension if not exists "pgcrypto";

create table services (
  id text primary key,                 -- flow | love | career | quick
  name text not null, short_name text not null,
  minutes int not null, price int not null,          -- TWD 整數
  tagline text, description text, includes text[] default '{}',
  is_featured boolean default false, sort int default 0, active boolean default true
);

-- 老師每週固定可預約時段
create table weekly_slots (
  id serial primary key,
  weekday int not null check (weekday between 0 and 6),  -- 0=日；週一(1)不建資料＝公休
  start_time time not null
);

-- 單日例外（請假/加開）
create table date_overrides (
  date date primary key,
  closed boolean default false,
  extra_times time[] default '{}'
);

create type booking_status as enum ('pending_payment','awaiting_transfer','confirmed','cancelled','expired','refunded');
create type pay_method as enum ('card','line','atm');

create table bookings (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null,                -- 'YS' + 8 碼
  service_id text references services(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status booking_status not null default 'pending_payment',
  pay_method pay_method not null,
  amount int not null,
  customer_name text not null, gender text, birth_date date not null, birth_time time,
  birth_place text, phone text not null, email text not null, questions text,
  atm_account text, hold_expires_at timestamptz,
  meet_url text,
  created_at timestamptz default now()
);
-- 同一時段不可重複（排除已取消/逾時）
create unique index bookings_slot_unique on bookings(starts_at)
  where status in ('pending_payment','awaiting_transfer','confirmed');

create table payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete cascade,
  provider text not null,           -- ecpay | linepay
  provider_trade_no text,
  amount int not null,
  status text not null,             -- init | paid | failed | refunded
  raw jsonb,
  created_at timestamptz default now()
);

-- RLS：前端只讀方案與「已被占用的時段」，不可讀個資
alter table services enable row level security;
alter table weekly_slots enable row level security;
alter table date_overrides enable row level security;
alter table bookings enable row level security;
alter table payments enable row level security;
create policy "public read services" on services for select using (active);
create policy "public read slots" on weekly_slots for select using (true);
create policy "public read overrides" on date_overrides for select using (true);

create view taken_slots as
  select starts_at from bookings
  where status in ('pending_payment','awaiting_transfer','confirmed');
grant select on taken_slots to anon;
```
`seed.sql`：寫入 4 個方案（值見 README §6）與每週時段：週二～週日 × `10:00,13:30,15:30,19:00,20:30`。

## 4. API（Railway，`apps/api`）
| Method | Path | 說明 |
|---|---|---|
| GET | `/availability?month=YYYY-MM&service=love` | 回傳每日可用時段（weekly_slots − taken − overrides；過去時間與 < 24h 內不可選） |
| POST | `/bookings` | body：service_id, date, time, 表單資料, pay_method。交易內 insert（撞 unique → 409「時段剛被預約」），`hold_expires_at = now()+15min`（ATM 為 24h）。回傳 `{ bookingId, orderNo, next }` |
| POST | `/payments/ecpay/checkout` | 產生綠界 AioCheckOut 表單參數（CheckMacValue），前端自動 submit。ATM 用 `ChoosePayment=ATM` 取得虛擬帳號 |
| POST | `/payments/ecpay/notify` | 綠界 ReturnURL。驗簽 → payments=paid、bookings=confirmed → 寄確認信（含 Google Meet 連結、.ics） |
| POST | `/payments/ecpay/atm-info` | PaymentInfoURL：存 atm_account，status=awaiting_transfer |
| POST | `/payments/linepay/request` | LINE Pay v3 Request API → 回傳 paymentUrl |
| GET | `/payments/linepay/confirm` | LINE Pay confirmUrl → Confirm API → confirmed → 302 回 `WEB_URL/booking/success?order=` |
| GET | `/bookings/:orderNo` | 完成頁查詢（只回傳非敏感欄位） |
| CRON | 每 5 分鐘 | 逾時未付款 → expired，釋出時段 |

> 信用卡**不可**自行收卡號。原型中的卡號欄位在正式版請改為：綠界站內付 2.0 / TapPay Fields（iframe 代管卡號），或直接導向綠界付款頁。視覺仍照原型（同樣的框、字級、4 位空格）。

## 5. 環境變數
**Vercel（apps/web）**
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=https://<railway-app>.up.railway.app
NEXT_PUBLIC_SITE_URL=https://<domain>
```
**Railway（apps/api）**
```
PORT=8080
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
WEB_URL=https://<domain>
API_URL=https://<railway-app>.up.railway.app
ECPAY_MERCHANT_ID=   ECPAY_HASH_KEY=   ECPAY_HASH_IV=   ECPAY_ENV=stage|prod
LINEPAY_CHANNEL_ID=  LINEPAY_CHANNEL_SECRET=  LINEPAY_ENV=sandbox|prod
RESEND_API_KEY=      MAIL_FROM="緣舍命理 <hello@domain>"
TZ=Asia/Taipei
```

## 6. 部署步驟
1. **GitHub**：建立 repo `yuanshe`，推上 monorepo。
2. **Supabase**：新專案（區域 Tokyo／Singapore）→ `supabase link` → `supabase db push` → 執行 `seed.sql`；Storage 建 `public-images` bucket 放人物照。Auth 開 Email，只建老師一個後台帳號。
3. **Railway**：New Project → Deploy from GitHub → Root Directory `apps/api`，Build `pnpm i && pnpm build`、Start `node dist/index.js`；填環境變數；新增 Cron Service（或 node-cron in-process）跑 expire-holds。
4. **Vercel**：Import repo → Root Directory `apps/web` → Framework Next.js → 填環境變數 → 綁網域。
5. **金流**：綠界後台設定 ReturnURL=`{API_URL}/payments/ecpay/notify`、PaymentInfoURL=`{API_URL}/payments/ecpay/atm-info`、OrderResultURL=`{WEB_URL}/booking/success`；LINE Pay confirmUrl=`{API_URL}/payments/linepay/confirm`。先用測試環境全流程跑通。
6. **CORS**：Railway 只允許 `WEB_URL`。

## 7. 驗收清單
- [ ] 桌機 1440 / 1280 / 1024、手機 390 / 375 / 360 與 `design/site.dc.html` 並排比對無差異
- [ ] 桌機各緞面區塊紋理連續；手機無接縫錯位
- [ ] 流光動畫 9s、`prefers-reduced-motion` 停用
- [ ] 同時段兩人同時送出 → 只有一人成功，另一人看到 409 提示並回 Step 2
- [ ] 信用卡 / LINE Pay / ATM 三種測試交易成功，信件寄達
- [ ] 逾時未付款 15 分鐘後時段重新開放
- [ ] Lighthouse 手機 Performance ≥ 90、Accessibility ≥ 95
