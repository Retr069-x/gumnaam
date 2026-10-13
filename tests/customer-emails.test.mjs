import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/customer-emails.sql", import.meta.url), "utf8");
const template = sql.slice(sql.indexOf("create or replace function public.gumnaam_queue_customer_receipt"), sql.indexOf("drop trigger"));

test("receipt queue is atomic with new orders, unique, private, and never backfills past customers", () => {
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /reference text primary key references public.gumnaam_orders\(reference\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public.gumnaam_customer_emails from public, anon, authenticated/);
  assert.match(sql, /after insert on public.gumnaam_orders/);
  assert.match(template, /if new.email = '' then return new/);
  assert.doesNotMatch(template, /marketing_consent|suppression|\/admin|supabase.com|receipt_path|transaction_id|new.address|new.phone/);
  assert.doesNotMatch(sql, /insert into public.gumnaam_customer_emails[^;]+select[^;]+from public.gumnaam_orders/s);
});

test("receipt includes reference, complete lines, server totals and honest payment-specific status", () => {
  for (const text of ["Order number:", "Placed:", "Pieces: PKR", "Delivery: PKR", "Total: PKR", "Payment method:", "Pending payment verification", "Pending confirmation", "not confirmed yet", "Do not transfer again.", "Pay the total on delivery.", "reply_to", "gumnaamofficialpk@gmail.com"]) assert.ok(template.includes(text), text);
  assert.match(template, /jsonb_array_elements\(new.line_items\) with ordinality/);
  assert.match(template, /new.unit_price \* new.quantity/);
  assert.match(template, /new.cod_fee/);
  assert.match(template, /jsonb_build_array\(new.email\)/);
  assert.match(template, /new.notification_payload->>'from'/);
});

test("customer worker RPC leases rows, caps retries within provider deduplication, and is service-only", () => {
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /interval '5 minutes'/);
  assert.match(sql, /attempts < 12/);
  assert.match(sql, /first_attempt_at < now\(\) - interval '23 hours'/);
  assert.match(sql, /coalesce\(emails.first_attempt_at, now\(\)\)/);
  assert.match(sql, /revoke all on function public.gumnaam_claim_customer_emails\(text,integer\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public.gumnaam_claim_customer_emails\(text,integer\) to service_role/);
});

test("owner retry cannot resend accepted receipts, bypass the retry window, or mutate snapshots", () => {
  const retry = sql.slice(sql.indexOf("create or replace function public.gumnaam_owner_retry_customer_email"), sql.indexOf("create or replace function public.gumnaam_customer_email_version"));
  assert.match(retry, /user_id = p_actor and active/);
  assert.match(retry, /for update/);
  assert.match(retry, /receipt.status = 'sent'/);
  assert.match(retry, /receipt.lease_until > now\(\)/);
  assert.match(retry, /interval '23 hours'/);
  assert.match(retry, /gumnaam_owner_audit/);
  assert.doesNotMatch(retry, /set[^;]+payload\s*=|set[^;]+first_attempt_at\s*=/s);
});
