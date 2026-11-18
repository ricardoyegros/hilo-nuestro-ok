// Corazón del negocio: confirma el pago con Mercado Pago y entrega los libros UNA sola vez.
// Lo usan el webhook, la página de gracias, y los botones "Sincronizar" y "Reenviar" del panel.
import { getOrden, log } from "./db.js";
import { buscarPagoPorReferencia, obtenerPago } from "./mp.js";
import { enviarLibros } from "./mail.js";
import { ahora, UUID_RE } from "./util.js";

const RECLAMABLES = ["pending", "approved", "delivery_failed"];

/**
 * Entrega los libros. Es seguro llamarla varias veces: un UPDATE atómico "reclama" la orden
 * y solo un proceso a la vez puede enviarla. Con forzar=true se reenvía aunque ya esté entregada.
 */
export async function entregar(env, ordenId, { forzar = false } = {}) {
  const o = await getOrden(env, ordenId);
  if (!o) return { ok: false, error: "La orden no existe" };
  if (o.status === "refunded") return { ok: false, error: "La orden está reembolsada" };
  if (!forzar && !o.paid_at) return { ok: false, error: "La orden no tiene un pago aprobado" };
  if (forzar && !o.paid_at) return { ok: false, error: "No se puede reenviar una orden sin pago aprobado" };

  const permitidos = forzar ? [...RECLAMABLES, "delivered"] : RECLAMABLES;
  const marcas = permitidos.map(() => "?").join(",");
  const hace5min = new Date(Date.now() - 5 * 60000).toISOString();
  const r = await env.DB.prepare(
    `UPDATE orders SET status = 'delivering', delivering_at = ?
     WHERE id = ? AND (status IN (${marcas}) OR (status = 'delivering' AND delivering_at < ?))`
  )
    .bind(ahora(), ordenId, ...permitidos, hace5min)
    .run();
  if (!r.meta || r.meta.changes !== 1) return { ok: true, omitido: true }; // ya entregada o en curso

  const claveIdem = forzar ? `entrega-${ordenId}-r${o.mail_count + 1}` : `entrega-${ordenId}`;
  const res = await enviarLibros(env, o, claveIdem);
  if (res.ok) {
    await env.DB.prepare("UPDATE orders SET status = 'delivered', delivered_at = COALESCE(delivered_at, ?), email_id = ?, mail_count = mail_count + 1 WHERE id = ?")
      .bind(ahora(), res.id, ordenId)
      .run();
    await log(env, ordenId, forzar ? "mail_reenviado" : "mail_enviado", res.id);
    return { ok: true, enviado: true };
  }
  const vuelta = forzar && o.status === "delivered" ? "delivered" : "delivery_failed";
  await env.DB.prepare("UPDATE orders SET status = ? WHERE id = ?").bind(vuelta, ordenId).run();
  await log(env, ordenId, "mail_error", res.error);
  return { ok: false, error: res.error };
}

/** Consulta el pago en Mercado Pago (la fuente de verdad) y actúa según su estado. */
export async function procesarPago(env, pagoId) {
  const p = await obtenerPago(env, pagoId);
  if (!p.ok || !p.data) {
    await log(env, null, "mp_error", `GET pago ${pagoId}: HTTP ${p.status}`);
    return { ok: false, reintentar: true, error: `Mercado Pago respondió ${p.status}` };
  }
  return aplicarPago(env, p.data);
}

export async function aplicarPago(env, pago) {
  const ref = pago.external_reference;
  const orden = UUID_RE.test(ref || "") ? await getOrden(env, ref) : null;
  if (!orden) {
    await log(env, null, "pago_sin_orden", `pago ${pago.id}, referencia ${ref}`);
    return { ok: true, ignorado: true };
  }
  const id = String(pago.id);
  const metodo = pago.payment_method_id || pago.payment_type_id || null;
  const estadoMP = pago.status;

  // Otro pago distinto sobre una orden que ya se cobró: no pisar los datos, avisar.
  if (orden.paid_at && orden.mp_payment_id && orden.mp_payment_id !== id) {
    if (estadoMP === "approved") await log(env, orden.id, "pago_duplicado", `El pago ${id} también fue aprobado (ya estaba el ${orden.mp_payment_id}). Revisalo y reembolsá uno.`);
    return { ok: true, ignorado: true };
  }

  const actualizarMP = () =>
    env.DB.prepare("UPDATE orders SET mp_payment_id = ?, mp_status = ?, mp_status_detail = ?, payment_method = ? WHERE id = ?")
      .bind(id, estadoMP || null, pago.status_detail || null, metodo, orden.id)
      .run();

  if (estadoMP === "approved") {
    const monto = Number(pago.transaction_amount);
    if (monto !== orden.amount || (pago.currency_id && pago.currency_id !== orden.currency)) {
      await actualizarMP();
      await env.DB.prepare("UPDATE orders SET status = 'revisar' WHERE id = ? AND status IN ('pending','rejected','cancelled')").bind(orden.id).run();
      await log(env, orden.id, "monto_distinto", `Esperado ${orden.amount} ${orden.currency}, MP informó ${pago.transaction_amount} ${pago.currency_id}. No se entregó.`);
      return { ok: true, revisar: true };
    }
    await actualizarMP();
    await env.DB.prepare(
      "UPDATE orders SET paid_at = COALESCE(paid_at, ?), status = CASE WHEN status IN ('pending','rejected','cancelled') THEN 'approved' ELSE status END WHERE id = ?"
    )
      .bind(ahora(), orden.id)
      .run();
    await log(env, orden.id, "pago_aprobado", `pago ${id} (${metodo || "?"})`);
    const e = await entregar(env, orden.id);
    if (!e.ok) return { ok: false, reintentar: true, error: e.error };
    return { ok: true, entregado: true };
  }

  if (estadoMP === "refunded" || estadoMP === "charged_back") {
    await actualizarMP();
    await env.DB.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").bind(orden.id).run();
    await log(env, orden.id, estadoMP === "refunded" ? "reembolsado" : "contracargo", `pago ${id}`);
    return { ok: true };
  }

  if (estadoMP === "rejected" || estadoMP === "cancelled") {
    await actualizarMP();
    await env.DB.prepare("UPDATE orders SET status = ? WHERE id = ? AND status IN ('pending','rejected','cancelled')")
      .bind(estadoMP === "rejected" ? "rejected" : "cancelled", orden.id)
      .run();
    await log(env, orden.id, "pago_" + estadoMP, `${pago.status_detail || ""}`);
    return { ok: true };
  }

  // pending, in_process, authorized, in_mediation…: se guarda el estado y se espera el próximo aviso.
  await actualizarMP();
  await log(env, orden.id, "pago_" + (estadoMP || "desconocido"), `${pago.status_detail || ""}`);
  return { ok: true };
}

/** Para el botón "Sincronizar": usa el pago guardado o lo busca por referencia. */
export async function sincronizarOrden(env, orden) {
  if (orden.mp_payment_id) return procesarPago(env, orden.mp_payment_id);
  const r = await buscarPagoPorReferencia(env, orden.id);
  if (!r.ok) return { ok: false, error: `Mercado Pago respondió ${r.status}` };
  if (!r.data) return { ok: false, error: "Mercado Pago no tiene ningún pago para esta orden (todavía no pagó)." };
  return aplicarPago(env, r.data);
}
