# Handoff：緣舍命理 — 一對一命理諮詢網站（線上預約＋付款）

> 給 Claude Code：請先讀完本檔，再讀 `DEPLOYMENT.md` 與 `CLAUDE_CODE_PROMPT.md`。目標是**100% 還原 `design/site.dc.html` 的視覺與互動**，並把模擬的預約／付款接上真實後端。

---

## 1. Overview
命理師個人品牌網站，核心轉換＝**一對一線上諮詢的預約與付款**。
- 頁面：首頁、諮詢方案、老師介紹、常見問題、線上預約（4 步）、預約完成
- 響應式：`< 760px` 切換為手機排版（漢堡選單、底部浮動 CTA、預約底部結帳列）
- 風格：粉紅色系、中華風、**緞綢光澤**（多段斜向漸層＋一道全頁共用的流光動畫）

## 2. About the Design Files
`design/` 內的檔案是 **HTML 設計原型**（非正式產品程式碼）。它們是一種自訂格式「Design Component (.dc.html)」，靠 `support.js` 在瀏覽器執行：
- `<x-dc>` 內是模板（`{{ path }}` 插值、`<sc-for>` 迴圈、`<sc-if>` 條件）
- `<script data-dc-script>` 內是 `class Component extends DCLogic`，等同 React class component：`state`、`setState`、`renderVals()` 回傳模板要用的值
- **所有樣式都是 inline style** → 請把它們原封不動轉成 Tailwind / CSS Modules / styled 皆可，但數值要一致

**本機預覽**：在 `design/` 資料夾執行 `npx serve .`（或任何靜態伺服器），開 `site.dc.html`。
- URL 參數可直接跳到指定狀態：`?page=services|about|faq|booking`、`&step=1..4`、`&svc=flow|love|career|quick`、`&date=auto`、`?menu=1`
- `mobile-preview.dc.html`：6 支 390×844 手機並排預覽
- `explorations.dc.html`：早期三版探索＋最終 2a（僅參考）

請在目標專案中用 **Next.js (App Router) + TypeScript + Tailwind** 重建（見 DEPLOYMENT.md）。

## 3. Fidelity
**High-fidelity。** 顏色、字級、間距、圓角、陰影、漸層角度與色標、動畫時長都是最終值，請逐一照抄。

---

## 4. Design Tokens

### 4.1 色彩
| Token | 值 | 用途 |
|---|---|---|
| ink-900 | `#63142f` | 主標題、深色文字、Footer 底色 |
| ink-700 | `#6b2540` | 摘要內文 |
| ink-600 | `#7a3450` | 內文 |
| ink-500 | `#8a4a63` | 次要說明 |
| ink-400 | `#a06a80` | 註記、署名 |
| rose-800 | `#8a1740` | 品牌深紅、價格、Logo 字 |
| rose-600 | `#b9265a` | 主強調、序號、選中框 |
| rose-500 | `#e0417a` / `#e04c7f` | 按鈕漸層端 |
| rose-300 | `#e8749c` | 按鈕漸層起點、摘要上緣 |
| rose-accent | `#a8285c` | 英文小標 (letter-spacing .4em) |
| bg-page | `#fff8fa` | 頁面底 |
| bg-soft | `#fff0f5` / `#fff5f8` / `#ffeef4` | 淺底、hover |
| line | `#f0d5df` / `#efcad8` / `#f3d3df` / `#f5dde6` | 分隔線、輸入框框線 |
| error | `#d0284f` | 表單錯誤 |
| footer-text | `#f5cfdc`，標題 `#ffe4ee` | |
| disabled | 字 `#d9bcc8`，時段 `#cfb2be` 底 `#f7eef1` | |

### 4.2 緞面漸層（**最重要**，全站共用同一組）
```css
--satin: linear-gradient(118deg,#ffd9e6 0%,#fff0f5 16%,#ffb9d0 34%,#ffe2ec 48%,#f9a3c0 66%,#ffe7f0 82%,#ffc7db 100%);
```
- **桌機**：`background-image: var(--satin); background-attachment: fixed; background-size: 100vw 100vh;`
  → Nav、首頁 Hero、首頁底部 CTA、方案頁頁首、老師頁頁首、完成頁全部用這個，因為固定在 viewport，相鄰區塊紋理無縫接續。
