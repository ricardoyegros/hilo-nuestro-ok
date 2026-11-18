// Pruebas del backend sin internet: base de datos SQLite real (node:sqlite) como reemplazo de D1,
// un R2 de mentira y un "fetch" que simula Mercado Pago, Resend y Cloudflare Access.
//   Ejecutar:  npm test   (necesita Node 22+)
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const F = (p) => import(join(AQUI, "..", "functions", p));
const { onRequestPost: checkout } = await F("api/checkout.js");
const { onRequestPost: webhook } = await F("api/webhook.js");
const { onRequestGet: estado } = await F("api/estado.js");
const { onRequestGet: descarga } = await F("api/descarga.js");
const adminMw = (await F("api/admin/_middleware.js")).onRequest;
const adminPageMw = (await F("admin/_middleware.js")).onRequest;
const A = {
  me: (await F("api/admin/me.js")).onRequestGet,
  resumen: (await F("api/admin/resumen.js")).onRequestGet,
  ventas: (await F("api/admin/ventas.js")).onRequestGet,
  venta: (await F("api/admin/venta.js")).onRequestGet,
  reenviar: (await F("api/admin/reenviar.js")).onRequestPost,
  sincronizar: (await F("api/admin/sincronizar.js")).onRequestPost,
  nota: (await F("api/admin/nota.js")).onRequestPost,
  gastos: await F("api/admin/gastos.js"),
  exportar: (await F("api/admin/exportar.js")).onRequestGet,
  config: (await F("api/admin/config.js")).onRequestGet,
  probar: (await F("api/admin/probar-mail.js")).onRequestPost,
};
const { procesarPago } = await F("_lib/fulfill.js");
const { crearToken } = await F("_lib/tokens.js");
const { hmacHex } = await F("_lib/util.js");

