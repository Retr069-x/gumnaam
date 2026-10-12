begin;

alter table public.gumnaam_orders add column if not exists line_items jsonb;
alter table public.gumnaam_orders add column if not exists subtotal integer;

alter table public.gumnaam_orders drop constraint if exists gumnaam_orders_total_check;
alter table public.gumnaam_orders
  add constraint gumnaam_orders_total_check
  check (total = coalesce(subtotal, unit_price * quantity) + cod_fee);

alter table public.gumnaam_orders drop constraint if exists gumnaam_orders_cart_check;
alter table public.gumnaam_orders
  add constraint gumnaam_orders_cart_check
  check ((line_items is null and subtotal is null)
      or (line_items is not null and subtotal is not null and subtotal > 0
          and jsonb_typeof(line_items) = 'array' and jsonb_array_length(line_items) between 1 and 10));

create or replace function public.gumnaam_cart_version()
returns integer language sql immutable security invoker set search_path = '' as $$
  select 1;
$$;
revoke all on function public.gumnaam_cart_version() from public, anon, authenticated;
grant execute on function public.gumnaam_cart_version() to service_role;

commit;
