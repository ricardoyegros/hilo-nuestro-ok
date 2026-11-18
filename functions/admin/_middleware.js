// Protege la página /admin (el HTML del panel). Mismo control que la API.
import { verificarAccess } from "../_lib/access.js";

export async function onRequest(ctx) {
  const v = await verificarAccess(ctx.request, ctx.env);
  if (!v.ok) {
    return new Response(v.msg, { status: v.status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  }
  return ctx.next();
}
