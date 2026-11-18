// Protege TODO /api/admin/*: exige Cloudflare Access y, en pedidos que modifican datos, una cabecera propia
// (evita que otra web haga pedidos en tu nombre mientras tenés la sesión abierta).
import { verificarAccess } from "../../_lib/access.js";
import { json } from "../../_lib/util.js";

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const v = await verificarAccess(request, env);
  if (!v.ok) return json({ error: v.msg }, v.status);

  if (!["GET", "HEAD"].includes(request.method)) {
    if (request.headers.get("x-hilo-admin") !== "1") return json({ error: "Pedido no permitido." }, 403);
    const origen = request.headers.get("origin");
    if (origen) {
      let ok = false;
      try {
        ok = new URL(origen).host === new URL(request.url).host;
      } catch {}
      if (!ok) return json({ error: "Origen no permitido." }, 403);
    }
  }
  ctx.data.admin = v.email;
  return ctx.next();
}
