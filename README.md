# Hilo Nuestro · Tienda

Tienda de libros digitales sobre **Cloudflare Pages** (sitio + funciones), **D1** (pedidos), **R2** (PDFs privados), **Mercado Pago** (cobro) y **Resend** (mail con los libros). Incluye panel de administración protegido con **Cloudflare Access**.

Costo fijo: solo el dominio. Cloudflare, Resend y Access tienen plan gratuito suficiente para arrancar; Mercado Pago cobra comisión por venta.

```
public/            sitio estático: landing, /gracias, /admin
functions/api/     checkout, webhook, estado, descarga
functions/api/admin/   API del panel (protegida)
functions/_lib/    código compartido
schema.sql         tablas D1
wrangler.toml      configuración y variables no secretas
tests/run.mjs      pruebas (node --no-warnings tests/run.mjs)
```

## Cómo funciona una compra

1. La compradora escribe su mail en la landing → `/api/checkout` crea el pedido y una preferencia de Mercado Pago (el precio lo fija el servidor, no el navegador).
2. Paga en Mercado Pago y vuelve a `/gracias`, que muestra el agradecimiento y **el mail que escribió**.
3. Mercado Pago avisa a `/api/webhook`. Se valida la firma, se consulta el pago directo a la API de MP y, si está aprobado y el monto coincide, se envía el mail con los dos PDF adjuntos (una sola vez, aunque el aviso llegue repetido).
4. Si el aviso se demora, `/gracias` confirma el pago por su cuenta. Si el mail falla, queda marcado "Falló el mail" en el panel y se reenvía con un botón.

## Puesta en marcha (paso a paso)

Requisitos: Node 18+, cuenta de Cloudflare, de Mercado Pago y de Resend.

### 1. Repositorio
Subí esta carpeta a un repo **privado** de GitHub. Los PDF no van al repo (`.gitignore` los excluye).

### 2. Base de datos D1
```bash
npm install
npx wrangler d1 create hilo-nuestro
```
Copiá el `database_id` que devuelve a `wrangler.toml` (`[[d1_databases]]`). Después:
```bash
npm run db:remote
```

### 3. Bucket R2 con los libros
```bash
npx wrangler r2 bucket create hilo-libros
npx wrangler r2 object put hilo-libros/Mucho-gusto-mama.pdf --file ./Mucho-gusto-mama_Libro-completo.pdf
npx wrangler r2 object put hilo-libros/Nuestra-Navidad.pdf --file ./Nuestra-Navidad_Regalo-de-lanzamiento.pdf
```
(Si usás otros nombres, cambialos en `FILE_LIBRO` y `FILE_NAVIDAD`.) R2 puede pedir cargar una tarjeta aunque no cobre dentro del plan gratuito.

### 4. Proyecto en Cloudflare Pages
Workers & Pages → Create → Pages → conectar el repo. Framework: ninguno. Build command: vacío. Output directory: `public`.
En Settings → Bindings confirmá `DB` (D1 `hilo-nuestro`) y `FILES` (R2 `hilo-libros`), o dejá que `wrangler.toml` los declare.
Agregá tu dominio en Custom domains.

### 5. Variables
En `wrangler.toml` (sección `[vars]`, no secretas) completá lo que dice `COMPLETAR`. Los **secretos** se cargan así (te pide el valor):
```bash
npx wrangler pages secret put MP_ACCESS_TOKEN --project-name <tu-proyecto>
npx wrangler pages secret put MP_WEBHOOK_SECRET --project-name <tu-proyecto>
npx wrangler pages secret put RESEND_API_KEY --project-name <tu-proyecto>
npx wrangler pages secret put DOWNLOAD_SIGNING_KEY --project-name <tu-proyecto>
```
`DOWNLOAD_SIGNING_KEY`: inventá una clave larga y aleatoria (`openssl rand -hex 32`).

