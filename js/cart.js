import { CART_KEY, lineKey, sanitizeCart, addLine, editLine, cartTotals, subtractPurchased } from "./cart-model.mjs";

const catalog = window.GUMNAAM_PRODUCTS;
const config = window.GUMNAAM_CHECKOUT;
const money = (value) => `PKR ${value.toLocaleString("en-PK")}`;
let memory = [];
let storageAvailable = true;
let focusOrigin;
const drawer = document.querySelector("#cart-drawer");

function read() {
  if (!storageAvailable) return memory;
  try { return sanitizeCart(JSON.parse(localStorage.getItem(CART_KEY) || "[]"), catalog); }
  catch { storageAvailable = false; return memory; }
}
function save(lines) {
  memory = lines;
  try { localStorage.setItem(CART_KEY, JSON.stringify(lines)); }
  catch { storageAvailable = false; }
  render();
  window.dispatchEvent(new CustomEvent("gumnaam:cart", { detail: lines }));
}
function lineMarkup(line) {
  const product = catalog.find((entry) => entry.id === line.productId);
  return `<article class="cart-line" data-line="${lineKey(line)}"><a href="product.html?id=${product.id}"><img src="${product.images[1] || product.images[0]}" width="80" height="100" alt="${product.name}"></a><div><h3><a href="product.html?id=${product.id}">${product.name}</a></h3><p>${money(product.price * line.quantity)}</p><div class="cart-line-controls"><select data-cart-size aria-label="Size for ${product.name}">${product.sizes.map((size) => `<option ${size === line.size ? "selected" : ""}>${size}</option>`).join("")}</select><button type="button" data-cart-step="-1" aria-label="Decrease ${product.name}, ${line.size} quantity">−</button><span aria-label="Quantity">${line.quantity}</span><button type="button" data-cart-step="1" aria-label="Increase ${product.name}, ${line.size} quantity">+</button><button type="button" data-cart-remove>Remove</button></div></div></article>`;
}
function render() {
  const lines = read();
  const totals = cartTotals(lines, catalog, config.deliveryFee);
  document.querySelectorAll("[data-cart-lines]").forEach((node) => { node.innerHTML = lines.length ? lines.map(lineMarkup).join("") : '<div class="cart-empty"><h3>Nothing here. Yet.</h3><p>Four forms. Find yours.</p><a class="text-link" href="shop.html">Explore the collection ↗</a></div>'; });
  for (const [selector, value] of [["count", totals.count], ["subtotal", money(totals.subtotal)], ["delivery", money(totals.delivery)], ["total", money(totals.total)]]) document.querySelectorAll(`[data-cart-${selector}]`).forEach((node) => {
    const changed = node.textContent !== String(value);
    node.textContent = value;
    if (changed && window.gsap && !matchMedia("(prefers-reduced-motion: reduce)").matches) gsap.fromTo(node, { opacity: .4, y: 3 }, { opacity: 1, y: 0, duration: .6, ease: "power4.out", clearProps: "transform,opacity" });
  });
  document.querySelectorAll("[data-cart-checkout]").forEach((link) => { link.setAttribute("aria-disabled", String(!lines.length)); if (!lines.length) link.setAttribute("tabindex", "-1"); else link.removeAttribute("tabindex"); });
  document.querySelectorAll("[data-cart-message]").forEach((node) => { node.textContent = storageAvailable ? "" : "Your browser cannot save the bag. Keep this tab open; use Buy now for a single piece."; });
}
function message(text) {
  const toast = document.querySelector("[data-toast]");
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add("is-visible");
  clearTimeout(message.timer);
  message.timer = setTimeout(() => toast.classList.remove("is-visible"), 3000);
}
function open() {
  if (!drawer || drawer.open) return;
  focusOrigin = document.activeElement;
  drawer.showModal();
  window.GumnaamLenis?.stop();
}
function close() {
  drawer?.close();
  window.GumnaamLenis?.start();
  focusOrigin?.focus();
}
window.GumnaamCart = {
  get: read,
  add(line) { save(addLine(read(), line, catalog)); message("Added to your bag."); open(); },
  purchased(lines) { save(subtractPurchased(read(), lines)); },
  open, close
};
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-cart-open]")) return open();
  if (event.target.closest("[data-cart-close]")) return close();
  if (event.target.closest('[data-cart-checkout][aria-disabled="true"]')) { event.preventDefault(); return; }
  const lineNode = event.target.closest("[data-line]");
  if (!lineNode) return;
  const lines = read();
  const key = lineNode.dataset.line;
  const line = lines.find((item) => lineKey(item) === key);
  const step = event.target.closest("[data-cart-step]");
  const remove = event.target.closest("[data-cart-remove]");
  if (!line || (!step && !remove)) return;
  const container = lineNode.closest("[data-cart-lines]");
  try {
    save(editLine(lines, key, { quantity: remove ? 0 : line.quantity + Number(step.dataset.cartStep) }, catalog));
    const remaining = container.querySelector(`[data-line="${key}"]`);
    (remaining?.querySelector(step ? `[data-cart-step="${step.dataset.cartStep}"]` : "button") || container.querySelector("a, button"))?.focus();
  }
  catch (error) { message(error.message); }
});
document.addEventListener("change", (event) => {
  if (!event.target.matches("[data-cart-size]")) return;
  try { save(editLine(read(), event.target.closest("[data-line]").dataset.line, { size: event.target.value }, catalog)); }
  catch (error) { message(error.message); render(); }
});
window.addEventListener("storage", (event) => { if (event.key === CART_KEY || event.key === null) { render(); window.dispatchEvent(new CustomEvent("gumnaam:cart", { detail: read() })); } });
drawer?.addEventListener("click", (event) => { if (event.target === drawer && event.clientX < drawer.getBoundingClientRect().left) close(); });
drawer?.addEventListener("close", () => { window.GumnaamLenis?.start(); focusOrigin?.focus(); });
render();
