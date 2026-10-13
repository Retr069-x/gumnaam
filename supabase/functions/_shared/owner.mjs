import { toCSV, pakistanRange, STATUS_LABELS } from "../../../js/owner-model.mjs";
import { validateInvoice, invoiceHash } from "./invoices.mjs";

export class OwnerError extends Error {
  constructor(message, status = 400, code = "") { super(message); this.status = status; this.code = code; }
}
const OWNER_ORDER_COLUMNS = "reference,created_at,updated_at,customer_name,email,phone,city,address,notes,product_name,product_id,size,quantity,unit_price,subtotal,line_items,cod_fee,total,payment_method,payment_status,transaction_id,receipt_path,status,notification_status,notification_attempts,notification_sent_at,internal_note,courier,tracking_number,is_test,delivered_at,payment_recorded_at,version,marketing_consent,marketing_consent_at";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const referencePattern = /^GM-[A-F0-9]{16}$/;

function ownerText(value, maximum = 100, minimum = 0) {
  if (typeof value !== "string" || value.trim().length < minimum || value.trim().length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new OwnerError("Check the supplied details.");
  return value.trim();
}
function ownerReference(value) {
  if (typeof value !== "string" || !referencePattern.test(value)) throw new OwnerError("Choose a valid order.");
  return value;
}
function ownerVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new OwnerError("Reload this order before saving.");
  return value;
}
export function ownerFilters(params) {
  const q = ownerText(params.get("q") || "");
  const status = params.get("status") || "";
  const payment = params.get("payment") || "";
  if (status && !Object.hasOwn(STATUS_LABELS, status)) throw new OwnerError("Choose a valid order status.");
  if (payment && !["cod", "easypaisa"].includes(payment)) throw new OwnerError("Choose a valid payment method.");
  let range;
  try { range = pakistanRange(params.get("from") || "", params.get("until") || ""); } catch { throw new OwnerError("Choose a valid date range."); }
  const offset = Number(params.get("offset") || 0);
  const limit = Number(params.get("limit") || 50);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new OwnerError("Choose a valid page.");
  return { p_from: range.from, p_until: range.until, p_query: q, p_status: status, p_payment: payment, p_test: params.get("test") === "true", p_offset: offset, p_limit: limit };
}
export function ownerPatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Object.keys(input).length) throw new OwnerError("Choose a change to save.");
  const patch = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "status" && Object.hasOwn(STATUS_LABELS, value)) patch[key] = value;
    else if (key === "payment_status" && ["unverified", "verified", "collected", "refunded"].includes(value)) patch[key] = value;
    else if (["internal_note", "courier", "tracking_number"].includes(key)) patch[key] = ownerText(value, key === "internal_note" ? 2000 : key === "courier" ? 80 : 100);
    else if (key === "is_test" && typeof value === "boolean") patch[key] = value;
    else throw new OwnerError("This field cannot be changed from the panel.");
  }
  return patch;
}
async function ownerBody(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new OwnerError("Submit a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw new OwnerError("Request is empty.");
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 16384) { await reader.cancel(); throw new OwnerError("Request is too large.", 413); }
    chunks.push(value);
  }
  try {
    const result = JSON.parse(await new Blob(chunks).text());
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new OwnerError("Request could not be read."); }
}
function ownerDatabase(env, fetcher) {
  return async (path, options = {}) => {
    const response = await fetcher(`${env.SUPABASE_URL}${path}`, {
      ...options, signal: AbortSignal.timeout(20000),
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...options.headers }
    });
    if (!response.ok) {
      let result = {};
      try { result = await response.json(); } catch {}
      const codes = { "40001": 409, "P0002": 404, "22023": 400, "42501": 403 };
      if (Object.hasOwn(codes, result.code)) throw new OwnerError(result.message || "The change could not be saved.", codes[result.code]);
      const error = new OwnerError("Owner service unavailable. Check the owner-panel migration and function deployment.", 503);
      error.httpStatus = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    const value = await response.text();
    return value ? JSON.parse(value) : null;
  };
}
async function ownerIdentity(request, env, fetcher, db) {
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization) || authorization.length > 8192) throw new OwnerError("Sign in to continue.", 401);
  const response = await fetcher(`${env.SUPABASE_URL}/auth/v1/user`, { signal: AbortSignal.timeout(10000), headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: authorization } });
  if (response.status === 401 || response.status === 403) throw new OwnerError("Your session expired. Sign in again.", 401);
  if (!response.ok) throw new OwnerError("Authentication is temporarily unavailable.", 503);
  const user = await response.json();
  if (!uuid.test(user.id || "") || !user.email_confirmed_at) throw new OwnerError("Owner access required.", 403);
  const owners = await db(`/rest/v1/gumnaam_owners?user_id=eq.${user.id}&active=eq.true&select=user_id&limit=1`);
  if (!owners?.length || owners[0].user_id !== user.id) throw new OwnerError("This account is not authorised for the owner panel.", 403);
  if (user.factors?.some((factor) => factor.status === "verified")) {
    let claims;
    try {
      const part = authorization.slice(7).split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
      claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    } catch { throw new OwnerError("Complete your authenticator check.", 403, "mfa_required"); }
    if (claims.aal !== "aal2") throw new OwnerError("Complete your authenticator check.", 403, "mfa_required");
  }
  return { id: user.id, email: user.email };
}

