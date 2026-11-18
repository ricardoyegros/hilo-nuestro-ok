// Envío de mails con Resend. Los PDFs viajan adjuntos.
//   MAIL_ATTACH_MODE = "path"   (por defecto) → Resend descarga cada PDF desde un link firmado de este sitio.
//                                                Gasta casi nada de CPU de la función.
//   MAIL_ATTACH_MODE = "inline" → la función lee los PDFs de R2 y los manda en base64 dentro del pedido.
import { ARCHIVOS, crearToken } from "./tokens.js";
import { b64std, dias, esc, siteUrl } from "./util.js";

const crema = "#F6EFE4", tinta = "#3B2F2A", terracota = "#B5483A", arena = "#EBDFCB";

async function adjuntos(env, orden, modo) {
  const arch = ARCHIVOS(env);
  const out = [];
  for (const clave of ["libro", "navidad"]) {
    const { r2, nombre } = arch[clave];
    if (modo === "inline") {
      const obj = await env.FILES.get(r2);
      if (!obj) throw new Error(`Falta el archivo "${r2}" en el bucket R2`);
      out.push({ filename: nombre, content: b64std(await obj.arrayBuffer()) });
    } else {
      if (!(await env.FILES.head(r2))) throw new Error(`Falta el archivo "${r2}" en el bucket R2`);
      const t = await crearToken(env, orden.id, clave, "m", 3600);
      out.push({ filename: nombre, path: `${siteUrl(env)}/api/descarga?t=${t}` });
    }
  }
  return out;
}

async function linksRespaldo(env, orden) {
  const ttl = dias(env) * 86400;
  const site = siteUrl(env);
  return {
    libro: `${site}/api/descarga?t=${await crearToken(env, orden.id, "libro", "u", ttl)}`,
    navidad: `${site}/api/descarga?t=${await crearToken(env, orden.id, "navidad", "u", ttl)}`,
  };
}

function cuerpoHtml(env, links, esPrueba) {
  const contacto = env.REPLY_TO ? `<a href="mailto:${esc(env.REPLY_TO)}" style="color:${terracota}">${esc(env.REPLY_TO)}</a>` : "respondiendo este mail";
  const respaldo = links
    ? `<p style="margin:22px 0 6px;font-size:15px;color:#6F6058">Por si tu casilla no abre los adjuntos, también podés descargarlos acá (válidos por ${dias(env)} días):</p>
       <p style="margin:0;font-size:15px"><a href="${esc(links.libro)}" style="color:${terracota}">Mucho gusto, mamá (PDF)</a><br><a href="${esc(links.navidad)}" style="color:${terracota}">Nuestra Navidad (PDF)</a></p>`
    : "";
  return `<!doctype html><html lang="es"><body style="margin:0;background:${arena};padding:24px 12px;font-family:Georgia,'Times New Roman',serif;color:${tinta}">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:${crema};border-radius:4px"><tr><td style="padding:34px 30px">
<p style="margin:0 0 26px;font-size:22px;letter-spacing:.02em">hilo <em style="color:${terracota}">nuestro</em></p>
${esPrueba ? `<p style="margin:0 0 14px;padding:8px 12px;background:${arena};font-size:13px">Este es un mail de prueba del panel.</p>` : ""}
<h1 style="margin:0 0 14px;font-size:26px;font-weight:normal;line-height:1.25">¡Gracias por tu compra!</h1>
<p style="margin:0 0 14px;font-size:17px;line-height:1.6">Te mandamos tus dos libros, adjuntos a este mail:</p>
<p style="margin:0 0 18px;font-size:17px;line-height:1.7">• <b>Mucho gusto, mamá</b>: 50 preguntas para que ella cuente su historia.<br>• <b>Nuestra Navidad</b>: juegos, recetas y tarjetas para la mesa, de regalo.</p>
<p style="margin:0 0 6px;font-size:16px;line-height:1.6"><b>Cómo usarlos:</b> imprimilos en tamaño A5 (en tu casa o en una copistería) o abrilos en una tablet para escribir con lápiz digital.</p>
${respaldo}
<hr style="border:0;border-top:1px solid ${arena};margin:26px 0 16px">
<p style="margin:0;font-size:14px;line-height:1.6;color:#6F6058">Si algo no es lo que esperabas, escribinos dentro de los 10 días y te devolvemos tu dinero. Cualquier duda, escribinos a ${contacto}.<br><br>Con cariño,<br>Hilo Nuestro</p>
</td></tr></table></body></html>`;
}

function cuerpoTexto(env, links) {
  return `¡Gracias por tu compra!

Te mandamos tus dos libros, adjuntos a este mail:
- Mucho gusto, mamá
- Nuestra Navidad (de regalo)

Imprimilos en tamaño A5 o abrilos en una tablet para escribir con lápiz digital.
${links ? `\nSi no podés abrir los adjuntos, descargalos acá (válidos por ${dias(env)} días):\n${links.libro}\n${links.navidad}\n` : ""}
Si algo no es lo que esperabas, escribinos dentro de los 10 días y te devolvemos tu dinero.

Hilo Nuestro`;
}

async function resend(env, cuerpo, claveIdem) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": claveIdem },
    body: JSON.stringify(cuerpo),
  });
  let data = null;
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) return { ok: false, error: `Resend ${r.status}: ${data?.message || data?.name || "error"}` };
  return { ok: true, id: data?.id || null };
}

/** Manda los libros a la compradora. claveIdem evita mails duplicados si se reintenta. */
export async function enviarLibros(env, orden, claveIdem) {
  try {
    const modo = env.MAIL_ATTACH_MODE === "inline" ? "inline" : "path";
    const [adj, links] = await Promise.all([adjuntos(env, orden, modo), linksRespaldo(env, orden)]);
    return await resend(
      env,
      {
        from: env.FROM_EMAIL,
        to: [orden.email],
        ...(env.REPLY_TO ? { reply_to: env.REPLY_TO } : {}),
        subject: "Tus libros de Hilo Nuestro: Mucho gusto, mamá + Nuestra Navidad",
        html: cuerpoHtml(env, links, false),
        text: cuerpoTexto(env, links),
        attachments: adj,
      },
      claveIdem
    );
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** Mail de prueba desde el panel: siempre con adjuntos en base64, sin links. */
export async function enviarPrueba(env, destino) {
  try {
    const adj = await adjuntos(env, { id: "prueba" }, "inline");
    return await resend(
      env,
      {
        from: env.FROM_EMAIL,
        to: [destino],
        ...(env.REPLY_TO ? { reply_to: env.REPLY_TO } : {}),
        subject: "[Prueba] Tus libros de Hilo Nuestro",
        html: cuerpoHtml(env, null, true),
        text: cuerpoTexto(env, null),
        attachments: adj,
      },
      `prueba-${crypto.randomUUID()}`
    );
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
