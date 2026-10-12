begin;

create table if not exists public.gumnaam_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.gumnaam_owner_audit (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid not null,
  order_reference text,
  action text not null,
  before_value jsonb,
  after_value jsonb,
  reason text not null default '' check (length(reason) <= 2000)
);
create table if not exists public.gumnaam_marketing_suppressions (
  email text primary key check (email = lower(trim(email)) and length(email) between 3 and 254),
  withdrawn_at timestamptz not null default now()
);

alter table public.gumnaam_orders add column if not exists version integer not null default 1;
alter table public.gumnaam_orders add column if not exists updated_at timestamptz not null default now();
alter table public.gumnaam_orders add column if not exists internal_note text not null default '';
alter table public.gumnaam_orders add column if not exists courier text not null default '';
alter table public.gumnaam_orders add column if not exists tracking_number text not null default '';
alter table public.gumnaam_orders add column if not exists is_test boolean not null default false;
alter table public.gumnaam_orders add column if not exists delivered_at timestamptz;
alter table public.gumnaam_orders add column if not exists payment_recorded_at timestamptz;
alter table public.gumnaam_orders add column if not exists marketing_consent boolean not null default false;
alter table public.gumnaam_orders add column if not exists marketing_consent_at timestamptz;
alter table public.gumnaam_orders add column if not exists marketing_consent_version text;

alter table public.gumnaam_owners enable row level security;
alter table public.gumnaam_owner_audit enable row level security;
alter table public.gumnaam_marketing_suppressions enable row level security;
revoke all on public.gumnaam_owners, public.gumnaam_owner_audit, public.gumnaam_marketing_suppressions from public, anon, authenticated;
grant select on public.gumnaam_owners to service_role;
grant select, insert on public.gumnaam_owner_audit to service_role;
grant select, insert, update on public.gumnaam_marketing_suppressions to service_role;
revoke all on sequence public.gumnaam_owner_audit_id_seq from public, anon, authenticated;
grant usage, select on sequence public.gumnaam_owner_audit_id_seq to service_role;
create index if not exists gumnaam_orders_created on public.gumnaam_orders (created_at desc, id desc);
create index if not exists gumnaam_orders_email on public.gumnaam_orders (lower(email));
create index if not exists gumnaam_owner_audit_order on public.gumnaam_owner_audit (order_reference, created_at desc);

create or replace function public.gumnaam_order_version_trigger()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare ignored text[] := array['version','updated_at','notification_status','notification_attempts','notification_next_at','notification_lease_until','notification_sent_at','notification_provider_id','notification_payload'];
begin
  if (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored) then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists gumnaam_order_version on public.gumnaam_orders;
create trigger gumnaam_order_version before update on public.gumnaam_orders
  for each row execute function public.gumnaam_order_version_trigger();
revoke all on function public.gumnaam_order_version_trigger() from public, anon, authenticated;
grant execute on function public.gumnaam_order_version_trigger() to service_role;

create or replace function public.gumnaam_owner_version()
returns integer language sql immutable security invoker set search_path = '' as $$ select 1; $$;

create or replace function public.gumnaam_owner_orders(
  p_from timestamptz default null, p_until timestamptz default null,
  p_query text default '', p_status text default '', p_payment text default '',
  p_test boolean default false, p_offset integer default 0, p_limit integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matched as (
    select id, reference, created_at, customer_name, email, phone, city, product_name, quantity,
      total, status, payment_status, payment_method, notification_status, is_test, version
    from public.gumnaam_orders
    where (p_from is null or created_at >= p_from) and (p_until is null or created_at < p_until)
      and (p_test or not is_test) and (p_status = '' or status = p_status)
      and (p_payment = '' or payment_method = p_payment)
      and (p_query = '' or position(lower(p_query) in lower(reference || ' ' || customer_name || ' ' || email || ' ' || phone || ' ' || city)) > 0)
  ), page as (
    select * from matched order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 10001) offset greatest(p_offset, 0)
  ) select jsonb_build_object('total', (select count(*) from matched), 'rows', coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc, id desc) from page), '[]'::jsonb));
