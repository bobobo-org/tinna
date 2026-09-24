-- 狀態轉換函式（0001 + 0002）：單一連線的情境
do $$
declare
  r jsonb; b1 uuid; b2 uuid; b3 uuid; b4 uuid; b5 uuid; b6 uuid; b7 uuid;
begin
  -- 付款成功＋冪等
  b1 := sqltest.mk_booking('YS2222222A', sqltest.day(10), 'pending_payment', now() + interval '15 minutes');
  perform sqltest.mk_payment(b1, 'T1');
  r := public.apply_payment_paid(p_provider => 'ecpay', p_trade_no => 'T1', p_amount => 3600,
         p_provider_txn_id => 'TN1', p_event => 'notify', p_raw => '{"RtnCode":"1"}');
  assert r->>'result' = 'confirmed', 'confirmed: ' || r::text;
  r := public.apply_payment_paid('ecpay', 'T1', 3600, 'TN1', 'result', '{}');
  assert r->>'result' = 'already_paid', 'already_paid: ' || r::text;
  assert (select raw ? 'notify' and raw ? 'result' from public.payments where provider_trade_no = 'T1'), 'raw keeps events';
  -- 晚到的失敗不能改掉 paid / confirmed
  r := public.mark_payment_failed(p_provider => 'ecpay', p_trade_no => 'T1', p_event => 'result', p_raw => '{}');
  assert r->>'result' = 'ignored', 'late failure: ' || r::text;
  assert (select status from public.bookings where id = b1) = 'confirmed';
  -- 同一筆預約第二次付款 → duplicate_payment
  perform sqltest.mk_payment(b1, 'T1b');
  r := public.apply_payment_paid('ecpay', 'T1b', 3600, 'TN1b', 'notify', '{}');
  assert r->>'reason' = 'duplicate_payment', 'duplicate: ' || r::text;
  raise notice 'PASS paid / idempotent / duplicate';

  -- 金額不符
  b2 := sqltest.mk_booking('YS2222222B', sqltest.day(11), 'pending_payment', now() + interval '15 minutes');
  perform sqltest.mk_payment(b2, 'T2');
  r := public.apply_payment_paid('ecpay', 'T2', 1, 'TN2', 'notify', '{}');
  assert r->>'result' = 'amount_mismatch', 'mismatch: ' || r::text;
  assert (select status from public.payments where provider_trade_no = 'T2') = 'init';
  raise notice 'PASS amount mismatch';

  -- 逾時後付款、時段被（有效的）別人預約占用 → 人工處理、不動別人
  b3 := sqltest.mk_booking('YS2222222C', sqltest.day(12), 'expired', now() - interval '1 minute');
  perform sqltest.mk_payment(b3, 'T3');
  b4 := sqltest.mk_booking('YS2222222D', sqltest.day(12), 'pending_payment', now() + interval '15 minutes');
  r := public.apply_payment_paid('ecpay', 'T3', 3600, 'TN3', 'notify', '{}');
  assert r->>'reason' = 'paid_after_expiry_slot_taken', 'slot taken: ' || r::text;
  assert (select status from public.bookings where id = b4) = 'pending_payment', 'other untouched';
  assert (select status from public.payments where provider_trade_no = 'T3') = 'paid';
  raise notice 'PASS paid after expiry, slot taken';

  -- 4. 逾時後付款、同時段只有「保留已過期但還沒掃」的預約 → 先釋出它再確認
  b5 := sqltest.mk_booking('YS2222222E', sqltest.day(13), 'expired', now() - interval '20 minutes');
  perform sqltest.mk_payment(b5, 'T5');
  b6 := sqltest.mk_booking('YS2222222F', sqltest.day(13), 'pending_payment', now() - interval '1 minute');
  r := public.apply_payment_paid('ecpay', 'T5', 3600, 'TN5', 'notify', '{}');
  assert r->>'result' = 'confirmed' and (r->>'reclaimed')::boolean, 'reclaim over stale: ' || r::text;
  assert (select status from public.bookings where id = b6) = 'expired', 'stale hold released';
  raise notice 'PASS reclaim releases stale hold';

  -- 1. 付款結果不明 → 標人工處理；之後成功 → 確認並清除暫時性標記；非暫時性原因保留
  b7 := sqltest.mk_booking('YS2222222G', sqltest.day(14), 'pending_payment', now() + interval '15 minutes');
  perform sqltest.mk_payment(b7, 'T7');
  r := public.flag_payment_attention(p_provider => 'ecpay', p_trade_no => 'T7', p_event => 'result',
         p_raw => '{"RtnCode":"10300066"}', p_reason => 'payment_pending_review');
  assert r->>'result' = 'flagged', 'flag: ' || r::text;
  assert (select needs_attention and attention_reason = 'payment_pending_review' from public.bookings where id = b7);
  assert (select status from public.payments where provider_trade_no = 'T7') = 'init', 'not failed';
  r := public.apply_payment_paid('ecpay', 'T7', 3600, 'TN7', 'notify', '{}');
  assert r->>'result' = 'confirmed', 'confirm after pending review: ' || r::text;
  assert (select not needs_attention and attention_reason is null from public.bookings where id = b7), 'transient cleared';
  r := public.flag_payment_attention('ecpay', 'T7', 'notify', '{}', 'payment_unknown_status');
  assert r->>'result' = 'ignored', 'flag after paid ignored: ' || r::text;
  update public.bookings set needs_attention = true, attention_reason = 'amount_mismatch' where id = b2;
  r := public.flag_payment_attention('ecpay', 'T2', 'result', '{}', 'payment_unknown_status');
  assert (select attention_reason from public.bookings where id = b2) = 'amount_mismatch', 'keeps stronger reason';
  raise notice 'PASS flag_payment_attention';

  -- 已退款不能被重送的回呼改回 paid
  update public.payments set status = 'refunded' where provider_trade_no = 'T1b';
  r := public.apply_payment_paid('ecpay', 'T1b', 3600, 'TN1b', 'result', '{}');
  assert r->>'result' in ('ignored', 'already_paid'), 'refunded: ' || r::text;
  assert (select status from public.payments where provider_trade_no = 'T1b') = 'refunded';
  raise notice 'PASS refunded not overridden';

  r := public.apply_payment_paid('ecpay', 'NOPE', 3600, null, 'notify', '{}');
  assert r->>'result' = 'not_found';
