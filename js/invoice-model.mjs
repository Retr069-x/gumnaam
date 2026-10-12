export const INVOICE_HOODIES = [
  { id: "obsidian", name: "Black", price: 1999, sizes: ["S", "M", "L", "XL"] },
  { id: "navy", name: "Navy Blue", price: 1999, sizes: ["S", "M", "L", "XL"] },
  { id: "camel", name: "Camel", price: 1999, sizes: ["S", "M", "L", "XL"] },
  { id: "olive", name: "Olive Green", price: 1999, sizes: ["S", "M", "L", "XL"] }
];
export const INVOICE_METHODS = { cash: "Cash", easypaisa: "Easypaisa", bank_transfer: "Bank transfer", other: "Other" };
export function invoiceTotals(lines, discount = 0, paid = 0) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 20) throw new Error("Add between one and twenty invoice lines.");
  const keys = new Set();
  let pieces = 0;
  const subtotal = lines.reduce((sum, line) => {
    const product = INVOICE_HOODIES.find((entry) => entry.id === line.productId);
    if (!product || !product.sizes.includes(line.size)) throw new Error("Choose a hoodie and size for each line.");
    const key = `${line.productId}:${line.size}`;
    if (keys.has(key)) throw new Error("Combine duplicate hoodie and size lines.");
    keys.add(key);
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) throw new Error("Quantity must be between 1 and 100.");
    if (!Number.isInteger(line.unitPrice) || line.unitPrice < 1 || line.unitPrice > 100000) throw new Error("Unit price must be a whole PKR amount between 1 and 100,000.");
    pieces += line.quantity;
    return sum + line.quantity * line.unitPrice;
  }, 0);
  if (pieces > 100) throw new Error("Up to 100 pieces per invoice.");
  if (!Number.isInteger(discount) || discount < 0 || discount >= subtotal) throw new Error("Discount must be a whole PKR amount below the subtotal.");
  const total = subtotal - discount;
  if (!Number.isInteger(paid) || paid < 0 || paid > total) throw new Error("Amount received must be between zero and the invoice total.");
  return { subtotal, discount, total, paid, balance: total - paid, pieces };
}