$$;

create or replace function public.gumnaam_owner_customers(
  p_query text default '', p_marketing boolean default false,
  p_offset integer default 0, p_limit integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with source as (
    select *, case when trim(email) <> '' then 'email:' || lower(trim(email)) else 'phone:' || phone end as customer_key
    from public.gumnaam_orders where not is_test
  ), people as (
    select customer_key,
      (array_agg(customer_name order by created_at desc, id desc))[1] as name,
      lower((array_agg(trim(email) order by created_at desc, id desc))[1]) as email,
      (array_agg(phone order by created_at desc, id desc))[1] as phone,
      (array_agg(city order by created_at desc, id desc))[1] as city,
      count(*) as orders, min(created_at) as first_order, max(created_at) as last_order,
      coalesce(sum(total) filter (where status = 'completed' and payment_status in ('verified', 'collected')), 0) as delivered_paid_value,
      max(marketing_consent_at) filter (where marketing_consent and marketing_consent_version = 'checkout-email-v1') as consent_at
    from source group by customer_key
  ), eligible as (
    select people.*, (people.email <> '' and consent_at is not null and
      (suppression.withdrawn_at is null or consent_at > suppression.withdrawn_at)) as marketing_eligible
    from people left join public.gumnaam_marketing_suppressions as suppression on suppression.email = people.email
  ), matched as (
    select * from eligible where (not p_marketing or marketing_eligible)
      and (p_query = '' or position(lower(p_query) in lower(name || ' ' || email || ' ' || phone || ' ' || city)) > 0)
  ), page as (
    select * from matched order by last_order desc, customer_key
    limit least(greatest(p_limit, 1), 10001) offset greatest(p_offset, 0)
  ) select jsonb_build_object('total', (select count(*) from matched), 'rows', coalesce((select jsonb_agg(to_jsonb(page) order by last_order desc, customer_key) from page), '[]'::jsonb));
$$;

create or replace function public.gumnaam_owner_metrics(p_from timestamptz default null, p_until timestamptz default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with orders as (
    select * from public.gumnaam_orders where not is_test
      and (p_from is null or created_at >= p_from) and (p_until is null or created_at < p_until)
  ), totals as (
    select count(*) as orders,
      count(*) filter (where status in ('pending_confirmation', 'pending_verification')) as pending,
      count(*) filter (where status = 'confirmed') as confirmed,
      count(*) filter (where status = 'dispatched') as dispatched,
      count(*) filter (where status = 'completed') as delivered,
      count(*) filter (where status = 'completed' and payment_status in ('verified', 'collected')) as delivered_paid_orders,
      count(*) filter (where status = 'cancelled') as cancelled,
      coalesce(sum(total), 0) as order_value,
      coalesce(sum(total) filter (where payment_status in ('verified', 'collected')), 0) as payments_recorded,
      coalesce(sum(total) filter (where status = 'completed' and payment_status in ('verified', 'collected')), 0) as delivered_paid_value,
      coalesce(sum(coalesce(subtotal, unit_price * quantity)) filter (where status = 'completed' and payment_status in ('verified', 'collected')), 0) as merchandise_revenue,
      coalesce(sum(cod_fee) filter (where status = 'completed' and payment_status in ('verified', 'collected')), 0) as delivery_collected,
      coalesce(sum(total) filter (where payment_status = 'unverified' and status <> 'cancelled'), 0) as awaiting_payment,
      coalesce(sum(total) filter (where payment_status = 'refunded'), 0) as refunded_value,
      count(*) filter (where status = 'pending_verification') as verify_payments,
      count(*) filter (where notification_status = 'failed') as failed_alerts,
      count(*) filter (where status in ('pending_confirmation', 'pending_verification') and created_at < now() - interval '48 hours') as aged_pending,
      count(*) filter (where status = 'cancelled' and payment_status in ('verified', 'collected')) as cancelled_paid,
      count(distinct case when trim(email) <> '' then 'email:' || lower(trim(email)) else 'phone:' || phone end) as customers
    from orders
  ), chart_end as (
    select (coalesce(p_until, now()) at time zone 'Asia/Karachi')::date - case when p_until is null then 0 else 1 end as last_day
  ), chart_range as (
    select greatest(coalesce((p_from at time zone 'Asia/Karachi')::date, last_day - 29), last_day - 29) as first_day, last_day from chart_end
  ), daily_values as (
    select (created_at at time zone 'Asia/Karachi')::date as day, count(*) as orders,
      coalesce(sum(total) filter (where status = 'completed' and payment_status in ('verified', 'collected')), 0) as revenue
    from orders where (created_at at time zone 'Asia/Karachi')::date >= (select first_day from chart_range)
    group by day order by day
  ), daily as (
    select calendar.day::date as day, coalesce(daily_values.orders, 0) as orders, coalesce(daily_values.revenue, 0) as revenue
    from chart_range cross join lateral generate_series(first_day::timestamp, last_day::timestamp, interval '1 day') as calendar(day)
    left join daily_values on daily_values.day = calendar.day::date order by calendar.day
  ), products as (
    select item->>'product_name' as name, sum((item->>'quantity')::integer) as units,
      sum((item->>'quantity')::integer * (item->>'unit_price')::integer) as value
    from orders cross join lateral jsonb_array_elements(coalesce(line_items,
      jsonb_build_array(jsonb_build_object('product_name', product_name, 'quantity', quantity, 'unit_price', unit_price)))) as item
    where status = 'completed' and payment_status in ('verified', 'collected')
    group by item->>'product_name' order by value desc limit 5
  ), cities as (
    select city, count(*) as orders from orders group by city order by orders desc, city limit 5
  ) select jsonb_build_object('summary', (select to_jsonb(totals) from totals),
    'daily', coalesce((select jsonb_agg(to_jsonb(daily) order by day) from daily), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(products) order by value desc, name) from products), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(to_jsonb(cities) order by orders desc, city) from cities), '[]'::jsonb));
