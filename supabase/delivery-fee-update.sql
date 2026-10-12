begin;

do $$
declare payment_constraints text[];
begin
  select array_agg(c.conname::text) into payment_constraints
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.gumnaam_orders'::regclass
    and c.contype = 'c'
    and (
      select array_agg(a.attname::text order by a.attname::text)
      from pg_catalog.pg_attribute a
      where a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    ) = array['cod_fee', 'payment_method', 'receipt_path', 'transaction_id']::text[];

  if coalesce(cardinality(payment_constraints), 0) <> 1 then
    raise exception 'Expected one Gumnaam payment-details constraint. No changes were applied; inspect the table constraints first.';
  end if;

  execute format('alter table public.gumnaam_orders drop constraint %I', payment_constraints[1]);
end;
$$;

alter table public.gumnaam_orders
  add constraint gumnaam_orders_payment_details_check
  check ((payment_method = 'cod' and cod_fee = 200 and receipt_path is null and transaction_id = '')
      or (payment_method = 'easypaisa' and cod_fee in (0, 200) and receipt_path is not null and length(transaction_id) between 4 and 80));

create or replace function public.gumnaam_delivery_fee()
returns integer language sql immutable security invoker set search_path = '' as $$
  select 200;
$$;
revoke all on function public.gumnaam_delivery_fee() from public, anon, authenticated;
grant execute on function public.gumnaam_delivery_fee() to service_role;

commit;
