# Order backend setup

## Customer order receipts / existing installation

1. Run `customer-emails.sql` in the Gumnaam SQL Editor after the existing `owner-panel.sql` setup. Do not rerun `schema.sql`. The migration is transactional and can be rerun safely; it does not alter existing orders or send historical emails.
2. Redeploy the complete regenerated `dashboard/create-order.ts` and `dashboard/retry-notifications.ts`, retaining JWT verification OFF and their existing CAPTCHA/private-Cron protections. Redeploy `dashboard/owner-api.ts` with JWT verification ON for customer email status/retry controls. These files are already packaged.
3. Keep the existing Resend secrets, verified sender, receipt bucket and five-minute Cron schedule. No new secrets, SMTP settings or job are required. `GET create-order` should then include `customerEmailVersion: 1` alongside `ready: true`.
4. Place one labelled test COD order with your own email; do not transfer money. Check that the owner alert and a separate customer receipt arrive. The receipt includes the reference, all items, delivery, total and pending status. A provider-accepted result does not prove inbox delivery; inspect Resend delivery/bounce events too.
5. In Admin → Orders → Manage, confirm or cancel that test order with a reason. Test dispatch/delivery only on a non-production project or a genuine fulfilled order; do not record fake collections. Email receipt creation/retries must not change fulfilment or payment records. Direct browser access to `gumnaam_customer_emails` must remain denied.

Email remains optional. A new online order with an email creates one immutable customer receipt in the same database transaction as the order through an INSERT trigger. Marketing opt-in is not required and no subscription is created. Email-less customers are contacted on WhatsApp. Walk-in invoices and pre-migration orders are not emailed automatically.

