import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createOwnerHandler, ownerFilters, ownerPatch } from "../supabase/functions/_shared/owner.mjs";
import { createOwnerAuth } from "../js/owner-auth.mjs";
import { toCSV, nextStatuses, nextPayments, pakistanRange } from "../js/owner-model.mjs";

const env = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "private-server-key", ALLOWED_ORIGINS: "https://shop.example" };
const ownerId = "11111111-1111-4111-8111-111111111111";
const reference = "GM-0123456789ABCDEF";
const token = (aal = "aal1") => `test.${Buffer.from(JSON.stringify({ sub: ownerId, aal })).toString("base64url")}.signature`;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
function mock(options = {}) {
  const calls = [];
  const fetcher = async (url, request = {}) => {
    calls.push({ url, request });
    const path = new URL(url).pathname;
    if (path === "/auth/v1/user") return options.invalidToken ? json({}, 401) : json({ id: ownerId, email: "owner@example.com", email_confirmed_at: options.unconfirmed ? null : "2026-01-01", user_metadata: { role: "owner" }, factors: options.mfa ? [{ status: "verified", factor_type: "totp" }] : [] });
    assert.equal(request.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(request.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
    if (path === "/rest/v1/gumnaam_owners") return json(options.notOwner ? [] : [{ user_id: ownerId }]);
    if (path === "/rest/v1/rpc/gumnaam_owner_version") return json(1);
    if (path === "/rest/v1/rpc/gumnaam_owner_orders") return json({ total: 0, rows: [] });
    if (path === "/rest/v1/rpc/gumnaam_owner_customers") return json({ total: 0, rows: [] });
    if (path === "/rest/v1/rpc/gumnaam_owner_metrics") return json({ summary: { orders: 0 }, daily: [], products: [], cities: [] });
    if (path === "/rest/v1/rpc/gumnaam_owner_update") return options.conflict ? json({ code: "40001", message: "Order changed. Reload before saving." }, 400) : json({ reference, version: 2 });
    if (path === "/rest/v1/rpc/gumnaam_owner_retry" || path === "/rest/v1/rpc/gumnaam_owner_suppress") return json(true);
    if (path === "/rest/v1/rpc/gumnaam_owner_export") return json([{ name: "=DANGEROUS()", email: "buyer@example.com", phone: "923001234567", marketing_eligible: true, orders: 1 }]);
    if (path === "/rest/v1/gumnaam_orders") {
      if (new URL(url).searchParams.get("select") === "receipt_path") return json([{ receipt_path: options.badReceipt ? "../private-file" : "11111111-1111-4111-8111-111111111111.png" }]);
      return json([{ reference, version: 1, customer_name: "Buyer" }]);
    }
    if (path === "/rest/v1/gumnaam_owner_audit") return json([]);
    if (path.startsWith("/storage/v1/object/sign/payment-receipts/")) return json({ signedURL: "/object/sign/payment-receipts/test.png?token=temporary" });
    throw new Error(`Unexpected request: ${path}`);
  };
  return { calls, handler: createOwnerHandler(env, fetcher) };
}
function request(action = "me", body, options = {}) {
  return new Request(`https://test.supabase.co/functions/v1/owner-api?action=${action}${options.query || ""}`, { method: body ? "POST" : "GET", headers: { origin: options.origin || "https://shop.example", ...(options.noAuth ? {} : { Authorization: `Bearer ${options.token || token()}` }), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
test("anonymous owner requests never query the database", async () => {
  const server = mock();
  const response = await server.handler(request("orders", null, { noAuth: true }));
  assert.equal(response.status, 401);
  assert.equal(server.calls.length, 0);
});
test("forged tokens and unconfirmed users are denied", async () => {
  for (const options of [{ invalidToken: true }, { unconfirmed: true }]) {
    const server = mock(options);
    assert.ok([401, 403].includes((await server.handler(request("orders"))).status));
    assert.ok(!server.calls.some(({ url }) => url.includes("gumnaam_owner_orders")));
  }
});
test("a signed-in non-owner is denied regardless of claimed metadata", async () => {
  const server = mock({ notOwner: true });
  assert.equal((await server.handler(request("customers"))).status, 403);
  assert.equal(server.calls.length, 2);
  assert.match(server.calls[1].url, /active=eq.true/);
});
test("owner sign-in returns no service credentials or customer information", async () => {
  const server = mock();
  const response = await server.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { owner: { email: "owner@example.com" }, version: 1 });
  assert.match(response.headers.get("cache-control"), /no-store/);
});
test("verified MFA enrollment requires an aal2 session", async () => {
  const server = mock({ mfa: true });
  const denied = await server.handler(request("orders"));
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "mfa_required");
  assert.equal((await server.handler(request("orders", null, { token: token("aal2") }))).status, 200);
});
test("disallowed origins cannot read owner data", async () => {
  const server = mock();
  const response = await server.handler(request("orders", null, { origin: "https://attacker.example" }));
  assert.equal(response.status, 403);
  assert.equal(server.calls.length, 0);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
test("CORS preflight carries no private data and allows required headers", async () => {
  const server = mock();
  const response = await server.handler(new Request("https://test.supabase.co/functions/v1/owner-api", { method: "OPTIONS", headers: { origin: "https://shop.example" } }));
  assert.equal(response.status, 204);
  assert.match(response.headers.get("access-control-allow-headers"), /authorization/);
  assert.equal(server.calls.length, 0);
});
test("filters are bounded, literal, and use Pakistan date boundaries", () => {
  const filter = ownerFilters(new URLSearchParams({ q: "O'Neil, (M)", from: "2026-10-01", until: "2026-10-02", status: "completed", limit: "200" }));
  assert.equal(filter.p_query, "O'Neil, (M)");
  assert.equal(filter.p_from, "2026-09-30T19:00:00.000Z");
  assert.equal(filter.p_until, "2026-10-02T19:00:00.000Z");
  for (const args of [{ status: "unknown" }, { payment: "card" }, { limit: "99999" }, { offset: "-1" }, { from: "2026-02-30" }, { from: "2026-10-02", until: "2026-10-01" }]) assert.throws(() => ownerFilters(new URLSearchParams(args)));
  assert.deepEqual(pakistanRange("", ""), { from: null, until: null });
});
test("owner update accepts only operational fields and injects the verified actor", async () => {
  const server = mock();
  const response = await server.handler(request("update", { reference, version: 1, patch: { status: "confirmed", internal_note: " Stock checked " }, reason: "Availability confirmed", actor_id: "forged" }));
  assert.equal(response.status, 200);
  const call = server.calls.find(({ url }) => url.endsWith("gumnaam_owner_update"));
  const input = JSON.parse(call.request.body);
  assert.equal(input.p_actor, ownerId);
  assert.equal(input.p_patch.internal_note, "Stock checked");
  for (const patch of [{ total: 1 }, { email: "other@example.com" }, { notification_payload: {} }, { is_test: "true" }, { status: "paid" }, {}, { internal_note: "a".repeat(2001) }]) assert.throws(() => ownerPatch(patch));
});
test("concurrent edits return 409 instead of overwriting silently", async () => {
  const server = mock({ conflict: true });
  const response = await server.handler(request("update", { reference, version: 1, patch: { status: "confirmed" }, reason: "Stock checked" }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Reload/);
});
test("invalid reference, oversized JSON and malformed body are rejected", async () => {
  const server = mock();
  assert.equal((await server.handler(request("order", null, { query: "&reference=GM-ABC%26select=*" }))).status, 400);
  const huge = await server.handler(request("update", { reference, version: 1, patch: { internal_note: "a".repeat(17000) }, reason: "reason" }));
  assert.equal(huge.status, 413);
  assert.equal((await server.handler(request("update", { reference, version: 0, patch: { is_test: true }, reason: "test" }))).status, 400);
});
test("receipt signing is owner-only, order-scoped, short-lived and private", async () => {
  const server = mock();
  const result = await server.handler(request("receipt", null, { query: `&reference=${reference}` }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).expiresIn, 60);
  const call = server.calls.find(({ url }) => url.includes("/object/sign/"));
  assert.deepEqual(JSON.parse(call.request.body), { expiresIn: 60 });
  assert.equal((await mock({ badReceipt: true }).handler(request("receipt", null, { query: `&reference=${reference}` }))).status, 404);
});
test("order details do not request payload hashes, retry tokens or email payloads", async () => {
  const server = mock();
  assert.equal((await server.handler(request("order", null, { query: `&reference=${reference}` }))).status, 200);
  const url = server.calls.find(({ url }) => url.includes("gumnaam_orders?")).url;
  assert.doesNotMatch(url, /request_key|payload_hash|notification_payload/);
});
test("marketing exports force opt-in selection and exclude phone numbers", async () => {
  const server = mock();
  const response = await server.handler(request("export", { kind: "marketing" }));
  assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
  const csv = await response.text();
  assert.doesNotMatch(csv, /923001234567|Phone/);
  assert.match(csv, /'=DANGEROUS/);
  const params = JSON.parse(server.calls.find(({ url }) => url.endsWith("gumnaam_owner_export")).request.body);
  assert.equal(params.p_marketing, true);
  assert.equal(params.p_actor, ownerId);
});
test("CSV quotes content and neutralises spreadsheet formulas", () => {
  const csv = toCSV([["Name", "name"]], [{ name: '=HYPERLINK("bad")' }, { name: "  +SUM(1)" }, { name: "Line\nbreak, comma" }, { name: "@SUM(1)" }]);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"'  \+SUM/);
  assert.match(csv, /"Line\nbreak, comma"/);
  assert.match(csv, /"'@SUM/);
});
test("fulfilment and payment selectors offer bounded workflows", () => {
  assert.deepEqual(nextStatuses({ status: "pending_confirmation", payment_method: "cod" }), ["pending_confirmation", "confirmed", "cancelled"]);
  assert.deepEqual(nextStatuses({ status: "cancelled", payment_method: "cod", payment_status: "refunded" }), ["cancelled"]);
  assert.deepEqual(nextPayments({ payment_status: "unverified", payment_method: "easypaisa" }), ["unverified", "verified"]);
  assert.deepEqual(nextPayments({ payment_status: "collected", payment_method: "cod" }), ["collected", "refunded"]);
});
const authConfig = { projectUrl: "https://test.supabase.co", publishableKey: "sb_publishable_test" };
function authMock(options = {}) {
  const calls = [];
  const user = { id: ownerId, factors: options.mfa ? [{ id: ownerId, factor_type: "totp", status: "verified" }] : [] };
  const fetcher = async (url, request) => {
    calls.push({ url, request });
    if (url.includes("grant_type=password")) return options.fail ? json({}, 400) : json({ access_token: token(), refresh_token: "test-refresh", expires_in: options.expiry || 3600, user });
    if (url.includes("grant_type=refresh_token")) return options.failRefresh ? json({}, 401) : json({ access_token: token("aal2"), refresh_token: "rotated-refresh", expires_in: 3600, user });
    if (url.endsWith("/user")) return json(user);
    if (url.endsWith("/challenge")) return json({ id: "challenge-id" });
    if (url.endsWith("/verify")) return json({ access_token: token("aal2"), refresh_token: "mfa-refresh", expires_in: 3600, user });
    if (url.includes("/logout")) return new Response(null, { status: 204 });
    throw new Error(`Unexpected auth request ${url}`);
  };
  return { calls, auth: createOwnerAuth(authConfig, fetcher) };
}
test("auth uses the public key, keeps credentials in memory, and clears on sign out", async () => {
  const server = authMock();
  await assert.rejects(server.auth.token(), /Sign in/);
  assert.equal(await server.auth.signIn("owner@example.com", "test-password"), null);
  assert.equal(await server.auth.token(), token());
  assert.equal(server.calls[0].request.headers.apikey, authConfig.publishableKey);
  await server.auth.signOut();
  await assert.rejects(server.auth.token(), /Sign in/);
  assert.ok(server.calls.some(({ url }) => url.endsWith("/logout?scope=local")));
});
test("auth refresh is coalesced and failed refresh removes the session", async () => {
  const server = authMock({ expiry: 1 });
  await server.auth.signIn("owner@example.com", "test-password");
  await Promise.all([server.auth.token(), server.auth.token()]);
  assert.equal(server.calls.filter(({ url }) => url.includes("grant_type=refresh_token")).length, 1);
  const failed = authMock({ expiry: 1, failRefresh: true });
  await assert.rejects(failed.auth.signIn("owner@example.com", "test-password"));
  await assert.rejects(failed.auth.token(), /Sign in/);
});
test("TOTP verification replaces the session and validates code format", async () => {
  const server = authMock({ mfa: true });
  const factor = await server.auth.signIn("owner@example.com", "test-password");
  assert.equal(factor.id, ownerId);
  await assert.rejects(server.auth.verify(ownerId, "not-a-code"));
  await server.auth.verify(ownerId, "123456");
  assert.equal(await server.auth.token(), token("aal2"));
  const call = server.calls.find(({ url }) => url.endsWith("/verify"));
  assert.deepEqual(JSON.parse(call.request.body), { challenge_id: "challenge-id", code: "123456" });
});

test("a delayed sign-in cannot revive a cleared session", async () => {
  let resolve;
  const auth = createOwnerAuth(authConfig, async () => new Promise((done) => { resolve = done; }));
  const login = auth.signIn("owner@example.com", "test-password");
  auth.clear();
  resolve(json({ access_token: token(), refresh_token: "test-refresh", expires_in: 3600, user: {} }));
  await assert.rejects(login, /Session ended/);
  await assert.rejects(auth.token(), /Sign in/);
});
test("owner bundle is standalone, source-matched and closed without configuration", async () => {
  const root = new URL("../", import.meta.url);
  const source = await readFile(new URL("supabase/dashboard/owner-api.ts", root), "utf8");
  const model = (await readFile(new URL("js/owner-model.mjs", root), "utf8")).replace(/^export /gm, "").trim();
  const invoiceModel = (await readFile(new URL("js/invoice-model.mjs", root), "utf8")).replace(/^export /gm, "").trim();
  const invoiceShared = (await readFile(new URL("supabase/functions/_shared/invoices.mjs", root), "utf8")).replace(/^import [^\n]+\r?\n/gm, "").replace(/^export /gm, "").trim();
  const shared = (await readFile(new URL("supabase/functions/_shared/owner.mjs", root), "utf8")).replace(/^import [^\n]+\r?\n/gm, "").replace(/^export /gm, "").trim();
  const entry = (await readFile(new URL("supabase/functions/owner-api/index.ts", root), "utf8")).replace(/^import [^\n]+\r?\n/, "").trim();
  assert.equal(source, `${model}\n\n${invoiceModel}\n\n${invoiceShared}\n\n${shared}\n\n${entry}\n`);
  let handler;
  vm.runInNewContext(source, { Deno: { env: { toObject: () => ({}) }, serve(value) { handler = value; } }, fetch, Request, Response, URL, URLSearchParams, AbortSignal, Blob, atob });
  assert.equal((await handler(new Request("https://test.example"))).status, 503);
});
test("owner migration denies browser tables and RPCs and guards mutations atomically", async () => {
  const source = await readFile(new URL("../supabase/owner-panel.sql", import.meta.url), "utf8");
  for (const table of ["gumnaam_owners", "gumnaam_owner_audit", "gumnaam_marketing_suppressions"]) assert.match(source, new RegExp(`alter table public.${table} enable row level security`));
  assert.doesNotMatch(source, /grant .* to (anon|authenticated)|security definer/i);
  assert.match(source, /for update/);
  assert.match(source, /old_order\.version <> p_version/);
  assert.match(source, /Verify the actual Easypaisa transfer first/);
  assert.match(source, /Record the collected COD payment first/);
  assert.match(source, /not is_test/);
  assert.match(source, /consent_at > suppression.withdrawn_at/);
  assert.doesNotMatch(source, /update public.gumnaam_orders set marketing_consent/i);
});
test("admin page stays isolated, noindex, accessible and free of inline scripts", async () => {
  const root = new URL("../", import.meta.url);
  const html = await readFile(new URL("admin.html", root), "utf8");
  const js = await readFile(new URL("js/owner.js", root), "utf8");
  const auth = await readFile(new URL("js/owner-auth.mjs", root), "utf8");
  assert.match(html, /noindex, nofollow/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /id="workspace" hidden/);
  assert.match(html, /id="confirm-dialog" aria-labelledby/);
  assert.doesNotMatch(html, /gsap|lenis|cart.js|<script>[^<]/);
  assert.doesNotMatch(js + auth, /localStorage|sessionStorage|innerHTML|console\./);
  assert.match(js, /epoch !== state.epoch/);
  const config = JSON.parse(await readFile(new URL("vercel.json", root), "utf8"));
  assert.ok(config.headers.some((rule) => rule.headers.some((header) => header.key === "Content-Security-Policy" && header.value.includes("frame-ancestors 'none'"))));
});
