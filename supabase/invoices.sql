begin;

create table if not exists public.gumnaam_invoices (
  id bigint generated always as identity primary key,
  number text not null unique,
  request_key uuid not null unique,
  payload_hash text not null check (length(payload_hash) = 64),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  customer_name text not null check (length(customer_name) between 2 and 100),
  email text not null default '' check (length(email) <= 254),
  phone text not null default '' check (phone = '' or phone ~ '^923[0-9]{9}$'),
  line_items jsonb not null check (jsonb_typeof(line_items) = 'array' and jsonb_array_length(line_items) between 1 and 20),
  subtotal integer not null check (subtotal > 0),
  discount integer not null default 0 check (discount >= 0),
  total integer not null check (total > 0 and total = subtotal - discount),
  amount_paid integer not null default 0 check (amount_paid between 0 and total),
  refunded_amount integer not null default 0 check (refunded_amount between 0 and total),
  payment_method text not null check (payment_method in ('cash', 'easypaisa', 'bank_transfer', 'other')),
  payment_reference text not null default '' check (length(payment_reference) <= 100),
  notes text not null default '' check (length(notes) <= 1000),
  status text not null default 'issued' check (status in ('issued', 'void')),
  void_reason text not null default '',
  version integer not null default 1,
  check (status <> 'void' or amount_paid = 0)
);
alter table public.gumnaam_invoices enable row level security;
revoke all on public.gumnaam_invoices from public, anon, authenticated;
grant select, insert, update on public.gumnaam_invoices to service_role;
revoke all on sequence public.gumnaam_invoices_id_seq from public, anon, authenticated;
grant usage, select on sequence public.gumnaam_invoices_id_seq to service_role;
create index if not exists gumnaam_invoices_created on public.gumnaam_invoices (created_at desc, id desc);

create or replace function public.gumnaam_invoice_version()
returns integer language sql immutable security invoker set search_path = '' as $$ select 1; $$;

create or replace function public.gumnaam_invoice_create(p_actor uuid, p_order jsonb, p_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  invoice public.gumnaam_invoices;
  invoice_id bigint;
  existing public.gumnaam_invoices;
  calculated bigint;
  pieces bigint;
begin
  if not exists (select 1 from public.gumnaam_owners where user_id = p_actor and active) then raise exception 'Owner access required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended((p_order->>'request_key'), 0));
  select * into existing from public.gumnaam_invoices where request_key = (p_order->>'request_key')::uuid;
  if found then
    if existing.payload_hash <> p_hash then raise exception 'Invoice details changed. Start a new invoice.' using errcode = '40001'; end if;
    return to_jsonb(existing) - array['payload_hash','request_key','created_by'];
  end if;
  if jsonb_typeof(p_order->'line_items') <> 'array' or jsonb_array_length(p_order->'line_items') not between 1 and 20 then raise exception 'Invalid invoice lines' using errcode = '22023'; end if;
  select sum((item->>'quantity')::integer * (item->>'unit_price')::integer), sum((item->>'quantity')::integer)
    into calculated, pieces from jsonb_array_elements(p_order->'line_items') as item;
  if calculated is null or calculated <> (p_order->>'subtotal')::integer or pieces not between 1 and 100 or exists (
    select 1 from jsonb_array_elements(p_order->'line_items') as item
    where (item->>'quantity')::integer not between 1 and 100 or (item->>'unit_price')::integer not between 1 and 100000
      or item->>'product_id' not in ('obsidian','navy','camel','olive') or item->>'size' not in ('S','M','L','XL')
  ) then raise exception 'Invoice amounts do not match' using errcode = '22023'; end if;
  invoice_id := nextval('public.gumnaam_invoices_id_seq');
  insert into public.gumnaam_invoices(id, number, request_key, payload_hash, created_by, customer_name, email, phone,
    line_items, subtotal, discount, total, amount_paid, payment_method, payment_reference, notes)
  overriding system value values(invoice_id,
    'GINV-' || to_char(now() at time zone 'Asia/Karachi','YYYY') || '-' || lpad(invoice_id::text, greatest(6, length(invoice_id::text)), '0'),
    (p_order->>'request_key')::uuid, p_hash, p_actor, p_order->>'customer_name', p_order->>'email', p_order->>'phone',
    p_order->'line_items', (p_order->>'subtotal')::integer, (p_order->>'discount')::integer, (p_order->>'total')::integer,
    (p_order->>'amount_paid')::integer, p_order->>'payment_method', p_order->>'payment_reference', p_order->>'notes') returning * into invoice;
  insert into public.gumnaam_owner_audit(actor_id, action, after_value, reason)
    values(p_actor, 'invoice_issued', jsonb_build_object('invoice', invoice.number, 'total', invoice.total, 'amount_paid', invoice.amount_paid), 'Walk-in invoice issued. No delivery charge or order email.');
  return to_jsonb(invoice) - array['payload_hash','request_key','created_by'];
end;
$$;

create or replace function public.gumnaam_invoice_list(p_query text default '', p_status text default '', p_offset integer default 0, p_limit integer default 50)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with matched as (
    select number, created_at, customer_name, email, phone, total, amount_paid, refunded_amount, payment_method, status, version
    from public.gumnaam_invoices where (p_status = '' or status = p_status)
      and (p_query = '' or position(lower(p_query) in lower(number || ' ' || customer_name || ' ' || email || ' ' || phone)) > 0)
  ), page as (
    select * from matched order by created_at desc, number desc limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
  ), summary as (
    select count(*) filter (where status = 'issued') as issued,
      coalesce(sum(total) filter (where status = 'issued'), 0) as invoiced,
      coalesce(sum(amount_paid) filter (where status = 'issued'), 0) as paid,
      coalesce(sum(total - amount_paid) filter (where status = 'issued'), 0) as balance,
      coalesce(sum(refunded_amount), 0) as refunded
    from public.gumnaam_invoices
  ) select jsonb_build_object('total', (select count(*) from matched), 'rows', coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc, number desc) from page), '[]'::jsonb), 'summary', (select to_jsonb(summary) from summary));
