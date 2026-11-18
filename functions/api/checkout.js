// POST /api/checkout  { email }  →  { init_point }
// Crea la orden y la preferencia de Mercado Pago. El PRECIO sale del servidor (PRICE_ARS), nunca del navegador.
import { log } from "../_lib/db.js";
import { crearPreferencia } from "../_lib/mp.js";
import { ahora, emailValido, json, leerJson, precio, sha256Hex, siteUrl } from "../_lib/util.js";

function origenPermitido(request, env) {
  const origen = request.headers.get("origin");
  if (!origen) return false;
  let host;
  try {
    host = new URL(origen).host;
  } catch {
    return false;
  }
  const permitidos = new Set();
  try {
    permitidos.add(new URL(siteUrl(env)).host);
  } catch {}
  for (const o of String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    try {
      permitidos.add(new URL(o).host);
    } catch {}
  }
  const u = new URL(request.url);
  if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && host === u.host) return true; // desarrollo local
  return permitidos.has(host);
}

export async function onRequestPost({ request, env }) {
  if (!env.MP_ACCESS_TOKEN || !env.SITE_URL || !env.DB) return json({ error: "Los pagos todavía no están configurados." }, 503);
  if (!origenPermitido(request, env)) return json({ error: "Origen no permitido." }, 403);

  const body = await leerJson(request);
  if (!body || typeof body !== "object") return json({ error: "Pedido inválido." }, 400);
  if (body.web) return json({ error: "Pedido inválido." }, 400); // campo trampa para bots
  const email = String(body.email || "").trim().toLowerCase();
  if (!emailValido(email)) return json({ error: "Revisá tu mail." }, 400);

  // Límite simple: máx. 8 intentos por IP cada 10 minutos (se guarda solo un hash de la IP).
  const ip = request.headers.get("cf-connecting-ip") || "desconocida";
  const ipHash = (await sha256Hex(ip + (env.DOWNLOAD_SIGNING_KEY || ""))).slice(0, 16);
  const desde = new Date(Date.now() - 10 * 60000).toISOString();
  const cuenta = await env.DB.prepare("SELECT COUNT(*) AS c FROM orders WHERE ip_hash = ? AND created_at > ?").bind(ipHash, desde).first();
  if (cuenta && cuenta.c >= 8) return json({ error: "Demasiados intentos. Probá de nuevo en unos minutos." }, 429);

  const id = crypto.randomUUID();
  const monto = precio(env);
  await env.DB.prepare("INSERT INTO orders (id, email, amount, currency, status, created_at, ip_hash) VALUES (?, ?, ?, 'ARS', 'pending', ?, ?)")
    .bind(id, email, monto, ahora(), ipHash)
    .run();

  const r = await crearPreferencia(env, { id, email, amount: monto });
  const link = env.MP_USAR_SANDBOX_URL === "1" ? r.data?.sandbox_init_point : r.data?.init_point;
  if (!r.ok || !link) {
    await env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").bind(id).run();
    await log(env, id, "mp_error", `crear preferencia: HTTP ${r.status} ${r.data?.message || ""}`);
    return json({ error: "No pudimos abrir Mercado Pago. Probá de nuevo en unos minutos." }, 502);
  }
  await env.DB.prepare("UPDATE orders SET mp_preference_id = ? WHERE id = ?").bind(r.data.id || null, id).run();
  await log(env, id, "orden_creada", null);
  return json({ init_point: link });
}
