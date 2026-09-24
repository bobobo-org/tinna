import CartCheckout from '@/components/shop/CartCheckout';
import { pageMetadata } from '@/lib/metadata';
import { getCatalog } from '@/lib/shop';

export const metadata = pageMetadata({
  title: '購物車',
  description: '確認購物車商品、填寫收件資料並以信用卡付款。',
  path: '/shop/cart',
  noindex: true,
});

/** 購物車＋結帳：每次都讀最新的價格與庫存（下單時 API 還會再檢查一次） */
export default async function CartPage() {
  const catalog = await getCatalog({ fresh: true });
  return <CartCheckout catalog={catalog} />;
}