end $$;

-- ATM：取號後保留 = least(繳費期限, 開始前 24 小時)；過期重送不處理；逾時預約恢復前先釋出過期保留
do $$
declare r jsonb; a1 uuid; a2 uuid; a3 uuid;
begin
  a1 := sqltest.mk_booking('YS3333333A', sqltest.day(5, '10:00'), 'pending_payment', now() + interval '30 minutes', 'atm');
  perform sqltest.mk_payment(a1, 'A1', 3600, 'ecpay', 'atm');
  r := public.apply_atm_issued(p_trade_no => 'A1', p_amount => 3600, p_provider_txn_id => 'TNA1', p_bank_code => '822',
         p_account => '9103522175887271', p_expires_at => sqltest.day(6, '23:59'), p_event => 'atm_info', p_raw => '{}');
  assert r->>'result' = 'issued', 'issued: ' || r::text;
  assert (select hold_expires_at = sqltest.day(4, '10:00') and atm_expires_at = sqltest.day(4, '10:00')
            from public.bookings where id = a1), 'hold capped at starts_at - 24h';
  r := public.apply_atm_issued('A1', 3600, 'TNA1', '822', '9103522175887271', sqltest.day(6, '23:59'), 'atm_redirect', '{}');
  assert r->>'result' = 'already_issued', 'already_issued: ' || r::text;
  r := public.apply_payment_paid('ecpay', 'A1', 3600, 'TNA1', 'notify', '{}');
  assert r->>'result' = 'confirmed', 'atm paid: ' || r::text;
  raise notice 'PASS atm hold cap / idempotent';

  a2 := sqltest.mk_booking('YS3333333B', sqltest.day(8), 'expired', now() - interval '1 minute', 'atm',
                            3600, 'a2@example.com', '0900000002');
  perform sqltest.mk_payment(a2, 'A2', 3600, 'ecpay', 'atm');
  r := public.apply_atm_issued('A2', 3600, 'TNA2', '822', '9103522175880000', now() - interval '1 hour', 'atm_redirect', '{}');
  assert r->>'result' = 'ignored', 'replay after deadline: ' || r::text;
  assert (select status from public.bookings where id = a2) = 'expired';
  a3 := sqltest.mk_booking('YS3333333C', sqltest.day(8), 'pending_payment', now() - interval '1 minute',
                            'card', 3600, 'a3@example.com', '0900000003');
  r := public.apply_atm_issued('A2', 3600, 'TNA2', '822', '9103522175880000', now() + interval '1 day', 'atm_info', '{}');
  assert r->>'result' = 'issued', 're-issue over stale hold: ' || r::text;
  assert (select status from public.bookings where id = a3) = 'expired', 'stale hold released';
  raise notice 'PASS atm replay ignored / re-issue releases stale hold';
end $$;

