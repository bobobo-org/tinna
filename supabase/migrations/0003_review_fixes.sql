-- =====================================================================
-- 0003：第二次獨立審查的修正
-- 0001、0002 不修改（0002 已套到本機測試庫）；本檔新增欄位，並以 CREATE OR REPLACE 取代函式
-- （參數與回傳型別 jsonb 都與原本相同，既有權限保留，檔尾仍再明確設定一次）。
--
-- 暫時性的異常原因（付款結果不明，之後有結果就能自動解除）：
--   payment_pending_review（綠界 10300066）、payment_unknown_status（綠界不認得的代碼）、
--   linepay_confirm_unknown（LINE Pay Confirm 結果不明）
-- =====================================================================

-- ---------------------------------------------------------------------
-- 付款層級的異常標記：哪一次付款引起的標記，就由那一次付款的結果解除；
-- 同一預約還有結果不明的付款時，API 不再開新的付款（409 payment_under_review），避免重複扣款
-- ---------------------------------------------------------------------
alter table public.payments add column attention_reason text;

-- ---------------------------------------------------------------------
-- create_booking：先做完所有檢查（計數時排除這次會被取代的舊保留），
-- 「取消舊保留＋新增」放在同一個子交易，任何衝突都整段回滾 → 建單失敗時舊保留不會被取消
-- ---------------------------------------------------------------------
create or replace function public.create_booking(
  p_order_no                 text,
  p_service_id               text,
  p_starts_at                timestamptz,
  p_ends_at                  timestamptz,
  p_pay_method               text,
  p_amount                   integer,
  p_hold_expires_at          timestamptz,
  p_customer_name            text,
  p_gender                   text,
  p_birth_date               date,
  p_birth_time               time,
  p_birth_place              text,
  p_phone                    text,
  p_email                    text,
  p_questions                text,
  p_max_pending_per_customer integer,
  p_max_pending_atm          integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email      text := lower(btrim(p_email));
  v_phone      text := public.normalize_phone(p_phone);
  v_count      integer;
  v_replaced   integer := 0;
  v_id         uuid;
  v_constraint text;
begin
  perform pg_advisory_xact_lock(727260001);
  perform public.expire_stale_holds(p_starts_at, p_ends_at);

  -- 同一人（Email 且電話）同一時段、沒有成功付款紀錄的未付款保留 → 這次會被取代，不列入上限計數
  select count(*) into v_count
    from public.bookings b
   where b.status in ('pending_payment', 'awaiting_transfer')
     and b.hold_expires_at > now()
     and (b.email_norm = v_email or b.phone_norm = v_phone)
     and not (b.starts_at = p_starts_at and b.email_norm = v_email and b.phone_norm = v_phone
              and not exists (select 1 from public.payments p where p.booking_id = b.id and p.status = 'paid'));
  if v_count >= p_max_pending_per_customer then
    return jsonb_build_object('result', 'too_many_pending');
  end if;

  if p_pay_method = 'atm' then
    select count(*) into v_count
      from public.bookings b
     where b.hold_expires_at > now()
       and (b.status = 'awaiting_transfer' or (b.status = 'pending_payment' and b.pay_method = 'atm'))
       and not (b.starts_at = p_starts_at and b.email_norm = v_email and b.phone_norm = v_phone
                and not exists (select 1 from public.payments p where p.booking_id = b.id and p.status = 'paid'));
    if v_count >= p_max_pending_atm then
      return jsonb_build_object('result', 'atm_full');
    end if;
  end if;

  begin
    update public.bookings b
       set status = 'cancelled'
     where b.status in ('pending_payment', 'awaiting_transfer')
       and b.starts_at = p_starts_at
       and b.email_norm = v_email
       and b.phone_norm = v_phone
       and not exists (select 1 from public.payments p where p.booking_id = b.id and p.status = 'paid');
    get diagnostics v_replaced = row_count;

    insert into public.bookings (
      order_no, service_id, starts_at, ends_at, status, pay_method, amount, hold_expires_at,
      customer_name, gender, birth_date, birth_time, birth_place, phone, email, questions
    ) values (
      p_order_no, p_service_id, p_starts_at, p_ends_at, 'pending_payment', p_pay_method::public.pay_method,
      p_amount, p_hold_expires_at, p_customer_name, p_gender, p_birth_date, p_birth_time, p_birth_place,
      p_phone, p_email, p_questions
    )
    returning id into v_id;
  exception
    -- 例外會回滾整個 begin 區塊（包含上面的取消），舊保留維持原狀
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'bookings_order_no_unique' then
        return jsonb_build_object('result', 'order_no_taken');
      end if;
      return jsonb_build_object('result', 'slot_taken');
    when exclusion_violation then
      return jsonb_build_object('result', 'slot_taken');
  end;

  return jsonb_build_object('result', 'created', 'id', v_id, 'replaced', v_replaced);
end;
$$;

-- ---------------------------------------------------------------------
-- flag_payment_attention：標在付款上＋預約上。第一次標記回 flagged；已標記過回 already_flagged（避免重複通知）
-- ---------------------------------------------------------------------
create or replace function public.flag_payment_attention(
  p_provider text,
  p_trade_no text,
  p_event    text,
  p_raw      jsonb,
  p_reason   text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pay       public.payments%rowtype;
  v_bk        public.bookings%rowtype;
  v_transient text[] := array['payment_pending_review', 'payment_unknown_status', 'linepay_confirm_unknown'];
begin
  select * into v_pay
    from public.payments
   where provider = p_provider and provider_trade_no = p_trade_no
   for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into v_bk from public.bookings where id = v_pay.booking_id for update;

  update public.payments
     set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(p_event, coalesce(p_raw, '{}'::jsonb))
   where id = v_pay.id;

  if v_pay.status <> 'init' then
    return jsonb_build_object('result', 'ignored', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', v_bk.status);
  end if;

  update public.payments set attention_reason = coalesce(attention_reason, p_reason) where id = v_pay.id;

  update public.bookings
     set needs_attention = true,
         attention_reason = case
           when needs_attention and attention_reason is not null and not (attention_reason = any(v_transient))
             then attention_reason
           else p_reason
         end
   where id = v_bk.id;

  return jsonb_build_object('result', case when v_pay.attention_reason is null then 'flagged' else 'already_flagged' end,
                            'booking_id', v_bk.id, 'order_no', v_bk.order_no, 'booking_status', v_bk.status);
end;
$$;

-- ---------------------------------------------------------------------
-- apply_payment_paid：付款成功時解除「這次付款」的標記；
-- 同一預約還有其他結果不明的付款 → 預約照樣確認，但保持人工處理（possible_duplicate_payment，可能重複扣款）
-- 其餘同 0002（補確認前先釋出同時段過期保留）
-- ---------------------------------------------------------------------
create or replace function public.apply_payment_paid(
  p_provider        text,
  p_trade_no        text,
  p_amount          integer,
  p_provider_txn_id text,
  p_event           text,
  p_raw             jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pay       public.payments%rowtype;
  v_bk        public.bookings%rowtype;
  v_reason    text;
  v_other     boolean;
  v_transient text[] := array['payment_pending_review', 'payment_unknown_status', 'linepay_confirm_unknown'];
begin
  select * into v_pay
    from public.payments
   where provider = p_provider and provider_trade_no = p_trade_no
   for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into v_bk from public.bookings where id = v_pay.booking_id for update;

  update public.payments
     set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(p_event, coalesce(p_raw, '{}'::jsonb)),
         provider_txn_id = coalesce(provider_txn_id, p_provider_txn_id)
   where id = v_pay.id;

  if v_pay.status = 'paid' then
    return jsonb_build_object('result', 'already_paid', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', v_bk.status);
  end if;

  if v_pay.status = 'refunded' then
    return jsonb_build_object('result', 'ignored', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', v_bk.status);
  end if;

  if p_amount is distinct from v_pay.amount or v_pay.amount <> v_bk.amount then
    update public.bookings
       set needs_attention = true, attention_reason = 'amount_mismatch'
     where id = v_bk.id;
    return jsonb_build_object('result', 'amount_mismatch', 'reason', 'amount_mismatch',
                              'booking_id', v_bk.id, 'order_no', v_bk.order_no,
                              'booking_status', v_bk.status);
  end if;

  update public.payments set status = 'paid', paid_at = now(), attention_reason = null where id = v_pay.id;

  v_other := exists (
    select 1 from public.payments p
     where p.booking_id = v_bk.id and p.id <> v_pay.id and p.status = 'init' and p.attention_reason is not null
  );

  if v_bk.status in ('pending_payment', 'awaiting_transfer') then
    if v_bk.starts_at <= now() then
      update public.bookings
         set status = 'confirmed', confirmed_at = now(), hold_expires_at = null,
             needs_attention = true, attention_reason = 'paid_after_start'
       where id = v_bk.id;
      return jsonb_build_object('result', 'needs_attention', 'reason', 'paid_after_start',
                                'booking_id', v_bk.id, 'order_no', v_bk.order_no,
                                'booking_status', 'confirmed');
    end if;
    update public.bookings
       set status = 'confirmed', confirmed_at = now(), hold_expires_at = null,
           needs_attention = case when v_other then true
                                  when attention_reason = any(v_transient) then false
                                  else needs_attention end,
           attention_reason = case when v_other and (attention_reason is null or attention_reason = any(v_transient))
                                     then 'possible_duplicate_payment'
                                   when attention_reason = any(v_transient) then null
                                   else attention_reason end
     where id = v_bk.id;
    return jsonb_build_object('result', 'confirmed', 'possible_duplicate', v_other, 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', 'confirmed');
  end if;

  if v_bk.status = 'expired' and v_bk.starts_at > now() then
    perform public.expire_stale_holds(v_bk.starts_at, v_bk.ends_at);
    begin
      update public.bookings
         set status = 'confirmed', confirmed_at = now(), hold_expires_at = null,
             needs_attention = case when v_other then true
                                    when attention_reason = any(v_transient) then false
                                    else needs_attention end,
             attention_reason = case when v_other and (attention_reason is null or attention_reason = any(v_transient))
                                       then 'possible_duplicate_payment'
                                     when attention_reason = any(v_transient) then null
                                     else attention_reason end
       where id = v_bk.id;
      return jsonb_build_object('result', 'confirmed', 'reclaimed', true, 'possible_duplicate', v_other,
                                'booking_id', v_bk.id, 'order_no', v_bk.order_no, 'booking_status', 'confirmed');
    exception when unique_violation or exclusion_violation then
      update public.bookings
         set needs_attention = true, attention_reason = 'paid_after_expiry_slot_taken'
       where id = v_bk.id;
      return jsonb_build_object('result', 'needs_attention', 'reason', 'paid_after_expiry_slot_taken',
                                'booking_id', v_bk.id, 'order_no', v_bk.order_no,
                                'booking_status', v_bk.status);
    end;
  end if;

  v_reason := case v_bk.status
    when 'confirmed' then 'duplicate_payment'
    when 'expired'   then 'paid_after_expiry_past'
    when 'cancelled' then 'paid_after_cancel'
    else 'paid_after_refund'
  end;
  update public.bookings
     set needs_attention = true, attention_reason = v_reason
   where id = v_bk.id;
  return jsonb_build_object('result', 'needs_attention', 'reason', v_reason, 'booking_id', v_bk.id,
                            'order_no', v_bk.order_no, 'booking_status', v_bk.status);
end;
$$;

-- ---------------------------------------------------------------------
-- mark_payment_failed：引起標記的付款確定失敗 → 解除它的標記；
-- 同一預約沒有其他結果不明的付款時，預約的暫時性標記也解除（可以重新付款）
-- ---------------------------------------------------------------------
create or replace function public.mark_payment_failed(
  p_provider text,
  p_trade_no text,
  p_event    text,
  p_raw      jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pay       public.payments%rowtype;
  v_order     text;
  v_transient text[] := array['payment_pending_review', 'payment_unknown_status', 'linepay_confirm_unknown'];
begin
  select * into v_pay
    from public.payments
   where provider = p_provider and provider_trade_no = p_trade_no
   for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  update public.payments
     set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(p_event, coalesce(p_raw, '{}'::jsonb)),
         status = case when status = 'init' then 'failed' else status end,
         attention_reason = case when status = 'init' then null else attention_reason end
   where id = v_pay.id;

  if v_pay.status = 'init' and v_pay.attention_reason is not null
     and not exists (
       select 1 from public.payments p
        where p.booking_id = v_pay.booking_id and p.id <> v_pay.id and p.status = 'init' and p.attention_reason is not null
     ) then
    update public.bookings
       set needs_attention = false, attention_reason = null
     where id = v_pay.booking_id and attention_reason = any(v_transient);
  end if;

  select order_no into v_order from public.bookings where id = v_pay.booking_id;
  return jsonb_build_object('result', case when v_pay.status = 'init' then 'failed' else 'ignored' end,
                            'booking_id', v_pay.booking_id, 'order_no', v_order);
end;
$$;

-- ---------------------------------------------------------------------
-- apply_atm_issued：逾時預約恢復待轉帳時，也拿建單鎖並守與 create_booking 相同的上限
-- （同一顧客 2 筆、全站未付款 ATM 5 筆；需與 apps/api/src/lib/policy.ts 一致，test/policy-sync.test.ts 會檢查）
-- 其餘同 0002
-- ---------------------------------------------------------------------
create or replace function public.apply_atm_issued(
  p_trade_no        text,
  p_amount          integer,
  p_provider_txn_id text,
  p_bank_code       text,
  p_account         text,
  p_expires_at      timestamptz,
  p_event           text,
  p_raw             jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pay  public.payments%rowtype;
  v_bk   public.bookings%rowtype;
  v_hold timestamptz;
begin
  select * into v_pay
    from public.payments
   where provider = 'ecpay' and provider_trade_no = p_trade_no
   for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into v_bk from public.bookings where id = v_pay.booking_id for update;

  update public.payments
     set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(p_event, coalesce(p_raw, '{}'::jsonb)),
         provider_txn_id = coalesce(provider_txn_id, p_provider_txn_id)
   where id = v_pay.id;

  if v_pay.status <> 'init' then
    return jsonb_build_object('result', 'ignored', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', v_bk.status);
  end if;

  if p_amount is distinct from v_pay.amount then
    update public.bookings
       set needs_attention = true, attention_reason = 'amount_mismatch'
     where id = v_bk.id;
    return jsonb_build_object('result', 'amount_mismatch', 'reason', 'amount_mismatch',
                              'booking_id', v_bk.id, 'order_no', v_bk.order_no,
                              'booking_status', v_bk.status);
  end if;

  v_hold := least(p_expires_at, v_bk.starts_at - interval '24 hours');
  if v_hold <= now() then
    return jsonb_build_object('result', 'ignored', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', v_bk.status);
  end if;

  if v_bk.status = 'awaiting_transfer' and v_bk.atm_account is not distinct from p_account then
    return jsonb_build_object('result', 'already_issued', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', v_bk.status);
  end if;

  if v_bk.status in ('pending_payment', 'awaiting_transfer')
     or (v_bk.status = 'expired' and v_bk.starts_at > now()) then
    if v_bk.status = 'expired' then
      -- 逾時預約恢復 = 新增一筆未付款保留：跟 create_booking 一樣序列化並守上限
      perform pg_advisory_xact_lock(727260001);
      perform public.expire_stale_holds(v_bk.starts_at, v_bk.ends_at);
      if (select count(*) from public.bookings b
           where b.id <> v_bk.id
             and b.status in ('pending_payment', 'awaiting_transfer')
             and b.hold_expires_at > now()
             and (b.email_norm = v_bk.email_norm or b.phone_norm = v_bk.phone_norm)) >= 2
         or (select count(*) from public.bookings b
              where b.id <> v_bk.id
                and b.hold_expires_at > now()
                and (b.status = 'awaiting_transfer' or (b.status = 'pending_payment' and b.pay_method = 'atm'))) >= 5 then
        return jsonb_build_object('result', 'limit_exceeded', 'booking_id', v_bk.id,
                                  'order_no', v_bk.order_no, 'booking_status', v_bk.status);
      end if;
    end if;
    begin
      update public.bookings
         set status = 'awaiting_transfer',
             atm_bank_code = p_bank_code,
             atm_account = p_account,
             atm_expires_at = v_hold,
             hold_expires_at = v_hold,
             transfer_info_sent_at = null
       where id = v_bk.id;
      return jsonb_build_object('result', 'issued', 'booking_id', v_bk.id,
                                'order_no', v_bk.order_no, 'booking_status', 'awaiting_transfer');
    exception when unique_violation or exclusion_violation then
      return jsonb_build_object('result', 'slot_taken', 'booking_id', v_bk.id,
                                'order_no', v_bk.order_no, 'booking_status', v_bk.status);
    end;
  end if;

  return jsonb_build_object('result', 'ignored', 'booking_id', v_bk.id,
                            'order_no', v_bk.order_no, 'booking_status', v_bk.status);
end;
$$;

-- ---------------------------------------------------------------------
-- 函式權限（明確設定一次）
-- ---------------------------------------------------------------------
revoke execute on function public.create_booking(text, text, timestamptz, timestamptz, text, integer, timestamptz,
  text, text, date, time, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.flag_payment_attention(text, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.apply_payment_paid(text, text, integer, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.mark_payment_failed(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_atm_issued(text, integer, text, text, text, timestamptz, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.create_booking(text, text, timestamptz, timestamptz, text, integer, timestamptz,
  text, text, date, time, text, text, text, text, integer, integer) to service_role;
grant execute on function public.flag_payment_attention(text, text, text, jsonb, text) to service_role;
grant execute on function public.apply_payment_paid(text, text, integer, text, text, jsonb) to service_role;
grant execute on function public.mark_payment_failed(text, text, text, jsonb) to service_role;
grant execute on function public.apply_atm_issued(text, integer, text, text, text, timestamptz, text, jsonb)
  to service_role;
