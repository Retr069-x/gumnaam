# Gumnaam

Plain HTML, CSS and JavaScript. No packages or build step.

## Open locally

Open `index.html`, or serve this folder:

```sh
python -m http.server 8000
```

Visit `http://localhost:8000`. Order submission needs a configured, deployed Supabase function. Until then, checkout stays closed and offers Instagram ordering; Easypaisa transfers are disabled.

## Edit the store

- Product names, prices, sizes, stock and photographs: the array at the top of `js/products.js`. The backend imports this same catalog. Redeploy `create-order` and `retry-notifications` whenever you change it.
- Page copy: `index.html`, `shop.html`, `checkout.html` and `privacy.html`. Product-page copy: `js/products.js`.
- Photography and logo: `assets/`.
- Layout: `css/style.css`; checkout: `css/checkout.css`.
- Public checkout endpoint and CAPTCHA site key: `js/checkout-config.js`. Never put server keys here.

Every current hoodie is PKR 1,999. COD adds PKR 200 once per order. Easypaisa has no COD fee. Buy now carries the selected piece and size to checkout. Each order is for one style and size; quantity can be changed. There is no multi-item cart.

## Backend setup

See [Supabase setup](supabase/SETUP.md). It covers private receipts, Resend email alerts, spam protection and notification retries.

Screenshots do not automatically verify a transfer. Review actual Easypaisa funds, then confirm the customer manually on WhatsApp. This is manual transfer checkout, not an Easypaisa payment-gateway integration.

## Tests

With Node.js 22 or later:

```sh
node --test tests/orders.test.mjs tests/dashboard.test.mjs
```

The tests use fake services and never contact Supabase, send email or create real orders. They cover pricing, validation, private-file handling, retries and notification failure. Live database access, real email delivery and CAPTCHA still need deployment checks.

If deploying through the Supabase browser editor, use the standalone files in `supabase/dashboard/`. Regenerate them after changing products or backend code with `node scripts/package-dashboard-functions.mjs`. This is optional backend packaging, not a storefront build step.
