// GET /api/admin/exportar?estado=&q=&desde=&hasta=  → CSV de ventas para tu contador (abre bien en Excel).
import { filtrosVentas } from "../../_lib/admin.js";
import { fechaAR } from "../../_lib/util.js";

const CAB = ["fecha_pedido", "fecha_pago", "mail", "monto_ARS", "estado", "estado_mp", "id_pago_mp", "medio_de_pago", "mails_enviados", "descargas", "nota", "id_orden"];

// Evita que Excel interprete como fórmula un texto que empieza con = + - @
function celda(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function onRequestGet({ request, env }) {
  const { where, binds } = filtrosVentas(new URL(request.url));
  const r = await env.DB.prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT 5000`).bind(...binds).all();
  const filas = [CAB.map(celda).join(",")];
  for (const o of r.results || []) {
    filas.push([
      fechaAR(o.created_at), o.paid_at ? fechaAR(o.paid_at) : "", o.email, o.amount, o.status, o.mp_status, o.mp_payment_id,
      o.payment_method, o.mail_count, o.downloads, o.notes, o.id,
    ].map(celda).join(","));
  }
  return new Response("﻿" + filas.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ventas-hilo-nuestro-${fechaAR()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
