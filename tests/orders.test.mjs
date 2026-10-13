import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createOrderHandler, validateOrder, validateCartOrder, imageType, notifyOrders, notifyCustomerOrders, MAX_RECEIPT_BYTES } from "../supabase/functions/_shared/orders.mjs";

const base = {
  productId: "obsidian", size: "M", quantity: 1,
  customerName: "Test Customer", phone: "03001234567", city: "Faisalabad",
  address: "House 10, Test Street", email: "", notes: "",
  paymentMethod: "cod", transactionId: "", consent: true,
  requestKey: "11111111-1111-4111-8111-111111111111"
};
const env = {
  SUPABASE_URL: "https://test-project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-server-key",
  ALLOWED_ORIGINS: "https://shop.example", TURNSTILE_SECRET_KEY: "test-captcha-secret",
  TURNSTILE_HOSTNAMES: "shop.example", RESEND_API_KEY: "test-email-key",
  ORDER_ALERT_EMAIL: "merchant@example.com", ORDER_FROM_EMAIL: "Gumnaam <orders@example.com>",
  CRON_SECRET: "test-cron-secret"
};
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

function mockService(options = {}) {
  const rows = [];
  const uploads = new Map();
  const emails = [];
  const receipts = [];
  const calls = [];
  const fetcher = async (url, request = {}) => {
    calls.push([url, request]);
    if (url.includes("turnstile/v0")) return json({ success: !options.badCaptcha, action: "checkout", hostname: options.badHost ? "attacker.example" : "shop.example" });
    if (url === "https://api.resend.com/emails") {
      emails.push(JSON.parse(request.body));
      return options.emailFails || (options.customerEmailFails && request.headers["Idempotency-Key"].startsWith("gumnaam-customer")) ? json({ error: "Unavailable" }, 500) : json({ id: "email-1" });
    }
    assert.equal(request.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
    const path = new URL(url).pathname;
    if (path === "/storage/v1/bucket/payment-receipts") return json({ public: Boolean(options.publicBucket) });
    if (path.startsWith("/storage/v1/object/payment-receipts/") && request.method === "POST") {
      uploads.set(path.split("/").pop(), request.body);
      return json({ Key: path });
    }
    if (path === "/storage/v1/object/payment-receipts" && request.method === "DELETE") {
      for (const key of JSON.parse(request.body).prefixes) uploads.delete(key);
      return json([]);
    }
    if (path === "/rest/v1/rpc/gumnaam_check_order_limit") return json(!options.rateLimited);
    if (path === "/rest/v1/rpc/gumnaam_delivery_fee") return options.feeNotConfigured ? json({ error: "Not found" }, 404) : json(200);
    if (path === "/rest/v1/rpc/gumnaam_cart_version") return options.cartNotConfigured ? json({ error: "Not found" }, 404) : json(1);
    if (path === "/rest/v1/rpc/gumnaam_owner_version") return options.ownerNotConfigured ? json({ error: "Not found" }, 404) : json(1);
    if (path === "/rest/v1/rpc/gumnaam_customer_email_version") return options.customerNotConfigured ? json({}, 404) : json(1);
    if (path === "/rest/v1/rpc/gumnaam_claim_customer_emails") {
      if (options.customerNotConfigured) return json({}, 404);
      if (options.customerQueueFails) return json({}, 500);
      const input = JSON.parse(request.body);
      const picked = receipts.filter((receipt) => receipt.status === "pending" && (!input.order_reference || receipt.reference === input.order_reference)).slice(0, 5);
      picked.forEach((receipt) => { receipt.status = "sending"; receipt.attempts++; });
      return json(picked);
    }
    if (path === "/rest/v1/gumnaam_customer_emails") {
      if (options.customerAckFails && JSON.parse(request.body).status === "sent") { options.customerAckFails = false; return json({}, 500); }
      const params = new URL(url).searchParams;
      const receipt = receipts.find((row) => `eq.${row.reference}` === params.get("reference") && `eq.${row.status}` === params.get("status") && `eq.${row.attempts}` === params.get("attempts"));
      if (receipt) Object.assign(receipt, JSON.parse(request.body));
      return new Response(null, { status: 204 });
    }
    if (path === "/rest/v1/rpc/gumnaam_claim_notifications") {
      if (options.ownerQueueFails) return json({}, 500);
      const input = JSON.parse(request.body);
      const picked = rows.filter((row) => row.notification_status === "pending" && (!input.order_reference || row.reference === input.order_reference));
      picked.forEach((row) => { row.notification_status = "sending"; row.notification_attempts++; });
      return json(picked);
    }
    if (path === "/rest/v1/gumnaam_orders") {
      const params = new URL(url).searchParams;
      if (request.method === "POST") {
        if (options.insertFails) return json({ error: "Unavailable" }, 500);
        const data = JSON.parse(request.body);
        if (rows.some((row) => row.request_key === data.request_key)) return json({ error: "Duplicate" }, 409);
        const row = { ...data, id: rows.length + 1, notification_status: "pending", notification_attempts: 0 };
        rows.push(row);
        if (data.email && !options.customerNotConfigured) receipts.push({ reference: data.reference, status: "pending", attempts: 0, payload: { from: data.notification_payload.from, to: [data.email], subject: `Gumnaam / Order received ${data.reference}`, text: "Immutable customer receipt fixture" } });
        return json([row]);
      }
      if (request.method === "PATCH") {
        if (!params.has("id")) return new Response(null, { status: 204 });
        const row = rows.find((entry) => entry.id === Number(params.get("id").slice(3)));
        Object.assign(row, JSON.parse(request.body));
        return new Response(null, { status: 204 });
      }
      if (params.has("request_key")) return json(rows.filter((row) => `eq.${row.request_key}` === params.get("request_key")));
      if (params.has("receipt_path")) return json(rows.filter((row) => `eq.${row.receipt_path}` === params.get("receipt_path")));
      return json([]);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const tasks = [];
  const handler = createOrderHandler(env, fetcher, (task) => tasks.push(task));
  return { rows, receipts, uploads, emails, calls, handler, fetcher, tasks };
}

function request(overrides = {}, receipt, origin = "https://shop.example") {
  const form = new FormData();
  form.set("order", JSON.stringify({ ...base, ...overrides }));
  form.set("token", "test-token");
  if (receipt) form.set("receipt", receipt, "receipt.png");
  return new Request("https://test-project.supabase.co/functions/v1/create-order", { method: "POST", headers: { origin }, body: form });
}

test("all pieces are PKR 1,999 and use the same server catalog", () => {
  for (const piece of globalThis.GUMNAAM_PRODUCTS) assert.equal(validateOrder({ ...base, productId: piece.id }).unit_price, 1999);
});
test("delivery is PKR 200 once per order for both payment methods", () => {
  for (const paymentMethod of ["cod", "easypaisa"]) {
    for (const [quantity, total] of [[1, 2199], [2, 4198], [6, 12194]]) {
      const order = validateOrder({ ...base, paymentMethod, quantity, transactionId: "TX123456", cod_fee: 0, total: 1 });
      assert.equal(order.cod_fee, 200);
      assert.equal(order.total, total);
    }
  }
});
test("client prices are ignored and Pakistan phone is normalized", () => {
  const order = validateOrder({ ...base, total: 1, unit_price: 1, cod_fee: 0 });
  assert.equal(order.total, 2199);
  assert.equal(order.phone, "923001234567");
});
for (const [name, patch] of [
  ["unknown product", { productId: "fake" }], ["invalid size", { size: "XXXL" }],
  ["negative quantity", { quantity: -1 }], ["fractional quantity", { quantity: 1.5 }],
  ["too many pieces", { quantity: 99 }], ["invalid phone", { phone: "abc" }],
  ["missing address", { address: "" }], ["missing consent", { consent: false }],
  ["bad email", { email: "bad@" }], ["bad payment method", { paymentMethod: "paid" }],
  ["missing transaction", { paymentMethod: "easypaisa" }], ["bad retry key", { requestKey: "abc" }]
]) test(`rejects ${name}`, () => assert.throws(() => validateOrder({ ...base, ...patch })));

test("checks file bytes, not only extension", () => {
  assert.equal(imageType(png).mime, "image/png");
  assert.equal(imageType(new Uint8Array([255, 216, 255])).mime, "image/jpeg");
  assert.throws(() => imageType(new TextEncoder().encode("<svg></svg>")));
});
test("unconfigured checkout is closed", async () => {
  const handler = createOrderHandler({});
  assert.equal((await handler(new Request("https://test.example"))).status, 503);
  assert.equal((await handler(request({}, null, ""))).status, 503);
});
test("health checks table and private bucket", async () => {
  const mock = mockService();
  const response = await mock.handler(new Request("https://test.example", { headers: { origin: "https://shop.example" } }));
  assert.deepEqual(await response.json(), { ready: true, deliveryFee: 200, cartVersion: 1, ownerVersion: 1, customerEmailVersion: 1 });
  const bad = mockService({ publicBucket: true });
  assert.equal((await bad.handler(new Request("https://test.example"))).status, 503);
});

test("checkout stays closed until the delivery-fee database update is applied", async () => {
  const mock = mockService({ feeNotConfigured: true });
  const response = await mock.handler(new Request("https://test.example"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ready: false });
});

test("owner setup is optional for existing checkout but required for new email opt-ins", async () => {
  const mock = mockService({ ownerNotConfigured: true });
  const health = await mock.handler(new Request("https://test.example"));
  assert.deepEqual(await health.json(), { ready: true, deliveryFee: 200, cartVersion: 1, ownerVersion: 0, customerEmailVersion: 1 });
  const failed = await mock.handler(request({ email: "buyer@example.com", marketingConsent: true }));
  assert.equal(failed.status, 503);
  assert.equal(mock.rows.length, 0);
  assert.equal((await mock.handler(request())).status, 201);
  await Promise.all(mock.tasks);
});

test("email marketing is explicitly optional and never inferred from an email address", async () => {
  const defaultOrder = validateOrder({ ...base, email: "buyer@example.com" });
  assert.equal(defaultOrder.marketing_consent, undefined);
  assert.throws(() => validateOrder({ ...base, marketingConsent: true }));
  assert.throws(() => validateOrder({ ...base, email: "buyer@example.com", marketingConsent: "true" }));
  const opted = mockService();
  const response = await opted.handler(request({ email: "buyer@example.com", marketingConsent: true, marketing_consent_at: "2000-01-01" }));
  assert.equal(response.status, 201);
  assert.equal(opted.rows[0].marketing_consent, true);
  assert.equal(opted.rows[0].marketing_consent_version, "checkout-email-v1");
  assert.ok(Date.parse(opted.rows[0].marketing_consent_at) > Date.parse("2000-01-01"));
  assert.ok(opted.rows[0].notification_payload.text.includes("https://www.gumnaamofficial.com/admin"));
  const duplicate = await opted.handler(request({ email: "buyer@example.com", marketingConsent: true }));
  assert.equal(duplicate.status, 200);
  assert.equal(opted.rows.length, 1);
  await Promise.all(opted.tasks);
});
test("disallowed origin and failed CAPTCHA never save orders", async () => {
  const mock = mockService({ badCaptcha: true });
  assert.equal((await mock.handler(request({}, null, "https://attacker.example"))).status, 403);
  assert.equal((await mock.handler(request())).status, 400);
  assert.equal(mock.rows.length, 0);
});
test("CAPTCHA hostname is checked", async () => {
  const mock = mockService({ badHost: true });
  assert.equal((await mock.handler(request())).status, 400);
  assert.equal(mock.rows.length, 0);
});
test("COD persists before notifying and returns no private details", async () => {
  const mock = mockService();
  const response = await mock.handler(request());
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ["reference", "status", "total"]);
  assert.equal(result.status, "pending_confirmation");
  assert.equal(result.total, 2199);
  await Promise.all(mock.tasks);
  assert.equal(mock.rows[0].notification_status, "sent");
  assert.match(mock.emails[0].text, /https:\/\/wa.me\/923001234567/);
  assert.match(mock.emails[0].text, /Delivery: PKR 200/);
  assert.doesNotMatch(mock.emails[0].text, /COD charge:/);
  assert.equal(mock.uploads.size, 0);
});
test("identical retry does not duplicate an order", async () => {
  const mock = mockService();
  const first = await (await mock.handler(request())).json();
  const second = await (await mock.handler(request())).json();
  assert.equal(first.reference, second.reference);
  assert.equal(mock.rows.length, 1);
  await Promise.all(mock.tasks);
  assert.equal(mock.emails.length, 1);
});
test("concurrent retries produce only one saved order", async () => {
  const mock = mockService();
  const responses = await Promise.all([mock.handler(request()), mock.handler(request())]);
  const results = await Promise.all(responses.map((response) => response.json()));
  assert.equal(results[0].reference, results[1].reference);
  assert.equal(mock.rows.length, 1);
  await Promise.all(mock.tasks);
});
test("changing data under the same retry key is rejected", async () => {
  const mock = mockService();
  await mock.handler(request());
  assert.equal((await mock.handler(request({ quantity: 2 }))).status, 409);
  assert.equal(mock.rows.length, 1);
  await Promise.all(mock.tasks);
});
test("Easypaisa stores private screenshot and awaits verification", async () => {
  const mock = mockService();
  const response = await mock.handler(request({ paymentMethod: "easypaisa", transactionId: "TX123456" }, new Blob([png], { type: "image/png" })));
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.total, 2199);
  assert.equal(mock.rows[0].cod_fee, 200);
  assert.equal(result.status, "pending_verification");
  assert.equal(mock.uploads.size, 1);
  assert.match(mock.rows[0].receipt_path, /^[a-f0-9-]+\.png$/);
  await Promise.all(mock.tasks);
  assert.match(mock.emails[0].text, /Supabase login required/);
  assert.match(mock.emails[0].text, /Delivery: PKR 200/);
  assert.match(mock.emails[0].text, /Total: PKR 2199/);
  assert.doesNotMatch(mock.emails[0].text, /object\/public/);
});
test("simultaneous Easypaisa retries clean up the unused upload", async () => {
  const mock = mockService();
  const send = () => mock.handler(request({ paymentMethod: "easypaisa", transactionId: "TX123456" }, new Blob([png], { type: "image/png" })));
  await Promise.all([send(), send()]);
  assert.equal(mock.rows.length, 1);
  assert.equal(mock.uploads.size, 1);
  await Promise.all(mock.tasks);
});
test("receipt cannot be uploaded into a public bucket", async () => {
  const mock = mockService({ publicBucket: true });
  assert.equal((await mock.handler(request({ paymentMethod: "easypaisa", transactionId: "TX123456" }, new Blob([png], { type: "image/png" })))).status, 503);
  assert.equal(mock.uploads.size, 0);
});
test("rejects a spoofed receipt and a too-large screenshot", async () => {
  const mock = mockService();
  const prepaid = { paymentMethod: "easypaisa", transactionId: "TX123456" };
  assert.equal((await mock.handler(request(prepaid, new Blob(["not a PNG"], { type: "image/png" })))).status, 400);
  assert.equal((await mock.handler(request(prepaid, new Blob([new Uint8Array(MAX_RECEIPT_BYTES + 32769)], { type: "image/png" })))).status, 413);
  assert.equal(mock.rows.length, 0);
});
test("failed insert removes orphan screenshot", async () => {
  const mock = mockService({ insertFails: true });
  assert.equal((await mock.handler(request({ paymentMethod: "easypaisa", transactionId: "TX123456" }, new Blob([png], { type: "image/png" })))).status, 503);
  assert.equal(mock.uploads.size, 0);
});
test("email outage does not discard an order and is retried", async () => {
  const options = { emailFails: true };
  const mock = mockService(options);
  assert.equal((await mock.handler(request())).status, 201);
  await Promise.all(mock.tasks);
  assert.equal(mock.rows[0].notification_status, "pending");
  assert.equal(mock.rows.length, 1);
  options.emailFails = false;
  await notifyOrders(env, null, mock.fetcher);
  assert.equal(mock.rows[0].notification_status, "sent");
  assert.deepEqual(mock.emails[0], mock.emails[1]);
});
test("rate-limited attempts never insert or upload", async () => {
  const mock = mockService({ rateLimited: true });
  assert.equal((await mock.handler(request())).status, 429);
  assert.equal(mock.rows.length, 0);
});
test("browser scripts parse without a build tool", async () => {
  for (const file of ["products.js", "main.js", "checkout.js", "checkout-config.js"]) {
    new vm.Script(await readFile(new URL(`../js/${file}`, import.meta.url), "utf8"), { filename: file });
  }
});

test("multi-item pricing is server-derived for both payment methods", () => {
  for (const paymentMethod of ["cod", "easypaisa"]) {
    const order = validateCartOrder({ ...base, paymentMethod, transactionId: "TEST-ONLY", total: 1, items: [{ productId: "obsidian", size: "M", quantity: 1, price: 1 }, { productId: "camel", size: "L", quantity: 2 }] });
    assert.equal(order.subtotal, 5997);
    assert.equal(order.total, 6197);
    assert.equal(order.cod_fee, 200);
    assert.equal(order.quantity, 3);
    assert.equal(order.line_items.length, 2);
  }
});
test("multi-item checkout rejects duplicate lines, aggregate overstock and more than ten pieces", () => {
  for (const items of [
    [], [null], [{ productId: "fake", size: "M", quantity: 1 }],
    [{ productId: "obsidian", size: "M", quantity: 1 }, { productId: "obsidian", size: "M", quantity: 1 }],
    [{ productId: "obsidian", size: "M", quantity: 4 }, { productId: "obsidian", size: "L", quantity: 4 }],
    [{ productId: "obsidian", size: "M", quantity: 6 }, { productId: "navy", size: "L", quantity: 6 }]
  ]) assert.throws(() => validateCartOrder({ ...base, items }));
});
test("multi-item COD and Easypaisa persist all lines and email the complete summary", async () => {
  for (const paymentMethod of ["cod", "easypaisa"]) {
    const mock = mockService();
    const response = await mock.handler(request({ paymentMethod, transactionId: "TEST-ONLY", items: [{ productId: "obsidian", size: "M", quantity: 1 }, { productId: "camel", size: "L", quantity: 1 }] }, paymentMethod === "easypaisa" ? new Blob([png], { type: "image/png" }) : null));
    assert.equal(response.status, 201);
    assert.equal((await response.json()).total, 4198);
    assert.equal(mock.rows[0].line_items.length, 2);
    await Promise.all(mock.tasks);
    assert.match(mock.emails[0].text, /Black Hoodie \/ M \/ quantity 1/);
    assert.match(mock.emails[0].text, /Camel Hoodie \/ L \/ quantity 1/);
    assert.match(mock.emails[0].text, /Delivery: PKR 200/);
    assert.match(mock.emails[0].text, /Total: PKR 4198/);
  }
});
test("cart database update is optional for legacy single-piece orders", async () => {
  const mock = mockService({ cartNotConfigured: true });
  const health = await (await mock.handler(new Request("https://test.example"))).json();
  assert.equal(health.ready, true);
  assert.equal(health.cartVersion, 0);
  assert.equal((await mock.handler(request())).status, 201);
  await Promise.all(mock.tasks);
  const missing = await mock.handler(request({ requestKey: "22222222-2222-4222-8222-222222222222", items: [{ productId: "camel", size: "M", quantity: 1 }] }));
  assert.equal(missing.status, 503);
  assert.equal(mock.rows.length, 1);
});
test("cart retry order is stable even when line ordering changes", async () => {
  const mock = mockService();
  const items = [{ productId: "obsidian", size: "M", quantity: 1 }, { productId: "camel", size: "L", quantity: 1 }];
  const first = await (await mock.handler(request({ items }))).json();
  const retry = await (await mock.handler(request({ items: [...items].reverse() }))).json();
  assert.equal(first.reference, retry.reference);
  assert.equal(mock.rows.length, 1);
  await Promise.all(mock.tasks);
});

test("customer receipts are independent of marketing and use a separate provider key", async () => {
  const mock = mockService();
  const response = await mock.handler(request({ email: "buyer@example.com", marketingConsent: false }));
  const result = await response.json();
  await Promise.all(mock.tasks);
  assert.equal(mock.rows[0].marketing_consent, undefined);
  assert.equal(mock.receipts.length, 1);
  assert.equal(mock.receipts[0].status, "sent");
  const send = mock.calls.find(([url, options]) => url === "https://api.resend.com/emails" && options.headers["Idempotency-Key"].startsWith("gumnaam-customer"));
  assert.equal(send[1].headers["Idempotency-Key"], `gumnaam-customer-receipt/${result.reference}`);
  assert.deepEqual(JSON.parse(send[1].body).to, ["buyer@example.com"]);
  assert.equal(mock.emails.length, 2);
  assert.ok(mock.calls.findIndex(([url, options]) => url.endsWith("/gumnaam_orders") && options.method === "POST") < mock.calls.indexOf(send));
  assert.equal((await mock.handler(request({ email: "buyer@example.com", marketingConsent: false }))).status, 200);
  await Promise.all(mock.tasks);
  assert.equal(mock.emails.length, 2);
});

test("customers without an email still order and receive no email queue entry", async () => {
  const mock = mockService();
  assert.equal((await mock.handler(request())).status, 201);
  await Promise.all(mock.tasks);
  assert.equal(mock.receipts.length, 0);
  assert.equal(mock.emails.length, 1);
});

test("simultaneous checkouts create only one customer receipt and one owner alert", async () => {
  const mock = mockService();
  const responses = await Promise.all([mock.handler(request({ email: "buyer@example.com" })), mock.handler(request({ email: "buyer@example.com" }))]);
  const results = await Promise.all(responses.map((response) => response.json()));
  await Promise.all(mock.tasks);
  assert.equal(results[0].reference, results[1].reference);
  assert.equal(mock.receipts.length, 1);
  assert.equal(mock.emails.length, 2);
});

test("lost database acknowledgement retries a customer send with the same provider key", async () => {
  const mock = mockService({ customerAckFails: true });
  await mock.handler(request({ email: "buyer@example.com" }));
  await Promise.all(mock.tasks);
  assert.equal(mock.receipts[0].status, "pending");
  await notifyCustomerOrders(env, null, mock.fetcher);
  assert.equal(mock.receipts[0].status, "sent");
  const sends = mock.calls.filter(([url, options]) => url === "https://api.resend.com/emails" && options.headers["Idempotency-Key"].startsWith("gumnaam-customer"));
  assert.equal(sends.length, 2);
  assert.equal(sends[0][1].headers["Idempotency-Key"], sends[1][1].headers["Idempotency-Key"]);
  assert.equal(sends[0][1].body, sends[1][1].body);
});

test("customer mail failure preserves the order, owner alert, and immutable retry payload", async () => {
  const options = { customerEmailFails: true };
  const mock = mockService(options);
  assert.equal((await mock.handler(request({ email: "buyer@example.com" }))).status, 201);
  await Promise.all(mock.tasks);
  assert.equal(mock.rows[0].notification_status, "sent");
  assert.equal(mock.receipts[0].status, "pending");
  assert.equal(mock.receipts[0].attempts, 1);
  assert.ok(Date.parse(mock.receipts[0].next_at) > Date.now());
  options.customerEmailFails = false;
  await notifyOrders(env, null, mock.fetcher);
  assert.equal(mock.receipts[0].status, "sent");
  assert.equal(mock.receipts[0].attempts, 2);
  const sends = mock.calls.filter(([url, options]) => url === "https://api.resend.com/emails" && options.headers["Idempotency-Key"].startsWith("gumnaam-customer"));
  assert.equal(sends[0][1].body, sends[1][1].body);
  assert.equal(sends[0][1].headers["Idempotency-Key"], sends[1][1].headers["Idempotency-Key"]);
  assert.equal(mock.rows.length, 1);
});

test("owner queue failure does not prevent independent customer delivery", async () => {
  const mock = mockService({ ownerQueueFails: true });
  await mock.handler(request({ email: "buyer@example.com" }));
  await Promise.all(mock.tasks.map((task) => task.catch(() => {})));
  assert.equal(mock.receipts[0].status, "sent");
});

test("customer queue failure does not prevent independent owner delivery", async () => {
  const mock = mockService({ customerQueueFails: true });
  await mock.handler(request({ email: "buyer@example.com" }));
  await Promise.all(mock.tasks.map((task) => task.catch(() => {})));
  assert.equal(mock.rows[0].notification_status, "sent");
});

test("missing customer migration does not break existing checkout or owner alerts", async () => {
  const mock = mockService({ customerNotConfigured: true });
  const health = await (await mock.handler(new Request("https://test.example"))).json();
  assert.equal(health.ready, true);
  assert.equal(health.customerEmailVersion, 0);
  assert.equal((await mock.handler(request({ email: "buyer@example.com" }))).status, 201);
  await Promise.all(mock.tasks);
  assert.equal(mock.rows[0].notification_status, "sent");
  assert.deepEqual(await notifyCustomerOrders(env, null, mock.fetcher), { available: false, attempted: 0, sent: 0 });
});

test("exhausted customer sends are failed, not silently marked delivered", async () => {
  const options = { customerEmailFails: true };
  const mock = mockService(options);
  await mock.handler(request({ email: "buyer@example.com" }));
  await Promise.all(mock.tasks);
  mock.receipts[0].attempts = 11;
  await notifyCustomerOrders(env, null, mock.fetcher);
  assert.equal(mock.receipts[0].status, "failed");
  assert.equal(mock.receipts[0].attempts, 12);
  assert.equal(mock.rows[0].status, "pending_confirmation");
});