- **手機 (<760px)**：`background-attachment: scroll; background-size: 100% 100%;`（iOS Safari 不支援 fixed）
- 區塊交界：`border-top: 1px solid rgba(255,255,255,.9)`（緞布收邊）

主要按鈕漸層：
```css
--btn: linear-gradient(120deg,#e8749c,#b9265a 48%,#8a1740);
box-shadow: 0 12px 26px -10px rgba(138,23,64,.75);
```
Nav 按鈕：`linear-gradient(120deg,#e04c7f,#b9265a 55%,#e8749c)`，陰影 `0 6px 16px -4px rgba(185,38,90,.6)`
珍珠圓（Logo/步驟號/完成勾）：`radial-gradient(circle at 32% 28%,#fff 0%,#ffb3cc 40~42%,#c33566 100%)`
Hero 光暈圓：`radial-gradient(circle at 38% 32%,rgba(255,255,255,.95) 0%,rgba(255,190,214,.9) 45%,rgba(226,110,152,.55) 100%)`，陰影 `0 30px 60px -24px rgba(160,30,80,.5)`
首頁服務列底：`linear-gradient(180deg,#ffe4ee 0%,#fff8fa 100%)`
評價區底：`linear-gradient(110deg,#ffeef4,#fff8fa 60%)`
預約頁底：`linear-gradient(180deg,#ffeef4 0,#fff8fa 320px)`
選中選項底：`linear-gradient(120deg,#fff0f5,#ffe0eb)`；選中日期/時段：`linear-gradient(135deg,#e8749c,#b9265a)`
付款資訊框：`linear-gradient(135deg,#fff5f8,#ffe9f1)`

### 4.3 流光動畫（全頁一道）
```html
<div style="position:fixed;inset:0;z-index:30;pointer-events:none;overflow:hidden;mix-blend-mode:soft-light">
  <div style="position:absolute;top:-20%;left:0;width:22vw;height:140%;
    background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.9),rgba(255,255,255,0));
    animation:satinSweep 9s ease-in-out infinite"></div>
</div>
```
```css
@keyframes satinSweep { 0%{transform:translateX(-40%) skewX(-18deg)} 100%{transform:translateX(600%) skewX(-18deg)} }
```
可由設定 `shine`（預設 true）關閉。請加 `prefers-reduced-motion` 時停用。

### 4.4 字體
Google Fonts：`Noto Serif TC`（400/500/600/700/900）、`Noto Sans TC`（300/400/500/700）
- 標題／價格／序號（壹貳參）：Noto Serif TC
- 內文／UI：Noto Sans TC
- 字級：Hero 標題 桌機 `clamp(44px,5vw,64px)` 直排 `writing-mode:vertical-rl` letter-spacing .16em line-height 1.5；手機 38px（<420px 為 32px）橫排 line-height 1.4
- 頁 H1：桌機 44px／手機 32px，700
- 區塊標題 30px 700 letter-spacing .1em；卡片標題 24–26px 700
- 內文 17px line-height 2.1（Hero/老師）；14–15px line-height 1.9–2
- Logo 22px（手機 19px）700 letter-spacing .18em
- 輸入框 **16px**（避免 iOS 縮放）

### 4.5 圓角／陰影
- 膠囊按鈕 `99px`；卡片 16–20px；選項 12–14px；輸入框 10px；月曆格 10px
- Hero 人物框：`border-radius:180px 180px 24px 24px`（拱形）、`border:3px solid rgba(255,255,255,.85)`、陰影 `0 24px 50px -20px rgba(138,23,64,.55)`
- 卡片陰影：`0 20px 40px -26px rgba(160,30,80,.6)`；表單卡 `0 20px 40px -30px rgba(138,23,64,.5)`

---

## 5. Screens

