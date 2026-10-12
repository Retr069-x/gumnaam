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

## Reports and money

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
