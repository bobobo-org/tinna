/**
 * 換頁轉場：template 每次換頁都會重新掛載，內容淡入（globals.css 的 .page-enter）
 * 只動 opacity：頁面裡有 position:fixed 的元件（手機浮動 CTA、預約底部列），用 transform 會讓它們在動畫期間跑位
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter flex flex-col">{children}</div>;
}
