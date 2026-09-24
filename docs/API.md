# API 合約（apps/api ↔ apps/web）

apps/api（Railway）與 apps/web（Vercel）之間唯一的介面約定。兩邊實作都以本檔為準；要改介面先改本檔。

- Base URL：web 端 `NEXT_PUBLIC_API_URL`
- 格式：JSON（金流回呼除外）。時間一律 `Asia/Taipei`（UTC+8，無日光節約）；ISO 時間字串帶 `+08:00`
- 錯誤一律：`{ "error": "<code>", "message": "<可直接顯示給使用者的中文>", "fields"?: { "<欄位>": "<錯誤訊息>" } }`
- CORS：只允許 `WEB_URL`（可逗號分隔多個）；`NODE_ENV!=production` 時另允許 `http://localhost:3000`
- 所有回應 `Cache-Control: no-store`；未知路徑 `404 not_found`；未預期錯誤 `500 internal`；body 超過 64KB `413 payload_too_large`

### 瀏覽器端 JSON POST 端點的共同規則
適用 `POST /bookings`、`POST /payments/ecpay/checkout`、`POST /payments/linepay/request`（金流回呼不適用）：
- `Content-Type` 必須是 `application/json`（可帶 `; charset=utf-8`）→ 否則 `415 { "error": "unsupported_media_type" }`
- 有 `Origin` header 且不在 `WEB_URL` 白名單 → `403 { "error": "forbidden_origin" }`（沒有 Origin 的 server 端呼叫照常）

### 限流
| 範圍 | 上限 | 超過時 |
|---|---|---|
| `POST /bookings`，每個用戶端 IP | 每小時 30 次（含驗證失敗） | `429 rate_limited`＋`Retry-After` 秒數 |
| 付款端點，每個「IP＋orderNo」 | 每 10 分鐘 10 次 | `429 rate_limited`＋`Retry-After` |
| 每筆訂單的付款嘗試（`payments` 筆數） | 10 次 | `429 { "error": "too_many_attempts", "message": "付款嘗試次數已達上限，請聯繫客服協助處理" }` |

- 用戶端 IP：`X-Forwarded-For` 由右往左，跳過受信任段（私有網段、loopback、`100.64.0.0/10`、`::1`、`fc00::/7`、link-local），取第一個非受信任 IP；IPv6 以 `/64` 為單位計數

## 一般端點

### `GET /health`
`200 { "ok": true, "time": "<ISO>", "version": "<commit SHA>" }`
- `version`：啟動時讀 `apps/api/BUILD_SHA`（CI 在 `railway up` 前寫入），不存在時為環境變數 `GIT_SHA`，再沒有就是 `"dev"`。CI 以此判斷新版是否上線

### `GET /config`
`200 { "payments": { "card": bool, "atm": bool, "line": bool }, "paymentEnv": "stage" | "prod" | null, "atmMinLeadHours": 72 }`
- card：綠界參數齊全即為 true；atm：綠界參數齊全**且** `ATM_ENABLED=true` 才 true（預設關閉，web 不顯示 ATM 選項）；line：LINE Pay 參數齊全才 true
- `paymentEnv`：綠界使用中的環境；**綠界未設定時為 `null`**（web 只在 `"stage"` 時顯示測試環境字樣）
- `atmMinLeadHours`：ATM 只能預約開始時間在這個小時數以後的時段（web 依此停用 ATM 選項）
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
- 判斷順序：日期早於今天 → `past`；沒有任何時段 → `closed`；所有時段都早於「現在 + 24 小時」→ `past`；至少一個可約 → `open`；其餘 → `full`
- `closed`：`date_overrides.closed = true`，或該日沒有任何時段（週一公休且沒有加開）；`slots = []`（web 顯示「休」）
  - 週一若在 `date_overrides.extra_times` 加開時段，依加開的時段判斷，**不算** `closed`
- `slots`：`weekly_slots` 該 weekday 的 `start_time` ∪ `date_overrides.extra_times`，依時間排序；`available=false` 代表已被占用（`pending_payment` / `awaiting_transfer` 且 hold 未逾時，或 `confirmed`）或早於「現在 + 24 小時」
  - 過去的日子（`past`）也列出當天所有時段，全部 `available=false`（公休日為 `[]`）
