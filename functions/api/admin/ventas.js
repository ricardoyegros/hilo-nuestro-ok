// GET /api/admin/ventas?estado=&q=&desde=&hasta=&pagina=1&limite=25
import { filtrosVentas } from "../../_lib/admin.js";
import { json } from "../../_lib/util.js";

const COLUMNAS = "id, email, amount, status, mp_status, mp_payment_id, payment_method, created_at, paid_at, delivered_at, mail_count, downloads, notes";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const { where, binds } = filtrosVentas(url);
  const limite = Math.min(Math.max(parseInt(url.searchParams.get("limite"), 10) || 25, 1), 100);
  const pagina = Math.max(parseInt(url.searchParams.get("pagina"), 10) || 1, 1);
  const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM orders ${where}`).bind(...binds).first();
  const filas = await env.DB.prepare(`SELECT ${COLUMNAS} FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limite, (pagina - 1) * limite)
    .all();
  return json({ total: total.c, pagina, limite, items: filas.results || [] });
}
