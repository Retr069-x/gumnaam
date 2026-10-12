import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const names = ["index", "shop", "product", "about", "contact", "cart", "checkout", "confirmation", "shipping", "size-guide", "faq", "privacy", "terms", "404"];
for (const name of names) test(`${name} has shared navigation, accessible landmarks and resolvable assets`, async () => {
  const html = await readFile(new URL(`${name}.html`, root), "utf8");
  assert.match(html, /<main id="main"/);
  assert.match(html, /<header class="site-header"/);
  assert.match(html, /<footer class="site-footer"/);
  assert.match(html, /<dialog class="cart-drawer"/);
  assert.match(html, /rel="icon"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /href="about.html"/);
  assert.match(html, /href="contact.html"/);
  assert.doesNotMatch(html, /Inter:wght|Pakistan, Pakistan|PKR 200 COD/);
  for (const [, value] of html.matchAll(/(?:src|href|srcset)="([^"]+)"/g)) {
    if (/^(?:https?:|mailto:|#)/.test(value)) continue;
    await access(new URL(value.split("?")[0].split("#")[0], root));
  }
});
test("checkout keeps all submission hooks and private payment requirements", async () => {
  const html = await readFile(new URL("checkout.html", root), "utf8");
  for (const id of ["checkout-form", "checkout-captcha", "checkout-status", "summary-total", "summary-fee", "checkout-cart", "order-result"]) assert.ok(html.includes(`id="${id}"`));
  assert.match(html, /image\/jpeg,image\/png,image\/webp/);
  assert.match(html, /Maximum 4 MB/);
  assert.match(html, /name="consent"/);
});
test("privacy and product descriptions no longer claim delivery is free for Easypaisa", async () => {
  const privacy = await readFile(new URL("privacy.html", root), "utf8");
  const products = await readFile(new URL("js/products.js", root), "utf8");
  assert.doesNotMatch(privacy, /not applied to Easypaisa/);
  assert.match(privacy, /both COD and Easypaisa/);
  assert.match(products, /for COD or Easypaisa/);
});