$$;

create or replace function public.gumnaam_invoice_update(p_actor uuid, p_number text, p_version integer, p_paid integer, p_method text, p_reference text, p_void boolean, p_reason text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare old_invoice public.gumnaam_invoices; invoice public.gumnaam_invoices;
begin
  if not exists (select 1 from public.gumnaam_owners where user_id = p_actor and active) then raise exception 'Owner access required' using errcode = '42501'; end if;
  if length(trim(p_reason)) not between 2 and 2000 then raise exception 'Record a reason for this change' using errcode = '22023'; end if;
  select * into old_invoice from public.gumnaam_invoices where number = p_number for update;
  if not found then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  if old_invoice.version <> p_version then raise exception 'Invoice changed. Reopen before saving.' using errcode = '40001'; end if;
  if old_invoice.status = 'void' then raise exception 'A void invoice cannot be changed' using errcode = '22023'; end if;
  if p_method not in ('cash','easypaisa','bank_transfer','other') or length(p_reference) > 100 then raise exception 'Invalid payment record' using errcode = '22023'; end if;
  if p_paid < old_invoice.amount_paid or p_paid > old_invoice.total or p_paid is null then raise exception 'Received-to-date must be between the previous payment and total' using errcode = '22023'; end if;
  update public.gumnaam_invoices set
    amount_paid = case when p_void then 0 else p_paid end,
    refunded_amount = case when p_void then old_invoice.amount_paid else refunded_amount end,
    status = case when p_void then 'void' else status end,
    void_reason = case when p_void then trim(p_reason) else void_reason end,
    payment_method = p_method, payment_reference = p_reference, updated_at = now(), version = version + 1
    where id = old_invoice.id returning * into invoice;
  insert into public.gumnaam_owner_audit(actor_id, action, before_value, after_value, reason)
    values(p_actor, case when p_void then 'invoice_voided' else 'invoice_payment_recorded' end,
      jsonb_build_object('invoice', old_invoice.number, 'amount_paid', old_invoice.amount_paid, 'status', old_invoice.status),
      jsonb_build_object('invoice', invoice.number, 'amount_paid', invoice.amount_paid, 'refunded_amount', invoice.refunded_amount, 'status', invoice.status, 'payment_method', invoice.payment_method, 'payment_reference', invoice.payment_reference), trim(p_reason));
  return to_jsonb(invoice) - array['payload_hash','request_key','created_by'];
end;
$$;

revoke all on function public.gumnaam_invoice_version() from public, anon, authenticated;
revoke all on function public.gumnaam_invoice_create(uuid,jsonb,text) from public, anon, authenticated;
revoke all on function public.gumnaam_invoice_list(text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.gumnaam_invoice_update(uuid,text,integer,integer,text,text,boolean,text) from public, anon, authenticated;
grant execute on function public.gumnaam_invoice_version() to service_role;
grant execute on function public.gumnaam_invoice_create(uuid,jsonb,text) to service_role;
grant execute on function public.gumnaam_invoice_list(text,text,integer,integer) to service_role;
grant execute on function public.gumnaam_invoice_update(uuid,text,integer,integer,text,text,boolean,text) to service_role;
notify pgrst, 'reload schema';
commit;
