# Order backend setup

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

The storefront endpoint is `https://mcpzozjhjbjgeaaszdhl.supabase.co/functions/v1/create-order`. Its public Turnstile site key has been configured. It remains closed when backend readiness checks fail.

### Connected deployment tool or CLI

Deploy `create-order` and `retry-notifications` with their shared `orders.mjs` file and imported `js/products.js`. The entrypoints are `index.ts`; the application logic is plain JavaScript and native HTTP requests, with no npm dependencies.

Use the connected Supabase deployment tool, or an official Supabase CLI. Before using a CLI, read its current `--help`, `functions --help`, `functions deploy --help` and `secrets --help` and select this exact project. `supabase/config.toml` disables gateway JWT verification for these functions: guest checkout is protected by server-verified Turnstile and request limits; the retry function checks `CRON_SECRET`. Do not expose the service-role key to guests.

If creating a recorded migration from a verified deployed schema, run security advisors first, generate it using the current CLI migration workflow, and verify migration history. `schema.sql` is a bootstrap script, not a claim that a migration has already been applied.

Set the public `endpoint` in `js/checkout-config.js` to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/create-order`. Set its public Turnstile site key. Deploy the static storefront to your existing hosting provider.

## 6. Retry email alerts

Enable Supabase Cron (`pg_cron`) and `pg_net` in the dashboard. In Vault, create:

- `gumnaam_project_url`: your `https://YOUR_PROJECT_REF.supabase.co` URL.
- `gumnaam_cron_secret`: the same value as the function's `CRON_SECRET`.

Use Vault's dashboard to enter secret values; do not commit them in SQL. Run `schedule.sql` once to invoke the retry worker every five minutes. Confirm exactly one job named `gumnaam-order-alerts` exists.

Each order initially stores a pending alert in the same database row. A worker claims rows with a lease to avoid concurrent delivery. Failed sends are retried with backoff, up to 12 attempts. The Resend idempotency key and stored email snapshot reduce duplicate sends. Providers cannot guarantee exactly-once email forever; check Resend if troubleshooting a send.

Monitor rows with `notification_status = failed` or a long-expired `sending` lease. After fixing credentials or delivery problems, reset those rows to `pending`, reset attempts to 0 and set `notification_next_at` to now. Do not change `notification_payload` for a retry under the same provider idempotency key. Salted rate-limit keys expire after a day through the retry worker.

## 7. Opening checks

Before taking customer payments:

1. Confirm `GET create-order` reports `ready: true` from the storefront origin.
2. Place a clearly labelled test COD order. Check the database total is PKR 2,199 for one piece and PKR 4,198 for two. Verify the merchant email arrives on your phone.
3. Submit a test Easypaisa order with a harmless test image and transaction label, without a real payment. Confirm PKR 1,999 total, a private receipt and `pending_verification`. Never treat this test screenshot as paid.
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