### 共用：Nav（sticky top:0, z-index 20）
- 背景 `--satin`，下框 `1px rgba(255,255,255,.7)`，陰影 `0 6px 20px -14px rgba(138,23,64,.4)`，padding `16px clamp(20px,4vw,48px)`
- 左：34px 珍珠圓＋「緣舍命理」
- 中（桌機）：首頁／諮詢方案／老師介紹／常見問題，`padding 8px 12px`、15px、500、不換行；目前頁底 `rgba(255,255,255,.75)` 字 `#8a1740`
- 右（桌機）：「立即預約」
- 手機：右側 44px 漢堡圓鈕（三條 18×2px，展開時變 X，transition .2s）；展開：遮罩 `rgba(99,20,47,.28)` ＋ `top:76px; left/right:12px` 白色面板（radius 20），列表項 16px 18px padding 17px，底部全寬「立即預約」

### 共用：Footer
底 `#63142f`，左「緣舍命理」＋「© 2026 緣舍命理工作室 · 統一編號 00000000」，右「信用卡 · LINE Pay · ATM 轉帳 · 隱私權政策 · 退款規則」13px。手機底部 padding 112px（留給浮動 CTA）。

### 共用：手機浮動 CTA（首頁/方案/老師/FAQ）
`position:fixed; left/right:16px; bottom:16px + safe-area`；白色 92% ＋ backdrop-blur 12px 膠囊；左「一對一線上諮詢／NT$1,500 起 · 付款即確認」，右 48px 高「立即預約」。

### 5.1 首頁
1. **Hero**：grid `repeat(auto-fit,minmax(min(100%,360px),1fr))`、min-height 580px（手機 auto）。
   - 左：400px 光暈圓 ＋ 360×450 拱形人物照（手機 280 圓／250×310）
   - 右：直排標題「問一個人的命 / 答一段路的解」（第二句 `#b9265a`）＋ 56×2 漸層短線 ＋ 內文「一對一線上諮詢，紫微斗數 × 八字合參。每一場都為你單獨排盤，不套模板、不販賣恐懼。」＋ 三點（線上刷卡／LINE Pay，即時確認時段；全程錄影，事後可重看；附一頁重點行動建議）＋ 按鈕「立即預約」「查看價目」（手機兩鈕等寬）
2. **三格服務**（壹/貳/參）：底為服務列漸層，每格 padding 48px 36px（手機 26px 22px）；中間「姻緣 · 合盤」上緣 3px `#b9265a` 表示推薦；hover 底 `rgba(255,255,255,.6)`。整格可點 → 直接進入預約 step 2 並帶入該方案。
3. **四步完成預約**：4 欄（手機 2 欄），44px 珍珠圓號碼。
4. **諮詢者說**：兩張白卡（見原檔文案）。
5. **CTA**：`--satin`，「下一個時段，留給你」34px／「線上選時段、付款完成即確認」／主按鈕「預約一對一諮詢」。

### 5.2 諮詢方案
頁首 `--satin` 置中：SERVICES／「一對一諮詢方案」／「皆為線上視訊 · 附錄影檔與重點筆記 · 付款後即確認時段」。4 張卡 grid `minmax(240px,1fr)`；「感情合盤」卡背景用 `--satin`＋「最多人選」徽章（`#8a1740` 白字 12px）；其餘 `linear-gradient(150deg,#fff 0%,#ffeef4 100%)`。價格 30px Serif。卡底「預約此方案」。

### 5.3 老師介紹
頁首 `--satin`：拱形照片（460 高，手機 360）＋「ABOUT THE READER」「沐妍老師」＋簡介＋標籤（紫微斗數/八字/擇日/姓名學）。下方兩欄：經歷時間軸（2014/2017/2021/至今）、諮詢原則三卡（不販賣恐懼／給能執行的建議／資料保密）。底部「預約沐妍老師」。

### 5.4 常見問題
max-width 820 手風琴，一次只開一題（預設第 1 題開），圖示 +/−。5 題文案見原檔 `FAQS`。

