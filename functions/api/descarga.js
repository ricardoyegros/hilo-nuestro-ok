// GET /api/descarga?t=<token>  → entrega un PDF desde el bucket privado, solo con un link firmado y vigente.
import { getOrden } from "../_lib/db.js";
import { ARCHIVOS, verificarToken } from "../_lib/tokens.js";

const txt = (msg, status) => new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function onRequestGet({ request, env }) {
  const tok = await verificarToken(env, new URL(request.url).searchParams.get("t"));
  if (!tok) return txt("Este link no es válido o ya venció. Escribinos y te lo reenviamos.", 403);

  const orden = await getOrden(env, tok.ordenId);
  if (!orden) return txt("No encontrado.", 404);
  const habilitada = tok.tipo === "m" ? ["delivering", "delivered"].includes(orden.status) : orden.status === "delivered";
  if (!habilitada) return txt("Este link no está disponible.", 403);

  if (tok.tipo === "u") {
    const max = Number(env.MAX_DOWNLOADS) || 10;
    if (orden.downloads >= max) return txt("Se superó el máximo de descargas. Escribinos y te lo reenviamos.", 429);
    await env.DB.prepare("UPDATE orders SET downloads = downloads + 1 WHERE id = ?").bind(orden.id).run();
  }

  const { r2, nombre } = ARCHIVOS(env)[tok.archivo];
  const obj = await env.FILES.get(r2);
  if (!obj) return txt("Archivo no disponible. Escribinos y lo resolvemos.", 500);
  return new Response(obj.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${nombre}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
