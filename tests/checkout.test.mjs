import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../js/checkout.js", import.meta.url), "utf8");

async function checkout(health = { ready: true, deliveryFee: 200 }) {
  const nodes = new Map();
  const events = new Map();
  const scripts = [];
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: "", hidden: false });
    return nodes.get(selector);
  };
  const select = (value) => ({
    value, options: [], add(option) { this.options.push(option); },
    replaceChildren(option) { this.options = [option]; this.value = option.value; }
  });
  const elements = {
    productId: select("obsidian"), size: select(""), quantity: { value: "1" },
    paymentMethod: { value: "cod" }, transactionId: {}, receipt: {},
    phone: { addEventListener() {} }
  };
  const submit = { disabled: true };
  const prepaidOption = { disabled: true };
  const form = {
    elements,
    querySelector: (selector) => selector === '[type="submit"]' ? submit : prepaidOption,
    addEventListener: (name, handler) => events.set(name, handler)
  };
  elements.productId.addEventListener = () => {};
  const window = {
    GUMNAAM_PRODUCTS: [{ id: "obsidian", name: "Obsidian Mark Hoodie", price: 1999, stock: 6, sizes: ["S", "M"], images: ["test.jpg"] }],
    GUMNAAM_CHECKOUT: { endpoint: "https://test.supabase.co/functions/v1/create-order", turnstileSiteKey: "test-site-key" },
    location: { search: "?id=obsidian&size=M" }, crypto: { randomUUID() {} },
    addEventListener() {}
  };
  vm.runInNewContext(source, {
    window,
    document: {
      querySelector: (selector) => selector === "#checkout-form" ? form : node(selector),
      addEventListener(name, callback) { if (name === "DOMContentLoaded") queueMicrotask(callback); },
      createElement: () => ({}), head: { append: (script) => scripts.push(script) }
    },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    URL, URLSearchParams, AbortSignal,
    fetch: async () => ({ ok: health.ready, json: async () => health })
  });
  await new Promise(setImmediate);
  return { elements, submit, prepaidOption, scripts, node, change: () => events.get("change")() };
}

test("checkout and Easypaisa transfer include delivery once, even after switching methods", async () => {
  const ui = await checkout();
  for (const paymentMethod of ["cod", "easypaisa", "cod", "easypaisa"]) {
    ui.elements.paymentMethod.value = paymentMethod;
    for (const [quantity, subtotal, total] of [[1, 1999, 2199], [2, 3998, 4198]]) {
      ui.elements.quantity.value = String(quantity);
      ui.change();
      const money = (value) => `PKR ${value.toLocaleString("en-PK")}`;
      assert.equal(ui.node("#summary-subtotal").textContent, money(subtotal));
      assert.equal(ui.node("#summary-fee").textContent, money(200));
      assert.equal(ui.node("#summary-total").textContent, money(total));
      assert.equal(ui.node("[data-payment-total]").textContent, money(total));
      assert.equal(ui.node("#easypaisa-panel").hidden, paymentMethod !== "easypaisa");
      assert.equal(ui.elements.receipt.required, paymentMethod === "easypaisa");
    }
  }
});

test("invalid quantities never show a payable Easypaisa amount", async () => {
  const ui = await checkout();
  ui.elements.paymentMethod.value = "easypaisa";
  for (const quantity of ["0", "1.5", "7", ""]) {
    ui.elements.quantity.value = quantity;
    ui.change();
    assert.equal(ui.node("#summary-total").textContent, "—");
    assert.equal(ui.node("[data-payment-total]").textContent, "Choose a valid quantity");
  }
});

test("old backend pricing leaves checkout and Easypaisa transfers disabled", async () => {
  for (const health of [{ ready: true }, { ready: true, deliveryFee: 0 }]) {
    const ui = await checkout(health);
    assert.equal(ui.prepaidOption.disabled, true);
    assert.equal(ui.submit.disabled, true);
    assert.equal(ui.scripts.length, 0);
    assert.match(ui.node("#checkout-status").textContent, /Do not transfer money yet/);
  }
  const ui = await checkout();
  assert.equal(ui.prepaidOption.disabled, false);
  assert.equal(ui.scripts.length, 1);
});
