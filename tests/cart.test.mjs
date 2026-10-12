import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeCart, addLine, editLine, cartTotals, subtractPurchased } from "../js/cart-model.mjs";
import "../js/products.js";

const catalog = globalThis.GUMNAAM_PRODUCTS;
const first = { productId: "obsidian", size: "M", quantity: 1 };
const second = { productId: "camel", size: "L", quantity: 2 };

test("bag stores multiple products and sizes, charging delivery once", () => {
  let cart = addLine([], first, catalog);
  cart = addLine(cart, second, catalog);
  cart = addLine(cart, { ...first, size: "L" }, catalog);
  assert.equal(cart.length, 3);
  assert.deepEqual(cartTotals(cart, catalog), { count: 4, subtotal: 7996, delivery: 200, total: 8196 });
  assert.deepEqual(cartTotals([], catalog), { count: 0, subtotal: 0, delivery: 0, total: 0 });
});
test("repeated selections merge without mutating existing state", () => {
  const previous = [first];
  const result = addLine(previous, first, catalog);
  assert.equal(result.length, 1);
  assert.equal(result[0].quantity, 2);
  assert.equal(previous[0].quantity, 1);
});
test("stock limits apply across sizes; order cap applies across products", () => {
  assert.throws(() => addLine([{ ...first, quantity: 6 }], { ...first, size: "L" }, catalog));
  assert.throws(() => addLine([{ ...first, quantity: 6 }], { ...second, quantity: 5 }, catalog));
  assert.throws(() => addLine([], { ...first, size: "XXXL" }, catalog));
  assert.throws(() => addLine([], { ...first, quantity: 1.5 }, catalog));
});
test("editing a size merges lines; removing a line leaves other items", () => {
  const cart = [first, { ...first, size: "L", quantity: 2 }, second];
  const result = editLine(cart, "obsidian:M", { size: "L" }, catalog);
  assert.equal(result.find((line) => line.productId === "obsidian").quantity, 3);
  assert.equal(result.length, 2);
  assert.deepEqual(editLine(result, "obsidian:L", { quantity: 0 }, catalog), [second]);
});
test("corrupt storage and client prices cannot reach the order total", () => {
  assert.deepEqual(sanitizeCart(null, catalog), []);
  const cart = sanitizeCart([{ ...first, price: 1, email: "not-stored" }, { productId: "fake", size: "M", quantity: 4 }, { ...second, quantity: -2 }], catalog);
  assert.deepEqual(cart, [first]);
  assert.equal(cartTotals(cart, catalog).total, 2199);
});
test("successful checkout subtracts purchased lines without clearing additions made elsewhere", () => {
  assert.deepEqual(subtractPurchased([{ ...first, quantity: 3 }, second], [first]), [{ ...first, quantity: 2 }, second]);
});
