export const CART_KEY = "gumnaam-bag-v1";
export const lineKey = (line) => `${line.productId}:${line.size}`;

export function sanitizeCart(value, catalog) {
  if (!Array.isArray(value)) return [];
  const lines = [];
  let count = 0;
  for (const item of value.slice(0, 16)) {
    const product = catalog.find((entry) => entry.id === item?.productId);
    if (!product || !product.sizes.includes(item.size) || !Number.isInteger(item.quantity) || item.quantity < 1) continue;
    const used = lines.filter((entry) => entry.productId === product.id).reduce((sum, entry) => sum + entry.quantity, 0);
    const quantity = Math.min(item.quantity, product.stock - used, 10 - count);
    if (quantity < 1) continue;
    const previous = lines.find((entry) => lineKey(entry) === lineKey(item));
    if (previous) previous.quantity += quantity;
    else lines.push({ productId: product.id, size: item.size, quantity });
    count += quantity;
  }
  return lines;
}

export function addLine(cart, line, catalog) {
  const product = catalog.find((entry) => entry.id === line.productId);
  if (!product || !product.sizes.includes(line.size)) throw new Error("Choose a piece and size.");
  if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new Error("Choose a valid quantity.");
  const used = cart.filter((entry) => entry.productId === product.id).reduce((sum, entry) => sum + entry.quantity, 0);
  if (used + line.quantity > product.stock || cart.reduce((sum, entry) => sum + entry.quantity, 0) + line.quantity > 10) throw new Error("That quantity is not available. Up to 10 pieces per order.");
  const next = cart.map((entry) => ({ ...entry }));
  const existing = next.find((entry) => lineKey(entry) === lineKey(line));
  if (existing) existing.quantity += line.quantity;
  else next.push({ productId: line.productId, size: line.size, quantity: line.quantity });
  return next;
}

export function editLine(cart, key, changes, catalog) {
  const line = cart.find((entry) => lineKey(entry) === key);
  if (!line) return cart;
  const remaining = cart.filter((entry) => lineKey(entry) !== key);
  if (changes.quantity === 0) return remaining;
  return addLine(remaining, { ...line, ...changes }, catalog);
}

export function cartTotals(cart, catalog, deliveryFee = 200) {
  const subtotal = cart.reduce((sum, line) => {
    const product = catalog.find((entry) => entry.id === line.productId);
    return sum + (product?.price || 0) * line.quantity;
  }, 0);
  return { count: cart.reduce((sum, line) => sum + line.quantity, 0), subtotal, delivery: cart.length ? deliveryFee : 0, total: subtotal + (cart.length ? deliveryFee : 0) };
}

export function subtractPurchased(cart, purchased) {
  return cart.map((line) => ({ ...line, quantity: Math.max(0, line.quantity - (purchased.find((item) => lineKey(item) === lineKey(line))?.quantity || 0)) })).filter((line) => line.quantity > 0);
}