$$;

create or replace function public.gumnaam_owner_update(
  p_actor uuid, p_reference text, p_version integer, p_patch jsonb, p_reason text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  old_order public.gumnaam_orders;
  new_order public.gumnaam_orders;
  next_status text;
  next_payment text;
begin
  if not exists (select 1 from public.gumnaam_owners where user_id = p_actor and active) then raise exception 'Owner access required' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) not between 2 and 2000 then raise exception 'Add a reason for this change' using errcode = '22023'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or exists (select 1 from jsonb_object_keys(p_patch) as fields(key) where key not in ('status', 'payment_status', 'internal_note', 'courier', 'tracking_number', 'is_test')) then raise exception 'Invalid update' using errcode = '22023'; end if;
  select * into old_order from public.gumnaam_orders where reference = p_reference for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if old_order.version <> p_version then raise exception 'Order changed. Reload before saving.' using errcode = '40001'; end if;
  next_status := coalesce(p_patch->>'status', old_order.status);
  next_payment := coalesce(p_patch->>'payment_status', old_order.payment_status);
  if next_status not in ('pending_confirmation', 'pending_verification', 'confirmed', 'dispatched', 'completed', 'cancelled') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if next_payment not in ('unverified', 'verified', 'collected', 'refunded') then raise exception 'Invalid payment status' using errcode = '22023'; end if;
  if next_status <> old_order.status and not (
    (old_order.status in ('pending_confirmation', 'pending_verification') and next_status in ('confirmed', 'cancelled')) or
    (old_order.status = 'confirmed' and next_status in ('dispatched', 'cancelled')) or
    (old_order.status = 'dispatched' and next_status in ('completed', 'cancelled')) or
    (old_order.status = 'completed' and next_status = 'cancelled') or
    (old_order.status = 'cancelled' and next_status = case when old_order.payment_method = 'easypaisa' then 'pending_verification' else 'pending_confirmation' end)
  ) then raise exception 'Use the next fulfilment stage, or cancel the order' using errcode = '22023'; end if;
  if old_order.status = 'cancelled' and old_order.payment_status = 'refunded' and next_status <> 'cancelled' then raise exception 'A refunded order cannot be reopened. Create a new order.' using errcode = '22023'; end if;
  if next_payment <> old_order.payment_status and not (
    (old_order.payment_status = 'unverified' and next_payment = case when old_order.payment_method = 'cod' then 'collected' else 'verified' end) or
    (old_order.payment_status in ('verified', 'collected') and next_payment = 'refunded')
  ) then raise exception 'Invalid payment transition' using errcode = '22023'; end if;
  if next_status <> old_order.status or next_payment <> old_order.payment_status then
    if next_status in ('confirmed', 'dispatched', 'completed') and old_order.payment_method = 'easypaisa' and next_payment <> 'verified' then raise exception 'Verify the actual Easypaisa transfer first' using errcode = '22023'; end if;
    if next_status = 'completed' and old_order.payment_method = 'cod' and next_payment <> 'collected' then raise exception 'Record the collected COD payment first' using errcode = '22023'; end if;
    if next_payment = 'refunded' and next_status <> 'cancelled' then raise exception 'Cancel or return the order when recording a full refund' using errcode = '22023'; end if;
    if next_payment <> old_order.payment_status and next_payment = 'collected' and next_status not in ('dispatched', 'completed', 'cancelled') then raise exception 'COD collection is recorded after dispatch' using errcode = '22023'; end if;
  end if;
  if length(coalesce(p_patch->>'internal_note', '')) > 2000 or length(coalesce(p_patch->>'courier', '')) > 80 or length(coalesce(p_patch->>'tracking_number', '')) > 100 then raise exception 'Details are too long' using errcode = '22023'; end if;
  if p_patch ? 'is_test' and jsonb_typeof(p_patch->'is_test') <> 'boolean' then raise exception 'Invalid test flag' using errcode = '22023'; end if;
  update public.gumnaam_orders set status = next_status, payment_status = next_payment,
    internal_note = coalesce(p_patch->>'internal_note', internal_note), courier = coalesce(p_patch->>'courier', courier),
    tracking_number = coalesce(p_patch->>'tracking_number', tracking_number), is_test = coalesce((p_patch->>'is_test')::boolean, is_test),
    delivered_at = case when next_status = 'completed' and status <> 'completed' then now() else delivered_at end,
    payment_recorded_at = case when next_payment in ('verified', 'collected') and payment_status = 'unverified' then now() else payment_recorded_at end,
    updated_at = now(), version = version + 1
    where id = old_order.id returning * into new_order;
  insert into public.gumnaam_owner_audit(actor_id, order_reference, action, before_value, after_value, reason)
    values(p_actor, p_reference, 'order_updated',
      jsonb_build_object('status', old_order.status, 'payment_status', old_order.payment_status, 'courier', old_order.courier, 'tracking_number', old_order.tracking_number, 'internal_note', old_order.internal_note, 'is_test', old_order.is_test, 'version', old_order.version),
      jsonb_build_object('status', new_order.status, 'payment_status', new_order.payment_status, 'courier', new_order.courier, 'tracking_number', new_order.tracking_number, 'internal_note', new_order.internal_note, 'is_test', new_order.is_test, 'version', new_order.version), trim(p_reason));
  return jsonb_build_object('reference', new_order.reference, 'version', new_order.version);