### 5.5 線上預約（核心）
- 標題「線上預約」＋ 4 段進度條（4px，完成/目前＝`linear-gradient(90deg,#e8749c,#b9265a)`，未到 `#f3d9e3`；完成的號碼顯示 ✓）
- 桌機：左表單卡（flex 2 1 480px）＋右「預約摘要」白卡（上緣 4px `#e8749c`）；卡底「上一步 / 下一步」
- 手機：摘要卡與卡底按鈕隱藏，改為 **sticky 底部結帳列**：‹ 圓鈕｜應付金額（點擊展開摘要 ▴/▾）｜下一步／確認付款

**Step 1 選擇方案**：單選列表（radio 圓點＋名稱＋分鐘/tagline＋價格）。
**Step 2 日期時段**：月曆（可看本月＋之後 2 個月）；過去日期、**週一公休（顯示「休」）**、額滿（顯示「額滿」）不可選。選日期後顯示時段 10:00／13:30／15:30／19:00／20:30，已被預約的顯示刪除線不可點。手機時段 3 欄。
**Step 3 排盤資料**：姓名*、性別（女/男 切換）、國曆出生日期*、出生時間（可空）、出生地、手機*、Email*、想問的問題（textarea）。
**Step 4 付款**：信用卡／LINE Pay／ATM 轉帳 三選一；信用卡顯示卡號（自動 4 位空格）、MM/YY（自動斜線）、CVC；需勾選「我已閱讀並同意改期與退款規則（諮詢前 48 小時可免費改期一次）」。按鈕文字：`確認付款 NT$x,xxx` 或 `取得轉帳帳號`；送出時「付款處理中…」。

**驗證規則**
- 姓名非空；出生日期必填；Email `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`；手機數字 ≥ 9 碼
- 卡號 16 碼、有效期 `MM/YY`、CVC ≥ 3；同意條款必勾
- Step 1/2 未完成時「下一步」opacity .45 且無作用；Step 3/4 按下才顯示錯誤（12px `#d0284f`）

### 5.6 預約完成
`--satin` 底，560px 白卡：72px 珍珠勾、標題（信用卡/LINE Pay：「預約成功」；ATM：「預約已保留」）、說明、訂單明細（訂單編號、方案、時間、金額；ATM 多「虛擬帳號」）、「加入行事曆」「返回首頁」。

---

## 6. 方案資料（seed）
| id | 名稱 | 短名 | 分鐘 | 價格 | 推薦 |
|---|---|---|---|---|---|
| flow | 流年運勢盤 | 流年 · 大限 | 60 | 2800 | |
| love | 感情合盤 | 姻緣 · 合盤 | 90 | 3600 | ✓ |
| career | 事業／擇時 | 事業 · 擇時 | 75 | 3200 | |
| quick | 單題快問 | 單題快問 | 30 | 1500 | |
tagline / desc / includes 請從 `design/site.dc.html` 的 `SVCS` 陣列逐字複製。

## 7. State（前端）
`page, step(1-4), svc, mo(0-2), date(YYYY-MM-DD), time, f{name,gender,bdate,btime,bplace,email,phone,q}, err{}, pay('card'|'line'|'atm'), card{no,exp,cvc}, agree, faq, order{no,acct}, paying, menu, sumOpen`
正式版：頁面改為路由（`/`, `/services`, `/about`, `/faq`, `/booking`, `/booking/success?order=`），預約 state 可放 URL query 或 zustand。

## 8. Assets
- `design/uploads/images.jpeg`：**僅佔位，有他站浮水印，不可上線**。正式需替換為 Q 版命理師（粉色緞面旗袍，去背 PNG，建議 1200×1500）。
- 老師介紹頁照片：尚無，預留 `public/images/teacher.png`。
- 無 icon 套件；✓ ‹ › + − 為文字字元。

## 9. Files
- `design/site.dc.html` — **完整網站原型（主要依據）**
- `design/mobile-preview.dc.html` — 手機 6 畫面預覽
- `design/explorations.dc.html` — 設計探索歷程
- `design/support.js`, `design/image-slot.js` — 原型執行環境（不需移植）
- `DEPLOYMENT.md` — 架構、資料庫、API、金流、部署步驟
- `CLAUDE_CODE_PROMPT.md` — 可直接貼給 Claude Code 的指令
