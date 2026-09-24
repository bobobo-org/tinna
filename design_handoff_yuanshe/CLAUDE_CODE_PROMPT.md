# 貼給 Claude Code 的指令

```
這個資料夾是「緣舍命理」一對一命理諮詢網站的設計交接包。

1. 先完整閱讀 README.md、DEPLOYMENT.md，再打開 design/site.dc.html 讀完整份模板與 Component 類別（所有文案、數值、邏輯都在裡面）。
2. 用 `npx serve design` 啟動原型當作對照基準；用 ?page= / ?step= / ?svc= / ?date=auto / ?menu=1 參數檢視各狀態。
3. 依 DEPLOYMENT.md 建立 pnpm monorepo：apps/web（Next.js 14 App Router + TS + Tailwind，部署 Vercel）、apps/api（Node 20 + Hono，部署 Railway）、supabase/（migrations + seed）。
4. 把 README §4 的 design tokens 寫進 tailwind.config.ts（colors、backgroundImage.satin、keyframes satinSweep、fontFamily serif/sans）。
5. 逐頁 1:1 重建：Nav、Footer、首頁、諮詢方案、老師介紹、常見問題、預約 4 步、完成頁，以及 <760px 手機版（漢堡選單、底部浮動 CTA、預約底部結帳列）。所有文案逐字複製，所有 px/色碼/漸層色標/陰影照抄，不要自行「優化」。
6. 桌機緞面區塊使用 background-attachment:fixed + background-size:100vw 100vh；手機改 scroll + 100% 100%。
7. 把原型中模擬的時段與付款接上 apps/api：/availability、/bookings、綠界（信用卡 + ATM）、LINE Pay、Webhook、確認信、逾時釋出。卡號不可經過自家伺服器（用綠界站內付 2.0 或導轉）。
8. 每完成一頁，用瀏覽器在 1440 與 390 寬度與原型截圖並排比對，直到無差異。
9. 最後產出 .env.example（web / api 各一）與 README 的部署步驟。
```
