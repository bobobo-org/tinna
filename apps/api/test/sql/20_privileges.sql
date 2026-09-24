-- 權限：anon / authenticated 只能讀方案與時段；bookings、payments 與 RPC 完全不可用；
-- D：0002 之後新建的表／序列／函式不會自動開放給 anon / authenticated / PUBLIC
do $$
declare
  fns text[] := array[
    'public.apply_payment_paid(text,text,integer,text,text,jsonb)',
    'public.apply_atm_issued(text,integer,text,text,text,timestamptz,text,jsonb)',
    'public.mark_payment_failed(text,text,text,jsonb)',
    'public.expire_stale_holds(timestamptz,timestamptz)',
    'public.create_booking(text,text,timestamptz,timestamptz,text,integer,timestamptz,text,text,date,time,text,text,text,text,integer,integer)',
    'public.flag_payment_attention(text,text,text,jsonb,text)',
    'public.normalize_phone(text)'
  ];
  f text;
begin
  foreach f in array fns loop
    assert not has_function_privilege('anon', f, 'execute'), 'anon can execute ' || f;
    assert not has_function_privilege('authenticated', f, 'execute'), 'authenticated can execute ' || f;
    assert has_function_privilege('service_role', f, 'execute'), 'service_role cannot execute ' || f;
  end loop;

  assert not has_table_privilege('anon', 'public.bookings', 'select'), 'anon select bookings';
  assert not has_table_privilege('anon', 'public.bookings', 'insert'), 'anon insert bookings';
  assert not has_table_privilege('authenticated', 'public.bookings', 'update'), 'auth update bookings';
  assert not has_table_privilege('anon', 'public.payments', 'select'), 'anon select payments';
  assert not has_table_privilege('authenticated', 'public.payments', 'insert'), 'auth insert payments';
  assert has_table_privilege('anon', 'public.services', 'select'), 'anon select services';
  assert not has_table_privilege('anon', 'public.services', 'update'), 'anon update services';
  assert not has_table_privilege('authenticated', 'public.date_overrides', 'insert'), 'auth insert overrides';
  assert not has_sequence_privilege('anon', 'public.weekly_slots_id_seq', 'usage'), 'anon seq';
  assert has_table_privilege('service_role', 'public.bookings', 'insert'), 'service insert bookings';
  raise notice 'PASS privileges';
end $$;

-- anon 透過 RLS 只看得到啟用中的方案；碰 bookings / RPC 直接被拒
update public.services set active = false where id = 'quick';
set role anon;
do $$
begin
  -- seed 4 個 ＋ 0004 的 5 個（接住你的諮詢室、自選主題 4 個價位），quick 停用 → 8
  assert (select count(*) from public.services) = 8, 'anon sees only active services';
  assert not exists (select 1 from public.services where id = 'quick'), 'anon sees inactive service';
  assert (select count(*) from public.weekly_slots) = 30, 'anon sees weekly slots';
  begin
    perform 1 from public.bookings limit 1;
    raise exception 'anon could read bookings';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_booking('YS22222222', 'love', now(), now() + interval '1 hour', 'card', 1, now(),
      'x', 'female', '1990-01-01', null, null, '0912345678', 'x@example.com', null, 2, 5);
    raise exception 'anon could exec create_booking';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS anon RLS / RPC denied';
end $$;
reset role;
update public.services set active = true where id = 'quick';

-- D. 新物件的預設權限
create role sqltest_nobody nologin;
create table public.sqltest_new_table (id int);
create function public.sqltest_new_fn() returns int language sql as 'select 1';
do $$
begin
  assert not has_table_privilege('anon', 'public.sqltest_new_table', 'insert'), 'new table: anon insert';
  assert not has_table_privilege('authenticated', 'public.sqltest_new_table', 'select'), 'new table: auth select';
  assert has_table_privilege('service_role', 'public.sqltest_new_table', 'insert'), 'new table: service_role';
  assert not has_function_privilege('anon', 'public.sqltest_new_fn()', 'execute'), 'new fn: anon execute';
  assert not has_function_privilege('authenticated', 'public.sqltest_new_fn()', 'execute'), 'new fn: auth execute';
  assert not has_function_privilege('sqltest_nobody', 'public.sqltest_new_fn()', 'execute'), 'new fn: PUBLIC execute';
  raise notice 'PASS default privileges for new objects';
end $$;
drop function public.sqltest_new_fn();
drop table public.sqltest_new_table;
drop role sqltest_nobody;
