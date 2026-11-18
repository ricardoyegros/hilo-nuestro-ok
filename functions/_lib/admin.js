// Ayudas para los endpoints del panel.
import { fechaAR, json } from "./util.js";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const ESTADOS = ["pending", "approved", "delivering", "delivered", "delivery_failed", "rejected", "cancelled", "refunded", "revisar"];

/** Arma el WHERE de la lista de ventas según los filtros de la URL. */
export function filtrosVentas(url) {
  const sp = url.searchParams;
  const w = [];
  const b = [];
  const estado = sp.get("estado");
  if (estado && ESTADOS.includes(estado)) {
    w.push("status = ?");
    b.push(estado);
  }
  const q = (sp.get("q") || "").trim().toLowerCase().slice(0, 80);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    w.push("(lower(email) LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' OR mp_payment_id LIKE ? ESCAPE '\\')");
    b.push(like, like, like);
  }
  const desde = sp.get("desde");
  if (FECHA.test(desde || "")) {
    w.push("date(created_at, '-3 hours') >= ?");
    b.push(desde);
  }
  const hasta = sp.get("hasta");
  if (FECHA.test(hasta || "")) {
    w.push("date(created_at, '-3 hours') <= ?");
    b.push(hasta);
  }
  return { where: w.length ? "WHERE " + w.join(" AND ") : "", binds: b };
}

export function rango(url, porDefecto = "30") {
  const d = url.searchParams.get("dias") || porDefecto;
  if (d === "all") return { desde: null, hasta: fechaAR(), dias: "all" };
  const n = Math.min(Math.max(parseInt(d, 10) || 30, 1), 365);
  return { desde: fechaAR(Date.now() - (n - 1) * 86400000), hasta: fechaAR(), dias: n };
}

export const noEncontrada = () => json({ error: "No encontrada" }, 404);
