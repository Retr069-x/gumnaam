import { createOwnerAuth } from "./owner-auth.mjs";
import { money, dateTime, STATUS_LABELS, PAYMENT_LABELS, nextStatuses, nextPayments, linesFor } from "./owner-model.mjs";
import { setupInvoices } from "./owner-invoices.mjs";

const config = window.GUMNAAM_OWNER || {};
const auth = createOwnerAuth(config);
const $ = (selector) => document.querySelector(selector);
const state = { view: "overview", epoch: 0, load: 0, orders: { offset: 0, total: 0 }, customers: { offset: 0, total: 0 }, detail: null, factor: null, enrollment: null, idle: Date.now(), signedIn: false };
const views = { overview: ["01 / At a glance", "Overview."], orders: ["02 / Fulfilment", "Orders."], invoices: ["03 / In-person sales", "Invoices."], customers: ["04 / The people", "Customers."], activity: ["05 / Recorded changes", "Activity."], security: ["06 / Access & privacy", "Security."] };

function node(tag, text = "", className = "") {
  const value = document.createElement(tag);
  if (text !== "") value.textContent = String(text);
  if (className) value.className = className;
  return value;
}
function empty(container, text) { container.replaceChildren(node("p", text, "empty-state")); }
function lock(message = "Signed out. Your private workspace has been cleared.") {
  state.epoch++;
  state.signedIn = false;
  state.detail = null;
  state.factor = null;
  state.enrollment = null;
  invoiceUI.clear();
  auth.clear();
  $("#workspace").hidden = true;
  $("#login-view").hidden = false;
  $("#login-form").hidden = false;
  $("#login-form").reset();
  $("#login-mfa").hidden = true;
  $("#login-mfa").reset();
  $("#login-status").textContent = message;
  for (const id of ["metrics", "attention", "revenue-chart", "top-products", "status-breakdown", "top-cities", "order-rows", "customer-rows", "activity-list", "detail-content"]) $(`#${id}`).replaceChildren();
  for (const id of ["owner-email", "security-email", "workspace-status", "detail-status", "last-refreshed", "order-count", "customer-count", "security-status"]) $(`#${id}`).textContent = "";
  $("#mfa-qr").removeAttribute("src");
  $("#mfa-enrollment").hidden = true;
  $("#enrollment-form").reset();
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  $("#login-form input[name=email]").focus();
}
async function api(action, params = {}, body, raw = false) {
  const epoch = state.epoch;
  const endpoint = new URL(config.endpoint);
  endpoint.search = new URLSearchParams({ action, ...params });
  let token;
  try { token = await auth.token(); }
  catch (error) { if (state.signedIn) lock("Your session ended. Sign in again."); throw error; }
  if (epoch !== state.epoch) throw new Error("Session ended.");
  const response = await fetch(endpoint, { method: body ? "POST" : "GET", cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(30000), headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (epoch !== state.epoch) throw new Error("Session ended.");
  if (!response.ok) {
    let result = {};
    try { result = await response.json(); } catch {}
    const message = result.error || (response.status === 401 ? "Sign-in required. Check the owner function deployment." : "The owner service could not complete this request.");
    if ([401, 403].includes(response.status) && state.signedIn) lock(message);
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  const result = raw ? await response.blob() : await response.json();
  if (epoch !== state.epoch) throw new Error("Session ended.");
  return result;
}
async function busy(button, status, operation) {
  if (button) button.disabled = true;
  status.textContent = "Working…";
  try { await operation(); } catch (error) {
    status.textContent = ["TypeError", "TimeoutError"].includes(error.name) ? "Could not reach the service. Check your connection, refresh and try again." : error.message;
  } finally { if (button) button.disabled = false; }
}
function formParams(form) {
  const values = new FormData(form);
  const params = {};
  for (const [key, value] of values) params[key] = value === "on" ? "true" : String(value).trim();
  return params;
}
function badge(text, strong = false) { return node("span", text, strong ? "badge strong" : "badge"); }
function rank(container, entries, name, value) {
  container.replaceChildren();
  if (!entries.length) return empty(container, "Nothing recorded in this range.");
  for (const entry of entries) {
    const row = node("div", "", "rank-row");
    row.append(node("span", name(entry)), node("strong", value(entry)));
    container.append(row);
  }
}
function renderOverview(data) {
  const s = data.summary;
  const metrics = [
    ["Delivered & paid", money(s.delivered_paid_value), "Delivered orders with payment recorded"],
    ["Merchandise revenue", money(s.merchandise_revenue), "Delivered & paid, excluding delivery"],
    ["Delivery collected", money(s.delivery_collected), "Delivery on delivered & paid orders"],
    ["Payments recorded", money(s.payments_recorded), "Verified transfers + collected COD"],
    ["Awaiting payment", money(s.awaiting_payment), "Unpaid orders, excluding cancelled"],
    ["Refunds recorded", money(s.refunded_value), "Full-order refunds recorded manually"],
    ["Orders placed", s.orders, `${s.customers} customer records / tests excluded`],
    ["Average delivered order", money(s.delivered_paid_orders ? Math.round(s.delivered_paid_value / s.delivered_paid_orders) : 0), "Paid delivered orders, including delivery"]
  ];
  $("#metrics").replaceChildren(...metrics.map(([label, value, copy]) => {
    const card = node("article", "", "metric");
    card.append(node("p", label, "eyebrow"), node("strong", value), node("p", copy, "fine-print"));
    return card;
  }));
  const needs = [[s.pending, "awaiting confirmation"], [s.verify_payments, "transfers to verify"], [s.aged_pending, "pending over 48 hours"], [s.failed_alerts, "failed email alerts"], [s.cancelled_paid, "cancelled orders with recorded payment"]];
  $("#attention").replaceChildren(...needs.map(([count, label]) => node("span", `${count} ${label}`, "badge")));
  rank($("#top-products"), data.products, (p) => p.name, (p) => `${p.units} pieces / ${money(p.value)}`);
  rank($("#top-cities"), data.cities, (p) => p.city, (p) => `${p.orders} orders`);
  rank($("#status-breakdown"), ["pending", "confirmed", "dispatched", "delivered", "cancelled"].map((key) => ({ label: key === "pending" ? "Pending review" : key[0].toUpperCase() + key.slice(1), value: s[key] })), (p) => p.label, (p) => p.value);
  const chart = $("#revenue-chart");
  chart.replaceChildren();
  if (!data.daily.length) return empty(chart, "No orders in this chart window.");
  const max = Math.max(1, ...data.daily.map((day) => Number(day.revenue)));
  for (const day of data.daily) {
    const bar = node("div", "", "chart-day");
    const label = `${day.day}: ${money(day.revenue)} / ${day.orders} orders`;
    bar.title = label;
    bar.setAttribute("aria-label", label);
    bar.tabIndex = 0;
    const fill = node("i");
    fill.style.height = `${Math.max(1, Math.min(100, Number(day.revenue) / max * 100))}%`;
    fill.setAttribute("aria-hidden", "true");
    bar.append(fill);
    chart.append(bar);
  }
}
function renderOrders(data) {
  state.orders.total = Number(data.total);
  const rows = $("#order-rows");
  rows.replaceChildren();
  $("#order-count").textContent = `${data.total} orders / matching filters`;
  if (!data.rows.length) {
    const cell = node("td", "No orders match these filters.", "empty-state"); cell.colSpan = 6;
    const row = node("tr"); row.append(cell); rows.append(row);
  }
  for (const order of data.rows) {
    const row = node("tr");
    const ref = node("td"); ref.append(node("strong", order.reference), node("small", dateTime(order.created_at)));
    if (order.is_test) ref.append(badge("Test order"));
    const customer = node("td"); customer.append(node("span", order.customer_name), node("small", `${order.city} / ${order.quantity} pieces`));
    const status = node("td"); status.append(badge(STATUS_LABELS[order.status], order.status === "completed"));
    const payment = node("td"); payment.append(node("span", PAYMENT_LABELS[order.payment_status]), node("small", `${order.payment_method === "cod" ? "COD" : "Easypaisa"} / Alert ${order.notification_status}`));
    const total = node("td", money(order.total), "numeric");
    const action = node("td"); const button = node("button", "Open ↗", "quiet-link"); button.type = "button"; button.dataset.order = order.reference; button.setAttribute("aria-label", `Open order ${order.reference}`); action.append(button);
    row.append(ref, customer, status, payment, total, action); rows.append(row);
  }
  pagination("orders", data.rows.length);
}
function renderCustomers(data) {
  state.customers.total = Number(data.total);
  const rows = $("#customer-rows"); rows.replaceChildren();
  $("#customer-count").textContent = `${data.total} customer records / matching filters`;
  if (!data.rows.length) { const cell = node("td", "No customers match these filters.", "empty-state"); cell.colSpan = 5; const row = node("tr"); row.append(cell); rows.append(row); }
  for (const person of data.rows) {
    const row = node("tr");
    const name = node("td"); name.append(node("strong", person.name), node("small", person.city));
    const contact = node("td"); contact.append(node("span", person.email || "No email supplied"), node("small", `+${person.phone}`));
    const orders = node("td"); orders.append(node("span", `${person.orders} orders`), node("small", dateTime(person.last_order)));
    const total = node("td", money(person.delivered_paid_value), "numeric");
    const permission = node("td"); permission.append(badge(person.marketing_eligible ? "Email opted in" : "Not subscribed", person.marketing_eligible));
    if (person.marketing_eligible) { permission.append(node("small", dateTime(person.consent_at))); const button = node("button", "Record opt-out", "quiet-link"); button.type = "button"; button.dataset.suppress = person.email; permission.append(button); }
    row.append(name, contact, orders, total, permission); rows.append(row);
  }
  pagination("customers", data.rows.length);
}
function pagination(kind, length) {
  const { offset, total } = state[kind];
  $(`#${kind === "orders" ? "order" : "customer"}-page`).textContent = total ? `${offset + 1}–${offset + length} of ${total}` : "0 records";
  $(`[data-page="${kind}-prev"]`).disabled = offset === 0;
  $(`[data-page="${kind}-next"]`).disabled = offset + 50 >= total;
}
function renderActivity(container, entries, details = false) {
  container.replaceChildren();
  if (!entries.length) return empty(container, "No panel changes recorded yet.");
  for (const entry of entries) {
    const row = node("article", "", "activity-entry");
    const reference = entry.order_reference || entry.after_value?.invoice;
    row.append(node("p", dateTime(entry.created_at), "eyebrow"), node("p", `${entry.action.replaceAll("_", " ")}${reference ? ` / ${reference}` : ""}`), node("p", entry.reason, "fine-print"));
    if (details && entry.before_value && entry.after_value) {
      const changed = Object.keys(entry.after_value).filter((key) => key !== "version" && entry.before_value[key] !== entry.after_value[key]);
      row.append(node("p", changed.map((key) => `${key.replaceAll("_", " ")}: ${String(entry.before_value[key])} → ${String(entry.after_value[key])}`).join(" / "), "fine-print"));
    }
    container.append(row);
  }
}
async function loadView() {
  if (!state.signedIn) return;
  const serial = ++state.load;
  const view = state.view;
  $("#workspace-status").textContent = "Loading private records…";
  try {
    let result;
    if (view === "overview") result = await api("overview", formParams($("#overview-range")));
    if (view === "orders") result = await api("orders", { ...formParams($("#order-filters")), offset: state.orders.offset });
    if (view === "customers") result = await api("customers", { ...formParams($("#customer-filters")), offset: state.customers.offset });
    if (view === "activity") result = await api("audit");
    if (view === "invoices") await invoiceUI.load();
    if (view === "security") result = await auth.factors();
    if (!state.signedIn || serial !== state.load || view !== state.view) return;
    if (view === "overview") renderOverview(result);
    if (view === "orders") renderOrders(result);
    if (view === "customers") renderCustomers(result);
    if (view === "activity") renderActivity($("#activity-list"), result.rows);
    if (view === "security") {
      const verified = result.some((factor) => factor.status === "verified");
      $("#mfa-status").textContent = verified ? "Two-factor authentication is enabled. The backend requires a verified second-factor session." : "A password is your only sign-in factor. Add an authenticator for stronger protection.";
      $("#enroll-mfa").hidden = verified;
    }
    $("#workspace-status").textContent = "";
    $("#last-refreshed").textContent = `Updated ${dateTime(new Date().toISOString())}`;
  } catch (error) { if (state.signedIn && serial === state.load) $("#workspace-status").textContent = error.message; }
}
function selectView(view) {
  if (!views[view]) return;
  state.view = view;
  for (const key of Object.keys(views)) $(`#${key}-view`).hidden = key !== view;
  document.querySelectorAll("[data-view]").forEach((button) => { if (button.dataset.view === view) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); });
  $("#view-label").textContent = views[view][0]; $("#view-title").textContent = views[view][1];
  $("#view-title").focus({ preventScroll: true });
  loadView();
}
async function enterWorkspace() {
  const result = await api("me");
  state.signedIn = true;
  state.idle = Date.now();
  $("#owner-email").textContent = result.owner.email;
  $("#security-email").textContent = result.owner.email;
  $("#login-view").hidden = true; $("#workspace").hidden = false;
  $("#login-mfa").reset();
  selectView("overview");
}
function detailList(entries) {
  const list = node("dl", "", "detail-list");
  for (const [label, value] of entries) { const row = node("div"); if (["Email", "Transaction", "Email alert"].includes(label)) row.className = "print-private"; row.append(node("dt", label), node("dd", value || "—")); list.append(row); }
  return list;
}
function field(name, label, value, options = {}) {
  const wrapper = node("label", label);
  const control = node(options.options ? "select" : options.multiline ? "textarea" : "input");
  control.name = name;
  if (options.options) for (const [key, text] of options.options) { const option = node("option", text); option.value = key; control.append(option); }
  else { control.type = "text"; control.maxLength = options.max || 100; }
  control.value = value;
  wrapper.append(control);
  return wrapper;
}
function renderDetail(result) {
  const order = result.order;
  state.detail = order;
  $("#detail-title").textContent = order.reference;
  const content = $("#detail-content"); content.replaceChildren();
  const actions = node("div", "", "detail-actions");
  const whatsapp = node("a", "Open WhatsApp ↗", "button compact");
  const message = order.status === "confirmed" ? `Your Gumnaam order ${order.reference} is confirmed. Thank you for remaining Gumnaam.` : `Hello ${order.customer_name}, this is Gumnaam about your order ${order.reference}.`;
  whatsapp.href = `https://wa.me/${order.phone}?text=${encodeURIComponent(message)}`; whatsapp.target = "_blank"; whatsapp.rel = "noopener noreferrer"; actions.append(whatsapp);
  if (order.email) { const email = node("a", "Email customer ↗", "button compact"); email.href = `mailto:${encodeURIComponent(order.email)}?subject=${encodeURIComponent(`Gumnaam / Order ${order.reference}`)}`; actions.append(email); }
  const print = node("button", "Print packing slip ↓", "button compact"); print.type = "button"; print.dataset.print = "true"; actions.append(print);
  content.append(actions, node("p", "Contact links open drafts only. Nothing is sent automatically.", "fine-print"));
  const grid = node("div", "", "detail-grid");
  const customer = node("section", "", "panel"); customer.append(node("h2", "The customer."), detailList([["Name", order.customer_name], ["Email", order.email], ["WhatsApp", `+${order.phone}`], ["City", order.city], ["Address", order.address], ["Delivery note", order.notes], ["Placed", dateTime(order.created_at)]]));
  const selection = node("section", "", "panel"); selection.append(node("h2", "The selection."));
  const items = node("ul", "", "order-items");
  for (const line of linesFor(order)) { const item = node("li"); item.append(node("strong", line.product_name), node("span", `${line.size} / ${line.quantity} × ${money(line.unit_price)} / ${money(line.quantity * line.unit_price)}`)); items.append(item); }
  selection.append(items, detailList([["Pieces", money(order.subtotal ?? order.unit_price * order.quantity)], ["Delivery", money(order.cod_fee)], ["Total", money(order.total)], ["Method", order.payment_method === "cod" ? "Cash on delivery" : "Easypaisa"], ["Transaction", order.transaction_id], ["Email alert", `${order.notification_status} / ${order.notification_attempts} attempts`]]));
  grid.append(customer, selection); content.append(grid);
  if (order.receipt_path) { const receiptPanel = node("section", "", "panel"); receiptPanel.append(node("h2", "Payment evidence."), node("p", "Check the actual Easypaisa transaction before marking it verified. A screenshot alone is not proof of settlement.")); const button = node("button", "Show private screenshot", "button compact"); button.type = "button"; button.dataset.receipt = "true"; receiptPanel.append(button); const image = node("img", "", "receipt-preview"); image.id = "private-receipt"; image.alt = "Private payment screenshot"; image.hidden = true; receiptPanel.append(image); content.append(receiptPanel); }
  const edit = node("section", "", "panel"); edit.append(node("h2", "Keep it moving."));
  const form = node("form", "", "order-editor"); form.id = "order-editor";
  const pair = node("div", "", "edit-pair"); pair.append(field("status", "Order status", order.status, { options: nextStatuses(order).map((key) => [key, STATUS_LABELS[key]]) }), field("payment_status", "Payment record", order.payment_status, { options: nextPayments(order).map((key) => [key, PAYMENT_LABELS[key]]) }));
  form.append(pair, node("p", "Confirm → dispatch → deliver. Easypaisa requires transfer verification before confirmation. Mark COD collected only after money is actually received. Refunds here are records, not transfers.", "fine-print"));
  const delivery = node("div", "", "edit-pair"); delivery.append(field("courier", "Courier", order.courier, { max: 80 }), field("tracking_number", "Tracking number", order.tracking_number));
  form.append(delivery, field("internal_note", "Internal note / not sent to customer", order.internal_note, { multiline: true, max: 2000 }));
  const testLabel = node("label", "", "checkbox"); const test = node("input"); test.type = "checkbox"; test.name = "is_test"; test.checked = order.is_test; testLabel.append(test, node("span", "Test order / exclude from revenue and customer lists")); form.append(testLabel);
  const reason = field("reason", "Reason for this update", "", { max: 2000 }); reason.querySelector("input").required = true; reason.querySelector("input").minLength = 2; form.append(reason);
  const save = node("button", "Review & save changes ↗", "button primary"); save.type = "submit"; form.append(save); edit.append(form); content.append(edit);
  if (["failed", "pending", "sending"].includes(order.notification_status)) { const retry = node("button", "Queue original email alert again", "button compact"); retry.type = "button"; retry.dataset.retry = "true"; content.append(retry, node("p", "The existing five-minute retry job processes queued alerts. Alerts already sent or actively sending cannot be queued again.", "fine-print")); }
  const history = node("section", "", "panel"); history.append(node("h2", "Recorded changes.")); const list = node("div"); renderActivity(list, result.audit, true); history.append(list); content.append(history);
}
async function openOrder(reference) {
  const dialog = $("#order-detail");
  state.detail = null;
  $("#detail-content").replaceChildren(); $("#detail-title").textContent = reference; $("#detail-status").textContent = "Loading order…";
  if (!dialog.open) dialog.showModal();
  try {
    const result = await api("order", { reference });
    if (dialog.open && state.signedIn && $("#detail-title").textContent === reference) { renderDetail(result); $("#detail-status").textContent = ""; }
  } catch (error) { if (dialog.open) $("#detail-status").textContent = error.message; }
}
function confirmAction(copy) {
  const dialog = $("#confirm-dialog"); $("#confirm-copy").textContent = copy; dialog.returnValue = "cancel";
  if (dialog.open) return Promise.resolve(false);
  return new Promise((resolve) => { dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true }); dialog.showModal(); });
}
async function exportData(kind, button) {
  const copy = kind === "marketing" ? "Download explicit email opt-ins only? Phone numbers are excluded. Respect your email provider’s unsubscribe and suppression lists as well." : "Download private customer/order records for operations? Keep the file secure. Order contact details are not permission to send promotions.";
  if (!await confirmAction(copy)) return;
  await busy(button, $("#workspace-status"), async () => {
    const blob = await api("export", formParams($(kind === "orders" ? "#order-filters" : "#customer-filters")), { kind }, true);
    const url = URL.createObjectURL(blob); const link = node("a"); link.href = url; link.download = `gumnaam-${kind}-${new Date().toISOString().slice(0, 10)}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("#workspace-status").textContent = "Export downloaded. Keep it private.";
  });
}

const invoiceUI = setupInvoices({ api, node, busy, confirmAction, signedIn: () => state.signedIn });

$("#login-form").addEventListener("submit", (event) => {
  event.preventDefault(); const form = event.currentTarget;
  busy(form.querySelector("button"), $("#login-status"), async () => {
    try {
      const factor = await auth.signIn(form.elements.email.value.trim(), form.elements.password.value);
      if (factor) { state.factor = factor.id; form.hidden = true; $("#login-mfa").hidden = false; $("#login-status").textContent = "Verify your authenticator to enter."; $("#login-mfa input").focus(); }
      else await enterWorkspace();
    } catch (error) { auth.clear(); throw error; }
    finally { form.elements.password.value = ""; }
  });
});
$("#login-mfa").addEventListener("submit", (event) => {
  event.preventDefault(); const form = event.currentTarget;
  busy(form.querySelector('button[type="submit"]'), $("#login-status"), async () => { await auth.verify(state.factor, form.elements.code.value.trim()); form.reset(); await enterWorkspace(); });
});
$("#mfa-back").addEventListener("click", () => lock("Sign in again."));
$("#sign-out").addEventListener("click", () => { const task = auth.signOut(); lock(); task.catch(() => {}); });
$("#owner-nav").addEventListener("click", (event) => { const button = event.target.closest("[data-view]"); if (button) selectView(button.dataset.view); });
$("#refresh").addEventListener("click", () => loadView());
for (const [id, kind] of [["overview-range", "overview"], ["order-filters", "orders"], ["customer-filters", "customers"]]) $(`#${id}`).addEventListener("submit", (event) => { event.preventDefault(); if (kind !== "overview") state[kind].offset = 0; loadView(); });
$("#all-time").addEventListener("click", () => { $("#overview-range").reset(); loadView(); });
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.close) $(`#${button.dataset.close}`).close();
  if (button.dataset.order) openOrder(button.dataset.order);
  if (button.dataset.page) { const [kind, direction] = button.dataset.page.split("-"); state[kind].offset = Math.max(0, state[kind].offset + (direction === "next" ? 50 : -50)); loadView(); }
  if (button.dataset.export) exportData(button.dataset.export, button);
  if (button.dataset.suppress && await confirmAction(`Record an email marketing opt-out for ${button.dataset.suppress}? This removes the address from eligible exports. It does not update an external email platform.`)) busy(button, $("#workspace-status"), async () => { await api("suppress", {}, { email: button.dataset.suppress }); await loadView(); });
  if (button.dataset.receipt && state.detail) busy(button, $("#detail-status"), async () => { const reference = state.detail.reference; const result = await api("receipt", { reference }); if (!$("#order-detail").open || state.detail?.reference !== reference) return; const image = $("#private-receipt"); image.src = result.url; image.hidden = false; $("#detail-status").textContent = "Private preview link expires in 60 seconds. Do not share it."; });
  if (button.dataset.retry && state.detail) {
    const order = { ...state.detail };
    if (await confirmAction("Queue the original owner alert again? The existing Cron job will process it. Check Resend first if delivery is uncertain to avoid repeated alerts.")) busy(button, $("#detail-status"), async () => { await api("retry", {}, { reference: order.reference, version: order.version }); await openOrder(order.reference); await loadView(); });
  }
  if (button.dataset.print && state.detail) { window.print(); }
});
$("#detail-content").addEventListener("submit", async (event) => {
  if (event.target.id !== "order-editor") return;
  event.preventDefault(); const form = event.target; const order = state.detail;
  if (!order || !form.reportValidity()) return;
  const patch = {};
  for (const key of ["status", "payment_status", "courier", "tracking_number", "internal_note"]) { const value = form.elements[key].value.trim(); if (value !== order[key]) patch[key] = value; }
  if (form.elements.is_test.checked !== order.is_test) patch.is_test = form.elements.is_test.checked;
  if (!Object.keys(patch).length) { $("#detail-status").textContent = "No changes to save."; return; }
  const reason = form.elements.reason.value.trim();
  const changes = Object.entries(patch).map(([key, value]) => `${key.replaceAll("_", " ")}: ${key === "status" ? STATUS_LABELS[value] : key === "payment_status" ? PAYMENT_LABELS[value] : value}`).join(". ");
  if (!await confirmAction(`${changes}. This records your decision; it does not send a message, collect COD or transfer a refund. Confirm only after checking the actual payment and fulfilment details.`)) return;
  busy(form.querySelector('button[type="submit"]'), $("#detail-status"), async () => {
    await api("update", {}, { reference: order.reference, version: order.version, patch, reason }); await openOrder(order.reference); await loadView(); $("#detail-status").textContent = "Changes saved and recorded in the audit trail.";
  });
});
$("#order-detail").addEventListener("close", () => { state.detail = null; $("#detail-content").replaceChildren(); $("#detail-status").textContent = ""; });
$("#enroll-mfa").addEventListener("click", (event) => busy(event.currentTarget, $("#security-status"), async () => {
  const epoch = state.epoch;
  const result = await auth.enroll();
  if (!state.signedIn || epoch !== state.epoch) return;
  state.enrollment = result.id;
  if (!result.totp?.qr_code) throw new Error("Authenticator setup is unavailable.");
  $("#mfa-qr").src = result.totp.qr_code.startsWith("data:image/svg+xml") ? result.totp.qr_code : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.totp.qr_code)}`;
  $("#mfa-enrollment").hidden = false; $("#enroll-mfa").hidden = true; $("#security-status").textContent = "Scan the QR code and verify your authenticator.";
}));
$("#enrollment-form").addEventListener("submit", (event) => {
  event.preventDefault(); const form = event.currentTarget;
  busy(form.querySelector("button"), $("#security-status"), async () => { await auth.verify(state.enrollment, form.elements.code.value.trim()); state.enrollment = null; form.reset(); $("#mfa-qr").removeAttribute("src"); $("#mfa-enrollment").hidden = true; await loadView(); $("#security-status").textContent = "Authenticator enabled. Future sign-ins require your code."; });
});
for (const event of ["pointerdown", "keydown", "scroll"]) document.addEventListener(event, () => { state.idle = Date.now(); }, { passive: true });
setInterval(() => { if ((state.signedIn || state.factor) && Date.now() - state.idle > 15 * 60000) { const task = auth.signOut(); lock("Session locked after 15 minutes idle. Sign in again."); task.catch(() => {}); } }, 30000);
window.addEventListener("pagehide", () => { lock("Session ended. Sign in to reopen the workspace."); });
window.addEventListener("pageshow", (event) => { if (event.persisted) lock("Sign in again after returning to this page."); });
const now = new Date();
const pakistanDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" });
$("#overview-range input[name=until]").value = pakistanDate.format(now);
now.setUTCDate(now.getUTCDate() - 29);
$("#overview-range input[name=from]").value = pakistanDate.format(now);
