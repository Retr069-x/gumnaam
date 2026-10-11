import { configured, notifyOrders, service } from "../_shared/orders.mjs";

const env = Deno.env.toObject();
Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!env.CRON_SECRET || request.headers.get("Authorization") !== `Bearer ${env.CRON_SECRET}`) return new Response(null, { status: 401 });
  if (!configured(env)) return Response.json({ ready: false }, { status: 503 });
  try {
    const result = await notifyOrders(env);
    await service(env)(`/rest/v1/gumnaam_order_limits?window_start=lt.${new Date(Date.now() - 86400000).toISOString()}`, { method: "DELETE" });
    return Response.json(result);
  } catch { return Response.json({ error: "Notification retry failed." }, { status: 503 }); }
});
