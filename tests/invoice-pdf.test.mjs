import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderInvoicePages, encodeInvoicePDF, INVOICE_CONTACTS } from "../js/invoice-pdf.mjs";

const invoice = { number: "GINV-2026-000001", created_at: "2026-10-13T10:00:00Z", customer_name: "Test Customer", email: "customer@example.com", phone: "923001234567", line_items: [{ product_name: "Black", size: "M", quantity: 2, unit_price: 1999 }], subtotal: 3998, discount: 98, total: 3900, amount_paid: 3900, payment_method: "cash", payment_reference: "", notes: "", status: "issued" };
function fakeCanvas() {
  const pages = [];
  const createCanvas = (width, height) => {
    const entries = [];
    const context = { scale() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, drawImage() {}, measureText(value) { return { width: String(value).length * 5.8 }; }, fillText(value, x, y) { entries.push({ value, x, y }); } };
    const canvas = { width, height, entries, getContext: () => context }; pages.push(canvas); return canvas;
  };
  return { pages, createCanvas };
}
test("customer PDF contains no workspace title, page URL or admin controls", () => {
  const renderer = fakeCanvas();
  renderInvoicePages({ ...invoice, workspace_title: "Owner workspace", admin_url: "https://gumnaamofficial.com/admin", internal_note: "Private internal note" }, renderer);
  const texts = renderer.pages.flatMap((page) => page.entries.map((entry) => entry.value)).join("\n");
  assert.doesNotMatch(texts, /Owner workspace|\/admin|Private internal note|Review payment|Supabase|Restricted access/);
  assert.match(texts, /SALES INVOICE/); assert.match(texts, /Test Customer/); assert.match(texts, /PKR 3,900/);
  assert.deepEqual(renderer.pages[0].entries.filter((entry) => entry.y > 752).map((entry) => entry.value), INVOICE_CONTACTS);
});
test("long invoices paginate cleanly and repeat only the three contact footer lines", () => {
  const renderer = fakeCanvas();
  renderInvoicePages({ ...invoice, customer_name: "A long Unicode customer name محمد احمد", line_items: Array.from({ length: 20 }, () => ({ product_name: "Olive Green", size: "XL", quantity: 1, unit_price: 1999 })), notes: "A long customer note. ".repeat(47) }, renderer);
  assert.ok(renderer.pages.length > 1);
  for (const page of renderer.pages) {
    assert.deepEqual(page.entries.filter((entry) => entry.y > 752).map((entry) => entry.value), INVOICE_CONTACTS);
    assert.ok(page.entries.every((entry) => entry.y < 808));
    assert.ok(page.entries.filter((entry) => entry.y < 752).every((entry) => entry.y <= 714));
  }
});
test("native PDF writer has correct binary offsets and no inherited web page metadata", async () => {
  const blob = encodeInvoicePDF([{ bytes: new Uint8Array([255,216,255,217]), width: 1667, height: 2357 }, { bytes: new Uint8Array([255,216,255,217]), width: 1667, height: 2357 }]);
  assert.equal(blob.type, "application/pdf");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const content = new TextDecoder("latin1").decode(bytes);
  assert.match(content, /^%PDF-1.4/); assert.match(content, /\/Count 2/); assert.doesNotMatch(content, /\/admin|Owner workspace|\/URI|\/JavaScript/);
  const xref = Number(content.match(/startxref\n(\d+)/)[1]);
  assert.equal(new TextDecoder().decode(bytes.slice(xref, xref + 4)), "xref");
  const entries = content.slice(xref).match(/\d{10} 00000 n/g);
  for (const [index, entry] of entries.entries()) assert.ok(new TextDecoder().decode(bytes.slice(Number(entry.slice(0,10)), Number(entry.slice(0,10)) + 20)).startsWith(`${index + 1} 0 obj`));
});
test("preview footer and PDF action are customer-only", async () => {
  const source = await readFile(new URL("../js/owner-invoices.mjs", import.meta.url), "utf8");
  const html = await readFile(new URL("../admin.html", import.meta.url), "utf8");
  assert.match(html, /Download customer PDF/);
  assert.match(source, /for \(const contact of INVOICE_CONTACTS\)/);
  assert.match(source, /const pdf = await customerInvoicePDF\(invoice\)/);
  assert.match(source, /epoch !== generation \|\| current !== invoice/);
  assert.doesNotMatch(source, /window\.print\(\)/);
});
