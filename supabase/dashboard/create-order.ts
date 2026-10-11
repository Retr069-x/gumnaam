globalThis.GUMNAAM_PRODUCTS = [
  {
    id: "obsidian",
    number: "01",
    name: "Obsidian Mark Hoodie",
    shortName: "Obsidian",
    price: 1999,
    stock: 6,
    description:
      "A heavyweight black pullover cut with a relaxed shoulder and finished with the Gumnaam mark at the chest.",
    images: [
      "assets/black-model.jpg",
      "assets/black-front.jpg",
      "assets/black-back.jpg",
      "assets/black-closeup.jpg",
      "assets/black-detail.jpg",
    ],
    sizes: ["S", "M", "L", "XL"],
    material: "420 GSM brushed cotton fleece. Ribbed cuff and hem. Metal-tipped drawcord.",
    care: "Cold wash inside out. Wash with like colours. Line dry. Do not iron the mark.",
  },
  {
    id: "camel",
    number: "02",
    name: "Dune Script Hoodie",
    shortName: "Dune",
    price: 1999,
    stock: 4,
    description:
      "A warm neutral heavyweight layer carrying an expressive script across the chest and a clean, oversized silhouette.",
    images: [
      "assets/camel-model.jpg",
      "assets/camel-front.jpg",
      "assets/camel-back.jpg",
      "assets/camel-closeup.jpg",
      "assets/camel-detail.jpg",
    ],
    sizes: ["S", "M", "L", "XL"],
    material: "420 GSM brushed cotton fleece. Double-layer hood. Tonal rib and flat drawcord.",
    care: "Cold wash inside out. Wash with like colours. Line dry. Do not iron the artwork.",
  },
  {
    id: "navy",
    number: "03",
    name: "Midnight Mark Hoodie",
    shortName: "Midnight",
    price: 1999,
    stock: 8,
    description:
      "A deep midnight essential with a quiet chest mark, generous hood and an easy everyday drape.",
    images: [
      "assets/navy-model.png",
      "assets/navy-front.jpg",
      "assets/navy-closeup.jpg",
      "assets/navy-detail.jpg",
    ],
    sizes: ["S", "M", "L", "XL"],
    material: "400 GSM cotton-rich fleece. Kangaroo pocket. Reinforced ribbed finishes.",
    care: "Cold wash inside out. Wash with like colours. Line dry. Do not tumble dry.",
  },
  {
    id: "olive",
    number: "04",
    name: "Field Mark Hoodie",
    shortName: "Field",
    price: 1999,
    stock: 3,
    description:
      "A grounded, minimal pullover with the Gumnaam mark placed discreetly over the heart and a layered street fit.",
    images: [
      "assets/olive-model.png",
      "assets/olive-front.jpg",
      "assets/olive-closeup.jpg",
      "assets/olive-detail.jpg",
    ],
    sizes: ["S", "M", "L", "XL"],
    material: "400 GSM brushed cotton fleece. Double-layer hood. Ribbed cuff and hem.",
    care: "Cold wash inside out. Wash with like colours. Line dry. Do not bleach.",
  },
];

const MAX_RECEIPT_BYTES = 4194304;
const MAX_REQUEST_BYTES = MAX_RECEIPT_BYTES + 32768;
const catalog = globalThis.GUMNAAM_PRODUCTS;

class OrderError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function field(value, label, minimum, maximum) {
  if (typeof value !== "string") throw new OrderError(`Check your ${label}.`);
  const clean = value.trim();
  if (clean.length < minimum || clean.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) throw new OrderError(`Check your ${label}.`);
  return clean;
}

