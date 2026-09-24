-- 0007：VIP 購買付款（apply_order_paid）、商店扣庫存、VIP 用堂數預約（create_vip_booking）
-- 時間用凌晨（06:00 起）避免和前面測試佈置的預約重疊（時段表只在 API 檢查，SQL 函式不管）

do $$
declare
  v_order  uuid;
  v_member public.vip_members%rowtype;
  r        jsonb;
begin
  insert into public.orders (order_no, kind, status, subtotal, amount, customer_name, email, phone, vip_plan_id, hold_expires_at)
  values ('YSVVVVVVV2', 'vip', 'pending_payment', 18000, 18000, 'V', 'Vip@Example.com', '0912345678', 'vip-4', now() + interval '30 minutes')
  returning id into v_order;
  insert into public.order_payments (order_id, trade_no, amount) values (v_order, 'TVIP1', 18000);

  r := public.apply_order_paid('TVIP1', 17000, 't1', '{}'::jsonb, 'VIP-AAAA-BBBB');
  assert r->>'result' = 'amount_mismatch', 'vip amount mismatch: ' || r::text;
  assert (select status from public.orders where id = v_order) = 'pending_payment', 'mismatch keeps order pending';

  r := public.apply_order_paid('TVIP1', 18000, 't1', '{}'::jsonb, 'VIP-AAAA-BBBB');
  assert r->>'result' = 'paid' and r->>'card_no' = 'VIP-AAAA-BBBB' and r->>'kind' = 'vip', 'vip paid: ' || r::text;
  r := public.apply_order_paid('TVIP1', 18000, 't1', '{}'::jsonb, 'VIP-CCCC-DDDD');
  assert r->>'result' = 'already_paid', 'vip notify again: ' || r::text;

  select * into v_member from public.vip_members where order_id = v_order;
  assert v_member.card_no = 'VIP-AAAA-BBBB' and v_member.sessions_total = 4 and v_member.sessions_used = 0, 'vip member created';
  assert v_member.email_norm = 'vip@example.com', 'email normalized';
  assert v_member.expires_at > now() + interval '364 days', 'vip valid for a year';
  assert (select status from public.orders where id = v_order) = 'paid', 'order paid';
  assert (select vip_member_id from public.orders where id = v_order) = v_member.id, 'order linked to member';

  -- 同一筆訂單另一次付款也成功（可能重複扣款）→ 不再建立會員
  insert into public.order_payments (order_id, trade_no, amount) values (v_order, 'TVIP2', 18000);
  r := public.apply_order_paid('TVIP2', 18000, 't2', '{}'::jsonb, 'VIP-EEEE-FFFF');
  assert r->>'result' = 'duplicate_payment', 'vip duplicate payment: ' || r::text;
  assert (select count(*) from public.vip_members where order_id = v_order) = 1, 'still one member';

  assert public.apply_order_paid('NOPE', 1, null, '{}'::jsonb, 'VIP-GGGG-HHHH')->>'result' = 'not_found', 'unknown trade';
  raise notice 'PASS apply_order_paid (vip)';
end $$;

do $$
declare
  v_product uuid;
  v_order   uuid;
  r         jsonb;
begin
  insert into public.products (slug, name, price, stock) values ('sqltest-amulet', '護身符', 800, 5) returning id into v_product;
  insert into public.orders (order_no, kind, status, subtotal, shipping_fee, amount, customer_name, email, phone,
                             ship_name, ship_phone, ship_address, hold_expires_at)
  values ('YSSSSSSSS2', 'shop', 'pending_payment', 1600, 100, 1700, 'S', 's@example.com', '0912345678',
          'S', '0912345678', '台北市信義區松仁路 1 號', now() - interval '1 minute')
  returning id into v_order;
  insert into public.order_items (order_id, product_id, name, unit_price, qty) values (v_order, v_product, '護身符', 800, 2);
  insert into public.order_payments (order_id, trade_no, amount) values (v_order, 'TSHOP1', 1700);

  -- 保留已過期才付款：一樣接受（客人已經付錢）
  r := public.apply_order_paid('TSHOP1', 1700, 't', '{}'::jsonb, 'VIP-JJJJ-KKKK');
  assert r->>'result' = 'paid' and r->>'kind' = 'shop', 'shop paid: ' || r::text;
  assert (select stock from public.products where id = v_product) = 3, 'stock decremented';
  assert (select status from public.orders where id = v_order) = 'paid', 'shop order paid';
  assert not exists (select 1 from public.vip_members where card_no = 'VIP-JJJJ-KKKK'), 'no member for shop order';
  raise notice 'PASS apply_order_paid (shop)';
end $$;

do $$
declare
  v_member  uuid;
  v_booking public.bookings%rowtype;
  v_start   timestamptz := sqltest.day(40, '06:00');
  r         jsonb;
begin
  select id into v_member from public.vip_members where card_no = 'VIP-AAAA-BBBB';

  -- Email 對不上 → 視同找不到
  r := public.create_vip_booking('YSVB222222', 'vip', v_start, v_start + interval '90 minutes', 'VIP-AAAA-BBBB',
         'V', 'female', '1990-01-01', null, null, '0912345678', 'other@example.com', null);
  assert r->>'result' = 'vip_not_found', 'email mismatch: ' || r::text;

  -- 卡號小寫、Email 大小寫不同也可以
  r := public.create_vip_booking('YSVB222222', 'vip', v_start, v_start + interval '90 minutes', 'vip-aaaa-bbbb',
         'V', 'female', '1990-01-01', null, null, '0912345678', ' VIP@example.com ', '問題');
  assert r->>'result' = 'created' and (r->>'sessions_left')::int = 3, 'vip booking created: ' || r::text;
  select * into v_booking from public.bookings where order_no = 'YSVB222222';
  assert v_booking.status = 'confirmed' and v_booking.pay_method = 'vip' and v_booking.vip_member_id = v_member, 'vip booking row';
  assert v_booking.amount = 4500 and v_booking.hold_expires_at is null and v_booking.confirmed_at is not null, 'vip booking amount/hold';
  assert (select sessions_used from public.vip_members where id = v_member) = 1, 'one session used';

  -- 同時段 → slot_taken，不扣堂數
  r := public.create_vip_booking('YSVB333333', 'vip', v_start, v_start + interval '90 minutes', 'VIP-AAAA-BBBB',
         'V', 'female', '1990-01-01', null, null, '0912345678', 'vip@example.com', null);
  assert r->>'result' = 'slot_taken', 'slot taken: ' || r::text;
  assert (select sessions_used from public.vip_members where id = v_member) = 1, 'not deducted on conflict';

  -- 堂數用完
  update public.vip_members set sessions_used = sessions_total where id = v_member;
  r := public.create_vip_booking('YSVB444444', 'vip', v_start + interval '1 day', v_start + interval '1 day 90 minutes', 'VIP-AAAA-BBBB',
         'V', 'female', '1990-01-01', null, null, '0912345678', 'vip@example.com', null);
  assert r->>'result' = 'vip_no_sessions', 'no sessions: ' || r::text;

  -- 過期
  update public.vip_members set sessions_used = 1, expires_at = now() - interval '1 day' where id = v_member;
  r := public.create_vip_booking('YSVB555555', 'vip', v_start + interval '2 days', v_start + interval '2 days 90 minutes', 'VIP-AAAA-BBBB',
         'V', 'female', '1990-01-01', null, null, '0912345678', 'vip@example.com', null);
  assert r->>'result' = 'vip_expired', 'expired: ' || r::text;
  raise notice 'PASS create_vip_booking';
end $$;
