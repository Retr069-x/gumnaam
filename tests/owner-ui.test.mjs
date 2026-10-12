import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as model from "../js/owner-model.mjs";
import * as invoiceModel from "../js/invoice-model.mjs";
import { INVOICE_CONTACTS } from "../js/invoice-pdf.mjs";

const html = await readFile(new URL("../admin.html", import.meta.url), "utf8");
const source = (await readFile(new URL("../js/owner.js", import.meta.url), "utf8")).replace(/^import [^\n]+\r?\n/gm, "");
const invoiceSource = (await readFile(new URL("../js/owner-invoices.mjs", import.meta.url), "utf8")).replace(/^import [^\n]+\r?\n/gm, "").replace(/^export /gm, "");
class Element {
  constructor(tag, document) { this.tagName = tag; this.document = document; this.children = []; this.attributes = {}; this.dataset = {}; this.events = {}; this.style = {}; this._text = ""; this._value = undefined; this.hidden = false; this.open = false; this.disabled = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  get value() { return this._value ?? (this.tagName === "select" ? this.children[0]?.value || "" : ""); }
  set value(value) { this._value = value; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this._text = ""; this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === "id") this.id = value; if (name === "class") this.className = value; if (name === "name") this.name = value; if (name === "type") this.type = value; if (name === "value") this.value = value; if (name === "hidden") this.hidden = true; if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, handler, options) { (this.events[name] ||= []).push({ handler, once: options?.once }); }
  async fire(name, extra = {}) { const event = { target: this, currentTarget: this, preventDefault() {}, ...extra }; for (const item of [...this.events[name] || []]) { await item.handler(event); if (item.once) this.events[name] = this.events[name].filter((entry) => entry !== item); } }
  matches(selector) {
    const tag = selector.match(/^[a-z-]+/)?.[0]; if (tag && this.tagName !== tag) return false;
    const id = selector.match(/#([\w-]+)/)?.[1]; if (id && this.id !== id) return false;
    const cl = selector.match(/\.([\w-]+)/)?.[1]; if (cl && !(this.className || "").split(" ").includes(cl)) return false;
    for (const [, name, raw] of selector.matchAll(/\[([\w-]+)(?:=([^\]]+))?\]/g)) { const value = raw?.replace(/^['"]|['"]$/g, ""); const actual = name === "open" ? this.open ? "" : undefined : name.startsWith("data-") ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : this.attributes[name] ?? this[name]; if (actual === undefined || (value !== undefined && String(actual) !== value)) return false; }
    return true;
  }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  querySelectorAll(selector) {
    const parts = selector.split(" ");
    return this.all().filter((element) => { if (!element.matches(parts.at(-1))) return false; let ancestor = element.parent; for (let i = parts.length - 2; i >= 0; i--) { while (ancestor && !ancestor.matches(parts[i])) ancestor = ancestor.parent; if (!ancestor) return false; ancestor = ancestor.parent; } return true; });
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  get elements() { return new Proxy({}, { get: (_, name) => this.all().find((child) => child.name === name) }); }
  reportValidity() { return true; }
  reset() { for (const child of this.all()) { if (["input", "textarea", "select"].includes(child.tagName)) { child._value = child.attributes.value; child.checked = Boolean(child.attributes.checked); } } }
  focus() { this.document.activeElement = this; }
  showModal() { if (this.open) throw new Error("Already open"); this.open = true; }
  close() { this.open = false; this.fire("close"); }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
  click() {}
}
function documentFixture() {
  const document = new Element("document"); document.document = document;
  document.createElement = (tag) => new Element(tag, document);
  const stack = [document];
  const voidTags = new Set(["meta", "link", "img", "input", "br"]);
  for (const part of html.match(/<[^>]+>|[^<]+/g)) {
    if (part.startsWith("<!")) continue;
    if (part.startsWith("</")) { stack.pop(); continue; }
    if (part.startsWith("<")) {
      const tag = part.match(/^<([a-z0-9-]+)/)?.[1]; if (!tag) continue;
      const element = document.createElement(tag);
      for (const [, key, value] of part.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)) element.setAttribute(key, value ?? "");
      stack.at(-1).append(element);
      if (!voidTags.has(tag)) stack.push(element);
    } else stack.at(-1)._text += part.replaceAll("&amp;", "&").trim();
  }
  document.body = document.querySelector("body");
  return document;
}
const ref = "GM-0123456789ABCDEF";
const order = { reference: ref, created_at: "2026-10-01T10:00:00Z", status: "pending_confirmation", payment_method: "cod", payment_status: "unverified", customer_name: "<img onerror=alert(1)>", phone: "923001234567", email: "buyer@example.com", city: "Faisalabad", address: "House 10, Test Street", notes: "", product_name: "Obsidian", size: "M", quantity: 1, unit_price: 1999, cod_fee: 200, total: 2199, version: 1, notification_status: "sent", notification_attempts: 1, is_test: false, internal_note: "", courier: "", tracking_number: "" };
async function settle() { await new Promise(setImmediate); }
async function app(options = {}) {
  const document = documentFixture(); const requests = []; let authorised = false; const windowEvents = {};
  const auth = { async signIn() { authorised = true; return null; }, async token() { if (!authorised) throw new Error("Sign in"); return "test.jwt.signature"; }, async factors() { return []; }, async signOut() { authorised = false; }, clear() { authorised = false; } };
  const fetcher = async (url, request) => {
    const action = new URL(url).searchParams.get("action"); requests.push({ action, url, request });
    if (options.deferOrders && action === "orders") return options.deferOrders;
    let result;
    if (action === "me") result = { owner: { email: "owner@example.com" }, version: 1 };
    if (action === "overview") result = { summary: { orders: 1, customers: 1, delivered_paid_value: 2199, merchandise_revenue: 1999, delivery_collected: 200, payments_recorded: 2199, awaiting_payment: 0, refunded_value: 0, delivered_paid_orders: 1, pending: 0, confirmed: 0, dispatched: 0, delivered: 1, cancelled: 0, verify_payments: 0, failed_alerts: 0, aged_pending: 0, cancelled_paid: 0 }, daily: [{ day: "2026-10-01", revenue: 2199, orders: 1 }], products: [{ name: "Obsidian", units: 1, value: 1999 }], cities: [{ city: "Faisalabad", orders: 1 }] };
    if (action === "orders") result = { total: 1, rows: [order] };
    if (action === "customers") result = { total: 1, rows: [{ name: order.customer_name, email: order.email, phone: order.phone, city: order.city, orders: 1, last_order: order.created_at, delivered_paid_value: 0, marketing_eligible: false }] };
    if (action === "order") result = { order, audit: [] };
    if (action === "update") result = { reference: ref, version: 2 };
    if (action === "audit") result = { rows: [] };
    if (action === "invoices") result = { total: 0, rows: [], summary: { invoiced: 0, paid: 0, balance: 0, refunded: 0 } };
    if (action === "invoice-create") {
      const body = JSON.parse(request.body);
      const subtotal = body.items.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
      result = { invoice: { number: "GINV-2026-000001", created_at: "2026-10-13T10:00:00Z", customer_name: body.customerName, email: body.email, phone: body.phone, line_items: body.items.map((line) => ({ product_name: invoiceModel.INVOICE_HOODIES.find((p) => p.id === line.productId).name, size: line.size, quantity: line.quantity, unit_price: line.unitPrice })), subtotal, discount: body.discount, total: subtotal - body.discount, amount_paid: body.amountPaid, refunded_amount: 0, payment_method: body.paymentMethod, payment_reference: body.paymentReference, notes: body.notes, status: "issued", version: 1 } };
    }
    return new Response(JSON.stringify(result), { status: 200 });
  };
  vm.runInNewContext(`${invoiceSource}\n${source}`, { ...model, ...invoiceModel, INVOICE_CONTACTS, customerInvoicePDF: async () => new Blob(['test'], { type: 'application/pdf' }), createOwnerAuth: () => auth, window: { GUMNAAM_OWNER: { endpoint: "https://test.supabase.co/functions/v1/owner-api" }, addEventListener: (name, callback) => { windowEvents[name] = callback; }, crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' }, print() {} }, document, fetch: fetcher, URL, URLSearchParams, AbortSignal, Intl, Date, setInterval() {}, setTimeout, FormData: class { constructor(form) { this.values = form.all().filter((el) => el.name && !(el.type === "checkbox" && !el.checked)).map((el) => [el.name, el.type === "checkbox" ? "on" : el.value]); } get(key) { return this.values.find(([name]) => name === key)?.[1] ?? null; } [Symbol.iterator]() { return this.values[Symbol.iterator](); } } });
  const click = async (element) => { await document.fire("click", { target: element }); await settle(); };
  const login = async () => { await document.querySelector("#login-form").fire("submit"); await settle(); };
  return { document, requests, click, login, windowEvents };
}
test("owner UI is closed until sign-in and renders private overview after authorised readiness", async () => {
  const ui = await app();
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.document.querySelector("#workspace").hidden, true);
  await ui.login();
  assert.equal(ui.document.querySelector("#workspace").hidden, false);
  assert.equal(ui.document.querySelector("#metrics").children.length, 8);
  assert.match(ui.document.querySelector("#metrics").textContent, /PKR 2,199/);
});
test("order and customer records render as text, not injected markup", async () => {
  const ui = await app(); await ui.login();
  await ui.document.querySelector("#owner-nav").fire("click", { target: ui.document.querySelector('[data-view="orders"]') }); await settle();
  assert.match(ui.document.querySelector("#order-rows").textContent, /<img onerror=alert\(1\)>/);
  assert.equal(ui.document.querySelectorAll("#order-rows img").length, 0);
  await ui.click(ui.document.querySelector("[data-order]"));
  assert.equal(ui.document.querySelector("#order-detail").open, true);
  assert.equal(ui.document.querySelector("#order-editor").elements.payment_status.value, "unverified");
  assert.equal(ui.document.querySelectorAll("#detail-content img").length, 0);
});
test("owner editor sends only chosen changes with a version and reason after confirmation", async () => {
  const ui = await app(); await ui.login();
  await ui.document.querySelector("#owner-nav").fire("click", { target: ui.document.querySelector('[data-view="orders"]') }); await settle();
  await ui.click(ui.document.querySelector("[data-order]"));
  const form = ui.document.querySelector("#order-editor");
  form.elements.status.value = "confirmed"; form.elements.reason.value = "Stock checked";
  const task = ui.document.querySelector("#detail-content").fire("submit", { target: form });
  await settle();
  assert.equal(ui.document.querySelector("#confirm-dialog").open, true);
  assert.ok(!ui.requests.some((request) => request.action === "update"));
  ui.document.querySelector("#confirm-dialog").returnValue = "confirm"; ui.document.querySelector("#confirm-dialog").close(); await task; await settle();
  const update = JSON.parse(ui.requests.find((request) => request.action === "update").request.body);
  assert.deepEqual(update.patch, { status: "confirmed" });
  assert.equal(update.version, 1); assert.equal(update.reason, "Stock checked");
});
test("sign-out clears visible records, dialog content and authenticator image", async () => {
  const ui = await app(); await ui.login();
  await ui.document.querySelector("#sign-out").fire("click");
  assert.equal(ui.document.querySelector("#workspace").hidden, true);
  assert.equal(ui.document.querySelector("#login-view").hidden, false);
  assert.equal(ui.document.querySelector("#metrics").children.length, 0);
  assert.equal(ui.document.querySelector("#detail-content").children.length, 0);
  assert.equal(ui.document.querySelector("#owner-email").textContent, "");
});
test("late responses cannot restore customer data after sign-out", async () => {
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const ui = await app({ deferOrders: response }); await ui.login();
  await ui.document.querySelector("#owner-nav").fire("click", { target: ui.document.querySelector('[data-view="orders"]') });
  await settle(); await ui.document.querySelector("#sign-out").fire("click");
  resolve(new Response(JSON.stringify({ total: 1, rows: [order] }))); await settle();
  assert.equal(ui.document.querySelector("#order-rows").children.length, 0);
  assert.equal(ui.document.querySelector("#workspace").hidden, true);
});

test("leaving a page clears records before a back-forward cache restore", async () => {
  const ui = await app(); await ui.login();
  ui.windowEvents.pagehide();
  assert.equal(ui.document.querySelector("#metrics").children.length, 0);
  assert.equal(ui.document.querySelector("#workspace").hidden, true);
  ui.windowEvents.pageshow({ persisted: true });
  assert.match(ui.document.querySelector("#login-status").textContent, /Sign in/);
});

test("invoice builder calculates no delivery, permits full received amount and saves only after confirmation", async () => {
  const ui = await app(); await ui.login();
  await ui.document.querySelector("#owner-nav").fire("click", { target: ui.document.querySelector('[data-view="invoices"]') }); await settle();
  assert.match(ui.document.querySelector("#invoice-draft-totals").textContent, /DeliveryPKR 0/);
  await ui.document.querySelector("#invoice-paid-in-full").fire("click");
  const form = ui.document.querySelector("#invoice-form");
  assert.equal(Number(form.elements.amountPaid.value), 1999);
  form.elements.customerName.value = "Buyer <script>unsafe</script>";
  const issuing = form.fire("submit"); await settle();
  assert.equal(ui.document.querySelector("#confirm-dialog").open, true);
  assert.ok(!ui.requests.some((r) => r.action === "invoice-create"));
  ui.document.querySelector("#confirm-dialog").returnValue = "confirm"; ui.document.querySelector("#confirm-dialog").close(); await issuing; await settle();
  assert.equal(ui.document.querySelector("#invoice-dialog").open, true);
  assert.match(ui.document.querySelector("#invoice-paper").textContent, /GINV-2026-000001/);
  assert.match(ui.document.querySelector("#invoice-paper").textContent, /Buyer <script>unsafe<\/script>/);
  assert.equal(ui.document.querySelectorAll("#invoice-paper script").length, 0);
  assert.match(ui.document.querySelector("#invoice-paper").textContent, /Black/);
  const saved = JSON.parse(ui.requests.find((r) => r.action === "invoice-create").request.body);
  assert.equal(saved.amountPaid, 1999); assert.equal(saved.discount, 0); assert.ok(saved.requestKey);
});

test("invoice drafts and previews are cleared at sign-out", async () => {
  const ui = await app(); await ui.login();
  ui.document.querySelector("#invoice-form").elements.customerName.value = "Private Buyer";
  ui.document.querySelector("#invoice-paper").textContent = "Private sale";
  await ui.document.querySelector("#sign-out").fire("click");
  assert.equal(ui.document.querySelector("#invoice-paper").children.length, 0);
  assert.equal(ui.document.querySelector("#invoice-paper").textContent, "");
  assert.equal(ui.document.querySelector("#invoice-form").elements.customerName.value, "Walk-in customer");
});
