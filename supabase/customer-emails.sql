begin;

create table if not exists public.gumnaam_customer_emails (
  reference text primary key references public.gumnaam_orders(reference) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_at timestamptz not null default now(),
  lease_until timestamptz,
  first_attempt_at timestamptz,
  sent_at timestamptz,
  provider_id text,
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);
alter table public.gumnaam_customer_emails enable row level security;
revoke all on table public.gumnaam_customer_emails from public, anon, authenticated;
grant select, insert, update, delete on table public.gumnaam_customer_emails to service_role;
create index if not exists gumnaam_customer_emails_queue on public.gumnaam_customer_emails(next_at)
  where status in ('pending','sending');

create or replace function public.gumnaam_queue_customer_receipt()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare pieces text; message text; sender text;
begin
  if new.email = '' then return new; end if;
  sender := new.notification_payload->>'from';
  if sender is null or sender = '' then raise exception 'Order sender is missing'; end if;
  if new.line_items is not null then
    select string_agg(format('%s / %s / quantity %s / PKR %s',
      item->>'product_name', item->>'size', item->>'quantity',
      (item->>'quantity')::integer * (item->>'unit_price')::integer), E'\n' order by position)
      into pieces from jsonb_array_elements(new.line_items) with ordinality as lines(item, position);
  else
    pieces := format('%s / %s / quantity %s / PKR %s', new.product_name, new.size, new.quantity, new.unit_price * new.quantity);
  end if;
  message := concat_ws(E'\n',
    'GUMNAAM / Order received', '',
    'Hello ' || new.customer_name || '.',
    'We have received your order request.',
    'Order number: ' || new.reference,
    'Placed: ' || to_char(new.created_at at time zone 'Asia/Karachi', 'DD Mon YYYY, HH24:MI') || ' (Pakistan time)', '',
    pieces, '',
    'Pieces: PKR ' || coalesce(new.subtotal, new.unit_price * new.quantity),
    'Delivery: PKR ' || new.cod_fee,
    'Total: PKR ' || new.total,
    'Payment method: ' || case new.payment_method when 'cod' then 'Cash on delivery' else 'Easypaisa' end,
    'Status: ' || case new.status when 'pending_verification' then 'Pending payment verification' else 'Pending confirmation' end, '',
    'This email acknowledges your request. Your order is not confirmed yet.',
    case new.payment_method when 'easypaisa'
      then 'We will check your transfer and availability before confirming on WhatsApp. Do not transfer again.'
      else 'We will check availability and delivery details before confirming on WhatsApp. Pay the total on delivery.' end, '',
    'For a correction or cancellation, reply with your order number.', '',
    'Remain Gumnaam.',
    'gumnaamofficial.com', 'gumnaamofficialpk@gmail.com', '@gumnaamclothingpk');
  insert into public.gumnaam_customer_emails(reference, payload)
    values(new.reference, jsonb_build_object('from', sender, 'to', jsonb_build_array(new.email),
      'reply_to', 'gumnaamofficialpk@gmail.com',
      'subject', 'Gumnaam / Order received ' || new.reference, 'text', message))
    on conflict (reference) do nothing;
  return new;
end;
$$;
drop trigger if exists gumnaam_customer_receipt on public.gumnaam_orders;
create trigger gumnaam_customer_receipt after insert on public.gumnaam_orders
  for each row execute function public.gumnaam_queue_customer_receipt();

create or replace function public.gumnaam_claim_customer_emails(order_reference text default null, batch_size integer default 5)
returns setof public.gumnaam_customer_emails language plpgsql security invoker set search_path = '' as $$
begin
  update public.gumnaam_customer_emails set status = 'failed', lease_until = null
    where status in ('pending','sending') and (lease_until is null or lease_until < now())
      and (attempts >= 12 or first_attempt_at < now() - interval '23 hours');
  return query with candidates as (
    select reference from public.gumnaam_customer_emails
    where (order_reference is null or reference = order_reference)
      and attempts < 12 and next_at <= now()
      and (first_attempt_at is null or first_attempt_at > now() - interval '23 hours')
      and (status = 'pending' or (status = 'sending' and lease_until < now()))
    order by next_at, reference limit least(greatest(batch_size, 1), 5)
    for update skip locked
  ) update public.gumnaam_customer_emails as emails set
    status = 'sending', attempts = emails.attempts + 1,
    first_attempt_at = coalesce(emails.first_attempt_at, now()), lease_until = now() + interval '5 minutes'
    from candidates where emails.reference = candidates.reference returning emails.*;
end;
$$;

create or replace function public.gumnaam_owner_retry_customer_email(p_actor uuid, p_reference text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare receipt public.gumnaam_customer_emails;
begin
  if not exists (select 1 from public.gumnaam_owners where user_id = p_actor and active) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  select * into receipt from public.gumnaam_customer_emails where reference = p_reference for update;
  if not found then raise exception 'No customer receipt for this order' using errcode = 'P0002'; end if;
  if receipt.status = 'sent' or (receipt.status = 'sending' and receipt.lease_until > now()) then
    raise exception 'Receipt already accepted or currently sending' using errcode = '22023';
  end if;
  if receipt.first_attempt_at < now() - interval '23 hours' then
    raise exception 'Receipt retry window expired. Check Resend and contact the customer manually to avoid duplicates.' using errcode = '22023';
  end if;
  update public.gumnaam_customer_emails set status = 'pending', attempts = 0, next_at = now(), lease_until = null
    where reference = p_reference;
  insert into public.gumnaam_owner_audit(actor_id, order_reference, action, after_value, reason)
    values(p_actor, p_reference, 'customer_email_retry', jsonb_build_object('status','pending'), 'Owner queued original customer order receipt.');
  return true;
end;
$$;

create or replace function public.gumnaam_customer_email_version()
returns integer language sql immutable security invoker set search_path = '' as $$ select 1; $$;

revoke all on function public.gumnaam_queue_customer_receipt() from public, anon, authenticated;
revoke all on function public.gumnaam_claim_customer_emails(text,integer) from public, anon, authenticated;
revoke all on function public.gumnaam_owner_retry_customer_email(uuid,text) from public, anon, authenticated;
revoke all on function public.gumnaam_customer_email_version() from public, anon, authenticated;
grant execute on function public.gumnaam_queue_customer_receipt() to service_role;
grant execute on function public.gumnaam_claim_customer_emails(text,integer) to service_role;
grant execute on function public.gumnaam_owner_retry_customer_email(uuid,text) to service_role;
grant execute on function public.gumnaam_customer_email_version() to service_role;

commit;
