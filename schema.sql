-- Base de datos D1 de Hilo Nuestro. Se ejecuta UNA vez:
--   npx wrangler d1 execute hilo-nuestro --remote --file=schema.sql
-- Estados de una orden (columna status):
--   pending          creada, todavía sin pago aprobado
--   approved         pago aprobado, entrega en curso
--   delivering       enviando el mail ahora mismo
--   delivered        mail enviado con los libros
--   delivery_failed  pago aprobado pero el mail falló (se reintenta solo / desde el panel)
--   rejected         pago rechazado
--   cancelled        no se pudo iniciar el pago
--   refunded         reembolsada o con contracargo
--   revisar          el monto del pago no coincide con el precio: NO se entregó, revisala a mano

CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL,
  amount           INTEGER NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'ARS',
  status           TEXT NOT NULL DEFAULT 'pending',
  mp_preference_id TEXT,
  mp_payment_id    TEXT,
  mp_status        TEXT,
  mp_status_detail TEXT,
  payment_method   TEXT,
  created_at       TEXT NOT NULL,
  paid_at          TEXT,
  delivering_at    TEXT,
  delivered_at     TEXT,
  email_id         TEXT,
  mail_count       INTEGER NOT NULL DEFAULT 0,
  downloads        INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  ip_hash          TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_paid    ON orders(paid_at);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_email   ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_ip      ON orders(ip_hash, created_at);

CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,
  order_id TEXT,
  type     TEXT NOT NULL,
  detail   TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_order ON events(order_id);

CREATE TABLE IF NOT EXISTS gastos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha      TEXT NOT NULL,
  concepto   TEXT NOT NULL,
  categoria  TEXT NOT NULL DEFAULT 'otros',
  monto      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha);
