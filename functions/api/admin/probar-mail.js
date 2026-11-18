// POST /api/admin/probar-mail  → te manda un mail de prueba con los dos PDFs, para comprobar Resend y R2.
import { log } from "../../_lib/db.js";
import { enviarPrueba } from "../../_lib/mail.js";
import { json } from "../../_lib/util.js";

export async function onRequestPost({ env, data }) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) return json({ ok: false, error: "Faltan RESEND_API_KEY o FROM_EMAIL." }, 503);
  const r = await enviarPrueba(env, data.admin);
  await log(env, null, r.ok ? "mail_prueba" : "mail_prueba_error", r.ok ? data.admin : r.error);
  return json({ ...r, destino: data.admin }, r.ok ? 200 : 502);
}
