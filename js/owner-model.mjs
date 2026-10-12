export const STATUS_LABELS = { pending_confirmation: "Pending confirmation", pending_verification: "Pending verification", confirmed: "Confirmed", dispatched: "Dispatched", completed: "Delivered", cancelled: "Cancelled" };
export const PAYMENT_LABELS = { unverified: "Awaiting payment", verified: "Transfer verified", collected: "COD collected", refunded: "Refund recorded" };
export const NEXT_STATUSES = { pending_confirmation: ["confirmed", "cancelled"], pending_verification: ["confirmed", "cancelled"], confirmed: ["dispatched", "cancelled"], dispatched: ["completed", "cancelled"], completed: ["cancelled"], cancelled: [] };
export const money = (value) => `PKR ${Number(value || 0).toLocaleString("en-PK")}`;
export const dateTime = (value) => value ? new Intl.DateTimeFormat("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
export function nextStatuses(order) {
  return [order.status, ...(order.status === "cancelled" ? order.payment_status === "refunded" ? [] : [order.payment_method === "easypaisa" ? "pending_verification" : "pending_confirmation"] : NEXT_STATUSES[order.status] || [])];
}
export function nextPayments(order) {
  return [order.payment_status, ...(order.payment_status === "unverified" ? [order.payment_method === "cod" ? "collected" : "verified"] : ["verified", "collected"].includes(order.payment_status) ? ["refunded"] : [])];
}
export function linesFor(order) {
  return Array.isArray(order.line_items) && order.line_items.length ? order.line_items : [{ product_name: order.product_name, size: order.size, quantity: order.quantity, unit_price: order.unit_price }];
}
export function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function toCSV(columns, rows) {
  return "\uFEFF" + [columns.map(([label]) => csvCell(label)).join(","), ...rows.map((row) => columns.map(([, key]) => csvCell(row[key])).join(","))].join("\r\n");
}
export function pakistanRange(from, until) {
  const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if ((from && !valid(from)) || (until && !valid(until)) || (from && until && from > until)) throw new Error("Choose a valid date range.");
  const end = until ? new Date(`${until}T00:00:00+05:00`) : null;
  if (end) end.setUTCDate(end.getUTCDate() + 1);
  return { from: from ? new Date(`${from}T00:00:00+05:00`).toISOString() : null, until: end?.toISOString() || null };
}
