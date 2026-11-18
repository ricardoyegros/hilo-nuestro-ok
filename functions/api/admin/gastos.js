// Gastos del negocio (publicidad, dominio, software…) para calcular el resultado real.
//   GET    /api/admin/gastos?desde=&hasta=
//   POST   /api/admin/gastos { fecha, concepto, categoria, monto }
//   DELETE /api/admin/gastos?id=<n>
import { ahora, json, leerJson } from "../../_lib/util.js";

const CATEGORIAS = ["publicidad", "dominio", "software", "impuestos", "otros"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet({ request, env }) {
  const sp = new URL(request.url).searchParams;
  const w = [];
  const b = [];
  if (FECHA.test(sp.get("desde") || "")) { w.push("fecha >= ?"); b.push(sp.get("desde")); }
  if (FECHA.test(sp.get("hasta") || "")) { w.push("fecha <= ?"); b.push(sp.get("hasta")); }
  const r = await env.DB.prepare(`SELECT id, fecha, concepto, categoria, monto FROM gastos ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY fecha DESC, id DESC LIMIT 500`).bind(...b).all();
  return json({ items: r.results || [], categorias: CATEGORIAS });
}

export async function onRequestPost({ request, env }) {
  const g = await leerJson(request);
  if (!g) return json({ error: "Pedido inválido." }, 400);
  const concepto = String(g.concepto || "").trim().slice(0, 120);
  const monto = Number(g.monto);
  if (!FECHA.test(g.fecha || "") || !concepto || !CATEGORIAS.includes(g.categoria) || !Number.isInteger(monto) || monto <= 0 || monto > 100000000) {
    return json({ error: "Revisá fecha, concepto, categoría y monto (número entero mayor a 0)." }, 400);
  }
  const r = await env.DB.prepare("INSERT INTO gastos (fecha, concepto, categoria, monto, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(g.fecha, concepto, g.categoria, monto, ahora())
    .run();
  return json({ ok: true, id: r.meta?.last_row_id ?? null }, 201);
}

export async function onRequestDelete({ request, env }) {
  const id = parseInt(new URL(request.url).searchParams.get("id"), 10);
  if (!Number.isInteger(id)) return json({ error: "Falta el id." }, 400);
  await env.DB.prepare("DELETE FROM gastos WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
