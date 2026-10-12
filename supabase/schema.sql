begin;

create table public.gumnaam_orders (
  id bigint generated always as identity primary key,
  reference text not null unique check (reference ~ '^GM-[A-F0-9]{16}$'),
  request_key uuid not null unique,
  payload_hash text not null check (length(payload_hash) = 64),
  created_at timestamptz not null default now(),
  product_id text not null,
  product_name text not null,
  size text not null,
  quantity integer not null check (quantity between 1 and 10),
  unit_price integer not null check (unit_price > 0),
  cod_fee integer not null check (cod_fee in (0, 200)),
  total integer not null check (total = unit_price * quantity + cod_fee),
  customer_name text not null check (length(customer_name) between 2 and 100),
  phone text not null check (phone ~ '^923[0-9]{9}$'),
  city text not null check (length(city) between 2 and 80),
  address text not null check (length(address) between 8 and 400),
  email text not null default '',
  notes text not null default '' check (length(notes) <= 500),
  payment_method text not null check (payment_method in ('cod', 'easypaisa')),
  transaction_id text not null default '',
  receipt_path text,
  status text not null check (status in ('pending_confirmation', 'pending_verification', 'confirmed', 'dispatched', 'completed', 'cancelled')),
  payment_status text not null default 'unverified' check (payment_status in ('unverified', 'verified', 'collected', 'refunded')),
  notification_status text not null default 'pending' check (notification_status in ('pending', 'sending', 'sent', 'failed')),
  notification_attempts integer not null default 0,
  notification_next_at timestamptz not null default now(),
  notification_lease_until timestamptz,
  notification_sent_at timestamptz,
  notification_provider_id text,
  notification_payload jsonb not null,
  constraint gumnaam_orders_payment_details_check check ((payment_method = 'cod' and cod_fee = 200 and receipt_path is null and transaction_id = '')
      or (payment_method = 'easypaisa' and cod_fee in (0, 200) and receipt_path is not null and length(transaction_id) between 4 and 80))
);

alter table public.gumnaam_orders enable row level security;
revoke all on table public.gumnaam_orders from public, anon, authenticated;
grant select, insert, update, delete on table public.gumnaam_orders to service_role;
revoke all on sequence public.gumnaam_orders_id_seq from public, anon, authenticated;
grant usage, select on sequence public.gumnaam_orders_id_seq to service_role;

create index gumnaam_orders_notification_queue on public.gumnaam_orders (notification_next_at)
  where notification_status in ('pending', 'sending');

create table public.gumnaam_order_limits (
  key_hash text primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);
alter table public.gumnaam_order_limits enable row level security;
revoke all on table public.gumnaam_order_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.gumnaam_order_limits to service_role;

create function public.gumnaam_check_order_limit(key_value text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_attempts integer;
begin
  insert into public.gumnaam_order_limits as limits (key_hash) values (key_value)
  on conflict (key_hash) do update set
    attempts = case when limits.window_start < now() - interval '1 hour' then 1 else limits.attempts + 1 end,
    window_start = case when limits.window_start < now() - interval '1 hour' then now() else limits.window_start end
  returning attempts into current_attempts;
  return current_attempts <= 10;
end;
$$;

create function public.gumnaam_claim_notifications(order_reference text default null, batch_size integer default 5)
returns setof public.gumnaam_orders language sql security invoker set search_path = '' as $$
  with candidates as (
    select id from public.gumnaam_orders
    where (order_reference is null or reference = order_reference)
      and notification_attempts < 12
      and notification_next_at <= now()
      and (notification_status = 'pending' or (notification_status = 'sending' and notification_lease_until < now()))
    order by notification_next_at
    limit least(greatest(batch_size, 1), 5)
    for update skip locked
  )
  update public.gumnaam_orders as orders set
    notification_status = 'sending',
    notification_attempts = orders.notification_attempts + 1,
    notification_lease_until = now() + interval '5 minutes'
  from candidates where orders.id = candidates.id
  returning orders.*;
$$;

revoke all on function public.gumnaam_check_order_limit(text) from public, anon, authenticated;
revoke all on function public.gumnaam_claim_notifications(text, integer) from public, anon, authenticated;
grant execute on function public.gumnaam_check_order_limit(text) to service_role;
grant execute on function public.gumnaam_claim_notifications(text, integer) to service_role;

create function public.gumnaam_delivery_fee()
returns integer language sql immutable security invoker set search_path = '' as $$
  select 200;
$$;
revoke all on function public.gumnaam_delivery_fee() from public, anon, authenticated;
grant execute on function public.gumnaam_delivery_fee() to service_role;

commit;
