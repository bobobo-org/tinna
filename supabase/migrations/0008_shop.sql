-- =====================================================================
-- 0008：商店與 VIP 贈品
--
-- 商品、訂單、運費設定的資料表在 0007 已建立；這裡補上：
--   consume_order_stock：依訂單品項扣庫存（後台建立的贈品訂單不經過付款，建立後直接扣；不會扣成負數）
--   products 依排序讀取的索引
-- 商品圖片放在 Supabase Storage 的公開 bucket「products」，由 API 第一次上傳時建立（這裡不碰 storage schema）。
-- 0001～0007 不修改。
-- =====================================================================

create index if not exists products_sort on public.products (sort, created_at desc);

create function public.consume_order_stock(p_order_id uuid) returns void
language sql
security invoker
set search_path = ''
as $$
  update public.products p
     set stock = greatest(0, p.stock - i.qty)
    from public.order_items i
   where i.order_id = p_order_id
     and i.product_id = p.id;
$$;

revoke all on function public.consume_order_stock(uuid) from public, anon, authenticated;
grant execute on function public.consume_order_stock(uuid) to service_role;
