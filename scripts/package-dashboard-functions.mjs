import { readFile, writeFile, mkdir } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const products = await readFile(new URL("js/products.js", root), "utf8");
const divider = "(function productCatalog() {";
if (products.split(divider).length !== 2) throw new Error("Catalog layout changed. Update packaging before deploying.");
const catalogSource = products.split(divider)[0].trim();
const shared = await readFile(new URL("supabase/functions/_shared/orders.mjs", root), "utf8");
if (!shared.startsWith('import "../../../js/products.js";')) throw new Error("Shared catalog import changed.");
const sharedSource = shared.replace('import "../../../js/products.js";', "").replace(/^export /gm, "").trim();
const output = new URL("supabase/dashboard/", root);
await mkdir(output, { recursive: true });

for (const name of ["create-order", "retry-notifications"]) {
  const entry = await readFile(new URL(`supabase/functions/${name}/index.ts`, root), "utf8");
  const importLine = /^import \{[^\n]+\} from "\.\.\/_shared\/orders\.mjs";\r?\n/;
  if (!importLine.test(entry)) throw new Error(`Unexpected entrypoint: ${name}`);
  const entrySource = entry.replace(importLine, "").trim();
  const source = `${catalogSource}\n\n${sharedSource}\n\n${entrySource}\n`;
  new vm.Script(source, { filename: `${name}.ts` });
  await writeFile(new URL(`${name}.ts`, output), source, "utf8");
  console.log(`Prepared supabase/dashboard/${name}.ts`);
}