-- create_booking：衝突、上限、同一人同時段取代
do $$
declare r jsonb; old uuid; n int;
begin
  r := sqltest.book('YS4444444A', sqltest.day(20), 'card', 'a@example.com', '0911111111');
  assert r->>'result' = 'created', 'create: ' || r::text;
  r := sqltest.book('YS4444444B', sqltest.day(20), 'card', 'b@example.com', '0922222222');
  assert r->>'result' = 'slot_taken', 'same slot: ' || r::text;
  r := sqltest.book('YS4444444C', sqltest.day(20) + interval '60 minutes', 'card', 'c@example.com', '0933333333', 30);
  assert r->>'result' = 'slot_taken', 'overlap: ' || r::text;
  r := sqltest.book('YS4444444A', sqltest.day(21), 'card', 'd@example.com', '0944444444');
  assert r->>'result' = 'order_no_taken', 'order no: ' || r::text;
  raise notice 'PASS create_booking conflicts';

  -- 同一 Email（大小寫、空白）最多 2 筆未付款
  r := sqltest.book('YS4444444D', sqltest.day(22), 'card', ' A@EXAMPLE.com', '0955555555');
  assert r->>'result' = 'created', 'second pending: ' || r::text;
  r := sqltest.book('YS4444444E', sqltest.day(23), 'card', 'a@example.com', '0966666666');
  assert r->>'result' = 'too_many_pending', 'email limit: ' || r::text;
  -- 同一電話（+886、分隔符號、括號）最多 2 筆未付款
  r := sqltest.book('YS4444444F', sqltest.day(24), 'card', 'p1@example.com', '0977-777-777');
  assert r->>'result' = 'created', 'phone 1: ' || r::text;
  r := sqltest.book('YS4444444H', sqltest.day(25), 'card', 'p2@example.com', '+886 977 777 777');
  assert r->>'result' = 'created', 'phone 2: ' || r::text;
  r := sqltest.book('YS4444444J', sqltest.day(26), 'card', 'p3@example.com', '(0977)777777');
  assert r->>'result' = 'too_many_pending', 'phone limit: ' || r::text;
  raise notice 'PASS too_many_pending';

  -- G. 同一人（Email 且電話）同一時段 → 取消舊的再建新單；取代發生在上限檢查之前（a@ 目前 2 筆未付款）
  r := sqltest.book('YS4444444G', sqltest.day(20), 'atm', 'a@example.com', '0911-111-111');
  assert r->>'result' = 'created' and (r->>'replaced')::int = 1, 'replace: ' || r::text;
  assert (select status from public.bookings where order_no = 'YS4444444A') = 'cancelled';
  -- 只有 Email 相同、電話不同 → 不算同一人 → slot_taken
  r := sqltest.book('YS4444444K', sqltest.day(20), 'card', 'a@example.com', '0900000000');
  assert r->>'result' in ('slot_taken', 'too_many_pending'), 'different phone not replaced: ' || r::text;
  assert (select status from public.bookings where order_no = 'YS4444444G') = 'pending_payment';
  -- 舊單有成功付款紀錄 → 不取消 → slot_taken
  old := sqltest.mk_booking('YS4444444N', sqltest.day(45), 'pending_payment', now() + interval '15 minutes',
                            'card', 3600, 'q@example.com', '0988888888');
  perform sqltest.mk_payment(old, 'PAIDL', 3600, 'ecpay', 'card', 'paid');
  r := sqltest.book('YS4444444M', sqltest.day(45), 'card', 'q@example.com', '0988888888');
  assert r->>'result' = 'slot_taken', 'paid old not cancelled: ' || r::text;
  assert (select status from public.bookings where id = old) = 'pending_payment';
  raise notice 'PASS replace own hold';

  -- 全站未付款 ATM 上限 5：補到 5 筆後，第 6 筆 ATM → atm_full
  select count(*) into n from public.bookings
   where hold_expires_at > now()
     and (status = 'awaiting_transfer' or (status = 'pending_payment' and pay_method = 'atm'));
  assert n between 1 and 4, 'unexpected unpaid atm count ' || n;
  for i in 1..(5 - n) loop
    r := sqltest.book('YS55555' || chr(64 + i) || 'AA', sqltest.day(30 + i), 'atm', 'atm' || i || '@example.com', '09800000' || (10 + i));
    assert r->>'result' = 'created', 'atm ' || i || ': ' || r::text;
  end loop;
  r := sqltest.book('YS55555EAA', sqltest.day(40), 'atm', 'atm9@example.com', '0980000099');
  assert r->>'result' = 'atm_full', 'atm cap: ' || r::text;
  r := sqltest.book('YS55555FAA', sqltest.day(40), 'card', 'atm9@example.com', '0980000099');
  assert r->>'result' = 'created', 'card still ok: ' || r::text;
  raise notice 'PASS atm cap';
end $$;

