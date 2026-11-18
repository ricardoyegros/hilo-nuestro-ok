// POST /api/admin/nota { id, nota }  → guarda una nota interna en la orden (por ejemplo "pidió reembolso").
import { noEncontrada } from "../../_lib/admin.js";
import { json, leerJson, UUID_RE } from "../../_lib/util.js";

export async function onRequestPost({ request, env }) {
  const body = await leerJson(request);
  if (!body || !UUID_RE.test(body.id || "")) return noEncontrada();
  const nota = String(body.nota ?? "").slice(0, 500);
  const r = await env.DB.prepare("UPDATE orders SET notes = ? WHERE id = ?").bind(nota || null, body.id).run();
  return r.meta?.changes ? json({ ok: true }) : noEncontrada();
}
