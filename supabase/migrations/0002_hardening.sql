-- =====================================================================
-- 0002：金流與資料層安全強化（兩份獨立審查的修正）
-- 0001 已套用到正式資料庫，不可修改；本檔只新增物件或以 CREATE OR REPLACE 取代函式
-- （簽章與回傳型別 jsonb 不變，既有 grant/revoke 會保留，下方仍再明確設定一次）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- D. 預設權限：之後由 postgres 在 public 新建的資料表／序列／函式，
--    不再自動開放給 anon / authenticated；新函式也不再預設 execute 給 PUBLIC。
--    （函式的 PUBLIC execute 是全域預設，只在 schema 層級 revoke 無效，必須用不帶 IN SCHEMA 的全域設定）
-- ---------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- ---------------------------------------------------------------------
-- A. 同一顧客（Email／電話正規化後）未付款保留上限：正規化欄位
--    電話：只留數字；+886 開頭改回 0 開頭（+886 912-345-678 → 0912345678）
-- ---------------------------------------------------------------------
create function public.normalize_phone(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when d ~ '^886[0-9]{8,9}$' then '0' || substr(d, 4) else d end
    from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) s;
$$;

revoke execute on function public.normalize_phone(text) from public, anon, authenticated;
grant execute on function public.normalize_phone(text) to service_role;

alter table public.bookings
  add column email_norm text generated always as (lower(btrim(email))) stored,
  add column phone_norm text generated always as (public.normalize_phone(phone)) stored;

create index bookings_unpaid_email_idx on public.bookings (email_norm)
  where status in ('pending_payment', 'awaiting_transfer');
create index bookings_unpaid_phone_idx on public.bookings (phone_norm)
  where status in ('pending_payment', 'awaiting_transfer');