-- 0003（第二次審查）：建單失敗不可取消舊保留、付款層級的異常標記、ATM 恢復也守上限
do $$
declare r jsonb; b uuid; b2 uuid; x uuid;
begin
  -- 換成較長方案而跟別人重疊 → slot_taken，舊保留不變
  r := sqltest.book('YS8888888A', sqltest.day(70), 'card', 'r1@example.com', '0912121212', 30);
  assert r->>'result' = 'created', 'r1: ' || r::text;
  perform sqltest.mk_booking('YS8888888B', sqltest.day(70) + interval '60 minutes', 'confirmed', null,
                             'card', 3600, 'other@example.com', '0923232323');
  r := sqltest.book('YS8888888C', sqltest.day(70), 'card', 'r1@example.com', '0912121212', 90);
  assert r->>'result' = 'slot_taken', 'longer overlaps: ' || r::text;
  assert (select status from public.bookings where order_no = 'YS8888888A') = 'pending_payment', 'old hold kept (slot_taken)';

  -- 全站 ATM 已滿（上面 atm cap 區塊已補到 5 筆）時換 ATM → atm_full，舊保留不變
  r := sqltest.book('YS8888888D', sqltest.day(71), 'card', 'r2@example.com', '0934343434');
  assert r->>'result' = 'created', 'r2: ' || r::text;
  r := sqltest.book('YS8888888E', sqltest.day(71), 'atm', 'r2@example.com', '0934343434');
  assert r->>'result' = 'atm_full', 'atm full on replace: ' || r::text;
  assert (select status from public.bookings where order_no = 'YS8888888D') = 'pending_payment', 'old hold kept (atm_full)';
  raise notice 'PASS failed create_booking keeps old hold';

  -- 付款層級的標記：第一次 flagged、再來 already_flagged；另一次付款成功 → 確認但標記可能重複扣款
  b := sqltest.mk_booking('YS8888888F', sqltest.day(72), 'pending_payment', now() + interval '15 minutes');
  perform sqltest.mk_payment(b, 'F1');
  perform sqltest.mk_payment(b, 'F2');
  r := public.flag_payment_attention('ecpay', 'F1', 'result', '{}', 'payment_pending_review');
  assert r->>'result' = 'flagged', 'first flag: ' || r::text;
  r := public.flag_payment_attention('ecpay', 'F1', 'notify', '{}', 'payment_pending_review');
  assert r->>'result' = 'already_flagged', 'second flag: ' || r::text;
  r := public.apply_payment_paid('ecpay', 'F2', 3600, 'TNF2', 'notify', '{}');
  assert r->>'result' = 'confirmed' and (r->>'possible_duplicate')::boolean, 'possible duplicate: ' || r::text;
  assert (select needs_attention and attention_reason = 'possible_duplicate_payment' from public.bookings where id = b);

  -- 引起標記的付款確定失敗 → 解除標記
  b2 := sqltest.mk_booking('YS8888888G', sqltest.day(73), 'pending_payment', now() + interval '15 minutes');
  perform sqltest.mk_payment(b2, 'G1');
  r := public.flag_payment_attention('ecpay', 'G1', 'result', '{}', 'payment_unknown_status');
  r := public.mark_payment_failed('ecpay', 'G1', 'notify', '{"RtnCode":"10100248"}');
  assert r->>'result' = 'failed', 'failed: ' || r::text;
  assert (select not needs_attention and attention_reason is null from public.bookings where id = b2), 'flag cleared';
  assert (select attention_reason is null from public.payments where provider_trade_no = 'G1'), 'payment flag cleared';
  raise notice 'PASS payment-level attention';

  -- ATM 逾時後才取號：全站未付款 ATM 已滿 → limit_exceeded，不恢復
  x := sqltest.mk_booking('YS8888888H', sqltest.day(74), 'expired', now() - interval '1 minute', 'atm');
  perform sqltest.mk_payment(x, 'H1', 3600, 'ecpay', 'atm');
  r := public.apply_atm_issued('H1', 3600, 'TNH1', '822', '9103522175880009', now() + interval '1 day', 'atm_info', '{}');
  assert r->>'result' = 'limit_exceeded', 'reissue limit: ' || r::text;
  assert (select status from public.bookings where id = x) = 'expired';
  raise notice 'PASS atm re-issue respects limits';
end $$;

-- 約束
do $$
begin
  begin
    perform sqltest.mk_booking('YS6666666A', sqltest.day(50), 'confirmed', null);
    perform sqltest.mk_booking('YS6666666B', sqltest.day(50) + interval '30 minutes', 'pending_payment', now() + interval '1 hour');
    raise exception 'overlap allowed';
  exception when exclusion_violation or unique_violation then null;
  end;
  begin
    perform sqltest.mk_booking('YS0000000O', sqltest.day(51), 'pending_payment', now());
    raise exception 'bad order_no allowed';
  exception when check_violation then null;
  end;
  begin
    perform sqltest.mk_booking('YS6666666C', sqltest.day(52), 'pending_payment', null);
    raise exception 'pending without hold allowed';
  exception when check_violation then null;
  end;
  raise notice 'PASS constraints';
end $$;