export function createOwnerHandler(env, fetcher = fetch) {
  return async (request) => {
    const origin = request.headers.get("origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store, private", "Vary": "Origin", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
    if (origin && allowed.includes(origin)) Object.assign(headers, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
    if (origin && !allowed.includes(origin)) return json({ error: "Owner panel is unavailable from this address." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !allowed.length) return json({ error: "Owner service is not configured." }, 503);
    const db = ownerDatabase(env, fetcher);
    const rpc = (name, body = {}) => db(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
    try {
      const owner = await ownerIdentity(request, env, fetcher, db);
      const params = new URL(request.url).searchParams;
      const action = params.get("action") || "me";
      if (request.method === "GET") {
        if (action === "me") {
          const version = await rpc("gumnaam_owner_version");
          if (version !== 1) throw new OwnerError("Owner-panel migration is required.", 503);
          return json({ owner: { email: owner.email }, version });
        }
        if (action === "overview") {
          const { p_from, p_until } = ownerFilters(params);
          return json(await rpc("gumnaam_owner_metrics", { p_from, p_until }));
        }
        if (action === "orders") return json(await rpc("gumnaam_owner_orders", ownerFilters(params)));
        if (action === "customers") {
          const filter = ownerFilters(params);
          return json(await rpc("gumnaam_owner_customers", { p_query: filter.p_query, p_marketing: params.get("marketing") === "true", p_offset: filter.p_offset, p_limit: filter.p_limit }));
        }
        if (action === "order") {
          const reference = ownerReference(params.get("reference"));
          const rows = await db(`/rest/v1/gumnaam_orders?reference=eq.${reference}&select=${OWNER_ORDER_COLUMNS}&limit=1`);
          if (!rows.length) throw new OwnerError("Order not found.", 404);
          const audit = await db(`/rest/v1/gumnaam_owner_audit?order_reference=eq.${reference}&select=created_at,action,before_value,after_value,reason&order=created_at.desc,id.desc&limit=25`);
          let customerEmail = { available: false };
          try {
            const receipts = await db(`/rest/v1/gumnaam_customer_emails?reference=eq.${reference}&select=status,attempts,sent_at,first_attempt_at&limit=1`);
            customerEmail = { available: true, receipt: receipts[0] || null };
          } catch (error) { if (error.httpStatus !== 404) throw error; }
          return json({ order: rows[0], audit, customerEmail });
        }
        if (action === "receipt") {
          const reference = ownerReference(params.get("reference"));
          const rows = await db(`/rest/v1/gumnaam_orders?reference=eq.${reference}&select=receipt_path&limit=1`);
          const path = rows[0]?.receipt_path;
          if (typeof path !== "string" || !/^[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(path)) throw new OwnerError("No payment screenshot for this order.", 404);
          const signed = await db(`/storage/v1/object/sign/payment-receipts/${path}`, { method: "POST", body: JSON.stringify({ expiresIn: 60 }) });
          const signedPath = signed.signedURL || signed.signedUrl;
          if (typeof signedPath !== "string" || !signedPath.startsWith("/object/sign/payment-receipts/")) throw new OwnerError("Private receipt preview is unavailable.", 503);
          return json({ url: `${env.SUPABASE_URL}/storage/v1${signedPath}`, expiresIn: 60 });
        }
        if (action === "audit") return json({ rows: await db("/rest/v1/gumnaam_owner_audit?select=created_at,order_reference,action,after_value,reason&order=created_at.desc,id.desc&limit=50") });
        if (action === "invoices") {
          const filter = ownerFilters(params);
          const status = params.get("invoiceStatus") || "";
          if (status && !["issued", "void"].includes(status)) throw new OwnerError("Choose a valid invoice status.");
          return json(await rpc("gumnaam_invoice_list", { p_query: filter.p_query, p_status: status, p_offset: filter.p_offset, p_limit: filter.p_limit }));
        }
        if (action === "invoice") {
          const number = params.get("number");
          if (!/^GINV-\d{4}-\d{6,20}$/.test(number || "")) throw new OwnerError("Choose a valid invoice.");
          const rows = await db(`/rest/v1/gumnaam_invoices?number=eq.${number}&select=number,created_at,updated_at,customer_name,email,phone,line_items,subtotal,discount,total,amount_paid,refunded_amount,payment_method,payment_reference,notes,status,void_reason,version&limit=1`);
          if (!rows.length) throw new OwnerError("Invoice not found.", 404);
          return json({ invoice: rows[0] });
        }
        throw new OwnerError("Unknown owner action.", 404);
      }
      const input = await ownerBody(request);
      if (action === "invoice-create") {
        let record;
        try { record = validateInvoice(input); } catch (error) { throw new OwnerError(error.message); }
        return json({ invoice: await rpc("gumnaam_invoice_create", { p_actor: owner.id, p_order: record, p_hash: await invoiceHash(record) }) }, 201);
      }
      if (action === "invoice-update") {
        if (!/^GINV-\d{4}-\d{6,20}$/.test(input.number || "") || !Number.isInteger(input.amountPaid) || input.amountPaid < 0 || input.amountPaid > 10000000 || !["cash", "easypaisa", "bank_transfer", "other"].includes(input.paymentMethod) || typeof input.void !== "boolean") throw new OwnerError("Check the invoice payment details.");
        return json({ invoice: await rpc("gumnaam_invoice_update", { p_actor: owner.id, p_number: input.number, p_version: ownerVersion(input.version), p_paid: input.amountPaid, p_method: input.paymentMethod, p_reference: ownerText(input.paymentReference ?? "", 100), p_void: input.void, p_reason: ownerText(input.reason, 2000, 2) }) });
      }
      if (action === "update") return json(await rpc("gumnaam_owner_update", { p_actor: owner.id, p_reference: ownerReference(input.reference), p_version: ownerVersion(input.version), p_patch: ownerPatch(input.patch), p_reason: ownerText(input.reason, 2000, 2) }));
      if (action === "retry") return json({ queued: await rpc("gumnaam_owner_retry", { p_actor: owner.id, p_reference: ownerReference(input.reference), p_version: ownerVersion(input.version) }) });
      if (action === "retry-customer-email") return json({ queued: await rpc("gumnaam_owner_retry_customer_email", { p_actor: owner.id, p_reference: ownerReference(input.reference) }) });
      if (action === "suppress") {
        const email = ownerText(input.email, 254, 3).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OwnerError("Choose a valid customer email.");
        return json({ saved: await rpc("gumnaam_owner_suppress", { p_actor: owner.id, p_email: email }) });
      }
      if (action === "export") {
        if (!["orders", "customers", "marketing"].includes(input.kind)) throw new OwnerError("Choose a valid export.");
        const filters = ownerFilters(params);
        const { p_offset, p_limit, ...exportFilters } = filters;
        const rows = await rpc("gumnaam_owner_export", { ...exportFilters, p_actor: owner.id, p_kind: input.kind, p_marketing: input.kind === "marketing" || params.get("marketing") === "true" });
        const columns = input.kind === "orders"
          ? [["Reference", "reference"], ["Placed at", "created_at"], ["Customer", "customer_name"], ["Email", "email"], ["Phone", "phone"], ["City", "city"], ["Status", "status"], ["Payment", "payment_status"], ["Method", "payment_method"], ["Total PKR", "total"], ["Test order", "is_test"]]
          : [["Customer", "name"], ["Email", "email"], ...(input.kind === "marketing" ? [] : [["Phone", "phone"], ["City", "city"]]), ["Orders", "orders"], ["Delivered paid PKR", "delivered_paid_value"], ["Email consent", "marketing_eligible"], ["Consent recorded", "consent_at"]];
        return new Response(toCSV(columns, rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="gumnaam-${input.kind}.csv"` } });
      }
      throw new OwnerError("Unknown owner action.", 404);
    } catch (error) {
      return json({ error: error instanceof OwnerError ? error.message : "Owner service temporarily unavailable.", ...(error.code && error instanceof OwnerError ? { code: error.code } : {}) }, error instanceof OwnerError ? error.status : 503);
    }
  };
}
