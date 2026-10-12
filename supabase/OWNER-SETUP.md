# Gumnaam owner workspace

The storefront page is `/admin`. Its HTML contains no orders or customer data. The owner backend must be deployed and the owner account explicitly authorised before it can read records.

## Activate on the existing Gumnaam project

1. Run `owner-panel.sql` in the SQL Editor. It adds owner access, audit and opt-out tables, order-management fields, and service-only reporting functions. It does not delete or reprice orders, grant guest access, recreate the receipt bucket or replace Cron. Do not rerun `schema.sql`.
2. Under Authentication → Users, create a password-based project Auth user for `gumnaamofficialpk@gmail.com`, or use that existing user. Choose a strong, unique password yourself and ensure the account is confirmed. Do not send passwords or secret keys in chat. This is a project Auth user, not the account you use to log into the Supabase dashboard. Do not disable email confirmation globally. An invite alone does not configure a password for this password-only panel.
3. Run `owner-access.sql`. It authorises only the confirmed Auth UUID belonging to the agreed owner email. A normal customer sign-in, matching metadata or knowing the page URL never grants access. If you change the owner email, deliberately update this script before running it; do not grant arbitrary customers ownership.
4. Deploy a new Edge Function named exactly `owner-api` using the complete `dashboard/owner-api.ts` standalone file. Leave gateway JWT verification ON for this owner function. The handler independently validates the bearer token through Supabase Auth, checks the active owner UUID and requires AAL2 when a verified MFA factor exists. It reuses the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `ALLOWED_ORIGINS` secrets. No new server secret is required.
5. Redeploy the regenerated `dashboard/create-order.ts` and `dashboard/retry-notifications.ts`, retaining their existing guest-CAPTCHA/private-Cron authentication settings. This enables the optional checkout email-consent record and adds the owner-panel link to new owner alerts. Old email snapshots are retained unchanged. Existing checkout works without this redeployment, but its optional consent box remains hidden.
6. Open `https://www.gumnaamofficial.com/admin` and sign in yourself. Under Security, set up an authenticator and verify its code. Do not share its QR image or codes. Later sign-ins require the authenticator. Recovery is through your authorised Supabase project administration.

The supplied `sb_publishable_` key in `js/owner-config.js` is intentionally public. Never replace it with `sb_secret_` or `service_role`. Configuration and UI changes are published through the existing GitHub/Vercel workflow, not through Supabase. Backend changes need regenerated dashboard files and manual redeployment.

## Check before using it for live fulfilment

- An unsigned `owner-api` request must fail with 401. A valid signed-in user not present in `gumnaam_owners` must fail with 403. Project APIs and private receipts must remain unavailable to anonymous and ordinary authenticated users. Do not relax grants or RLS to clear an error.
- Owner sign-in should load existing orders. Mark the earlier `Test order—DO NOT DISPATCH` record as a test using a reason so it no longer contributes to reports. Nothing automatically infers test status from names or notes.
- On a clearly labelled test order, check the pending → confirmed → dispatched → delivered flow, cancellation, private receipt preview, note/tracking edits and audit entries. Easypaisa requires manual verification before confirmation; COD requires actual collection before delivered. These are record updates, not payment transactions.
- Make a test edit from two tabs: the second save must show a conflict rather than overwrite the first. Refresh the order before retrying.
- An order without the optional checkbox remains non-subscribed, even if an email is supplied. A checked box requires an email and records server-side time/version. Opting out in Customers removes the email from eligible exports until a later explicit checkout opt-in.
- Check both payment methods still have one PKR 200 delivery charge, multi-item totals are correct, and real merchant alerts still arrive. Do not transfer real money for a test.
- Sign out, refresh or let the page idle for 15 minutes: records and tokens must clear. Do not screenshot private records for public sharing.
- Inspect Supabase security advisors after the migration. The added tables intentionally have RLS with no browser policies and service-only access.

## In-person invoices

For an already activated owner panel, run `invoices.sql` once in the SQL Editor, then redeploy the complete regenerated `dashboard/owner-api.ts` with JWT verification still ON. No owner-account, secrets, bucket or Cron setup needs to be repeated. The new Invoices tab can then create and reopen saved invoices.

Invoices use separate `gumnaam_invoices` records, not `gumnaam_orders`. They have their own all-time totals under Invoices; online Overview and Customers remain online-order reports. Walk-in contacts are saved with the invoice but never become marketing subscribers. No delivery charge, merchant email or stock reservation is added. Do not also record the same sale as an online order unless you deliberately want separate records; reports do not automatically deduplicate across channels.

Choose Black, Navy Blue, Camel or Olive Green, sizes S–XL, quantities and a unit price (default PKR 1,999). Prices can be negotiated for an in-person invoice without changing the storefront catalog. Discount and received amounts are whole PKR values, not percentages. A customer name is required; “Walk-in customer” is the default. Phone and email are optional. The sale must have a positive total. Maximum 20 distinct hoodie/size lines and 100 pieces.

