// POST /api/webhook  ← Mercado Pago avisa que un pago cambió.
// No se confía en el contenido del aviso: se valida la firma Y se vuelve a consultar el pago a Mercado Pago.
import { log } from "../_lib/db.js";
import { procesarPago } from "../_lib/fulfill.js";
import { verificarFirma } from "../_lib/mp.js";
import { json, leerJson } from "../_lib/util.js";

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const body = (await leerJson(request, 20000)) || {};
  const tipo = url.searchParams.get("type") || body.type || url.searchParams.get("topic");
  const dataId = url.searchParams.get("data.id") || body?.data?.id || url.searchParams.get("id");

  if (tipo !== "payment" || !dataId) return json({ ok: true, ignorado: true }); // otros avisos: se ignoran

  // Firma: por defecto es obligatoria. Solo desactivala (MP_WEBHOOK_ESTRICTO=0) para diagnosticar en pruebas.
  const estricto = env.MP_WEBHOOK_ESTRICTO !== "0";
  const firmaOk = await verificarFirma(env, request, dataId);
  if (!firmaOk) {
    await log(env, null, "firma_invalida", `aviso de pago ${dataId} con firma inválida o ausente`);
    if (estricto) return json({ error: "Firma inválida" }, 401);
  }

  try {
    const r = await procesarPago(env, dataId);
    // Si falló algo temporal, respondemos 500 para que Mercado Pago reintente más tarde.
    return json({ ok: r.ok }, r.ok ? 200 : 500);
  } catch (e) {
    await log(env, null, "error_webhook", String(e.message || e));
    return json({ ok: false }, 500);
  }
}
