# Gumnaam

Plain HTML, CSS and vanilla JavaScript, with ES modules for the bag. No framework, npm installation or storefront build step. GSAP 3.13.0 / ScrollTrigger and Lenis 1.3.11 are pinned CDN dependencies with native-scroll and visible-content fallbacks.

## Open locally

Serve this folder so ES modules and the bag work correctly:

```sh
python -m http.server 8000
```

Visit `http://localhost:8000`. Order submission needs a configured, deployed Supabase function. Until then, checkout stays closed and offers Instagram ordering; Easypaisa transfers are disabled.

## Edit the store

- Product names, prices, colours, sizes, stock, descriptions and photographs: the array at the top of `js/products.js`. The backend imports this same catalog. Names, IDs, prices, stock, sizes and new products need regenerated and redeployed functions. Descriptions, care, material and photos need only a storefront deployment; regenerating the copies keeps source tests consistent but does not require backend redeployment.
- Page copy: `index.html`, `shop.html`, `checkout.html` and `privacy.html`. Product-page copy: `js/products.js`.
- Photography and logo: `assets/`.
- Layout: `css/style.css`; checkout: `css/checkout.css`.
- Public checkout endpoint, CAPTCHA site key, delivery display fee, Easypaisa details, contact email and shared motion values: `js/checkout-config.js`. Never put server keys here. The backend delivery constant remains authoritative; change it and the database readiness function together if pricing changes.
- Typography, monochrome palette, fluid type and spacing: custom properties in `css/style.css`. Anton uppercase headlines, DM Sans body, IBM Plex Mono labels. The hero's decorative calligraphy uses `assets/logo.png` with the opacity and placement in `.hero-watermark`. Motion uses 0.8 seconds, power4.out and 0.08-second stagger. The CSS transition ease is cubic-bezier(.76,0,.24,1). Reduced motion disables reveals, loader, wipes, smooth scrolling and marquees.

Every current hoodie is PKR 1,999. Delivery adds PKR 200 once per order for both COD and Easypaisa. One piece totals PKR 2,199; two total PKR 4,198. The Easypaisa transfer amount includes delivery. Buy now carries a selected piece, size and quantity to single-piece checkout. The bag supports multiple pieces and sizes, up to ten total pieces and the catalog's per-product availability limits. These are manual stock limits, not live reservations.

## Backend setup

See [Supabase setup](supabase/SETUP.md). It covers private receipts, Resend email alerts, spam protection and notification retries.

## Owner workspace

Open `/admin` for the private order workspace. First activate it with [owner setup](supabase/OWNER-SETUP.md): run `supabase/owner-panel.sql`, create/confirm the agreed owner Auth user, run `supabase/owner-access.sql`, deploy `supabase/dashboard/owner-api.ts`, and redeploy the order functions for optional email consent. Until activation, the public sign-in page cannot read orders.

UI: `admin.html`, `css/owner.css`, `js/owner.js`. Auth: `js/owner-auth.mjs`. Public connection settings: `js/owner-config.js`. Server-only API: `supabase/functions/_shared/owner.mjs`. No secret key or password belongs in the frontend. The Sites skill's local-code workflow keeps the panel on the existing GitHub/Vercel deployment.

The workspace includes status/payment management, private screenshot previews, customer search, tracking/notes, test-order exclusion, audit history, bounded CSV exports and order-date revenue reports. Marketing CSV is limited to explicit optional email opt-ins with recorded opt-outs excluded. No bulk email is sent. Reports are not bank balances or profit; inventory remains the existing catalog's per-order limits.

The Invoices tab handles walk-in sales with the names Black, Navy Blue, Camel and Olive Green. Run `supabase/invoices.sql` and redeploy `supabase/dashboard/owner-api.ts` to activate saved invoices. Use `js/invoice-model.mjs` for the in-person options/default prices and `js/owner-invoices.mjs` for the editor, preview and Print / Save PDF. Defaults are PKR 1,999 with zero delivery; owner-entered prices/discounts are permitted only on invoices. Invoice payment totals are separate from online revenue. Customer contact details do not create marketing opt-ins. See the invoice section of the owner setup guide for retries, refunds and limitations.

For an existing installation, run `supabase/delivery-fee-update.sql` instead of rerunning `schema.sql`, then redeploy the updated dashboard functions. The update preserves old order totals and receipts. The database column `cod_fee` keeps its legacy name but stores delivery for both payment methods. Checkout stays closed against an older backend to prevent mismatched payment amounts.

For the new multi-item checkout on an already configured installation, run `supabase/cart-update.sql`, then redeploy `supabase/dashboard/create-order.ts` and `supabase/dashboard/retry-notifications.ts`. Do not rerun the bootstrap schema or recreate secrets, bucket or Cron. This adds nullable line-item/subtotal fields without modifying old orders. Until the backend reports `cartVersion: 1`, the bag can be edited but its submission is closed; existing Buy now checkout remains available.

The bag stores only product IDs, sizes and quantities in localStorage and syncs across tabs. Successful checkout removes the purchased quantities without clearing other selections. No address, phone or payment screenshot is stored there. The confirmation page uses a non-PII reference/product summary from sessionStorage, expires it after 24 hours, and does not claim payment is confirmed.

Contact and newsletter forms validate input and open an email draft. The customer must send it in their mail app. There is no mailing-list provider or automatic contact-message backend; the UI never claims delivery or subscription occurred. Verified garment measurements and a final merchant returns policy still need your own business information; the site does not invent measurements, refund guarantees or delivery dates.

## Pages and images

Home, shop, product, about, contact, bag, checkout, confirmation, shipping, size guide, FAQ, privacy/payments, terms and 404 share the same navigation and footer. Their editable copy lives in the HTML files. Product rendering and filtering live in `js/products.js`; shared UI in `js/main.js`; bag logic in `js/cart-model.mjs` and `js/cart.js`.

Original asset paths are retained as fallbacks. WebP copies are loaded with picture/source where possible. After replacing a photograph, regenerate its WebP alongside the original, or remove its source entry. An optional Pillow helper is `python scripts/optimize-images.py`; it is image maintenance, not a required site build.

Screenshots do not automatically verify a transfer. Review actual Easypaisa funds, then confirm the customer manually on WhatsApp. This is manual transfer checkout, not an Easypaisa payment-gateway integration.

## Tests

With Node.js 22 or later:

```sh
node --test tests/*.test.mjs
```

The tests use fake services and never contact Supabase, send email or create real orders. They cover single/multi-item pricing, stock limits across sizes, cart edits, validation, private-file handling, retries, notification failure and page/asset consistency. Live database access, real email delivery and CAPTCHA still need deployment checks.

If deploying through the Supabase browser editor, use the standalone files in `supabase/dashboard/`. Regenerate them after changing products or backend code with `node scripts/package-dashboard-functions.mjs`. This is optional backend packaging, not a storefront build step.
