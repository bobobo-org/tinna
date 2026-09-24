# API 合約（apps/api ↔ apps/web）

apps/api（Railway）與 apps/web（Vercel）之間唯一的介面約定。兩邊實作都以本檔為準；要改介面先改本檔。

- Base URL：web 端 `NEXT_PUBLIC_API_URL`
- 格式：JSON（金流回呼除外）。時間一律 `Asia/Taipei`（UTC+8，無日光節約）
- 錯誤一律：`{ "error": "<code>", "message": "<可直接顯示給使用者的中文>", "fields"?: { "<欄位>": "<錯誤訊息>" } }`
- CORS：只允許 `WEB_URL`（可逗號分隔多個）；`NODE_ENV!=production` 時另允許 `http://localhost:3000`

## 一般端點

### `GET /health`
`200 { "ok": true, "time": "<ISO>" }`

### `GET /config`
`200 { "payments": { "card": bool, "atm": bool, "line": bool }, "paymentEnv": "stage" | "prod" }`
- card / atm：綠界參數齊全即為 true；line：LINE Pay 參數齊全才 true
- web 端 Step 4 依此把未開通的付款方式顯示為停用（「即將開放」）

### `GET /availability?month=YYYY-MM[&service=<id>]`
```json
{
  "month": "2026-10",
  "timezone": "Asia/Taipei",
  "days": {
    "2026-10-01": { "status": "open", "slots": [{ "time": "10:00", "available": true }, { "time": "13:30", "available": false }] },
    "2026-10-05": { "status": "closed", "slots": [] }
  }
}
```
- 該月**每一天**都要有 key
- `past`：日期早於今天，或當天所有時段都早於「現在 + 24 小時」
- `closed`：該 weekday 沒有 `weekly_slots`（週一公休）或 `date_overrides.closed = true`；`slots = []`（web 顯示「休」）
- `full`：有時段但全部不可約（web 顯示「額滿」）
- `open`：至少一個可約時段
- `slots`：`weekly_slots` 該 weekday 的 `start_time` ∪ `date_overrides.extra_times`，依時間排序；`available=false` 代表已被占用（`pending_payment` / `awaiting_transfer` 且 hold 未逾時，或 `confirmed`）或早於「現在 + 24 小時」
- `month` 只接受本月～之後 2 個月，其餘回 `400`

## 預約

### `POST /bookings`
```json
{
  "service_id": "flow | love | career | quick",
  "date": "YYYY-MM-DD", "time": "HH:MM",
  "name": "王小美", "gender": "female | male",
  "birth_date": "YYYY-MM-DD", "birth_time": "HH:MM 或空字串", "birth_place": "",
  "phone": "0912345678", "email": "a@b.co", "questions": "",
  "pay_method": "card | line | atm",
  "agree": true
}
```
- 驗證同 README §5.5：姓名非空、生日必填、Email `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`、手機數字 ≥ 9 碼、`agree === true`；時段必須是 availability 中 `available` 的
- 金額一律取 DB `services.price`，不信任前端
- `hold_expires_at`：card / line = now + 15 分鐘；atm = now + 24 小時
- 回應：
  - `201 { "bookingId", "orderNo", "amount", "payMethod", "holdExpiresAt" }`
  - `400 { "error": "validation", "message", "fields": { "name": "請填寫姓名" } }`
  - `409 { "error": "slot_taken", "message": "這個時段剛被預約，請重新選擇時段" }`（撞 unique index）→ web 回到 Step 2 並重新載入時段
  - `409 { "error": "slot_unavailable", "message": "…" }`（不在可約時段內）→ 同上
  - `429 { "error": "rate_limited", "message": "…" }`

