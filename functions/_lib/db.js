import { ahora } from "./util.js";

/** Registra un evento (nunca rompe el flujo si falla). */
export async function log(env, ordenId, tipo, detalle) {
  try {
    await env.DB.prepare("INSERT INTO events (ts, order_id, type, detail) VALUES (?, ?, ?, ?)")
      .bind(ahora(), ordenId || null, tipo, detalle == null ? null : String(detalle).slice(0, 1000))
      .run();
  } catch (e) {
    console.error("log falló", e);
  }
}

export function getOrden(env, id) {
  return env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
}
