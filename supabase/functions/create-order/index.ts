import { createOrderHandler } from "../_shared/orders.mjs";

const env = Deno.env.toObject();
Deno.serve(createOrderHandler(env, fetch, (task) => EdgeRuntime.waitUntil(task.catch(() => {}))));
