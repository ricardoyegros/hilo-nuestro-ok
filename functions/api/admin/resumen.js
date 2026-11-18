// GET /api/admin/resumen?dias=7|30|90|all  → números del negocio para la pantalla de inicio del panel.
import { rango } from "../../_lib/admin.js";
import { fechaAR, json } from "../../_lib/util.js";

export async function onRequestGet({ request, env }) {
  const { desde, hasta, dias } = rango(new URL(request.url));
  const fp = desde ? " AND date(paid_at, '-3 hours') >= ?" : "";
  const bp = desde ? [desde] : [];
  const confirmadas = "paid_at IS NOT NULL AND status != 'refunded'";

  const tot = await env.DB.prepare(`SELECT COUNT(*) AS ventas, COALESCE(SUM(amount), 0) AS bruto FROM orders WHERE ${confirmadas}${fp}`).bind(...bp).first();
  const reem = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS monto FROM orders WHERE status = 'refunded' AND paid_at IS NOT NULL${fp}`).bind(...bp).first();
  const serie = await env.DB.prepare(
    `SELECT date(paid_at, '-3 hours') AS dia, COUNT(*) AS ventas, COALESCE(SUM(amount), 0) AS bruto FROM orders WHERE ${confirmadas}${fp} GROUP BY dia ORDER BY dia`
  ).bind(...bp).all();
  const hoyAR = fechaAR();
  const hoy = await env.DB.prepare(`SELECT COUNT(*) AS ventas, COALESCE(SUM(amount), 0) AS bruto FROM orders WHERE ${confirmadas} AND date(paid_at, '-3 hours') = ?`).bind(hoyAR).first();
  const gas = await env.DB.prepare(
    `SELECT categoria, COALESCE(SUM(monto), 0) AS total FROM gastos ${desde ? "WHERE fecha >= ?" : ""} GROUP BY categoria`
  ).bind(...bp).all();
  const pend = await env.DB.prepare(
    `SELECT SUM(CASE WHEN status = 'delivery_failed' THEN 1 ELSE 0 END) AS fallidos,
            SUM(CASE WHEN status = 'revisar' THEN 1 ELSE 0 END) AS revisar,
            SUM(CASE WHEN status = 'pending' AND mp_status IN ('pending','in_process') THEN 1 ELSE 0 END) AS por_acreditar
     FROM orders`
  ).first();

  const porCategoria = {};
  let gastos = 0;
  for (const g of gas.results || []) {
    porCategoria[g.categoria] = g.total;
    gastos += g.total;
  }
  const pct = Number(env.MP_FEE_PCT) > 0 ? Number(env.MP_FEE_PCT) : 6.29;
  const comision = Math.round(((tot.bruto * pct) / 100) * 1.21); // comisión + IVA 21%
  const neto = tot.bruto - comision;
  const publicidad = porCategoria.publicidad || 0;

  return json({
    periodo: { desde, hasta, dias },
    kpis: {
      ventas: tot.ventas,
      bruto: tot.bruto,
      ticket: tot.ventas ? Math.round(tot.bruto / tot.ventas) : 0,
      comision_est: comision,
      comision_pct: pct,
      neto_est: neto,
      gastos,
      gastos_por_categoria: porCategoria,
      resultado: neto - gastos,
      cac: tot.ventas && publicidad ? Math.round(publicidad / tot.ventas) : null,
      roas: publicidad ? Math.round((tot.bruto / publicidad) * 100) / 100 : null,
      reembolsos: reem.n,
      reembolsado: reem.monto,
    },
    hoy,
    serie: serie.results || [],
    atencion: { fallidos: pend?.fallidos || 0, revisar: pend?.revisar || 0, por_acreditar: pend?.por_acreditar || 0 },
  });
}