-- ---------------------------------------------------------------------
-- A + G. 建立預約（取代 API 直接 insert）
-- 以交易層級 advisory lock 把所有建單序列化（單一老師的行事曆，量很小），
-- 所以「同一顧客最多 N 筆未付款」「全站未付款 ATM 上限」與時段衝突都在同一把鎖內判斷，併發也繞不過。
-- G：同一 Email 且同一電話（正規化後）在「同一時段」已有自己的未付款保留 → 同一交易內先取消舊的再建新單
--    （例如從綠界返回後想換付款方式或改資料）；舊單已有付款成功紀錄則不取消。
--    取消與新增在同一交易內，其他人看得到的只有「舊保留」或「新預約」，時段不會空出來被搶走。
-- 回傳 jsonb：result = created | slot_taken | order_no_taken | too_many_pending | atm_full，created 時附 replaced 筆數
-- ---------------------------------------------------------------------
create function public.create_booking(
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
  -- 固定鍵值（'YS' 建單鎖）；交易結束自動釋放
  perform pg_advisory_xact_lock(727260001);

  -- 先釋出與新時段重疊、保留已過期但背景工作還沒掃的預約
  perform public.expire_stale_holds(p_starts_at, p_ends_at);

  -- G. 同一人（Email 且電話）在同一時段的舊未付款保留 → 取消（沒有成功付款紀錄的才可以）
  update public.bookings b
     set status = 'cancelled'
   where b.status in ('pending_payment', 'awaiting_transfer')
     and b.starts_at = p_starts_at
     and b.email_norm = v_email
     and b.phone_norm = v_phone
     and not exists (select 1 from public.payments p where p.booking_id = b.id and p.status = 'paid');
  get diagnostics v_replaced = row_count;

  select count(*) into v_count
    from public.bookings
   where status in ('pending_payment', 'awaiting_transfer')
     and hold_expires_at > now()
     and (email_norm = v_email or phone_norm = v_phone);
  if v_count >= p_max_pending_per_customer then
    return jsonb_build_object('result', 'too_many_pending');
  end if;

  if p_pay_method = 'atm' then
    select count(*) into v_count
      from public.bookings
     where hold_expires_at > now()
       and (status = 'awaiting_transfer' or (status = 'pending_payment' and pay_method = 'atm'));
    if v_count >= p_max_pending_atm then
      return jsonb_build_object('result', 'atm_full');
    end if;
  end if;

  begin
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
-- 1. 付款結果不明（綠界 10300066「交易付款結果待確認中」或不認得的代碼）：
--    不把付款標成 failed，只把預約標記需人工處理（付款已是 paid/failed 時不動）。
--    已有非暫時性的異常原因（例如金額不符）時保留原因。
-- 回傳 jsonb：result = not_found | ignored | flagged
-- ---------------------------------------------------------------------
create function public.flag_payment_attention(
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
  v_pay public.payments%rowtype;
  v_bk  public.bookings%rowtype;
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

  update public.bookings
     set needs_attention = true,
         attention_reason = case
           when needs_attention and attention_reason is not null
                and attention_reason not in ('payment_pending_review', 'payment_unknown_status')
             then attention_reason
           else p_reason
         end
   where id = v_bk.id;

  return jsonb_build_object('result', 'flagged', 'booking_id', v_bk.id,
                            'order_no', v_bk.order_no, 'booking_status', v_bk.status);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. 付款成功：補確認（expired → confirmed）前先釋出同時段「保留已過期但還沒掃」的預約；
--    確認時清除暫時性的異常標記（payment_pending_review / payment_unknown_status）。
--    其餘邏輯與 0001 相同。
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
  v_pay    public.payments%rowtype;
  v_bk     public.bookings%rowtype;
  v_reason text;
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

  -- 已退款的付款：重送的舊回呼不可再改回 paid
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

  update public.payments set status = 'paid', paid_at = now() where id = v_pay.id;

  if v_bk.status in ('pending_payment', 'awaiting_transfer') then
    if v_bk.starts_at <= now() then
      -- 諮詢時間已過才入帳
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
           needs_attention = case when attention_reason in ('payment_pending_review', 'payment_unknown_status')
                                  then false else needs_attention end,
           attention_reason = case when attention_reason in ('payment_pending_review', 'payment_unknown_status')
                                   then null else attention_reason end
     where id = v_bk.id;
    return jsonb_build_object('result', 'confirmed', 'booking_id', v_bk.id,
                              'order_no', v_bk.order_no, 'booking_status', 'confirmed');
  end if;

  if v_bk.status = 'expired' and v_bk.starts_at > now() then
    -- 保留逾時後才付款成功：先釋出同時段已過期但還沒掃的保留，時段沒被別人占用就直接確認
    perform public.expire_stale_holds(v_bk.starts_at, v_bk.ends_at);
    begin
      update public.bookings
         set status = 'confirmed', confirmed_at = now(), hold_expires_at = null,
             needs_attention = case when attention_reason in ('payment_pending_review', 'payment_unknown_status')
                                    then false else needs_attention end,
             attention_reason = case when attention_reason in ('payment_pending_review', 'payment_unknown_status')
                                     then null else attention_reason end
       where id = v_bk.id;
      return jsonb_build_object('result', 'confirmed', 'reclaimed', true, 'booking_id', v_bk.id,
                                'order_no', v_bk.order_no, 'booking_status', 'confirmed');
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
-- A + 4. ATM 取號成功：
--   保留期限改為 least(綠界繳費期限, 諮詢開始前 24 小時)，atm_expires_at 同值（對顧客顯示的期限）；
--   逾時預約恢復待轉帳前，先釋出同時段「保留已過期但還沒掃」的預約。其餘同 0001。
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

  -- 繳費期限已過（例如重送舊的取號結果），或離諮詢開始不到 24 小時 → 不處理
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
      perform public.expire_stale_holds(v_bk.starts_at, v_bk.ends_at);
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
-- 函式權限（明確設定；CREATE OR REPLACE 會保留原本的，這裡再設一次）
-- ---------------------------------------------------------------------
revoke execute on function public.create_booking(text, text, timestamptz, timestamptz, text, integer, timestamptz,
  text, text, date, time, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.flag_payment_attention(text, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.apply_payment_paid(text, text, integer, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_atm_issued(text, integer, text, text, text, timestamptz, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.create_booking(text, text, timestamptz, timestamptz, text, integer, timestamptz,
  text, text, date, time, text, text, text, text, integer, integer) to service_role;
grant execute on function public.flag_payment_attention(text, text, text, jsonb, text) to service_role;
grant execute on function public.apply_payment_paid(text, text, integer, text, text, jsonb) to service_role;
grant execute on function public.apply_atm_issued(text, integer, text, text, text, timestamptz, text, jsonb)
  to service_role;
