import { INVOICE_HOODIES, INVOICE_METHODS, invoiceTotals } from "../../../js/invoice-model.mjs";

function invoiceText(value, max, min = 0) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error("Check the invoice details.");
  return value.trim();
}
export function validateInvoice(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.requestKey !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestKey)) throw new Error("Start a fresh invoice and try again.");
  const totals = invoiceTotals(input.items, input.discount, input.amountPaid);
  const email = invoiceText(input.email ?? "", 254).toLowerCase();
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(email))) throw new Error("Check the customer email.");
  let phone = invoiceText(input.phone ?? "", 24).replace(/[\s()+-]/g, "");
  if (phone && !/^(?:03\d{9}|923\d{9})$/.test(phone)) throw new Error("Enter a valid Pakistan mobile number, or leave it blank.");
  if (phone.startsWith("0")) phone = `92${phone.slice(1)}`;
  if (!Object.hasOwn(INVOICE_METHODS, input.paymentMethod)) throw new Error("Choose a payment method.");
  return {
    request_key: input.requestKey.toLowerCase(), customer_name: invoiceText(input.customerName, 100, 2), email, phone,
    line_items: input.items.map((line) => ({ product_id: line.productId, product_name: INVOICE_HOODIES.find((entry) => entry.id === line.productId).name, size: line.size, quantity: line.quantity, unit_price: line.unitPrice })).sort((a, b) => `${a.product_id}:${a.size}`.localeCompare(`${b.product_id}:${b.size}`)),
    subtotal: totals.subtotal, discount: totals.discount, total: totals.total, amount_paid: totals.paid,
    payment_method: input.paymentMethod, payment_reference: invoiceText(input.paymentReference ?? "", 100), notes: invoiceText(input.notes ?? "", 1000)
  };
}
export async function invoiceHash(record) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(record))));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
