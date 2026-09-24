import OrderResult from '@/components/orders/OrderResult';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata({
  title: '訂單狀態',
  description: 'VIP 包堂與商店訂單的付款狀態。',
  path: '/orders',
  noindex: true,
});

/**
 * VIP／商店訂單頁：綠界付款後由 API 303 導回 /orders/<訂單編號>（按「返回商店」也回到這裡）
 * 訂單狀態在瀏覽器端查 GET /orders/:orderNo（付款確認中要輪詢）
 */
export default async function OrderPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  // 訂單編號只有英數字：格式不對由 OrderResult 顯示「找不到這筆訂單」
  return <OrderResult key={orderNo} orderNo={orderNo} />;
}