function validateOrder(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new OrderError("Check your order details.");
  const product = catalog.find((entry) => entry.id === input.productId);
  if (!product || !product.sizes.includes(input.size)) throw new OrderError("Choose an available piece and size.");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > Math.min(10, product.stock)) throw new OrderError("Choose an available quantity.");
  if (!["cod", "easypaisa"].includes(input.paymentMethod)) throw new OrderError("Choose a payment method.");
  if (input.consent !== true) throw new OrderError("Please acknowledge the confirmation information.");
  if (typeof input.requestKey !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestKey)) throw new OrderError("Refresh checkout and try again.");
  const rawPhone = field(input.phone, "WhatsApp number", 10, 24).replace(/[\s()+-]/g, "");
  if (!/^(?:03\d{9}|923\d{9})$/.test(rawPhone)) throw new OrderError("Enter a valid Pakistan mobile number.");
  const email = field(input.email ?? "", "email", 0, 254);
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(email))) throw new OrderError("Check your email address.");
  const prepaid = input.paymentMethod === "easypaisa";
  return {
    request_key: input.requestKey.toLowerCase(),
    product_id: product.id,
    product_name: product.name,
    size: input.size,
    quantity: input.quantity,
    unit_price: product.price,
    cod_fee: prepaid ? 0 : 200,
    total: product.price * input.quantity + (prepaid ? 0 : 200),
    customer_name: field(input.customerName, "name", 2, 100),
    phone: rawPhone.startsWith("0") ? `92${rawPhone.slice(1)}` : rawPhone,
    city: field(input.city, "city", 2, 80),
    address: field(input.address, "street address", 8, 400),
    email,
    notes: field(input.notes ?? "", "delivery note", 0, 500),
    payment_method: input.paymentMethod,
    transaction_id: prepaid ? field(input.transactionId, "transaction ID", 4, 80) : "",
    status: prepaid ? "pending_verification" : "pending_confirmation"
  };
}

function imageType(bytes) {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return { mime: "image/png", extension: "png" };
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", extension: "webp" };
  throw new OrderError("The screenshot must be a JPG, PNG or WebP image.");
}

async function digest(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function configured(env) {
  return ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ALLOWED_ORIGINS", "TURNSTILE_SECRET_KEY", "TURNSTILE_HOSTNAMES", "RESEND_API_KEY", "ORDER_ALERT_EMAIL", "ORDER_FROM_EMAIL", "CRON_SECRET"].every((key) => Boolean(env[key]?.trim()));
}

function service(env, fetcher = fetch) {
  return async (path, options = {}) => {
    const response = await fetcher(`${env.SUPABASE_URL}${path}`, {
      ...options,
      signal: AbortSignal.timeout(20000),
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...options.headers }
    });
    if (!response.ok) {
      const error = new Error("Order service unavailable.");
      error.httpStatus = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
}

function orderResponse(order) {
  return { reference: order.reference, total: order.total, status: order.status };
}

function alertBody(order, env) {
  const ref = new URL(env.SUPABASE_URL).hostname.split(".")[0];
  const whatsapp = `https://wa.me/${order.phone}?text=${encodeURIComponent(`Your Gumnaam order ${order.reference} is confirmed. Thank you for remaining Gumnaam.`)}`;
  return [
    `New Gumnaam order: ${order.reference}`,
    "",
    `${order.product_name} / ${order.size} / quantity ${order.quantity}`,
    `Pieces: PKR ${order.unit_price * order.quantity}`,
    `COD charge: PKR ${order.cod_fee}`,
    `Total: PKR ${order.total}`,
    `Payment method: ${order.payment_method}`,
    "Status: new order request — NOT automatically confirmed",
    "",
    `Customer: ${order.customer_name}`,
    `WhatsApp: +${order.phone}`,
    `Address: ${order.address}`,
    `City: ${order.city}`,
    `Email: ${order.email || "Not supplied"}`,
    `Note: ${order.notes || "None"}`,
    "",
    ...(order.payment_method === "easypaisa" ? [
      `Transaction ID: ${order.transaction_id}`,
      `Private screenshot path: ${order.receipt_path}`,
      `Open Storage (Supabase login required): https://supabase.com/dashboard/project/${ref}/storage/buckets/payment-receipts`,
      "Check the actual Easypaisa transaction before marking payment verified. A screenshot is not proof of settlement."
    ] : ["Confirm stock and delivery details before dispatch."]),
    "",
    `Review orders (Supabase login required): https://supabase.com/dashboard/project/${ref}/editor`,
    "After verification, set payment_status as appropriate and status to confirmed in gumnaam_orders.",
    "Then open this WhatsApp message to confirm manually:",
    whatsapp
  ].join("\n");
}

async function notifyOrders(env, reference = null, fetcher = fetch) {
  const db = service(env, fetcher);
  await db(`/rest/v1/gumnaam_orders?notification_status=eq.sending&notification_attempts=gte.12&notification_lease_until=lt.${new Date().toISOString()}`, {
    method: "PATCH", body: JSON.stringify({ notification_status: "failed", notification_lease_until: null })
  });
  const claimed = await db("/rest/v1/rpc/gumnaam_claim_notifications", { method: "POST", body: JSON.stringify({ order_reference: reference, batch_size: 5 }) });
  let sent = 0;
  for (const order of claimed) {
    try {
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `gumnaam-order/${order.reference}` },
        body: JSON.stringify(order.notification_payload)
      });
      if (!response.ok) throw new Error("Notification rejected.");
      const result = await response.json();
      if (!result.id) throw new Error("Notification response missing.");
      await db(`/rest/v1/gumnaam_orders?id=eq.${order.id}&notification_status=eq.sending&notification_attempts=eq.${order.notification_attempts}`, {
        method: "PATCH", body: JSON.stringify({ notification_status: "sent", notification_sent_at: new Date().toISOString(), notification_provider_id: result.id, notification_lease_until: null })
      });
      sent++;
    } catch {
      await db(`/rest/v1/gumnaam_orders?id=eq.${order.id}&notification_status=eq.sending&notification_attempts=eq.${order.notification_attempts}`, {
        method: "PATCH", body: JSON.stringify({ notification_status: order.notification_attempts >= 12 ? "failed" : "pending", notification_lease_until: null, notification_next_at: new Date(Date.now() + Math.min(60, 2 ** order.notification_attempts) * 60000).toISOString() })
      });
    }
  }
  return { attempted: claimed.length, sent };
}