- `service`（選填）：帶了就依該方案的時長判斷重疊——`[時段, 時段 + 方案分鐘數)` 與任一占用中預約重疊就不可約；沒帶時只判斷時段開始時間是否落在占用中預約的時間內。未知的方案 → `400 validation`（`fields.service`）
- `month` 只接受本月～之後 2 個月（台北時間），其餘回 `400 validation`（`fields.month`）

## 預約

### `POST /bookings`
```json
{
  "service_id": "flow | love | career | quick | listen | topics-4 | topics-6 | topics-8 | topics-15",
  "date": "YYYY-MM-DD", "time": "HH:MM",
  "name": "王小美", "gender": "female | male",
  "birth_date": "YYYY-MM-DD", "birth_time": "HH:MM 或空字串", "birth_place": "",
  "phone": "0912345678", "email": "a@b.co", "questions": "",
  "topics": ["財運", "工作", "健康", "小孩"], "topic_note": "",
  "pay_method": "card | line | atm",
  "agree": true
}
```
- 驗證同 README §5.5：姓名非空、生日必填、Email `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`、手機數字 ≥ 9 碼、`agree === true`；另外：性別必填、出生日期不可晚於今天或早於 1900（`fields.birth_date`「請確認出生日期」）
- 時段必須在老師的時段表內（每週時段 ∪ 加開、未公休、不早於「現在 + 24 小時」）
- 金額一律取 DB `services.price`，不信任前端
- 自選主題（`services.topic_limit` 不是 null 的方案，例 `topics-6`）：
  - `topics`：依優先順序排列的主題（字串、不可重複、最多 15 個）；`topic_note`：備註（最多 500 字）。格式不對 → `fields.topics`「請重新選擇主題」
  - 題數少於啟用中價位最小的 `topic_limit` → `fields.topics`「請至少選擇 4 個主題」
  - `service_id` 必須是「`topic_limit` ≥ 題數」最小的價位（例：5 題 → `topics-6`），否則 `fields.topics`「主題數量與方案不符，請重新整理頁面後再選一次」
  - 主題、備註、`questions` 合併存進 `bookings.questions`（`【自選主題・依優先順序】1. …`），老師的新訂單通知信看得到；其他方案送來的 `topics` 不理會
- `services.question_required = true` 的方案（`listen` 接住你的諮詢室）：`questions` 必填，空白 → `fields.questions`「請填寫這一欄」
- 付款方式未開通 → `400 validation`，`fields.pay_method`：「LINE Pay 即將開放，請改用信用卡」／「信用卡付款即將開放，請改用其他付款方式」／「ATM 轉帳即將開放，請改用其他付款方式」；ATM 關閉（`ATM_ENABLED` 未設為 true）→「ATM 轉帳已停止服務，請改用信用卡」（已取號的 ATM 訂單照常處理）
- ATM 限制（`400 validation`，`fields.pay_method`）：
  - 開始時間不到 72 小時（`/config` 的 `atmMinLeadHours`）→「ATM 轉帳需於諮詢開始 72 小時前預約，請改用信用卡」
  - 全站未付款的 ATM（取號前 + 待轉帳）已達 5 筆 →「ATM 轉帳名額暫滿，請改用信用卡」
- 同一顧客（Email 或電話，正規化後）最多 2 筆未付款保留（`pending_payment` + `awaiting_transfer`，hold 未逾時）→ 超過回 `409 too_many_pending`
- 同一人（Email **且**電話相同，正規化後）對**同一時段**再次送出（例如從綠界返回後想換付款方式或改資料）→ 在同一交易內把自己的舊保留改成 `cancelled` 再建新單（上面的 2 筆上限不把這筆舊保留算進去）；新單建不成（`slot_taken`、`too_many_pending`、ATM 名額滿）時舊保留維持原狀、不會被取消；舊單已有付款成功紀錄則不取消（→ `409 slot_taken`）
- 以上判斷都在資料庫單一交易內完成（`create_booking`，advisory lock 序列化），併發送出也不會繞過
- `holdExpiresAt`：card / line = 建立後 15 分鐘；atm = 建立後 30 分鐘（取號前），綠界取號成功後延長為 `min(綠界繳費期限, 諮詢開始前 24 小時)`
- 回應：
  - `201 { "bookingId", "orderNo", "amount", "payMethod", "holdExpiresAt" }`
  - `400 { "error": "validation", "message", "fields": { "name": "請填寫姓名" } }`（`message` 為第一個欄位錯誤）
  - `409 { "error": "slot_taken", "message": "這個時段剛被預約，請重新選擇時段" }`（已被占用、撞 unique index 或時間重疊）→ web 回到 Step 2 並重新載入時段
  - `409 { "error": "slot_unavailable", "message": "這個時段目前無法預約，請重新選擇時段" }`（不在可約時段內）→ 同上
  - `409 { "error": "too_many_pending", "message": "您已有尚未完成付款的預約，請先完成付款，或稍後再試" }`
  - `415 unsupported_media_type`、`403 forbidden_origin`（見共同規則）
  - `429 { "error": "rate_limited", "message": "送出次數太多了，請稍後再試" }`

