import { jsonLdString } from '@/lib/structured-data';

/** 結構化資料（schema.org JSON-LD）；Server Component，直接輸出在 HTML 裡給搜尋引擎讀 */
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
