// GET /api/admin/config  → qué está configurado y qué falta (solo sí/no, nunca muestra secretos).
import { ARCHIVOS } from "../../_lib/tokens.js";
import { json, precio, siteUrl } from "../../_lib/util.js";

export async function onRequestGet({ env }) {
  const set = (k) => Boolean(env[k]);
  let db = false;
  try {
    await env.DB.prepare("SELECT 1 FROM orders LIMIT 1").first();
    db = true;
  } catch {}
  const arch = ARCHIVOS(env);
  const r2 = {};
  for (const k of Object.keys(arch)) {
    try {
      r2[k] = { archivo: arch[k].r2, ok: Boolean(env.FILES && (await env.FILES.head(arch[k].r2))) };
    } catch {
      r2[k] = { archivo: arch[k].r2, ok: false };
    }
  }
  const tokenMP = String(env.MP_ACCESS_TOKEN || "");
  return json({
    sitio: siteUrl(env),
    webhook_url: `${siteUrl(env)}/api/webhook`,
    precio: precio(env),
    comision_pct: Number(env.MP_FEE_PCT) > 0 ? Number(env.MP_FEE_PCT) : 6.29,
    modo_adjuntos: env.MAIL_ATTACH_MODE === "inline" ? "inline" : "path",
    mp_modo: !tokenMP ? null : tokenMP.startsWith("TEST-") ? "prueba" : "produccion",
    webhook_estricto: env.MP_WEBHOOK_ESTRICTO !== "0",
    base_de_datos: db,
    archivos: r2,
    variables: Object.fromEntries(
      ["SITE_URL", "MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET", "RESEND_API_KEY", "FROM_EMAIL", "REPLY_TO", "DOWNLOAD_SIGNING_KEY", "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "ADMIN_EMAILS"].map((k) => [k, set(k)])
    ),
  });
}