### `GET /bookings/:orderNo`
```json
{
  "orderNo": "YS8K2M4Q7T", "status": "pending_payment | awaiting_transfer | confirmed | cancelled | expired | refunded",
  "payMethod": "card | line | atm", "amount": 3600,
  "service": { "id": "love", "name": "感情合盤", "minutes": 90 },
  "date": "2026-10-07", "time": "19:00", "startsAt": "<ISO>", "holdExpiresAt": "<ISO | null>",
  "atm": { "bankCode": "822", "account": "9103522175887271", "expireDate": "2026/10/02 23:59:59" }
}
```
- `atm` 只在 ATM 取號後出現；**不回傳**姓名、電話、Email、生日、問題
- 查無 → `404`

## 付款

### `POST /payments/ecpay/checkout` — body `{ "orderNo" }`
`200 { "action": "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5", "fields": { "MerchantID": "…", "CheckMacValue": "…" } }`
- web 端建立 `<form method="POST" action={action}>`，每個 field 一個 hidden input，submit → 整頁導向綠界付款頁（卡號只在綠界頁輸入，不經過本站）
- card → `ChoosePayment=Credit`；atm → `ChoosePayment=ATM`（`ExpireDate=1`）
- 只接受 `pending_payment` 且 hold 未逾時的訂單；已付款 → `409 already_paid`；已逾時 → `409 expired`
- 每次呼叫產生新的 `MerchantTradeNo`（綠界不接受重複），寫入 `payments.provider_trade_no`

### `POST /payments/linepay/request` — body `{ "orderNo" }`
`200 { "paymentUrl" }` → web `location.href = paymentUrl`
- LINE Pay 未設定 → `503 { "error": "payment_unavailable", "message": "LINE Pay 即將開放，請改用信用卡或 ATM 轉帳" }`

## 金流回呼（外部 → API）

| 端點 | 來源 | 行為 |
|---|---|---|
| `POST /payments/ecpay/notify` | 綠界 ReturnURL（server） | 驗 CheckMacValue、比對金額 → `payments=paid`、`bookings=confirmed` → 寄確認信；回純文字 `1|OK` |
| `POST /payments/ecpay/result` | 綠界 OrderResultURL（瀏覽器 POST） | 驗簽；成功則同上（冪等）→ `303 {WEB_URL}/booking/success?order=<orderNo>` |
| `POST /payments/ecpay/atm-info` | 綠界 PaymentInfoURL（server） | 驗簽、存虛擬帳號 → `awaiting_transfer`、hold 改為綠界繳費期限 → 寄轉帳資訊信；回 `1|OK` |
| `POST /payments/ecpay/atm-redirect` | 綠界 ClientRedirectURL（瀏覽器 POST） | 同 atm-info（冪等）→ `303` 完成頁 |
| `GET /payments/linepay/confirm` | LINE Pay confirmUrl | Confirm API → `confirmed` → `302` 完成頁；失敗 → `302 {WEB_URL}/booking/success?order=<orderNo>` |
| ClientBackURL / LINE Pay cancelUrl | 使用者按「返回商店」 | 直接指向 `{WEB_URL}/booking/success?order=<orderNo>` |

- 所有回呼都要冪等；已 `confirmed` 的不可被晚到的回呼改回別的狀態
- 付款成功但 booking 已 `expired` 且時段已被別人約走 → 保留 `payments.status=paid`，booking 標記需人工處理（寄信給 `ADMIN_EMAIL`），不可覆蓋別人的預約

## 完成頁 `/booking/success?order=<orderNo>`（web）

| status | 顯示 |
|---|---|
| `confirmed` | 「預約成功」＋訂單明細（card / line） |
| `awaiting_transfer` | 「預約已保留」＋虛擬帳號與繳費期限 |
| `pending_payment` | 「付款確認中…」每 3 秒輪詢，最多 10 次；之後顯示「尚未完成付款」＋「重新付款」（再呼叫 checkout）＋「返回首頁」 |
| `expired` / `cancelled` | 「預約已逾時」＋「重新預約」 |

## 背景工作（API 程序內）
每 5 分鐘：`pending_payment` / `awaiting_transfer` 且 `hold_expires_at < now()` → `expired`，時段自動釋出。