### `GET /bookings/:orderNo`
```json
{
  "orderNo": "YS8K2M4Q7T", "status": "pending_payment | awaiting_transfer | confirmed | cancelled | expired | refunded",
  "payMethod": "card | line | atm", "amount": 3600,
  "service": { "id": "love", "name": "感情合盤", "minutes": 90 },
  "date": "2026-10-07", "time": "19:00", "startsAt": "<ISO>", "holdExpiresAt": "<ISO | null>",
  "needsAttention": false,
  "atm": { "bankCode": "822", "account": "9103522175887271", "expireDate": "2026/10/02 23:59:59 | null" }
}
```
- `needsAttention`：這筆訂單有異常需要人工處理（例如付款成功但時段已被別人約走、重複付款或可能重複扣款、金額不符、綠界回報「付款結果待確認中」或無法辨識的狀態、LINE Pay 確認結果不明）。為 `true` 時 web 顯示「將由專人聯繫」，不要引導使用者重新付款或重新預約。付款結果不明造成的標記，等那一次付款有了結果（成功或確定失敗）會自動解除；同一訂單另一次付款成功時預約照常確認，但仍保持 `true`（可能重複扣款）
- `atm` 只在 ATM 取號後出現；`expireDate` 為 `yyyy/MM/dd HH:mm:ss`（台北時間，= 綠界繳費期限與「諮詢開始前 24 小時」較早者），可能為 `null`
- `holdExpiresAt`：`confirmed` 後為 `null`
- **不回傳**姓名、電話、Email、生日、問題
- 訂單編號格式不對或查無 → `404 not_found`

## 付款

### `POST /payments/ecpay/checkout` — body `{ "orderNo" }`
`200 { "action": "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5", "fields": { "MerchantID": "…", "CheckMacValue": "…" } }`
- web 端建立 `<form method="POST" action={action}>`，每個 field 一個 hidden input，submit → 整頁導向綠界付款頁（卡號只在綠界頁輸入，不經過本站）
- card → `ChoosePayment=Credit`；atm → `ChoosePayment=ATM`（`ExpireDate=1`）
- 每次呼叫產生新的 `MerchantTradeNo`（綠界不接受重複），寫入 `payments.provider_trade_no`；每筆訂單最多 10 次
- 只接受 `pending_payment` 且 hold 未逾時的訂單。錯誤：
  - `400 validation`（`fields.orderNo`，編號格式不對）、`404 not_found`
  - `409 already_paid`（已付款）、`409 expired`（已逾時／已取消）
  - `409 awaiting_transfer`「這筆訂單已取得轉帳帳號，請依帳號完成轉帳」
  - `409 invalid_method`（LINE Pay 訂單不能走綠界）
  - `409 payment_under_review`「付款結果確認中，請勿重複付款，我們會盡快與您聯繫」（同一訂單有結果不明的付款，避免重複扣款）
  - `429 rate_limited` / `429 too_many_attempts`、`415`、`403`
  - `503 payment_unavailable`（綠界未設定）

### `POST /payments/linepay/request` — body `{ "orderNo" }`
`200 { "paymentUrl" }` → web `location.href = paymentUrl`
- **LINE Pay 訂單的「重新付款」也走這裡**（打 `/payments/ecpay/checkout` 會 `409 invalid_method`）
- 同一筆訂單上一次的嘗試還在等使用者付款 → 回同一個 `paymentUrl`（不建立新交易）；上一次其實已扣款 → `409 already_paid`
- LINE Pay 未設定 → `503 { "error": "payment_unavailable", "message": "LINE Pay 即將開放，請改用信用卡" }`
- 其他錯誤：`400 validation`、`404 not_found`、`409 invalid_method`（非 LINE Pay 訂單）、`409 expired`、`409 payment_under_review`、`429 rate_limited` / `429 too_many_attempts`、`502 payment_error`（LINE Pay 暫時無法使用或上一筆結果不明）、`415`、`403`

