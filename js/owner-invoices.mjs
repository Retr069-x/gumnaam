import { INVOICE_HOODIES, INVOICE_METHODS, invoiceTotals } from "./invoice-model.mjs";
import { money, dateTime } from "./owner-model.mjs";

export function setupInvoices({ api, node, busy, confirmAction, signedIn }) {
  const $ = (selector) => document.querySelector(selector);
  let offset = 0, generation = 0, loadSerial = 0, current = null, requestKey = "", signature = "", issuing = false;
  const form = $("#invoice-form");
  const container = $("#invoice-lines");
  function input(label, name, type, value, settings = {}) {
    const wrapper = node("label", label);
    const field = node("input"); field.type = type; field.name = name; field.value = value;
    for (const [key, setting] of Object.entries(settings)) field[key] = setting;
    wrapper.append(field); return wrapper;
  }
  function select(label, name, options, value) {
    const wrapper = node("label", label); const field = node("select"); field.name = name;
    for (const [key, copy] of options) { const option = node("option", copy); option.value = key; field.append(option); }
    field.value = value; wrapper.append(field); return wrapper;
  }
  function line() {
    if (container.children.length >= 20) { $("#invoice-status").textContent = "Up to twenty lines per invoice."; return; }
    const row = node("div", "", "invoice-line");
    row.append(select("Hoodie", "hoodie", INVOICE_HOODIES.map((product) => [product.id, product.name]), "obsidian"), select("Size", "invoiceSize", ["S", "M", "L", "XL"].map((size) => [size, size]), "M"), input("Quantity", "invoiceQuantity", "number", "1", { required: true, min: "1", max: "100", step: "1" }), input("Unit price / PKR", "invoicePrice", "number", "1999", { required: true, min: "1", max: "100000", step: "1" }));
    const remove = node("button", "Remove ×", "quiet-link invoice-remove"); remove.type = "button"; remove.dataset.removeInvoiceLine = "true"; row.append(remove); container.append(row);
    updateTotals();
  }
  function items() {
    return [...container.children].map((row) => ({ productId: row.querySelector('[name="hoodie"]').value, size: row.querySelector('[name="invoiceSize"]').value, quantity: row.querySelector('[name="invoiceQuantity"]').value === "" ? NaN : Number(row.querySelector('[name="invoiceQuantity"]').value), unitPrice: row.querySelector('[name="invoicePrice"]').value === "" ? NaN : Number(row.querySelector('[name="invoicePrice"]').value) }));
  }
  function totals() {
    return invoiceTotals(items(), form.elements.discount.value === "" ? NaN : Number(form.elements.discount.value), form.elements.amountPaid.value === "" ? NaN : Number(form.elements.amountPaid.value));
  }
  function updateTotals() {
    const summary = $("#invoice-draft-totals"); summary.replaceChildren();
    try {
      const value = totals();
      for (const [label, amount] of [["Pieces", value.subtotal], ["Discount", value.discount], ["Delivery", 0], ["Total", value.total], ["Received", value.paid], ["Balance due", value.balance]]) { const row = node("div"); row.append(node("span", label), node("strong", money(amount))); summary.append(row); }
    } catch (error) { summary.append(node("p", error.message)); }
  }
  function resetDraft() { form.reset(); requestKey = ""; signature = ""; container.replaceChildren(); line(); $("#invoice-status").textContent = ""; }
  async function load() {
    const epoch = generation, serial = ++loadSerial;
    const filters = new FormData($("#invoice-filters"));
    let data;
    try { data = await api("invoices", { q: filters.get("q") || "", invoiceStatus: filters.get("invoiceStatus") || "", offset }); }
    catch (error) { if ([404, 503].includes(error.status)) throw new Error("Invoice storage is not ready. Run invoices.sql in Supabase and redeploy the updated owner-api function, then refresh this section."); throw error; }
    if (!signedIn() || epoch !== generation || serial !== loadSerial) return;
    const s = data.summary;
    const metrics = [["Walk-in invoiced", money(s.invoiced)], ["Payment recorded", money(s.paid)], ["Balance outstanding", money(s.balance)], ["Refunds recorded", money(s.refunded)]];
    $("#invoice-metrics").replaceChildren(...metrics.map(([label, value]) => { const card = node("article", "", "metric"); card.append(node("p", label, "eyebrow"), node("strong", value)); return card; }));
    $("#invoice-count").textContent = `${data.total} invoices / matching search`;
    const history = $("#invoice-history"); history.replaceChildren();
    if (!data.rows.length) history.append(node("p", "No invoices match this search.", "empty-state"));
    for (const invoice of data.rows) {
      const entry = node("article", "", "invoice-history-entry");
      const button = node("button", invoice.number, "quiet-link"); button.type = "button"; button.dataset.invoiceNumber = invoice.number; entry.append(button, node("p", invoice.customer_name), node("p", `${dateTime(invoice.created_at)} / ${invoice.status.toUpperCase()}`, "fine-print"), node("p", `${money(invoice.total)} / ${money(invoice.amount_paid)} received`, "fine-print")); history.append(entry);
    }
    $("#invoice-page").textContent = data.total ? `${offset + 1}–${offset + data.rows.length} of ${data.total}` : "0 records";
    $("#invoice-prev").disabled = offset === 0; $("#invoice-next").disabled = offset + 50 >= data.total;
  }
  function render(invoice) {
    current = invoice;
    const paper = $("#invoice-paper"); paper.replaceChildren();
    const header = node("header", "", "invoice-paper-header");
    const brand = node("div"); const logo = node("img"); logo.src = "assets/logo.png"; logo.alt = "Gumnaam"; logo.width = 54; logo.height = 54; brand.append(logo, node("p", "GUMNAAM", "invoice-wordmark"), node("p", "Faisalabad, Pakistan", "fine-print"));
    const identity = node("div"); identity.append(node("h2", "Sales invoice"), node("p", invoice.number, "eyebrow"), node("p", dateTime(invoice.created_at), "fine-print"), node("p", invoice.status === "void" ? "VOID" : invoice.amount_paid === invoice.total ? "PAID" : invoice.amount_paid ? "PART PAID" : "UNPAID", "badge")); header.append(brand, identity); paper.append(header);
    const customer = node("section", "", "invoice-billed-to"); customer.append(node("p", "Bill to / In-person purchase", "eyebrow"), node("p", invoice.customer_name));
    if (invoice.phone) customer.append(node("p", `+${invoice.phone}`, "fine-print")); if (invoice.email) customer.append(node("p", invoice.email, "fine-print")); paper.append(customer);
    const table = node("table", "", "invoice-paper-table"); const caption = node("caption", "Purchased hoodies", "sr-only"); table.append(caption);
    const head = node("thead"), labels = node("tr"); for (const label of ["Hoodie", "Size", "Qty", "Unit / PKR", "Amount / PKR"]) { const cell = node("th", label); cell.scope = "col"; labels.append(cell); } head.append(labels); table.append(head);
    const body = node("tbody"); for (const item of invoice.line_items) { const row = node("tr"); for (const value of [item.product_name, item.size, item.quantity, Number(item.unit_price).toLocaleString("en-PK"), (item.quantity * item.unit_price).toLocaleString("en-PK")]) row.append(node("td", value)); body.append(row); } table.append(body); paper.append(table);
    const summary = node("dl", "", "invoice-paper-totals");
    for (const [label, amount] of [["Subtotal", invoice.subtotal], ["Discount", invoice.discount], ["Delivery", 0], ["Total", invoice.total], ["Amount received", invoice.amount_paid], [invoice.status === "void" ? "Refund recorded" : "Balance due", invoice.status === "void" ? invoice.refunded_amount : invoice.total - invoice.amount_paid]]) { const row = node("div"); row.append(node("dt", label), node("dd", money(amount))); summary.append(row); } paper.append(summary);
    paper.append(node("p", `Payment record: ${INVOICE_METHODS[invoice.payment_method]}${invoice.payment_reference ? ` / ${invoice.payment_reference}` : ""}`, "fine-print"));
    if (invoice.notes) paper.append(node("p", invoice.notes, "invoice-public-note"));
    if (invoice.status === "void") paper.append(node("p", `Void reason: ${invoice.void_reason}`, "invoice-public-note"));
    const footer = node("footer", "", "invoice-paper-footer"); footer.append(node("p", "Thank you for remaining Gumnaam."), node("p", "gumnaamofficialpk@gmail.com / @gumnaamclothingpk", "fine-print"), node("p", "Sales invoice for an in-person purchase. Not a tax invoice. Payment status records the owner's confirmation, not an automatic bank verification.", "fine-print")); paper.append(footer);
    const editor = $("#invoice-payment-editor"); editor.replaceChildren();
    if (invoice.status !== "void") {
      editor.append(node("h2", "Payment record."), node("p", "Record cumulative money actually received. To correct a sale, void and reissue; paid invoices should be voided only after refunding the received amount.", "fine-print"));
      const paymentForm = node("form", "", "invoice-payment-form"); paymentForm.id = "invoice-payment-form";
      paymentForm.append(input("Total received to date / PKR", "paid", "number", String(invoice.amount_paid), { required: true, min: String(invoice.amount_paid), max: String(invoice.total), step: "1" }), select("Latest payment method", "method", Object.entries(INVOICE_METHODS), invoice.payment_method), input("Payment reference / optional", "reference", "text", invoice.payment_reference, { maxLength: 100 }), input("Reason / required", "reason", "text", "", { minLength: 2, maxLength: 2000, required: true }));
      const save = node("button", "Review payment update", "button primary"); save.type = "submit"; paymentForm.append(save); editor.append(paymentForm);
      const voidButton = node("button", "Void invoice / record full refund", "quiet-link"); voidButton.type = "button"; voidButton.id = "void-invoice"; editor.append(voidButton);
    } else editor.append(node("p", "This invoice is void and cannot be edited. Issue a new invoice if needed.", "fine-print"));
  }
  function show(invoice) { render(invoice); $("#invoice-dialog-status").textContent = ""; if (!$("#invoice-dialog").open) $("#invoice-dialog").showModal(); }
  async function open(number) {
    const epoch = generation;
    await busy(null, $("#invoice-status"), async () => { const data = await api("invoice", { number }); if (signedIn() && epoch === generation) { show(data.invoice); $("#invoice-status").textContent = ""; } });
  }
  $("#add-invoice-line").addEventListener("click", line);
  container.addEventListener("click", (event) => { const button = event.target.closest("[data-remove-invoice-line]"); if (!button) return; if (container.children.length === 1) { $("#invoice-status").textContent = "Keep at least one invoice line."; return; } button.closest(".invoice-line").remove(); updateTotals(); });
  form.addEventListener("input", updateTotals); form.addEventListener("change", updateTotals);
  $("#invoice-paid-in-full").addEventListener("click", () => { try { const value = invoiceTotals(items(), Number(form.elements.discount.value), 0); form.elements.amountPaid.value = value.total; updateTotals(); } catch (error) { $("#invoice-status").textContent = error.message; } });
  $("#new-invoice").addEventListener("click", async () => { if (!issuing && await confirmAction("Clear this unsaved invoice draft and start a new one? Saved invoices will remain unchanged.")) resetDraft(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); if (!signedIn() || issuing || !form.reportValidity()) return;
    issuing = true;
    const button = $("#issue-invoice"); button.disabled = true;
    try {
      const value = totals();
      const payload = { items: items(), discount: value.discount, amountPaid: value.paid, customerName: form.elements.customerName.value.trim(), phone: form.elements.phone.value.trim(), email: form.elements.email.value.trim(), paymentMethod: form.elements.paymentMethod.value, paymentReference: form.elements.paymentReference.value.trim(), notes: form.elements.notes.value.trim() };
      const epoch = generation;
      if (!await confirmAction(`Issue a saved sales invoice for ${payload.customerName}: ${money(value.total)} total, ${money(value.paid)} received, ${money(value.balance)} due? No delivery charge or email is added. Record only money actually received.`)) return;
      if (!signedIn() || epoch !== generation) return;
      const nextSignature = JSON.stringify(payload);
      if (!requestKey || signature !== nextSignature) { requestKey = window.crypto.randomUUID(); signature = nextSignature; }
      const fields = [...form.querySelectorAll("input, select, textarea, button")];
      const disabled = fields.map((field) => field.disabled); fields.forEach((field) => { field.disabled = true; });
      try {
        $("#invoice-status").textContent = "Saving invoice. Keep this page open.";
        const result = await api("invoice-create", {}, { ...payload, requestKey });
        if (epoch !== generation || !signedIn()) return;
        if (!/^GINV-\d{4}-\d{6,20}$/.test(result.invoice?.number) || result.invoice.total !== value.total) throw new Error("Invoice response differs from the displayed total. Refresh invoice history before retrying.");
        show(result.invoice); resetDraft(); $("#invoice-status").textContent = `Saved ${result.invoice.number}. Print or save PDF from its preview.`; await load();
      } finally { fields.forEach((field, index) => { field.disabled = disabled[index]; }); }
    } catch (error) { $("#invoice-status").textContent = ["TypeError", "TimeoutError"].includes(error.name) ? "Could not verify the save. Retry this same draft to avoid a duplicate; if you reload, check saved invoices first." : error.message; }
    finally { issuing = false; button.disabled = false; }
  });
  $("#invoice-filters").addEventListener("submit", async (event) => { event.preventDefault(); offset = 0; await busy(event.currentTarget.querySelector("button"), $("#invoice-status"), async () => { await load(); $("#invoice-status").textContent = ""; }); });
  $("#invoice-prev").addEventListener("click", () => { offset = Math.max(0, offset - 50); busy(null, $("#invoice-status"), async () => { await load(); $("#invoice-status").textContent = ""; }); });
  $("#invoice-next").addEventListener("click", () => { offset += 50; busy(null, $("#invoice-status"), async () => { await load(); $("#invoice-status").textContent = ""; }); });
  $("#invoice-history").addEventListener("click", (event) => { const button = event.target.closest("[data-invoice-number]"); if (button) open(button.dataset.invoiceNumber); });
  $("#print-invoice").addEventListener("click", () => { if (current && signedIn()) window.print(); });
  window.addEventListener("beforeprint", () => { if (current && signedIn() && $("#invoice-dialog").open) document.body.classList.add("printing-invoice"); });
  window.addEventListener("afterprint", () => { document.body.classList.remove("printing-invoice"); });
  async function updatePayment(voidInvoice = false) {
    if (!current || !signedIn()) return;
    const invoice = { ...current }, epoch = generation;
    const editor = $("#invoice-payment-form");
    if (!editor.reportValidity()) return;
    const paid = voidInvoice ? invoice.amount_paid : Number(editor.elements.paid.value);
    if (!Number.isInteger(paid) || paid < invoice.amount_paid || paid > invoice.total) { $("#invoice-dialog-status").textContent = "Received-to-date must be between the previous payment and invoice total."; return; }
    const reason = editor.elements.reason.value.trim();
    const copy = voidInvoice ? `Void ${invoice.number}? ${invoice.amount_paid ? `This records a full refund of ${money(invoice.amount_paid)}. Continue only after actually refunding that money.` : "No received payment is recorded."} This does not send money and cannot be undone.` : `Record ${money(paid)} received to date on ${invoice.number}? Only confirm money actually received. This does not charge the customer.`;
    if (!await confirmAction(copy) || epoch !== generation || !signedIn()) return;
    await busy(editor.querySelector("button"), $("#invoice-dialog-status"), async () => {
      const result = await api("invoice-update", {}, { number: invoice.number, version: invoice.version, amountPaid: paid, paymentMethod: editor.elements.method.value, paymentReference: editor.elements.reference.value.trim(), void: voidInvoice, reason });
      if (epoch !== generation || !signedIn()) return;
      show(result.invoice); $("#invoice-dialog-status").textContent = "Invoice record updated. No payment or message was sent."; await load();
    });
  }
  $("#invoice-payment-editor").addEventListener("submit", (event) => { event.preventDefault(); updatePayment(); });
  $("#invoice-payment-editor").addEventListener("click", (event) => { if (event.target.closest("#void-invoice")) updatePayment(true); });
  $("#invoice-dialog").addEventListener("close", () => { current = null; $("#invoice-paper").replaceChildren(); $("#invoice-payment-editor").replaceChildren(); $("#invoice-dialog-status").textContent = ""; });
  resetDraft();
  return { load, clear() { generation++; loadSerial++; current = null; offset = 0; requestKey = ""; signature = ""; $("#invoice-dialog").close(); resetDraft(); for (const id of ["invoice-history", "invoice-metrics", "invoice-paper", "invoice-payment-editor"]) $(`#${id}`).replaceChildren(); for (const id of ["invoice-count", "invoice-page", "invoice-status", "invoice-dialog-status"]) $(`#${id}`).textContent = ""; } };
}