Owner alerts and customer receipts have independent queues and provider idempotency keys. The existing worker attempts both even when one queue has an outage. Customer retries use a five-minute lease, exponential backoff, at most 12 attempts and a 23-hour window from the first attempt to stay inside [Resend's 24-hour idempotency retention](https://resend.com/docs/dashboard/emails/idempotency-keys). Once a receipt is accepted, the panel cannot resend it. After an expired/uncertain delivery, check Resend and contact the customer manually rather than resetting the first-attempt timestamp or changing the snapshot.

Customer receipt templates live in `customer-emails.sql`; changing that template requires rerunning this migration and affects future orders only. Product copy is taken from the order snapshot; editing a product description does not require updating this migration. Status changes do not currently send automatic status-update emails; use the individual WhatsApp/email draft after verification. Replies to receipts go to `gumnaamofficialpk@gmail.com`, not the sender subdomain mailbox.

The source is ready to deploy. It is not live merely because the files are in GitHub. Keep checkout closed until the checks below pass.

## 1. Choose the Supabase project

Use a project you own. Enable the Data API for the `public` schema. Run `schema.sql` once in the SQL Editor after inspecting existing objects. It creates only Gumnaam-specific tables and functions; it does not drop existing data. Do not run it repeatedly against an existing installation.

Orders have RLS enabled and no browser read/write policies. Only the server service role can access them. Do not grant access to `anon` or `authenticated` to fix permissions: the schema explicitly grants access to `service_role` instead.

Create a Storage bucket named `payment-receipts` in the dashboard:

- Public: off.
- Maximum file size: 4 MB (4,194,304 bytes).
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`.
- No public upload/read policies. Uploads go through the server function only.

The bucket can also be created with the Storage API by an authorized server-side setup tool. Never place that setup key in frontend code.

## 2. Resend for your domain

1. Sign in at [Resend](https://resend.com).
2. Add the sending subdomain `mail.gumnaamofficial.com` for your storefront at `www.gumnaamofficial.com`.
3. Copy the exact DNS records Resend shows into your DNS provider. Wait until Resend marks the domain verified. Do not guess the record values.
4. Create a sending-only API key scoped to that domain.
5. Save it as `RESEND_API_KEY` under Supabase Edge Functions → Secrets. Do not paste it into chat, HTML, JavaScript, GitHub or a public issue.
6. Set `ORDER_FROM_EMAIL` to `Gumnaam <orders@mail.gumnaamofficial.com>` once that subdomain is verified, and `ORDER_ALERT_EMAIL` to `gumnaamofficialpk@gmail.com` or your preferred inbox.

Production mail needs a verified sender; the `resend.dev` test sender is not a production substitute. Supabase Auth SMTP settings are not used for these order alerts.

On your phone, enable notifications for the receiving inbox. Resend acceptance is recorded as `notification_status = sent`; that means the provider accepted the email, not a guarantee it reached the inbox. Check delivery/bounce events in Resend and run a real delivery test before opening checkout.

## 3. Cloudflare Turnstile

Create a Turnstile widget for your storefront hostname(s) at [Cloudflare](https://dash.cloudflare.com). Use managed mode. Save its secret as `TURNSTILE_SECRET_KEY` in Supabase, and put its public site key in `js/checkout-config.js`.

Set `TURNSTILE_HOSTNAMES` to `www.gumnaamofficial.com,gumnaamofficial.com`, without protocols. Do not use the universal test CAPTCHA keys in production.

## 4. Function secrets

Use `supabase/.env.example` as the names checklist, not as production credentials.

- `ALLOWED_ORIGINS`: `https://www.gumnaamofficial.com,https://gumnaamofficial.com`. No wildcard. Add a localhost origin only for deliberate testing.
- `TURNSTILE_SECRET_KEY` and `TURNSTILE_HOSTNAMES`: as above.
- `RESEND_API_KEY`, `ORDER_ALERT_EMAIL`, `ORDER_FROM_EMAIL`: as above.
- `CRON_SECRET`: a long random secret used only by the retry worker. Keep it in Supabase secrets and Vault.

The hosted runtime supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. They remain server-side. No Supabase client key is required on the storefront.

## 5. Deploy functions

### Browser editor (no CLI)

Use the generated standalone files in `supabase/dashboard/`, not the short importing entrypoints in `supabase/functions/`. Each dashboard file includes the catalog and shared backend code and contains no external imports or credentials.

1. In project `Gumnaam` (`mcpzozjhjbjgeaaszdhl`), open Edge Functions → Deploy a new function → Via Editor.
2. Name the function exactly `create-order`. Replace the default `index.ts` content with the complete contents of `supabase/dashboard/create-order.ts` and deploy.
3. In the function's settings, turn off gateway JWT verification so guest checkout can reach the handler. The handler validates Turnstile, hostname, origin and request limits; service credentials never reach the browser. Do not remove these in-code checks.
4. Repeat for `retry-notifications`, using `supabase/dashboard/retry-notifications.ts`. Turn off its gateway JWT verification too; the handler itself requires the private `CRON_SECRET` bearer token.
5. Run the opening checks below. Dashboard code is versioned here in GitHub, but the dashboard itself has no automatic source rollback.

After edits to the catalog or backend, regenerate both copies using `node scripts/package-dashboard-functions.mjs`, run the tests and redeploy both functions. Do not edit generated dashboard copies directly.

The storefront endpoint is `https://mcpzozjhjbjgeaaszdhl.supabase.co/functions/v1/create-order`. Its public Turnstile site key has been configured. It remains closed when backend readiness checks fail or the deployed delivery fee differs from the storefront.

### Delivery-fee update for an existing installation

Run `delivery-fee-update.sql` in the SQL Editor, not `schema.sql`. It replaces only the payment-details check and adds the service-only `gumnaam_delivery_fee()` readiness function. It leaves existing orders, totals, receipts, access rules and notification snapshots unchanged. If it cannot identify exactly one expected payment-details check, it stops without applying changes.

The existing `cod_fee` column keeps its name for compatibility and records PKR 200 delivery for every new order, COD or Easypaisa. The check accepts zero only for compatibility with historical prepaid orders; the server always calculates PKR 200 for new submissions. Do not reprice historical orders or edit their stored notification payloads.

Regenerate and redeploy both dashboard functions after applying the database update. Then publish the static checkout changes. The updated frontend will not enable checkout against an older backend that does not report `deliveryFee: 200`. Close any checkout tabs opened before this change and reload before testing.

### Connected deployment tool or CLI

Deploy `create-order` and `retry-notifications` with their shared `orders.mjs` file and imported `js/products.js`. The entrypoints are `index.ts`; the application logic is plain JavaScript and native HTTP requests, with no npm dependencies.

Use the connected Supabase deployment tool, or an official Supabase CLI. Before using a CLI, read its current `--help`, `functions --help`, `functions deploy --help` and `secrets --help` and select this exact project. `supabase/config.toml` disables gateway JWT verification for these functions: guest checkout is protected by server-verified Turnstile and request limits; the retry function checks `CRON_SECRET`. Do not expose the service-role key to guests.

If creating a recorded migration from a verified deployed schema, run security advisors first, generate it using the current CLI migration workflow, and verify migration history. `schema.sql` is a bootstrap script, not a claim that a migration has already been applied.

Set the public `endpoint` in `js/checkout-config.js` to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/create-order`. Set its public Turnstile site key. Deploy the static storefront to your existing hosting provider.

## 6. Retry email alerts

### Multi-item update

On an existing configured project, run `cart-update.sql` once in the SQL Editor. It adds nullable `line_items` and `subtotal` columns, adjusts the total constraint to use subtotal when present, and adds a service-role-only `gumnaam_cart_version()` readiness function. Historical order data and alert snapshots remain unchanged. Do not rerun `schema.sql`.

Redeploy the regenerated dashboard copies of both functions. `GET create-order` then reports `cartVersion: 1`. The new bag checkout stays closed until that capability is reported, while legacy single-item checkout remains compatible. Test two different products/sizes with both payment methods, one PKR 200 delivery fee, correct email line items, private receipt storage and identical-retry protection. Do not send real payment for a test.

For multi-item orders, fulfil from `line_items` and the full email summary. The old header columns are retained for compatibility: `product_id` refers to the first sorted selection, `quantity` is the aggregate and `size` is Mixed when several lines are present. `subtotal` records the actual sum even if product prices differ.

Enable Supabase Cron (`pg_cron`) and `pg_net` in the dashboard. In Vault, create:

- `gumnaam_project_url`: your `https://YOUR_PROJECT_REF.supabase.co` URL.
- `gumnaam_cron_secret`: the same value as the function's `CRON_SECRET`.

Use Vault's dashboard to enter secret values; do not commit them in SQL. Run `schedule.sql` once to invoke the retry worker every five minutes. Confirm exactly one job named `gumnaam-order-alerts` exists.

Each order initially stores a pending alert in the same database row. A worker claims rows with a lease to avoid concurrent delivery. Failed sends are retried with backoff, up to 12 attempts. The Resend idempotency key and stored email snapshot reduce duplicate sends. Providers cannot guarantee exactly-once email forever; check Resend if troubleshooting a send.

Monitor rows with `notification_status = failed` or a long-expired `sending` lease. After fixing credentials or delivery problems, reset those rows to `pending`, reset attempts to 0 and set `notification_next_at` to now. Do not change `notification_payload` for a retry under the same provider idempotency key. Salted rate-limit keys expire after a day through the retry worker.

## 7. Opening checks

Before taking customer payments:

1. Confirm `GET create-order` reports `ready: true` and `deliveryFee: 200` from the storefront origin.
2. Place a clearly labelled test COD order. Check the database total is PKR 2,199 for one piece and PKR 4,198 for two. Verify the merchant email arrives on your phone.
3. Submit a test Easypaisa order with a harmless test image and transaction label, without a real payment. Confirm PKR 2,199 total for one piece or PKR 4,198 for two, the matching transfer amount including delivery, a private receipt and `pending_verification`. Never treat this test screenshot as paid.
4. With a publishable/anon key, confirm direct reads and inserts on both Gumnaam tables are denied. Confirm unauthenticated receipt downloads fail.
5. Confirm the retry worker returns 401 without the cron secret and Cron is invoking it successfully. Simulate an email-provider failure in a test project and verify the order survives and alerts recover.
6. Retry the same submission and confirm no duplicate row. Check mobile layout and keyboard navigation. Run Supabase security advisors.
7. Confirm the displayed Easypaisa title/number are correct. Agree on delivery/return handling, review `privacy.html` for your actual practices, then open checkout.

Do not claim live payment/email verification based only on local mocked tests.

## Review and fulfil orders

The alert includes the customer details, transaction ID (if prepaid), authenticated Supabase dashboard links and a WhatsApp confirmation link.

1. Open `gumnaam_orders` in Supabase's Table Editor. Locate the order reference.
2. Check stock and delivery details. Stock values in the catalog are per-order limits, not a live reservation system; incoming requests need manual availability confirmation. Update stock and redeploy when needed.
3. For Easypaisa, open the receipt in the private Storage bucket and match the actual transfer in the Easypaisa account. Only then set `payment_status` to `verified`.
4. Set `status` to `confirmed`, then open the WhatsApp link from the alert and manually send the confirmation. The link does not send a message or update order state automatically.
5. Set `dispatched`, `completed` or `cancelled` as appropriate. Mark COD payment `collected` only after it is actually collected. Record any refund accurately.

Customer data is never stored in browser local storage. Receipt filenames are random; original filenames are not retained. The backend rejects oversized files and checks their magic bytes; this is basic file validation, not a malware scanner. Keep receipts private, do not embed them in public pages, and remove images/data when no longer needed under your actual recordkeeping policy. Restrict merchant dashboard access and enable MFA.