async function limitedForm(request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new OrderError("Submit the checkout form.");
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) throw new OrderError("The screenshot is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new OrderError("Submit the checkout form.");
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_REQUEST_BYTES) { await reader.cancel(); throw new OrderError("The screenshot is too large.", 413); }
    chunks.push(value);
  }
  try { return await new Response(new Blob(chunks), { headers: { "Content-Type": request.headers.get("content-type") } }).formData(); }
  catch { throw new OrderError("The checkout form could not be read."); }
}

function createOrderHandler(env, fetcher = fetch, background = (task) => task.catch(() => {})) {
  return async (request) => {
    const origin = request.headers.get("origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff" };
    if (origin && allowed.includes(origin)) Object.assign(headers, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
    const json = (data, code = 200) => new Response(JSON.stringify(data), { status: code, headers });
    if (origin && !allowed.includes(origin)) return json({ error: "Checkout is unavailable from this address." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method === "GET") {
      if (!configured(env)) return json({ ready: false }, 503);
      try {
        const db = service(env, fetcher);
        await db("/rest/v1/gumnaam_orders?select=id&limit=0");
        const bucket = await db("/storage/v1/bucket/payment-receipts");
        return json({ ready: bucket.public === false }, bucket.public === false ? 200 : 503);
      } catch { return json({ ready: false }, 503); }
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (!configured(env)) return json({ error: "Checkout is not open yet. Do not transfer money. Please message Gumnaam on Instagram." }, 503);
    let uploadedPath;
    let saved = false;
    const db = service(env, fetcher);
    try {
      const form = await limitedForm(request);
      const encoded = form.get("order");
      if (typeof encoded !== "string" || encoded.length > 12000) throw new OrderError("Check your order details.");
      let input;
      try { input = JSON.parse(encoded); } catch { throw new OrderError("Check your order details."); }
      const order = validateOrder(input);
      const token = field(form.get("token"), "security check", 1, 2048);
      const captchaResponse = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token })
      });
      if (!captchaResponse.ok) throw new OrderError("Security check unavailable. Please retry.", 503);
      const captcha = await captchaResponse.json();
      const hostnames = env.TURNSTILE_HOSTNAMES.split(",").map((item) => item.trim());
      if (!captcha.success || captcha.action !== "checkout" || !hostnames.includes(captcha.hostname)) throw new OrderError("Please complete the security check again.");
      let bytes;
      let type;
      const receipt = form.get("receipt");
      if (order.payment_method === "easypaisa") {
        if (!(receipt instanceof File) || receipt.size === 0 || receipt.size > MAX_RECEIPT_BYTES) throw new OrderError("Attach a payment screenshot smaller than 4 MB.");
        bytes = new Uint8Array(await receipt.arrayBuffer());
        type = imageType(bytes);
        if (receipt.type !== type.mime) throw new OrderError("The screenshot file type does not match its contents.");
      } else if (receipt) { throw new OrderError("A screenshot is not needed for cash on delivery."); }
      const hash = await digest(JSON.stringify(order) + (bytes ? await digest(bytes) : ""));
      const previous = await db(`/rest/v1/gumnaam_orders?request_key=eq.${order.request_key}&select=reference,total,status,payload_hash`);
      if (previous.length) {
        if (previous[0].payload_hash !== hash) throw new OrderError("Order details changed. Start a new checkout.", 409);
        return json(orderResponse(previous[0]));
      }
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || order.phone;
      const limitKey = await digest(`${env.SUPABASE_SERVICE_ROLE_KEY}:${ip}`);
      const permitted = await db("/rest/v1/rpc/gumnaam_check_order_limit", { method: "POST", body: JSON.stringify({ key_value: limitKey }) });
      if (!permitted) throw new OrderError("Too many order attempts. Please try again later or message us on Instagram.", 429);
      const reference = `GM-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
      if (bytes) {
        const bucket = await db("/storage/v1/bucket/payment-receipts");
        if (bucket.public !== false) throw new OrderError("Payment upload unavailable. Please contact Gumnaam before transferring.", 503);
        uploadedPath = `${crypto.randomUUID()}.${type.extension}`;
        await db(`/storage/v1/object/payment-receipts/${uploadedPath}`, { method: "POST", headers: { "Content-Type": type.mime, "x-upsert": "false" }, body: bytes });
      }
      let rows;
      try {
        const record = { ...order, reference, payload_hash: hash, receipt_path: uploadedPath || null };
        record.notification_payload = { from: env.ORDER_FROM_EMAIL, to: [env.ORDER_ALERT_EMAIL], subject: `Gumnaam / New order ${reference}`, text: alertBody(record, env) };
        rows = await db("/rest/v1/gumnaam_orders", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(record) });
      } catch (error) {
        const existing = await db(`/rest/v1/gumnaam_orders?request_key=eq.${order.request_key}&select=reference,total,status,payload_hash,receipt_path`);
        if (!existing.length) throw error;
        if (existing[0].payload_hash !== hash) throw new OrderError("Order details changed. Start a new checkout.", 409);
        rows = existing;
        if (uploadedPath && existing[0].receipt_path !== uploadedPath) {
          await db("/storage/v1/object/payment-receipts", { method: "DELETE", body: JSON.stringify({ prefixes: [uploadedPath] }) });
          uploadedPath = undefined;
        }
      }
      saved = true;
      background(notifyOrders(env, rows[0].reference, fetcher));
      return json(orderResponse(rows[0]), 201);
    } catch (error) {
      if (uploadedPath && !saved) {
        try {
          const linked = await db(`/rest/v1/gumnaam_orders?receipt_path=eq.${uploadedPath}&select=id&limit=1`);
          if (!linked.length) await db("/storage/v1/object/payment-receipts", { method: "DELETE", body: JSON.stringify({ prefixes: [uploadedPath] }) });
        } catch {}
      }
      return json({ error: error instanceof OrderError ? error.message : "We could not verify the result. Retry with the same details. Do not transfer again." }, error instanceof OrderError ? error.status : 503);
    }
  };
}

const env = Deno.env.toObject();
Deno.serve(createOrderHandler(env, fetch, (task) => EdgeRuntime.waitUntil(task.catch(() => {}))));
