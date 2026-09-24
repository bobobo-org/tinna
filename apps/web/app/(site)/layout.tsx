import MobileCta from '@/components/MobileCta';
import { getServices, minPrice } from '@/lib/services';

/** 首頁／方案／老師／FAQ 共用：多一個手機浮動 CTA（/booking 不在這個 group，所以不會出現） */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const services = await getServices();
  return (
    <>
      {children}
      <MobileCta fromPrice={minPrice(services)} />
    </>
  );
}
