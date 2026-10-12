export const INVOICE_CONTACTS = ["gumnaamofficial.com", "gumnaamofficialpk@gmail.com", "@gumnaamclothingpk"];
const PAGE_WIDTH = 595.28, PAGE_HEIGHT = 841.89, SCALE = 2.8;
const amount = (value) => `PKR ${Number(value).toLocaleString("en-PK")}`;
const invoiceDate = (value) => new Intl.DateTimeFormat("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function renderInvoicePages(invoice, { createCanvas, logo = null } = {}) {
  if (!invoice || !Array.isArray(invoice.line_items) || !invoice.line_items.length || invoice.line_items.length > 20 || !/^GINV-\d{4}-\d{6,20}$/.test(invoice.number || "")) throw new Error("Open a saved invoice before downloading.");
  const pages = [];
  let canvas, context, y;
  const font = (size = 10, bold = false) => { context.font = `${bold ? "bold" : "normal"} ${size}px Arial, sans-serif`; };
  const text = (value, x, top, size = 10, bold = false, align = "left") => { font(size, bold); context.textAlign = align; context.fillText(String(value), x, top); context.textAlign = "left"; };
  const rule = (top) => { context.beginPath(); context.moveTo(42, top); context.lineTo(553, top); context.stroke(); };
  function wrap(value, width, size = 10, bold = false) {
    font(size, bold);
    const lines = [];
    for (const paragraph of String(value || "").split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (context.measureText(candidate).width <= width) line = candidate;
        else {
          if (line) lines.push(line);
          line = "";
          for (const char of Array.from(word)) { if (context.measureText(line + char).width > width && line) { lines.push(line); line = ""; } line += char; }
        }
      }
      lines.push(line);
    }
    return lines;
  }
  function startPage() {
    canvas = createCanvas(Math.round(PAGE_WIDTH * SCALE), Math.round(PAGE_HEIGHT * SCALE));
    context = canvas.getContext("2d");
    context.scale(SCALE, SCALE);
    context.fillStyle = "#fff"; context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    context.fillStyle = "#000"; context.strokeStyle = "#000"; context.lineWidth = .5; context.textBaseline = "top";
    if (logo) context.drawImage(logo, 42, 38, 40, 40);
    text("GUMNAAM", logo ? 94 : 42, 45, 17, true);
    text("Faisalabad, Pakistan", logo ? 94 : 42, 67, 9);
    text("SALES INVOICE", 553, 43, 17, true, "right");
    text(invoice.number, 553, 68, 10, false, "right");
    text(invoiceDate(invoice.created_at), 553, 85, 9, false, "right");
    rule(112);
    text(invoice.status === "void" ? "VOID" : invoice.amount_paid === invoice.total ? "PAID" : invoice.amount_paid ? "PART PAID" : "UNPAID", 42, 124, 10, true);
    text("In-person purchase / Not a tax invoice", 553, 126, 8, false, "right");
    y = 153; pages.push(canvas);
  }
  function ensure(height) { if (y + height > 714) { startPage(); return true; } return false; }
  function paragraph(value, size = 10, bold = false, width = 511) {
    for (const line of wrap(value, width, size, bold)) { ensure(size + 8); text(line, 42, y, size, bold); y += size + 5; }
  }
  function tableHeader() {
    ensure(32);
    rule(y); y += 10;
    text("HOODIE", 42, y, 8, true); text("SIZE", 308, y, 8, true); text("QTY", 362, y, 8, true, "right"); text("UNIT / PKR", 449, y, 8, true, "right"); text("AMOUNT / PKR", 553, y, 8, true, "right");
    y += 19; rule(y); y += 12;
  }
  startPage();
  paragraph("BILL TO", 8, true); y += 5;
  paragraph(invoice.customer_name, 12, true);
  if (invoice.phone) paragraph(`+${invoice.phone}`, 9);
  if (invoice.email) paragraph(invoice.email, 9);
  y += 20; tableHeader();
  for (const item of invoice.line_items) {
    const lines = wrap(item.product_name, 240, 10);
    const height = Math.max(31, lines.length * 15 + 14);
    if (ensure(height)) tableHeader();
    for (const [index, line] of lines.entries()) text(line, 42, y + index * 15);
    text(item.size, 308, y, 10); text(item.quantity, 362, y, 10, false, "right"); text(Number(item.unit_price).toLocaleString("en-PK"), 449, y, 10, false, "right"); text((item.unit_price * item.quantity).toLocaleString("en-PK"), 553, y, 10, false, "right");
    y += height; rule(y - 8);
  }
  y += 18; ensure(162);
  for (const [label, value] of [["Subtotal", invoice.subtotal], ["Discount", invoice.discount], ["Delivery", 0], ["Total", invoice.total], ["Amount received", invoice.amount_paid], [invoice.status === "void" ? "Refund recorded" : "Balance due", invoice.status === "void" ? invoice.refunded_amount : invoice.total - invoice.amount_paid]]) {
    text(label, 330, y, 10, label === "Total"); text(amount(value), 553, y, 10, label === "Total", "right"); y += 24;
  }
  y += 8;
  const methods = { cash: "Cash", easypaisa: "Easypaisa", bank_transfer: "Bank transfer", other: "Other" };
  paragraph(`Payment: ${methods[invoice.payment_method] || "Other"}${invoice.payment_reference ? ` / ${invoice.payment_reference}` : ""}`, 9);
  if (invoice.notes) { y += 14; paragraph(invoice.notes, 9); }
  if (invoice.status === "void" && invoice.void_reason) { y += 14; paragraph(`Void reason: ${invoice.void_reason}`, 9); }
  for (const [index, page] of pages.entries()) {
    context = page.getContext("2d");
    rule(752);
    for (const [line, contact] of INVOICE_CONTACTS.entries()) text(contact, PAGE_WIDTH / 2, 767 + line * 16, 9, false, "center");
    if (pages.length > 1) text(`Page ${index + 1} / ${pages.length}`, 553, 105, 7, false, "right");
  }
  return pages;
}