// ---------- reemplazos de D1 y R2 ----------
function crearDB() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(AQUI, "..", "schema.sql"), "utf8"));
  const limpiar = (a) => a.map((v) => (v === undefined ? null : v));
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      const mk = (args) => ({
        bind: (...a) => mk(limpiar(a)),
        async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
        async first() { return st.get(...args) ?? null; },
        async all() { return { results: st.all(...args) }; },
      });
      return mk([]);
    },
  };
}
function crearR2() {
  const m = new Map();
  return {
    put: (k, bytes) => m.set(k, new Uint8Array(bytes)),
    async head(k) { return m.has(k) ? { key: k } : null; },
    async get(k) {
      if (!m.has(k)) return null;
      const b = m.get(k);
      return { body: new Blob([b]).stream(), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    },
  };
}

// ---------- servicios externos simulados ----------
const mock = { pagos: {}, busqueda: [], resend: [], mpPrefs: [], resendFalla: false, jwks: null };
let nPref = 0, nMail = 0;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const R = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (url === "https://api.mercadopago.com/checkout/preferences") {
    const b = JSON.parse(init.body);
    mock.mpPrefs.push(b);
    nPref++;
    return R({ id: "pref" + nPref, init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref" + nPref });
  }
  let m = url.match(/^https:\/\/api\.mercadopago\.com\/v1\/payments\/(\d+)$/);
  if (m) return mock.pagos[m[1]] ? R(mock.pagos[m[1]]) : R({ message: "not found" }, 404);
  if (url.startsWith("https://api.mercadopago.com/v1/payments/search")) return R({ results: mock.busqueda });
  if (url === "https://api.resend.com/emails") {
    const cuerpo = JSON.parse(init.body);
    mock.resend.push({ cuerpo, idem: init.headers["idempotency-key"], auth: init.headers.authorization });
    if (mock.resendFalla) return R({ name: "internal_server_error", message: "boom" }, 500);
    return R({ id: "mail_" + ++nMail });
  }
  if (url === "https://equipo.cloudflareaccess.com/cdn-cgi/access/certs") return R({ keys: [mock.jwks] });
  throw new Error("fetch inesperado: " + url);
};

// ---------- entorno ----------
const SITE = "https://hilonuestro.test";
const R2 = crearR2();
R2.put("Mucho-gusto-mama.pdf", new TextEncoder().encode("%PDF-1.4 libro"));
R2.put("Nuestra-Navidad.pdf", new TextEncoder().encode("%PDF-1.4 navidad"));
const env = {
  SITE_URL: SITE, PRICE_ARS: "19999", MP_ACCESS_TOKEN: "APP_USR-test", MP_WEBHOOK_SECRET: "whsec_test",
  RESEND_API_KEY: "re_test", FROM_EMAIL: "Hilo Nuestro <libros@hilonuestro.test>", REPLY_TO: "hola@hilonuestro.test",
  DOWNLOAD_SIGNING_KEY: "k".repeat(40), CF_ACCESS_TEAM_DOMAIN: "equipo.cloudflareaccess.com", CF_ACCESS_AUD: "aud123",
  ADMIN_EMAILS: "yo@mail.com", MP_FEE_PCT: "6.29", DB: crearDB(), FILES: R2,
};
const DB = env.DB;

// ---------- JWT de Cloudflare Access (clave RSA de prueba) ----------
const par = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
mock.jwks = { ...(await crypto.subtle.exportKey("jwk", par.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const b64u = (b) => Buffer.from(b).toString("base64url");
async function jwt(over = {}, firmante = par.privateKey) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const p = b64u(JSON.stringify({ aud: ["aud123"], email: "yo@mail.com", iss: "https://equipo.cloudflareaccess.com", exp: Math.floor(Date.now() / 1000) + 600, ...over }));
  const s = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", firmante, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(s)}`;
}

// ---------- ayudas de prueba ----------
const post = (path, body, headers = {}) =>
  new Request(SITE + path, { method: "POST", headers: { origin: SITE, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
async function crearOrden(email = "ana@mail.com", ip = "1.1.1.1") {
  const r = await checkout({ request: post("/api/checkout", { email }, { "cf-connecting-ip": ip }), env });
  assert.equal(r.status, 200);
  return (await DB.prepare("SELECT * FROM orders ORDER BY created_at DESC, rowid DESC LIMIT 1").first()).id;
}
function pagoMP(id, ordenId, over = {}) {
  mock.pagos[id] = { id: Number(id), status: "approved", status_detail: "accredited", transaction_amount: 19999, currency_id: "ARS", external_reference: ordenId, payment_method_id: "visa", ...over };
}
async function avisoWebhook(pagoId, { firma = true, reqId = "req-" + Math.random() } = {}) {
  const ts = String(Date.now());
  const headers = { "x-request-id": reqId };
  if (firma) headers["x-signature"] = `ts=${ts},v1=${await hmacHex(env.MP_WEBHOOK_SECRET, `id:${pagoId};request-id:${reqId};ts:${ts};`)}`;
  const req = new Request(`${SITE}/api/webhook?data.id=${pagoId}&type=payment&source_news=webhooks`, { method: "POST", headers, body: JSON.stringify({ type: "payment", data: { id: String(pagoId) } }) });
  return webhook({ request: req, env });
}
const orden = (id) => DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
const eventos = (id) => DB.prepare("SELECT type FROM events WHERE order_id = ? ORDER BY id").bind(id).all().then((r) => r.results.map((e) => e.type));
async function admin(handler, { metodo = "GET", ruta = "/api/admin/x", body, headers, jwtOver, sinJwt } = {}) {
  const h = { ...(headers || {}) };
  if (!sinJwt) h["cf-access-jwt-assertion"] = await jwt(jwtOver);
  const init = { method: metodo, headers: h };
  if (body !== undefined) { init.body = JSON.stringify(body); h["content-type"] = "application/json"; }
  const ctx = { request: new Request(SITE + ruta, init), env, data: {}, params: {} };
  ctx.next = () => handler(ctx);
  return adminMw(ctx);
}
const adm = (handler, o = {}) => admin(handler, { ...o, headers: { "x-hilo-admin": "1", ...(o.headers || {}) } });

let ok = 0;
async function t(nombre, fn) {
  try { await fn(); ok++; console.log("  ✔", nombre); } catch (e) { console.error("  ✘", nombre, "\n    ", e.stack || e); process.exitCode = 1; }
}

// =====================================================================
console.log("\nCheckout");
let ordenA;
await t("crea la orden con el precio del servidor (ignora el que mande el navegador)", async () => {
  const r = await checkout({ request: post("/api/checkout", { email: "  Ana@Mail.com ", precio: 1, amount: 1 }, { "cf-connecting-ip": "9.9.9.9" }), env });
  assert.equal(r.status, 200);
  assert.match((await r.json()).init_point, /mercadopago/);
  const o = await DB.prepare("SELECT * FROM orders").first();
  ordenA = o.id;
  assert.equal(o.email, "ana@mail.com");
  assert.equal(o.amount, 19999);
  assert.equal(o.status, "pending");
  assert.ok(o.ip_hash && !o.ip_hash.includes("9.9.9.9"));
  const pref = mock.mpPrefs[0];
  assert.equal(pref.items[0].unit_price, 19999);
  assert.equal(pref.items[0].currency_id, "ARS");
  assert.equal(pref.external_reference, o.id);
  assert.equal(pref.payer.email, "ana@mail.com");
  assert.equal(pref.notification_url, SITE + "/api/webhook?source_news=webhooks");
  assert.equal(pref.back_urls.success, `${SITE}/gracias?o=${o.id}`);
  assert.equal(pref.auto_return, "approved");
});
await t("rechaza origen ajeno, bots (campo trampa) y mails inválidos", async () => {
  assert.equal((await checkout({ request: post("/api/checkout", { email: "a@b.com" }, { origin: "https://malo.test" }), env })).status, 403);
  assert.equal((await checkout({ request: new Request(SITE + "/api/checkout", { method: "POST", body: JSON.stringify({ email: "a@b.com" }) }), env })).status, 403);
  assert.equal((await checkout({ request: post("/api/checkout", { email: "a@b.com", web: "http://spam" }), env })).status, 400);
  assert.equal((await checkout({ request: post("/api/checkout", { email: "no-es-un-mail" }), env })).status, 400);
});
await t("limita a 8 intentos por IP cada 10 minutos", async () => {
  for (let i = 0; i < 8; i++) assert.equal((await checkout({ request: post("/api/checkout", { email: `t${i}@mail.com` }, { "cf-connecting-ip": "7.7.7.7" }), env })).status, 200);
  assert.equal((await checkout({ request: post("/api/checkout", { email: "t9@mail.com" }, { "cf-connecting-ip": "7.7.7.7" }), env })).status, 429);
});

console.log("\nWebhook y entrega");
await t("pago aprobado con firma válida: entrega UNA vez, con adjuntos y clave de idempotencia", async () => {
  pagoMP("1001", ordenA);
  const r = await avisoWebhook("1001");
  assert.equal(r.status, 200);
  const o = await orden(ordenA);
  assert.equal(o.status, "delivered");
  assert.equal(o.mp_payment_id, "1001");
  assert.equal(o.mail_count, 1);
  assert.ok(o.paid_at && o.delivered_at && o.email_id);
  assert.equal(mock.resend.length, 1);
  const m = mock.resend[0];
  assert.deepEqual(m.cuerpo.to, ["ana@mail.com"]);
  assert.equal(m.idem, `entrega-${ordenA}`);
  assert.equal(m.cuerpo.attachments.length, 2);
  assert.match(m.cuerpo.attachments[0].path, /\/api\/descarga\?t=/);
  assert.match(m.cuerpo.html, /Gracias por tu compra/);
  assert.match(m.cuerpo.html, /api\/descarga\?t=/);
});
await t("el mismo aviso repetido no manda otro mail", async () => {
  assert.equal((await avisoWebhook("1001")).status, 200);
  assert.equal((await avisoWebhook("1001")).status, 200);
  assert.equal(mock.resend.length, 1);
  assert.equal((await orden(ordenA)).mail_count, 1);
});
await t("firma inválida o ausente: 401 y no entrega", async () => {
  const id = await crearOrden("firma@mail.com", "2.2.2.2");
  pagoMP("1002", id);
  assert.equal((await avisoWebhook("1002", { firma: false })).status, 401);
  const req = new Request(`${SITE}/api/webhook?data.id=1002&type=payment`, { method: "POST", headers: { "x-signature": "ts=1,v1=00ff", "x-request-id": "x" }, body: "{}" });
  assert.equal((await webhook({ request: req, env })).status, 401);
  assert.equal((await orden(id)).status, "pending");
  assert.ok((await DB.prepare("SELECT 1 AS x FROM events WHERE type = 'firma_invalida'").first()));
});
await t("monto distinto al precio: NO entrega y queda para revisar", async () => {
  const id = await crearOrden("monto@mail.com", "3.3.3.3");
  pagoMP("1003", id, { transaction_amount: 1 });
  const antes = mock.resend.length;
  await avisoWebhook("1003");
  assert.equal((await orden(id)).status, "revisar");
  assert.equal(mock.resend.length, antes);
  assert.ok((await eventos(id)).includes("monto_distinto"));
});
await t("avisos que no son de pagos se ignoran con 200", async () => {
  const req = new Request(`${SITE}/api/webhook?data.id=55&type=topic_merchant_order_wh`, { method: "POST", body: "{}" });
  assert.equal((await webhook({ request: req, env })).status, 200);
});
await t("pago pendiente (efectivo/transferencia): no entrega y se muestra como pendiente", async () => {
  const id = await crearOrden("pend@mail.com", "4.4.4.4");
  pagoMP("1004", id, { status: "in_process", status_detail: "pending_contingency" });
  await avisoWebhook("1004");
  assert.equal((await orden(id)).status, "pending");
  const r = await estado({ request: new Request(`${SITE}/api/estado?o=${id}`), env });
  assert.equal((await r.json()).estado, "pendiente");
  pagoMP("1004", id); // se acredita
  await avisoWebhook("1004");
  assert.equal((await orden(id)).status, "delivered");
});
await t("pago rechazado queda rechazado y no entrega", async () => {
  const id = await crearOrden("rech@mail.com", "5.5.5.5");
  pagoMP("1005", id, { status: "rejected", status_detail: "cc_rejected_insufficient_amount" });
  const antes = mock.resend.length;
  await avisoWebhook("1005");
  assert.equal((await orden(id)).status, "rejected");
  assert.equal(mock.resend.length, antes);
  const r = await estado({ request: new Request(`${SITE}/api/estado?o=${id}`), env });
  assert.equal((await r.json()).estado, "rechazado");
  // reintenta con otra tarjeta dentro del mismo checkout y se aprueba
  pagoMP("1006", id);
  await avisoWebhook("1006");
  assert.equal((await orden(id)).status, "delivered");
});
await t("dos avisos simultáneos del mismo pago: un solo mail", async () => {
  const id = await crearOrden("carrera@mail.com", "6.6.6.6");
  pagoMP("1007", id);
  const antes = mock.resend.length;
  await Promise.all([procesarPago(env, "1007"), procesarPago(env, "1007"), procesarPago(env, "1007")]);
  assert.equal(mock.resend.length, antes + 1);
  assert.equal((await orden(id)).mail_count, 1);
});
await t("si el mail falla: queda 'delivery_failed', el webhook responde 500 y al reintentar se entrega", async () => {
  const id = await crearOrden("falla@mail.com", "8.8.8.8");
  pagoMP("1008", id);
  mock.resendFalla = true;
  assert.equal((await avisoWebhook("1008")).status, 500);
  assert.equal((await orden(id)).status, "delivery_failed");
  const e = await estado({ request: new Request(`${SITE}/api/estado?o=${id}`), env });
  assert.equal((await e.json()).estado, "error_envio");
  mock.resendFalla = false;
  assert.equal((await avisoWebhook("1008")).status, 200); // Mercado Pago reintenta
  assert.equal((await orden(id)).status, "delivered");
});
await t("pago duplicado sobre una orden ya cobrada: no pisa datos y deja aviso", async () => {
  pagoMP("1009", ordenA);
  const antes = mock.resend.length;
  await avisoWebhook("1009");
  assert.equal((await orden(ordenA)).mp_payment_id, "1001");
  assert.equal(mock.resend.length, antes);
  assert.ok((await eventos(ordenA)).includes("pago_duplicado"));
});

console.log("\nPágina de gracias");
await t("muestra 'entregado' con el mail que escribió la compradora", async () => {
  const r = await estado({ request: new Request(`${SITE}/api/estado?o=${ordenA}`), env });
  const d = await r.json();
  assert.equal(d.estado, "entregado");
  assert.equal(d.email, "ana@mail.com");
  assert.equal(d.monto, 19999);
});
await t("si vuelve de Mercado Pago antes que el webhook, confirma el pago ahí mismo", async () => {
  const id = await crearOrden("rapida@mail.com", "10.10.10.10");
  pagoMP("1010", id);
  const r = await estado({ request: new Request(`${SITE}/api/estado?o=${id}&payment_id=1010&status=approved`), env });
  assert.equal((await r.json()).estado, "entregado");
  assert.equal((await orden(id)).mail_count, 1);
});
await t("orden inexistente o id mal formado → 404", async () => {
  assert.equal((await estado({ request: new Request(`${SITE}/api/estado?o=${crypto.randomUUID()}`), env })).status, 404);
  assert.equal((await estado({ request: new Request(`${SITE}/api/estado?o=hola`), env })).status, 404);
});

console.log("\nDescargas firmadas");
await t("el link del mail entrega el PDF; el de respaldo cuenta descargas", async () => {
  const adj = mock.resend[0].cuerpo.attachments[0].path;
  const r = await descarga({ request: new Request(adj), env });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.match(await r.text(), /%PDF/);
  assert.equal((await orden(ordenA)).downloads, 0); // el adjunto no cuenta como descarga de la compradora
  const link = mock.resend[0].cuerpo.html.match(/href="([^"]*api\/descarga\?t=[^"]+)"/)[1].replaceAll("&amp;", "&");
  assert.equal((await descarga({ request: new Request(link), env })).status, 200);
  assert.equal((await orden(ordenA)).downloads, 1);
});
await t("rechaza links alterados, vencidos o de órdenes reembolsadas", async () => {
  const buena = await crearToken(env, ordenA, "libro", "u", 3600);
  const mala = buena.slice(0, -3) + "AAA";
  assert.equal((await descarga({ request: new Request(`${SITE}/api/descarga?t=${mala}`), env })).status, 403);
  const vencida = await crearToken(env, ordenA, "libro", "u", -10);
  assert.equal((await descarga({ request: new Request(`${SITE}/api/descarga?t=${vencida}`), env })).status, 403);
  assert.equal((await descarga({ request: new Request(`${SITE}/api/descarga`), env })).status, 403);
  const otroArchivo = buena.replace(".libro.", ".navidad.");
  assert.equal((await descarga({ request: new Request(`${SITE}/api/descarga?t=${otroArchivo}`), env })).status, 403);
  const ref = await crearOrden("reem@mail.com", "11.11.11.11");
  pagoMP("1011", ref); await avisoWebhook("1011");
  pagoMP("1011", ref, { status: "refunded" }); await avisoWebhook("1011");
  assert.equal((await orden(ref)).status, "refunded");
  const tk = await crearToken(env, ref, "libro", "u", 3600);
  assert.equal((await descarga({ request: new Request(`${SITE}/api/descarga?t=${tk}`), env })).status, 403);
});

console.log("\nAcceso al panel (Cloudflare Access)");
await t("sin sesión → 401; con sesión válida → pasa", async () => {
  assert.equal((await admin(A.me, { sinJwt: true })).status, 401);
  const r = await admin(A.me);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).email, "yo@mail.com");
});
await t("rechaza audiencia incorrecta, vencido, firma ajena, otro emisor y mail no autorizado", async () => {
  assert.equal((await admin(A.me, { jwtOver: { aud: ["otra"] } })).status, 401);
  assert.equal((await admin(A.me, { jwtOver: { exp: Math.floor(Date.now() / 1000) - 5 } })).status, 401);
  assert.equal((await admin(A.me, { jwtOver: { iss: "https://otro.cloudflareaccess.com" } })).status, 401);
  assert.equal((await admin(A.me, { jwtOver: { email: "intruso@mail.com" } })).status, 403);
  const ajena = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const falso = await jwt({}, ajena.privateKey);
  const ctx = { request: new Request(SITE + "/api/admin/me", { headers: { "cf-access-jwt-assertion": falso } }), env, data: {}, params: {} };
  ctx.next = () => A.me(ctx);
  assert.equal((await adminMw(ctx)).status, 401);
});
await t("sin configuración, el panel queda CERRADO (503), no abierto", async () => {
  const e2 = { ...env, CF_ACCESS_AUD: "" };
  const ctx = { request: new Request(SITE + "/api/admin/me", { headers: { "cf-access-jwt-assertion": await jwt() } }), env: e2, data: {}, params: {} };
  ctx.next = () => A.me(ctx);
  assert.equal((await adminMw(ctx)).status, 503);
  const page = await adminPageMw({ request: new Request(SITE + "/admin"), env: e2, next: () => new Response("PANEL") });
  assert.equal(page.status, 503);
  const page2 = await adminPageMw({ request: new Request(SITE + "/admin"), env, next: () => new Response("PANEL") });
  assert.equal(page2.status, 401);
});
await t("pedidos que modifican datos exigen la cabecera propia y el mismo origen (anti-CSRF)", async () => {
  assert.equal((await admin(A.nota, { metodo: "POST", body: { id: ordenA, nota: "x" } })).status, 403);
  assert.equal((await adm(A.nota, { metodo: "POST", body: { id: ordenA, nota: "x" }, headers: { origin: "https://malo.test" } })).status, 403);
  assert.equal((await adm(A.nota, { metodo: "POST", body: { id: ordenA, nota: "pidió factura" }, headers: { origin: SITE } })).status, 200);
  assert.equal((await orden(ordenA)).notes, "pidió factura");
});
await t("la sesión de desarrollo local solo vale en localhost", async () => {
  const e2 = { ...env, DEV_ADMIN_EMAIL: "dev@mail.com", CF_ACCESS_AUD: "" };
  const local = { request: new Request("http://localhost:8788/api/admin/me"), env: e2, data: {}, params: {} };
  local.next = () => A.me(local);
  assert.equal((await adminMw(local)).status, 200);
  const prod = { request: new Request(SITE + "/api/admin/me"), env: e2, data: {}, params: {} };
  prod.next = () => A.me(prod);
  assert.equal((await adminMw(prod)).status, 503);
});

console.log("\nPanel: datos");
await t("resumen: ventas, comisión estimada, gastos, CAC y ROAS", async () => {
  const antes = await (await adm(A.resumen, { ruta: "/api/admin/resumen?dias=30" })).json();
  // gastos
  const g1 = await adm(A.gastos.onRequestPost, { metodo: "POST", body: { fecha: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), concepto: "Meta Ads", categoria: "publicidad", monto: 30000 } });
  assert.equal(g1.status, 201);
  assert.equal((await adm(A.gastos.onRequestPost, { metodo: "POST", body: { fecha: "mañana", concepto: "x", categoria: "publicidad", monto: 5 } })).status, 400);
  assert.equal((await adm(A.gastos.onRequestPost, { metodo: "POST", body: { fecha: "2026-11-01", concepto: "x", categoria: "robo", monto: 5 } })).status, 400);
  const d = await (await adm(A.resumen, { ruta: "/api/admin/resumen?dias=30" })).json();
  assert.equal(d.kpis.ventas, antes.kpis.ventas);
  assert.ok(d.kpis.ventas >= 5);
  assert.equal(d.kpis.bruto, d.kpis.ventas * 19999);
  assert.equal(d.kpis.comision_est, Math.round(d.kpis.bruto * 6.29 / 100 * 1.21));
  assert.equal(d.kpis.neto_est, d.kpis.bruto - d.kpis.comision_est);
  assert.equal(d.kpis.gastos, 30000);
  assert.equal(d.kpis.resultado, d.kpis.neto_est - 30000);
  assert.equal(d.kpis.cac, Math.round(30000 / d.kpis.ventas));
  assert.equal(d.kpis.roas, Math.round(d.kpis.bruto / 30000 * 100) / 100);
  assert.equal(d.kpis.reembolsos, 1);
  assert.equal(d.hoy.ventas, d.kpis.ventas);
  assert.equal(d.serie.reduce((a, s) => a + s.ventas, 0), d.kpis.ventas);
  assert.ok(d.atencion.revisar >= 1);
});
await t("ventas: filtros por estado y búsqueda, con paginación", async () => {
  const todos = await (await adm(A.ventas, { ruta: "/api/admin/ventas?limite=5&pagina=1" })).json();
  assert.ok(todos.total > 5 && todos.items.length === 5);
  const ent = await (await adm(A.ventas, { ruta: "/api/admin/ventas?estado=delivered" })).json();
  assert.ok(ent.items.every((x) => x.status === "delivered"));
  const q = await (await adm(A.ventas, { ruta: "/api/admin/ventas?q=ana%40mail" })).json();
  assert.equal(q.total, 1);
  assert.equal(q.items[0].email, "ana@mail.com");
  const inj = await adm(A.ventas, { ruta: "/api/admin/ventas?q=" + encodeURIComponent("'; DROP TABLE orders;--") });
  assert.equal(inj.status, 200);
  assert.ok((await DB.prepare("SELECT COUNT(*) c FROM orders").first()).c > 5);
});
await t("detalle de una venta incluye el historial y oculta datos internos", async () => {
  const d = await (await adm(A.venta, { ruta: `/api/admin/venta?id=${ordenA}` })).json();
  assert.equal(d.orden.email, "ana@mail.com");
  assert.equal(d.orden.ip_hash, undefined);
  assert.ok(d.eventos.some((e) => e.type === "mail_enviado"));
  assert.equal((await adm(A.venta, { ruta: "/api/admin/venta?id=zzz" })).status, 404);
});
await t("exportar CSV: con BOM, encabezados y protección contra fórmulas", async () => {
  await adm(A.nota, { metodo: "POST", body: { id: ordenA, nota: '=HYPERLINK("http://malo")' } });
  const r = await adm(A.exportar, { ruta: "/api/admin/exportar?estado=delivered" });
  assert.match(r.headers.get("content-disposition"), /ventas-hilo-nuestro-\d{4}-\d{2}-\d{2}\.csv/);
  const bytes = new Uint8Array(await r.clone().arrayBuffer());
  const csv = await r.text();
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); // BOM para que Excel lea bien los acentos
  assert.ok(csv.startsWith("\"fecha_pedido\""));
  assert.ok(csv.includes("ana@mail.com"));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://malo"")"`));
});
await t("gastos: listar y borrar", async () => {
  const l = await (await adm(A.gastos.onRequestGet, { ruta: "/api/admin/gastos" })).json();
  assert.equal(l.items.length, 1);
  assert.equal((await adm(A.gastos.onRequestDelete, { metodo: "DELETE", ruta: `/api/admin/gastos?id=${l.items[0].id}` })).status, 200);
  assert.equal((await (await adm(A.gastos.onRequestGet, { ruta: "/api/admin/gastos" })).json()).items.length, 0);
});

console.log("\nPanel: acciones");
await t("reenviar: manda otro mail con otra clave de idempotencia", async () => {
  const antes = mock.resend.length;
  const r = await adm(A.reenviar, { metodo: "POST", body: { id: ordenA } });
  assert.equal(r.status, 200);
  assert.equal(mock.resend.length, antes + 1);
  assert.equal(mock.resend.at(-1).idem, `entrega-${ordenA}-r2`);
  const o = await orden(ordenA);
  assert.equal(o.mail_count, 2);
  assert.equal(o.status, "delivered");
});
await t("reenviar: no deja reenviar órdenes reembolsadas ni sin pago", async () => {
  const reem = (await DB.prepare("SELECT id FROM orders WHERE status = 'refunded'").first()).id;
  assert.equal((await adm(A.reenviar, { metodo: "POST", body: { id: reem } })).status, 502);
  const pend = (await DB.prepare("SELECT id FROM orders WHERE paid_at IS NULL LIMIT 1").first()).id;
  assert.equal((await adm(A.reenviar, { metodo: "POST", body: { id: pend } })).status, 502);
});
await t("reenviar con falla de mail: la orden entregada sigue entregada", async () => {
  mock.resendFalla = true;
  const r = await adm(A.reenviar, { metodo: "POST", body: { id: ordenA } });
  mock.resendFalla = false;
  assert.equal(r.status, 502);
  assert.equal((await orden(ordenA)).status, "delivered");
});
await t("sincronizar: encuentra el pago por referencia aunque el aviso nunca llegó", async () => {
  const id = await crearOrden("sync@mail.com", "12.12.12.12");
  pagoMP("1012", id);
  mock.busqueda = [mock.pagos["1012"]];
  const r = await adm(A.sincronizar, { metodo: "POST", body: { id } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "delivered");
  const sinPago = await crearOrden("nopago@mail.com", "13.13.13.13");
  mock.busqueda = [];
  assert.equal((await adm(A.sincronizar, { metodo: "POST", body: { id: sinPago } })).status, 502);
});
await t("config: informa qué está configurado, sin mostrar secretos", async () => {
  const txt = await (await adm(A.config, { ruta: "/api/admin/config" })).text();
  const d = JSON.parse(txt);
  assert.equal(d.base_de_datos, true);
  assert.equal(d.archivos.libro.ok, true);
  assert.equal(d.variables.MP_ACCESS_TOKEN, true);
  assert.equal(d.mp_modo, "produccion");
  assert.equal(d.webhook_url, SITE + "/api/webhook");
  for (const secreto of [env.MP_ACCESS_TOKEN, env.MP_WEBHOOK_SECRET, env.RESEND_API_KEY, env.DOWNLOAD_SIGNING_KEY]) assert.ok(!txt.includes(secreto));
});
await t("mail de prueba: llega al admin con los dos PDFs en base64", async () => {
  const r = await adm(A.probar, { metodo: "POST", body: {} });
  assert.equal(r.status, 200);
  const m = mock.resend.at(-1).cuerpo;
  assert.deepEqual(m.to, ["yo@mail.com"]);
  assert.equal(m.attachments.length, 2);
  assert.equal(Buffer.from(m.attachments[0].content, "base64").toString().startsWith("%PDF"), true);
});

console.log(`\n${process.exitCode ? "HAY FALLAS" : "Todo bien"}: ${ok} pruebas pasaron.\n`);
