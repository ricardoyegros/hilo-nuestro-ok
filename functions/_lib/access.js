// Verifica que quien entra al panel pasó por Cloudflare Access.
// Cloudflare Access agrega la cabecera "Cf-Access-Jwt-Assertion" (un JWT firmado). Acá se comprueba
// la firma, el vencimiento, la audiencia (AUD de tu aplicación) y, si lo configurás, que el mail esté en ADMIN_EMAILS.
// Si falta la configuración, el panel queda CERRADO (nunca abierto por defecto).
import { b64urlABytes, enc } from "./util.js";

let cache = { t: 0, team: null, keys: null };

async function claves(team, forzar = false) {
  if (!forzar && cache.keys && cache.team === team && Date.now() - cache.t < 3600e3) return cache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("no se pudieron leer las claves de Access");
  const d = await r.json();
  cache = { t: Date.now(), team, keys: d.keys || [] };
  return cache.keys;
}

const dec = (b64) => JSON.parse(new TextDecoder().decode(b64urlABytes(b64)));

export async function verificarAccess(request, env) {
  const host = new URL(request.url).hostname;
  // Solo para desarrollo local (wrangler pages dev): requiere DEV_ADMIN_EMAIL y que el host sea localhost.
  if ((host === "localhost" || host === "127.0.0.1") && env.DEV_ADMIN_EMAIL) return { ok: true, email: String(env.DEV_ADMIN_EMAIL).toLowerCase() };

  const team = String(env.CF_ACCESS_TEAM_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const aud = env.CF_ACCESS_AUD;
  if (!team || !aud) return { ok: false, status: 503, msg: "Panel sin configurar: faltan CF_ACCESS_TEAM_DOMAIN y CF_ACCESS_AUD." };

  const jwt = request.headers.get("cf-access-jwt-assertion");
  if (!jwt) return { ok: false, status: 401, msg: "No autenticado." };

  try {
    const [h, p, s] = jwt.split(".");
    if (!h || !p || !s) throw new Error("formato");
    const cab = dec(h);
    if (cab.alg !== "RS256") throw new Error("alg");
    let jwk = (await claves(team)).find((k) => k.kid === cab.kid);
    if (!jwk) jwk = (await claves(team, true)).find((k) => k.kid === cab.kid); // por si rotaron las claves
    if (!jwk) throw new Error("kid");
    const clave = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const firmaOk = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", clave, b64urlABytes(s), enc.encode(`${h}.${p}`));
    if (!firmaOk) throw new Error("firma");
    const c = dec(p);
    const ahoraS = Math.floor(Date.now() / 1000);
    const audOk = Array.isArray(c.aud) ? c.aud.includes(aud) : c.aud === aud;
    if (!audOk) throw new Error("aud");
    if (c.iss !== `https://${team}`) throw new Error("iss");
    if (!c.exp || c.exp < ahoraS) throw new Error("exp");
    if (c.nbf && c.nbf > ahoraS + 60) throw new Error("nbf");
    const email = String(c.email || "").toLowerCase();
    if (!email) throw new Error("email");
    const permitidos = String(env.ADMIN_EMAILS || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
    if (permitidos.length && !permitidos.includes(email)) return { ok: false, status: 403, msg: "Este mail no tiene acceso al panel." };
    return { ok: true, email };
  } catch (e) {
    return { ok: false, status: 401, msg: "Sesión inválida." };
  }
}
