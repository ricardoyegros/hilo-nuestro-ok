// Mercado Pago (Checkout Pro). Solo llamadas REST, sin SDK.
import { hmacHex, iguales, siteUrl } from "./util.js";

const API = "https://api.mercadopago.com";

export async function mpFetch(env, ruta, init = {}) {
  const r = await fetch(API + ruta, {
    ...init,
    headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  let data = null;
  try {
    data = await r.json();
  } catch {}
  return { ok: r.ok, status: r.status, data };
}

/** Crea la preferencia de pago. El monto lo define el servidor. */
export async function crearPreferencia(env, orden) {
  const site = siteUrl(env);
  const volver = `${site}/gracias?o=${orden.id}`;
  return mpFetch(env, "/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [
        {
          id: "mucho-gusto-mama",
          title: env.PRODUCT_NAME || "Mucho gusto, mamá (libro digital) + Nuestra Navidad",
          description: "Libro digital en PDF. Entrega inmediata por mail.",
          quantity: 1,
          unit_price: orden.amount,
          currency_id: "ARS",
        },
      ],
      payer: { email: orden.email },
      external_reference: orden.id,
      back_urls: { success: volver, pending: volver, failure: volver },
      auto_return: "approved",
      notification_url: `${site}/api/webhook?source_news=webhooks`,
      statement_descriptor: "HILO NUESTRO",
      metadata: { order_id: orden.id },
    }),
  });
}

export function obtenerPago(env, id) {
  if (!/^\d+$/.test(String(id))) return Promise.resolve({ ok: false, status: 400, data: null });
  return mpFetch(env, `/v1/payments/${id}`);
}

/** Busca el pago más relevante de una orden (sirve cuando el webhook nunca llegó). */
export async function buscarPagoPorReferencia(env, ref) {
  const r = await mpFetch(env, `/v1/payments/search?external_reference=${encodeURIComponent(ref)}&sort=date_created&criteria=desc&limit=10`);
  if (!r.ok) return r;
  const lista = r.data?.results || [];
  return { ok: true, status: 200, data: lista.find((p) => p.status === "approved") || lista[0] || null };
}

/**
 * Valida la firma del webhook (cabecera x-signature = "ts=...,v1=...").
 * Manifest: id:<data.id>;request-id:<x-request-id>;ts:<ts>;  → HMAC-SHA256 hex con el "secret" del webhook.
 */
export async function verificarFirma(env, request, dataId) {
  if (!env.MP_WEBHOOK_SECRET) return false;
  const cab = request.headers.get("x-signature") || "";
  const reqId = request.headers.get("x-request-id") || "";
  const partes = {};
  for (const trozo of cab.split(",")) {
    const i = trozo.indexOf("=");
    if (i > 0) partes[trozo.slice(0, i).trim()] = trozo.slice(i + 1).trim();
  }
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId);
  let manifest = "";
  if (dataId) manifest += `id:${id};`;
  if (reqId) manifest += `request-id:${reqId};`;
  manifest += `ts:${partes.ts};`;
  return iguales(await hmacHex(env.MP_WEBHOOK_SECRET, manifest), partes.v1);
}