end;
$$;

create or replace function public.gumnaam_owner_export(
  p_actor uuid, p_kind text, p_from timestamptz default null, p_until timestamptz default null,
  p_query text default '', p_status text default '', p_payment text default '', p_test boolean default false,
  p_marketing boolean default false
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if not exists (select 1 from public.gumnaam_owners where user_id = p_actor and active) then raise exception 'Owner access required' using errcode = '42501'; end if;
  if p_kind = 'orders' then
    result := public.gumnaam_owner_orders(p_from, p_until, p_query, p_status, p_payment, p_test, 0, 10001);
  elsif p_kind in ('customers', 'marketing') then
    result := public.gumnaam_owner_customers(p_query, p_kind = 'marketing' or p_marketing, 0, 10001);
  else raise exception 'Invalid export' using errcode = '22023'; end if;
  if (result->>'total')::bigint > 10000 then raise exception 'Export is limited to 10,000 records. Narrow your search or date range.' using errcode = '22023'; end if;
  insert into public.gumnaam_owner_audit(actor_id, action, after_value, reason)
    values(p_actor, 'csv_export', jsonb_build_object('kind', p_kind, 'rows', result->'total'),
      case when p_kind = 'marketing' then 'Checkout email opt-ins only; active opt-outs excluded.' else 'Private operational export. Not a marketing permission list.' end);
  return result->'rows';
end;
$$;

create or replace function public.gumnaam_owner_retry(p_actor uuid, p_reference text, p_version integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare old_order public.gumnaam_orders;
begin
  if not exists (select 1 from public.gumnaam_owners where user_id = p_actor and active) then raise exception 'Owner access required' using errcode = '42501'; end if;
  select * into old_order from public.gumnaam_orders where reference = p_reference for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if old_order.version <> p_version then raise exception 'Order changed. Reload before saving.' using errcode = '40001'; end if;
  if old_order.notification_status = 'sent' or (old_order.notification_status = 'sending' and old_order.notification_lease_until > now()) then raise exception 'Alert already sent or currently sending' using errcode = '22023'; end if;
  update public.gumnaam_orders set notification_status = 'pending', notification_attempts = 0,
    notification_next_at = now(), notification_lease_until = null, updated_at = now(), version = version + 1 where id = old_order.id;
  insert into public.gumnaam_owner_audit(actor_id, order_reference, action, reason)
    values(p_actor, p_reference, 'alert_retry_queued', 'Original alert snapshot retained. Existing Cron will process it.');
  return true;
end;
$$;

create or replace function public.gumnaam_owner_suppress(p_actor uuid, p_email text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.gumnaam_owners where user_id = p_actor and active) then raise exception 'Owner access required' using errcode = '42501'; end if;
  if length(trim(p_email)) not between 3 and 254 or position('@' in p_email) = 0 then raise exception 'Invalid email' using errcode = '22023'; end if;
  insert into public.gumnaam_marketing_suppressions(email, withdrawn_at) values(lower(trim(p_email)), now())
    on conflict (email) do update set withdrawn_at = now();
  insert into public.gumnaam_owner_audit(actor_id, action, after_value, reason)
    values(p_actor, 'marketing_opt_out', jsonb_build_object('email', lower(trim(p_email))), 'Owner recorded customer opt-out.');
  return true;
end;
$$;

revoke all on function public.gumnaam_owner_version() from public, anon, authenticated;
revoke all on function public.gumnaam_owner_orders(timestamptz,timestamptz,text,text,text,boolean,integer,integer) from public, anon, authenticated;
revoke all on function public.gumnaam_owner_customers(text,boolean,integer,integer) from public, anon, authenticated;
revoke all on function public.gumnaam_owner_metrics(timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.gumnaam_owner_update(uuid,text,integer,jsonb,text) from public, anon, authenticated;
revoke all on function public.gumnaam_owner_retry(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.gumnaam_owner_suppress(uuid,text) from public, anon, authenticated;
revoke all on function public.gumnaam_owner_export(uuid,text,timestamptz,timestamptz,text,text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.gumnaam_owner_version() to service_role;
grant execute on function public.gumnaam_owner_orders(timestamptz,timestamptz,text,text,text,boolean,integer,integer) to service_role;
grant execute on function public.gumnaam_owner_customers(text,boolean,integer,integer) to service_role;
grant execute on function public.gumnaam_owner_metrics(timestamptz,timestamptz) to service_role;
grant execute on function public.gumnaam_owner_update(uuid,text,integer,jsonb,text) to service_role;
grant execute on function public.gumnaam_owner_retry(uuid,text,integer) to service_role;
grant execute on function public.gumnaam_owner_suppress(uuid,text) to service_role;
grant execute on function public.gumnaam_owner_export(uuid,text,timestamptz,timestamptz,text,text,text,boolean,boolean) to service_role;

notify pgrst, 'reload schema';
commit;