| Variable | Tipo | Qué es |
|---|---|---|
| `SITE_URL` | var | Tu dominio con https, sin barra final |
| `PRICE_ARS` | var | Precio de venta (19999) |
| `PRODUCT_NAME` | var | Nombre que ve la compradora en Mercado Pago |
| `FROM_EMAIL` | var | Remitente, de un dominio verificado en Resend. Ej.: `Hilo Nuestro <hola@tudominio.com.ar>` |
| `REPLY_TO` | var | Mail donde te responden |
| `ADMIN_EMAILS` | var | Mails autorizados al panel (separados por coma) |
| `CF_ACCESS_TEAM_DOMAIN` | var | `tuequipo.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | var | AUD de la aplicación de Access |
| `MP_FEE_PCT` | var | Comisión estimada de MP (6.29 si cobrás al instante) |
| `DOWNLOAD_DAYS`, `MAX_DOWNLOADS` | var | Vigencia y cantidad de descargas del link de respaldo |
| `MAIL_ATTACH_MODE` | var | `path` (recomendado) o `inline` |
| `MP_WEBHOOK_ESTRICTO` | var | `1` siempre; `0` solo para diagnosticar |
| `MP_ACCESS_TOKEN` | **secreto** | Credencial de Mercado Pago (`TEST-…` para pruebas) |
| `MP_WEBHOOK_SECRET` | **secreto** | Clave secreta del webhook de MP |
| `RESEND_API_KEY` | **secreto** | API key de Resend |
| `DOWNLOAD_SIGNING_KEY` | **secreto** | Firma de los links de descarga |

### 6. Resend (mails)
Resend → Domains → agregá tu dominio y cargá los registros DNS que te indica (SPF/DKIM). Esperá a que figure "Verified". Después creá la API key.

### 7. Mercado Pago
1. Tus integraciones → Crear aplicación → Checkout Pro.
2. Credenciales de prueba primero (`TEST-…`) → `MP_ACCESS_TOKEN`.
3. Webhooks → modo prueba: URL `https://TU-DOMINIO/api/webhook`, evento **Pagos**. Copiá la clave secreta a `MP_WEBHOOK_SECRET`. (En el panel → Ajustes ves esa URL lista para copiar.)
4. Cuando todo ande, repetí con las credenciales de producción.

### 8. Cloudflare Access (protege el panel)
Zero Trust → Access → Applications → Add → Self-hosted. Dominio: tu sitio, paths `admin` y `api/admin` (agregá dos destinos). Política: Allow → Emails → tu mail. Copiá el **Application Audience (AUD)** a `CF_ACCESS_AUD` y tu team domain a `CF_ACCESS_TEAM_DOMAIN`.
Si esas dos variables faltan, el panel queda **bloqueado** a propósito (nunca abierto).

### 9. Deploy y prueba
```bash
npm test          # pruebas locales con simulaciones
npm run deploy
```
Entrá a `/admin` → Ajustes: todo debería estar en ✓. Tocá **Enviar mail de prueba**.

## Antes de vender: probá de punta a punta
Estas piezas están probadas con simulaciones, no contra tus cuentas reales. Tenés que verificar:
1. Compra con credenciales de **prueba** y usuarios de prueba de MP: que llegue el mail con los dos PDF y que `/gracias` muestre tu mail.
2. Que el webhook llegue (panel → Ventas → detalle → historial). Si MP rechaza la firma, el panel lo muestra como evento `firma_invalida`; en ese caso revisá `MP_WEBHOOK_SECRET` y, solo para diagnosticar, poné `MP_WEBHOOK_ESTRICTO=0` y volvé a `1`.
3. Una compra real chica con producción y su reembolso desde Mercado Pago (el panel lo refleja como "Reembolsada").
4. Que el mail no caiga en spam (mirá con una cuenta de Gmail y otra de Hotmail).

## Seguridad (resumen)
- Precio fijado en el servidor; el navegador no puede cambiarlo.
- Webhook con firma obligatoria + verificación del pago contra la API de MP + control de monto.
- Entrega idempotente: un pago = un envío, aunque lleguen avisos duplicados.
- PDF en bucket privado; los links de descarga están firmados y vencen.
- Panel detrás de Cloudflare Access con verificación del token en el servidor y protección CSRF.
- Sin claves en el repo: secretos solo en Cloudflare; `.dev.vars` está ignorado.

## Pendientes tuyos
- Completar `CONTACTO_EMAIL` en `public/index.html` y `public/gracias.html`.
- Páginas legales (términos, privacidad, arrepentimiento): los links del pie son provisorios.
- Facturación (ARCA) y titularidad de la cuenta de Mercado Pago / monotributo: consultalo con tu contador. El panel registra ventas pero **no emite facturas**.
- Pixel de Meta: la landing ya dispara eventos si instalás el pixel (`window.fbq`); el código base del pixel lo pegás vos en el `<head>`.

## Desarrollo local
```bash
cp .dev.vars.example .dev.vars   # completá valores de prueba
npm run db:local
npm run dev
```
En local, `DEV_ADMIN_EMAIL` habilita el panel sin Access (solo desde localhost).
`/admin?demo=1` muestra el panel con datos de ejemplo, sin backend.
