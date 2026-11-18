// POST /api/admin/sincronizar { id }  → consulta a Mercado Pago el estado real de la orden y la actualiza.
// Sirve cuando alguien pagó pero el aviso (webhook) nunca llegó.
import { noEncontrada } from "../../_lib/admin.js";
import { getOrden, log } from "../../_lib/db.js";
import { sincronizarOrden } from "../../_lib/fulfill.js";
import { json, leerJson, UUID_RE } from "../../_lib/util.js";

export async function onRequestPost({ request, env, data }) {
  const body = await leerJson(request);
  if (!body || !UUID_RE.test(body.id || "")) return noEncontrada();
  const orden = await getOrden(env, body.id);
  if (!orden) return noEncontrada();
  await log(env, orden.id, "sincronizacion_pedida", data.admin);
  const r = await sincronizarOrden(env, orden);
  const nueva = await getOrden(env, orden.id);
  return json({ ...r, status: nueva.status, mp_status: nueva.mp_status }, r.ok ? 200 : 502);
}
