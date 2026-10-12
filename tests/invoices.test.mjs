import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { invoiceTotals, INVOICE_HOODIES } from "../js/invoice-model.mjs";
import { validateInvoice, invoiceHash } from "../supabase/functions/_shared/invoices.mjs";
import { createOwnerHandler } from "../supabase/functions/_shared/owner.mjs";

const input = { requestKey: "11111111-1111-4111-8111-111111111111", customerName: "Walk-in customer", email: "", phone: "", items: [{ productId: "obsidian", size: "M", quantity: 1, unitPrice: 1999 }], discount: 0, amountPaid: 1999, paymentMethod: "cash", paymentReference: "", notes: "" };
test("walk-in prices and exact colour names default to the requested four hoodies", () => {
  assert.deepEqual(INVOICE_HOODIES.map((p) => p.name), ["Black", "Navy Blue", "Camel", "Olive Green"]);
  assert.ok(INVOICE_HOODIES.every((p) => p.price === 1999));
});

test("storefront catalogue keeps original IDs and adopts the same hoodie names", async () => {
  await import("../js/products.js");
  const products = globalThis.GUMNAAM_PRODUCTS;
  for (const invoiceProduct of INVOICE_HOODIES) {
    const product = products.find((entry) => entry.id === invoiceProduct.id);
    assert.equal(product.name, `${invoiceProduct.name} Hoodie`);
    assert.equal(product.shortName, invoiceProduct.name);
    assert.equal(product.price, invoiceProduct.price);
  }
});
test("invoice totals include multiple sizes and discounts, never delivery", () => {
  const lines = [{ productId: "obsidian", size: "M", quantity: 2, unitPrice: 1999 }, { productId: "olive", size: "L", quantity: 1, unitPrice: 1999 }];
  assert.deepEqual(invoiceTotals(lines, 497, 5000), { subtotal: 5997, discount: 497, total: 5500, paid: 5000, balance: 500, pieces: 3 });
  assert.equal(validateInvoice(input).total, 1999);
  assert.equal(validateInvoice(input).cod_fee, undefined);
});
test("invoice line validation rejects invalid quantities, prices, discounts and overpayment", () => {
  for (const line of [{ quantity: 0 }, { quantity: 1.2 }, { quantity: 101 }, { unitPrice: -1 }, { unitPrice: NaN }, { unitPrice: 1999.5 }, { unitPrice: 100001 }, { productId: "fake" }, { size: "XXL" }]) assert.throws(() => invoiceTotals([{ ...input.items[0], ...line }]));
  for (const [discount, paid] of [[1999, 0], [-1, 0], [0.5, 0], [0, 2000], [0, -1], [0, NaN]]) assert.throws(() => invoiceTotals(input.items, discount, paid));
  assert.throws(() => invoiceTotals([]));
  assert.throws(() => invoiceTotals([input.items[0], input.items[0]]));
  assert.throws(() => invoiceTotals([{ ...input.items[0], quantity: 60 }, { ...input.items[0], size: "L", quantity: 60 }]));
});
test("invoice server ignores forged totals, names, status, actor and delivery fees", () => {
  const record = validateInvoice({ ...input, subtotal: 1, total: 1, codFee: 200, status: "paid", actor_id: "fake", items: [{ ...input.items[0], product_name: "fake" }] });
  assert.equal(record.subtotal, 1999); assert.equal(record.total, 1999); assert.equal(record.line_items[0].product_name, "Black");
  assert.equal(record.actor_id, undefined); assert.equal(record.status, undefined); assert.equal(record.cod_fee, undefined);
});
test("owner can set an in-person negotiated price without changing the storefront", () => {
  const record = validateInvoice({ ...input, items: [{ ...input.items[0], unitPrice: 1800 }], amountPaid: 1000 });
  assert.equal(record.total, 1800); assert.equal(record.amount_paid, 1000); assert.equal(INVOICE_HOODIES[0].price, 1999);
});
test("invoice contact fields are optional, validated, normalised and never marketing consent", () => {
  const record = validateInvoice({ ...input, phone: "+92 300 1234567", email: " Buyer@Example.com ", marketingConsent: true });
  assert.equal(record.phone, "923001234567"); assert.equal(record.email, "buyer@example.com"); assert.equal(record.marketing_consent, undefined);
  for (const patch of [{ phone: "abc" }, { email: "bad" }, { email: "a@b.com\r\nX-Test:1" }, { customerName: "a" }, { notes: "a".repeat(1001) }, { paymentMethod: "cod" }, { requestKey: "fake" }]) assert.throws(() => validateInvoice({ ...input, ...patch }));
});
test("invoice hash is stable across line order and changes when money/details change", async () => {
  const second = { productId: "navy", size: "L", quantity: 1, unitPrice: 1999 };
  const first = await invoiceHash(validateInvoice({ ...input, items: [...input.items, second] }));
  const reordered = await invoiceHash(validateInvoice({ ...input, items: [second, ...input.items] }));
  assert.equal(first, reordered);
  assert.notEqual(first, await invoiceHash(validateInvoice({ ...input, items: [...input.items, second], discount: 100 })));
});
const ownerId = "22222222-2222-4222-8222-222222222222";
const env = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "private-test-key", ALLOWED_ORIGINS: "https://shop.example" };
function server(options = {}) {
  const calls = [], saved = new Map();
  const handler = createOwnerHandler(env, async (url, request = {}) => {
    calls.push({ url, request });
    const path = new URL(url).pathname;
    if (path === "/auth/v1/user") return Response.json({ id: ownerId, email_confirmed_at: "2026-01-01", email: "owner@example.com" });
    if (path === "/rest/v1/gumnaam_owners") return Response.json(options.notOwner ? [] : [{ user_id: ownerId }]);
    if (path === "/rest/v1/rpc/gumnaam_invoice_create") {
      const data = JSON.parse(request.body); assert.equal(data.p_actor, ownerId);
      if (saved.has(data.p_order.request_key) && saved.get(data.p_order.request_key).hash !== data.p_hash) return Response.json({ code: "40001", message: "Invoice details changed" }, { status: 400 });
      if (!saved.has(data.p_order.request_key)) saved.set(data.p_order.request_key, { hash: data.p_hash, number: "GINV-2026-000001", total: data.p_order.total });
      return Response.json(saved.get(data.p_order.request_key));
    }
    if (path === "/rest/v1/rpc/gumnaam_invoice_list") return Response.json({ total: 0, rows: [], summary: { invoiced: 0, paid: 0, balance: 0, refunded: 0 } });
    if (path === "/rest/v1/gumnaam_invoices") return Response.json([{ number: "GINV-2026-000001", total: 1999 }]);
    if (path === "/rest/v1/rpc/gumnaam_invoice_update") return options.conflict ? Response.json({ code: "40001", message: "Invoice changed. Reopen before saving." }, { status: 400 }) : Response.json({ number: "GINV-2026-000001", version: 2 });
    throw new Error(`Unexpected call ${url}`);
  });
  return { handler, calls, saved };
}
function request(action, body, authenticate = true, extra = "") {
  return new Request(`https://test.supabase.co/functions/v1/owner-api?action=${action}${extra}`, { method: body ? "POST" : "GET", headers: { origin: "https://shop.example", ...(authenticate ? { authorization: "Bearer test.jwt.signature" } : {}), ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
test("invoice endpoints require the same owner auth as private orders", async () => {
  const anonymous = server(); assert.equal((await anonymous.handler(request("invoice-create", input, false))).status, 401); assert.equal(anonymous.calls.length, 0);
  const customer = server({ notOwner: true }); assert.equal((await customer.handler(request("invoice-create", input))).status, 403); assert.equal(customer.saved.size, 0);
});
test("invoice saves are server-calculated, idempotent and never create online orders/email", async () => {
  const app = server();
  for (let i = 0; i < 2; i++) { const response = await app.handler(request("invoice-create", { ...input, actor_id: "forged", total: 1 })); assert.equal(response.status, 201); assert.equal((await response.json()).invoice.total, 1999); }
  assert.equal(app.saved.size, 1);
  assert.equal((await app.handler(request("invoice-create", { ...input, notes: "Changed" }))).status, 409);
  assert.ok(app.calls.every(({ url }) => !/gumnaam_orders|resend|turnstile/.test(url)));
});
test("invoice retrieval validates number and requests only safe columns", async () => {
  const app = server();
  assert.equal((await app.handler(request("invoice", null, true, "&number=bad"))).status, 400);
  assert.equal((await app.handler(request("invoice", null, true, "&number=GINV-2026-000001"))).status, 200);
  const call = app.calls.find(({ url }) => url.includes("gumnaam_invoices?")); assert.doesNotMatch(call.url, /payload_hash|request_key|created_by/);
});
test("invoice payment updates are bounded, versioned and use the verified owner", async () => {
  const app = server();
  const update = { number: "GINV-2026-000001", version: 1, amountPaid: 1999, paymentMethod: "cash", paymentReference: "", void: false, reason: "Cash received" };
  assert.equal((await app.handler(request("invoice-update", update))).status, 200);
  const call = app.calls.find(({ url }) => url.endsWith("gumnaam_invoice_update")); assert.equal(JSON.parse(call.request.body).p_actor, ownerId);
  for (const patch of [{ amountPaid: -1 }, { amountPaid: 1.5 }, { void: "true" }, { reason: "" }, { paymentMethod: "cod" }, { version: 0 }]) assert.equal((await app.handler(request("invoice-update", { ...update, ...patch }))).status, 400);
  assert.equal((await server({ conflict: true }).handler(request("invoice-update", update))).status, 409);
});
test("invoice schema is private, immutable in totals and protects retries/concurrent payments", async () => {
  const sql = await readFile(new URL("../supabase/invoices.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/); assert.doesNotMatch(sql, /grant .* to (anon|authenticated)|security definer/i);
  assert.match(sql, /pg_advisory_xact_lock/); assert.match(sql, /payload_hash <> p_hash/); assert.match(sql, /old_invoice.version <> p_version/); assert.match(sql, /for update/);
  assert.match(sql, /status = 'issued'/); assert.match(sql, /refunded_amount = case when p_void then old_invoice.amount_paid/);
  const update = sql.split("create or replace function public.gumnaam_invoice_update")[1]; assert.doesNotMatch(update, /set total|line_items =|customer_name =/);
  assert.doesNotMatch(sql, /delete from|gumnaam_orders|marketing_consent/);
});
