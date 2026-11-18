// Links de descarga firmados: <orden>.<archivo>.<tipo>.<vencimiento>.<firma>
//   tipo "m" = lo usa el servicio de mail para adjuntar (dura 1 hora)
//   tipo "u" = link de respaldo para la compradora (dura DOWNLOAD_DAYS)
import { hmacB64url, iguales, UUID_RE } from "./util.js";

export const ARCHIVOS = (env) => ({
  libro: { r2: env.FILE_LIBRO || "Mucho-gusto-mama.pdf", nombre: "Mucho-gusto-mama.pdf" },
  navidad: { r2: env.FILE_NAVIDAD || "Nuestra-Navidad.pdf", nombre: "Nuestra-Navidad.pdf" },
});

export async function crearToken(env, ordenId, archivo, tipo, ttlSeg) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeg;
  const payload = `${ordenId}.${archivo}.${tipo}.${exp}`;
  return `${payload}.${await hmacB64url(env.DOWNLOAD_SIGNING_KEY, payload)}`;
}

export async function verificarToken(env, token) {
  if (!env.DOWNLOAD_SIGNING_KEY || typeof token !== "string") return null;
  const p = token.split(".");
  if (p.length !== 5) return null;
  const [ordenId, archivo, tipo, exp, firma] = p;
  if (!UUID_RE.test(ordenId) || !["libro", "navidad"].includes(archivo) || !["m", "u"].includes(tipo)) return null;
  const esperada = await hmacB64url(env.DOWNLOAD_SIGNING_KEY, `${ordenId}.${archivo}.${tipo}.${exp}`);
  if (!iguales(esperada, firma)) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  return { ordenId, archivo, tipo };
}
