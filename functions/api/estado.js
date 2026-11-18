// GET /api/estado?o=<orden>&payment_id=<id>  → estado para la página de gracias.
// Si el comprador vuelve de Mercado Pago antes de que llegue el webhook, acá se confirma el pago directamente.
import { getOrden } from "../_lib/db.js";
import { procesarPago } from "../_lib/fulfill.js";
import { json, UUID_RE } from "../_lib/util.js";

function resumir(o) {
  let estado;
  switch (o.status) {
    case "delivered": estado = "entregado"; break;
    case "delivery_failed": estado = "error_envio"; break;
    case "rejected":
    case "cancelled": estado = "rechazado"; break;
    case "refunded": estado = "reembolsado"; break;
    case "revisar": estado = "revisar"; break;
    case "approved":
    case "delivering": estado = "confirmando"; break;
    default: estado = o.mp_status === "pending" || o.mp_status === "in_process" ? "pendiente" : "confirmando";
  }
  return { estado, email: o.email, monto: o.amount };
}

export async function onRequestGet({ request, env }) {
  const sp = new URL(request.url).searchParams;
  const id = sp.get("o") || "";
  if (!UUID_RE.test(id)) return json({ estado: "desconocido" }, 404);
  let orden = await getOrden(env, id);
  if (!orden) return json({ estado: "desconocido" }, 404);

  const pagoId = sp.get("payment_id") || sp.get("collection_id");
  if (pagoId && /^\d+$/.test(pagoId) && ["pending", "approved", "delivery_failed"].includes(orden.status)) {
    try {
      await procesarPago(env, pagoId);
      orden = await getOrden(env, id);
    } catch {}
  }
  return json(resumir(orden));
}