## 金流回呼（外部 → API）

| 端點 | 來源 | 行為 |
|---|---|---|
| `POST /payments/ecpay/notify` | 綠界 ReturnURL（server） | 驗 CheckMacValue、比對 MerchantID 與金額 → `payments=paid`、`bookings=confirmed` → 寄確認信；回純文字 `1|OK`（驗簽失敗 `400 0|CheckMacValue Error`） |
| `POST /payments/ecpay/result` | 綠界 OrderResultURL（瀏覽器 POST） | 驗簽；成功則同上（冪等）→ `303 {WEB_URL}/booking/success?order=<orderNo>`（處理失敗也照樣導回） |
| `POST /payments/ecpay/atm-info` | 綠界 PaymentInfoURL（server） | 驗簽、存虛擬帳號 → `awaiting_transfer`、hold 改為 `min(綠界繳費期限, 諮詢開始前 24 小時)` → 寄轉帳資訊信；回 `1|OK` |
| `POST /payments/ecpay/atm-redirect` | 綠界 ClientRedirectURL（瀏覽器 POST） | 同 atm-info（冪等）→ `303` 完成頁 |
| `GET /payments/linepay/confirm` | LINE Pay confirmUrl | 先確認預約仍可確認才呼叫 Confirm API → `confirmed` → `302` 完成頁；失敗 → 同樣 `302 {WEB_URL}/booking/success?order=<orderNo>` |
| ClientBackURL / LINE Pay cancelUrl | 使用者按「返回商店」 | 直接指向 `{WEB_URL}/booking/success?order=<orderNo>`；LINE Pay 會在後面多附 `orderId`、`transactionId` 參數，web 忽略即可 |

- 所有回呼都要冪等；已 `confirmed` 的不可被晚到的回呼改回別的狀態；已退款的付款不會被重送的舊回呼改回 `paid`
- 付款成功但 booking 已 `expired`：時段還空著就直接確認；時段已被別人約走 → 保留 `payments.status=paid`，booking 標記需人工處理（`needsAttention=true`，寄信給 `ADMIN_EMAIL`），不可覆蓋別人的預約
- 綠界信用卡 `RtnCode≠1`：只有確定失敗的代碼（10100058、10100248、10100251、10100252、10100254、10100255、10100256、10300024、10800001）才把該次付款標為失敗；`10300066`「交易付款結果待確認中」與不認得的代碼 → 不標失敗，booking 標記需人工處理並通知 `ADMIN_EMAIL`
- LINE Pay Confirm 失敗（或無回應）時先查交易狀態：`0123` 已完成 → 照付款成功處理；只有 `0121`／`0122` 算確定失敗；其他（`0110`、`0000`、`1104`、`9000`…）維持待處理交給背景對帳，並標記 `needsAttention`、通知 `ADMIN_EMAIL`（同一次付款只通知一次）
- 逾時的 ATM 預約之後才收到取號結果：時段空著且未超過未付款上限才恢復為 `awaiting_transfer`，否則維持 `expired`（若之後入帳，走上面的付款成功流程）

## 完成頁 `/booking/success?order=<orderNo>`（web）

| 狀態 | 顯示 |
|---|---|
| `needsAttention = true`（任何 status） | 「將由專人聯繫」，不顯示重新付款／重新預約 |
| `confirmed` | 「預約成功」＋訂單明細（card / line） |
| `awaiting_transfer` | 「預約已保留」＋虛擬帳號與繳費期限 |
| `pending_payment` | 「付款確認中…」每 3 秒輪詢，最多 10 次；之後顯示「尚未完成付款」＋「重新付款」（card / atm 再呼叫 checkout；line 再呼叫 linepay/request）＋「返回首頁」 |
| `expired` / `cancelled` | 「預約已逾時」＋「重新預約」 |

