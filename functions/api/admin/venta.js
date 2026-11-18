// GET /api/admin/venta?id=<orden>  → detalle de una orden con su historial de eventos.
import { noEncontrada } from "../../_lib/admin.js";
import { json, UUID_RE } from "../../_lib/util.js";

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!UUID_RE.test(id)) return noEncontrada();
  const orden = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!orden) return noEncontrada();
  delete orden.ip_hash;
  const eventos = await env.DB.prepare("SELECT ts, type, detail FROM events WHERE order_id = ? ORDER BY id DESC LIMIT 100").bind(id).all();
  return json({ orden, eventos: eventos.results || [] });
}
