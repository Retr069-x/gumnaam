import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createOrderHandler, validateOrder, imageType, notifyOrders, MAX_RECEIPT_BYTES } from "../supabase/functions/_shared/orders.mjs";

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
  const calls = [];
  const fetcher = async (url, request = {}) => {
    calls.push([url, request]);
    if (url.includes("turnstile/v0")) return json({ success: !options.badCaptcha, action: "checkout", hostname: options.badHost ? "attacker.example" : "shop.example" });
    if (url === "https://api.resend.com/emails") {
      emails.push(JSON.parse(request.body));
      return options.emailFails ? json({ error: "Unavailable" }, 500) : json({ id: "email-1" });
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
    if (path === "/rest/v1/rpc/gumnaam_claim_notifications") {
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
  return { rows, uploads, emails, calls, handler, fetcher, tasks };
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
  assert.deepEqual(await response.json(), { ready: true, deliveryFee: 200 });
  const bad = mockService({ publicBucket: true });
  assert.equal((await bad.handler(new Request("https://test.example"))).status, 503);
});

test("checkout stays closed until the delivery-fee database update is applied", async () => {
  const mock = mockService({ feeNotConfigured: true });
  const response = await mock.handler(new Request("https://test.example"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ready: false });
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
