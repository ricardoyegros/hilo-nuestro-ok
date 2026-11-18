// POST /api/admin/reenviar { id }  → vuelve a mandar los libros al mail de la orden.
import { noEncontrada } from "../../_lib/admin.js";
import { getOrden, log } from "../../_lib/db.js";
import { entregar } from "../../_lib/fulfill.js";
import { json, leerJson, UUID_RE } from "../../_lib/util.js";

export async function onRequestPost({ request, env, data }) {
  const body = await leerJson(request);
  if (!body || !UUID_RE.test(body.id || "")) return noEncontrada();
  if (!(await getOrden(env, body.id))) return noEncontrada();
  await log(env, body.id, "reenvio_pedido", data.admin);
  const r = await entregar(env, body.id, { forzar: true });
  return json(r, r.ok ? 200 : 502);
}