Review the displayed total and money actually received, then issue. A database-assigned `GINV-YYYY-NNNNNN` number appears only after successful saving. The year uses Pakistan time; the counter is global and sequence gaps are normal. Browser Print / Save PDF prints only the sales invoice, not admin controls, audit records or internal order notes. The document is explicitly not a tax invoice and does not calculate taxes or profit. Use your required accounting process separately.

Saved lines, customer details and totals are fixed. Payments can be increased to the full total with a reason; this is a received-to-date record, not a payment collection. Partial payments may use different methods, but the invoice displays only the latest method/reference, with updates retained in the panel audit. If a sale is incorrect, void it and issue a new one. When money was received, voiding records a full refund of the amount received; do this only after making the actual refund. Void invoices cannot be edited or reopened, are excluded from current invoiced/paid/balance totals and remain in history. No deletion endpoint is provided.

Invoice creates use request UUID + a hash of validated, canonical server-calculated details with a transaction-level lock. Retry the same unsaved draft after a connection failure. Reload ends the draft; search existing invoices before starting a replacement after an uncertain save. Invoice edits use versions and row locks to prevent conflicting payment updates. Only an active owner may call these RPCs through the authenticated function. Records and drafts clear on sign-out/reload; no local-storage copy is kept.

Before live use, test in a non-production project: multiple colours/sizes, discounts, no delivery, zero/partial/full payment, print output, retry without duplication, conflicting payment updates, void/refund history and guest access denial. Mocked tests cannot prove that your live migration ran correctly. Do not create fake paid invoices in production merely to test reports.

Renamed catalog items keep their original IDs, so product links and bags continue to work. To use the new names in new online orders/alerts, redeploy both regenerated `dashboard/create-order.ts` and `dashboard/retry-notifications.ts`. Past order names and old notification snapshots are not rewritten.

## Online reports and money

Reports use the dates orders were placed in Pakistan time, and their currently recorded statuses. This is an order-date cohort, not a cash-flow ledger. Test orders are excluded. Historical records with incomplete payment states are not guessed to be paid.

- **Delivered & paid:** full order totals, including delivery, for delivered orders whose payments are verified or collected.
- **Merchandise revenue:** delivered & paid pieces, excluding delivery.
- **Delivery collected:** delivery on delivered & paid orders. This is not courier profit.
- **Payments recorded:** verified Easypaisa plus collected COD, even if an order is not yet delivered. Cancelled orders with recorded money require review and are flagged until a full refund is recorded.
- **Awaiting payment:** unverified, non-cancelled order totals.
- **Refunds recorded:** full-order refund amounts recorded by the owner. This does not initiate an Easypaisa refund. Partial refunds and costs are not tracked, so the panel does not claim net profit.

Order states are pending confirmation/verification, confirmed, dispatched, delivered (`completed` in the database), and cancelled. A delivered return can be recorded as cancelled with an explanation and a full refund where appropriate. Refunded orders cannot be reopened; use a new order instead. Backwards corrections beyond these workflows need deliberate Supabase administration.

Stock in `js/products.js` remains a per-order limit, not live inventory or a reservation. This release does not change the catalog or automatically reserve stock. Check availability before confirmation and use the documented catalog deployment workflow for changes.

## Contact details and marketing

Customer records are grouped by normalised email where provided, otherwise phone. A shared email can combine multiple people; an email-less order and a later emailed order may appear separately. Records are not verified mailing-list identities.

Operational CSV includes contact details for order management. It is not a permission list. Email-opt-in CSV excludes phone numbers, opted-out emails and test orders. Export requests are recorded and limited to 10,000 rows; narrower filters are required above that limit. Each export uses a single database transaction snapshot and spreadsheet-formula escaping.

The panel does not send bulk marketing emails. Before campaigns, use a provider with unsubscribe, bounce and suppression handling and import only eligible addresses. Respect the provider's suppressions too. Checkout consent is for email, not promotional SMS or WhatsApp. Record emailed unsubscribe requests with the Customers opt-out action.

Contact links open an email or WhatsApp draft for an individual order; they never send automatically. Notification retry queues the original merchant-alert snapshot for the existing five-minute Cron job. It does not re-confirm the order or alter its old alert content.

## Security and access removal

Auth tokens and customer records stay in memory, not local/session storage. Reload ends the panel session. HTTP no-store and noindex headers, a restricted CSP and anti-framing headers apply to `/admin`. Customer text is rendered with DOM text nodes, not HTML. Signed receipt preview links last 60 seconds, but an owner who opened an image can still see/download its bytes; expiry is not remote erasure.

The audit covers panel edits, exports, opt-outs and retry requests. Direct Supabase dashboard edits are outside this audit. Access is intended for the sole authorised owner, not a staff role hierarchy. To remove access, use the SQL Editor to set that owner's `gumnaam_owners.active` to false. There is no browser endpoint for adding owners or escalating roles. Keep project dashboard access and your owner account secure, enable MFA and retain customer data only as needed.

Implementation references: [Supabase function authentication](https://supabase.com/docs/guides/functions/auth), [authorization headers](https://supabase.com/docs/guides/functions/auth-headers), [API key types](https://supabase.com/docs/guides/getting-started/api-keys), [Auth REST contract](https://github.com/supabase/auth/blob/master/openapi.yaml).
