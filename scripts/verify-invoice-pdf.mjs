import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderInvoicePages, encodeInvoicePDF } from "../js/invoice-pdf.mjs";
import { INVOICE_HOODIES } from "../js/invoice-model.mjs";

if (!process.argv[2]) throw new Error("Provide the bundled QA node_modules path.");
const { createCanvas, loadImage } = await import(pathToFileURL(join(process.argv[2], "@napi-rs/canvas/index.js")));
const root = new URL("../", import.meta.url);
const logo = await loadImage(await readFile(new URL("assets/logo.png", root)));
const invoice = {
  number: "GINV-2026-000001", created_at: "2026-10-13T10:00:00Z", customer_name: "Sample customer - layout preview", email: "", phone: "",
  line_items: INVOICE_HOODIES.flatMap((product) => product.sizes.map((size) => ({ product_name: product.name, size, quantity: 1, unit_price: 1999 }))),
  subtotal: 31984, discount: 984, total: 31000, amount_paid: 31000, payment_method: "cash", payment_reference: "Sample only", status: "issued",
  notes: "LAYOUT PREVIEW ONLY. No customer order or sale was created. This fixture checks a longer invoice with all colours and sizes, clear totals and a contact-only footer. ".repeat(6).trim()
};
const pages = renderInvoicePages(invoice, { createCanvas, logo });
const pdf = encodeInvoicePDF(pages.map((canvas) => ({ bytes: new Uint8Array(canvas.toBuffer("image/jpeg")), width: canvas.width, height: canvas.height })));
await mkdir(new URL("output/pdf/", root), { recursive: true });
await writeFile(new URL("output/pdf/invoice-customer-preview.pdf", root), new Uint8Array(await pdf.arrayBuffer()));
console.log(`Rendered ${pages.length} customer-only pages to output/pdf/invoice-customer-preview.pdf`);
