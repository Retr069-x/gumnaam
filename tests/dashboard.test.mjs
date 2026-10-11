import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

function load(source) {
  let handler;
  const context = {
    Deno: { env: { toObject: () => ({}) }, serve: (value) => { handler = value; } },
    fetch, Request, Response, Blob, File, FormData, AbortSignal,
    URL, TextEncoder, crypto: globalThis.crypto,
    EdgeRuntime: { waitUntil: () => {} }
  };
  vm.runInNewContext(source, context);
  return { handler, context };
}

test("dashboard create-order is standalone and stays closed without secrets", async () => {
  const source = await readFile(new URL("../supabase/dashboard/create-order.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import /m);
  const { handler, context } = load(source);
  assert.equal(context.GUMNAAM_PRODUCTS.length, 4);
  assert.ok(context.GUMNAAM_PRODUCTS.every((product) => product.price === 1999));
  const response = await handler(new Request("https://example.com"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ready: false });
});

test("dashboard retry worker rejects unauthenticated invocation", async () => {
  const source = await readFile(new URL("../supabase/dashboard/retry-notifications.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import /m);
  const { handler } = load(source);
  const response = await handler(new Request("https://example.com", { method: "POST" }));
  assert.equal(response.status, 401);
});

test("dashboard copies match current shared source and catalog", async () => {
  const root = new URL("../", import.meta.url);
  const products = await readFile(new URL("js/products.js", root), "utf8");
  const catalogSource = products.split("(function productCatalog() {")[0].trim();
  const shared = await readFile(new URL("supabase/functions/_shared/orders.mjs", root), "utf8");
  const sharedSource = shared.replace('import "../../../js/products.js";', "").replace(/^export /gm, "").trim();
  for (const name of ["create-order", "retry-notifications"]) {
    const entry = await readFile(new URL(`supabase/functions/${name}/index.ts`, root), "utf8");
    const entrySource = entry.replace(/^import \{[^\n]+\} from "\.\.\/_shared\/orders\.mjs";\r?\n/, "").trim();
    const bundle = await readFile(new URL(`supabase/dashboard/${name}.ts`, root), "utf8");
    assert.equal(bundle, `${catalogSource}\n\n${sharedSource}\n\n${entrySource}\n`);
  }
});