## 背景工作（API 程序內，每 5 分鐘，啟動時先跑一次）
- `pending_payment` / `awaiting_transfer` 且 `hold_expires_at < now()` → `expired`，時段自動釋出
- 補寄沒寄成功的確認信、轉帳資訊信、給老師的新訂單通知
- LINE Pay 對帳：24 小時內仍未結束的 LINE Pay 付款查詢交易狀態後收尾（已完成 → 確認；已授權 → 補 Confirm；取消／失敗 → 標失敗）

## 後台（`/admin/*`）

- 登入：web 端用 Supabase Auth（Email＋密碼，第一次需收信確認）取得 access token，每個請求帶 `Authorization: Bearer <token>`
- API 以 Supabase Auth 驗證 token（Email 必須已確認），再以 `sha256(lower(trim(email)))` 比對 `admins` 表（repo 公開，初始管理者只存雜湊）
  - 沒帶／無效／過期 → `401 { "error": "unauthorized" }`；不在名單 → `403 { "error": "forbidden" }`
- 寫入請求（POST／PATCH／DELETE）：Origin 必須在 `WEB_URL` 白名單（否則 `403 forbidden_origin`）；POST／PATCH 必須是 JSON（否則 `415`，上傳圖片除外）
- 回應含顧客個資，不寫進 log

### `GET /admin/me`
`200 { "email": "…" }`

### `GET /admin/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD&status=<逗號分隔>`
- 預設 `from` = 今天、`to` = `from` + 30 天（台北時間，含 `to` 當天）；區間最多一年；`status` 可選 `pending_payment,awaiting_transfer,confirmed,cancelled,expired,refunded`
- `200 { "from", "to", "bookings": [{ "orderNo", "status", "payMethod", "amount", "date", "time", "startsAt", "endsAt", "confirmedAt", "service": { "id", "name" }, "customer": { "name", "gender", "birthDate", "birthTime", "birthPlace", "phone", "email" }, "questions", "needsAttention", "attentionReason" }] }`（依開始時間排序，最多 500 筆）
- 參數不正確 → `400 validation`

## KOL 推薦碼

### `GET /referral/:code?kind=booking|vip|shop`（公開）
- 下單前預覽：`200 { "code": "AMY10", "discountType": "percent | amount", "discountValue": 10, "label": "9 折" }`
- 找不到 → `404 invalid_code`；停用、不適用、未開始、過期、達使用上限 → `409 referral_unusable`（`message` 可直接顯示）
- 代碼不分大小寫（一律轉大寫），格式 `^[A-Z0-9_-]{3,20}$`

### `POST /bookings` 的 `referral_code`
- 選填；有給就在建立預約時依 DB 設定重算：打折四捨五入到元、折抵金額不超過原價、實付至少 1 元；回應的 `amount` 為折扣後金額
- 無效或不能用 → `400 validation`，`fields.referral_code`（訊息同上）
- 成功時記一筆 `referral_uses`（原價、折扣、實付、佣金 = 實付 × 佣金比例四捨五入）；可用次數只算已付款或保留中的訂單

### 後台
- `GET /admin/kols` → `{ kols: [{ id, name, contact, note, active, createdAt, codes: [推薦碼] }] }`
- `POST /admin/kols { name, contact?, note? }`、`PATCH /admin/kols/:id { name?, contact?, note?, active? }`
- `POST /admin/referral-codes { kolId, code, discountType, discountValue, commissionRate?, appliesBooking?, appliesVip?, appliesShop?, startsOn?, endsOn?, maxUses? }`（日期 `YYYY-MM-DD`，結束日含當天；打折最多 90%；代碼重複 `409 duplicate`）
- `PATCH /admin/referral-codes/:id`（同上欄位皆選填，另可 `active`；代碼與 KOL 不可改）
- `GET /admin/referral-stats?from=YYYY-MM-DD[&to=YYYY-MM-DD]`（預設本月；沒給 `to` 時到 `from` 所在月份月底）→ `{ from, to, kols: [{ kolId, name, active, orders, pending, revenue, discount, commission }], codes: [...同上以推薦碼統計], uses: [{ orderNo, kind, code, kolName, createdAt, originalAmount, discountAmount, finalAmount, commissionAmount, state: "paid | pending | cancelled" }] }`；`orders`／`revenue`／`discount`／`commission` 只算已付款

