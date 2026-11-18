// Utilidades compartidas. Solo usa APIs estándar (Web Crypto, fetch), sin dependencias.
export const enc = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export const ahora = () => new Date().toISOString();

/** Fecha 'YYYY-MM-DD' en Argentina (UTC-3, sin horario de verano). */
export function fechaAR(d = new Date()) {
  return new Date(new Date(d).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function b64url(bytes) {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlABytes(str) {
  let s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Base64 estándar por tramos (evita desbordar la pila con archivos grandes). */
export function b64std(bytes) {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function claveHmac(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function hmacHex(secret, mensaje) {
  return toHex(await crypto.subtle.sign("HMAC", await claveHmac(secret), enc.encode(mensaje)));
}

export async function hmacB64url(secret, mensaje) {
  return b64url(await crypto.subtle.sign("HMAC", await claveHmac(secret), enc.encode(mensaje)));
}

export async function sha256Hex(texto) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(texto)));
}

/** Comparación de strings sin cortocircuito (evita filtrar información por tiempos). */
export function iguales(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] || 0) ^ (eb[i] || 0);
  return diff === 0;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailValido(e) {
  return typeof e === "string" && e.length <= 254 && EMAIL_RE.test(e);
}

/** Precio en pesos. Siempre sale del servidor (variable PRICE_ARS), nunca del navegador. */
export function precio(env) {
  const n = Number(env.PRICE_ARS);
  return Number.isInteger(n) && n > 0 ? n : 19999;
}

export function siteUrl(env) {
  return String(env.SITE_URL || "").replace(/\/+$/, "");
}

export function dias(env) {
  const n = Number(env.DOWNLOAD_DAYS);
  return Number.isInteger(n) && n > 0 ? n : 30;
}

export async function leerJson(request, maxBytes = 4096) {
  const txt = await request.text();
  if (txt.length > maxBytes) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}