export function encodeInvoicePDF(images) {
  if (!Array.isArray(images) || !images.length || images.length > 10) throw new Error("Invoice PDF page count is invalid.");
  const encoder = new TextEncoder();
  const parts = [], offsets = [0]; let length = 0;
  const append = (value) => { const bytes = typeof value === "string" ? encoder.encode(value) : value; parts.push(bytes); length += bytes.byteLength; };
  const object = (id, content, bytes) => { offsets[id] = length; append(`${id} 0 obj\n${content}`); if (bytes) { append("\nstream\n"); append(bytes); append("\nendstream"); } append("\nendobj\n"); };
  append("%PDF-1.4\n%Gumnaam\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Count ${images.length} /Kids [${images.map((_, index) => `${3 + index * 3} 0 R`).join(" ")}] >>`);
  for (const [index, image] of images.entries()) {
    if (!(image.bytes instanceof Uint8Array) || image.bytes[0] !== 255 || image.bytes[1] !== 216 || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) throw new Error("Invoice page image is invalid.");
    const id = 3 + index * 3;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /XObject << /InvoiceImage ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(id + 1, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.byteLength} >>`, image.bytes);
    const stream = `q\n${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm\n/InvoiceImage Do\nQ\n`;
    object(id + 2, `<< /Length ${encoder.encode(stream).byteLength} >>`, encoder.encode(stream));
  }
  const xref = length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let id = 1; id < offsets.length; id++) append(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

export async function customerInvoicePDF(invoice) {
  let logo = null;
  try { logo = new Image(); logo.src = new URL("../assets/logo.png", import.meta.url).href; await logo.decode(); } catch { logo = null; }
  const pages = renderInvoicePages(invoice, { createCanvas: (width, height) => { const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas; }, logo });
  const images = pages.map((canvas) => {
    const base64 = canvas.toDataURL("image/jpeg", .95).split(",")[1];
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return { bytes, width: canvas.width, height: canvas.height };
  });
  return encodeInvoicePDF(images);
}
