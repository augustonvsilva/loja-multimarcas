// Camada de banco de dados.
// - Producao: Postgres real via DATABASE_URL (Neon, Render Postgres, Supabase...).
// - Desenvolvimento/testes: PGlite (Postgres embutido) gravando em ./data/pglite
//   ou em memoria quando DB_MEMORY=1.
const path = require("path");
const { seedProducts, seedBrands, seedCategories } = require("./seed");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS brands (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  has_sizes BOOLEAN NOT NULL DEFAULT FALSE,
  has_numbers BOOLEAN NOT NULL DEFAULT FALSE,
  sizes JSONB NOT NULL DEFAULT '[]',
  numbers JSONB NOT NULL DEFAULT '[]',
  images JSONB NOT NULL DEFAULT '[]',
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS orders_id_seq START 1001;

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY DEFAULT nextval('orders_id_seq'),
  access_token TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  items JSONB NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  shipping_method TEXT NOT NULL,
  shipping_label TEXT NOT NULL,
  delivery_address JSONB,
  payment_id TEXT,
  payment_method TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  stock_applied BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_customer_email_idx ON orders (lower(customer_email));
CREATE INDEX IF NOT EXISTS orders_payment_id_idx ON orders (payment_id);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let backend = null;

async function createPostgresBackend(connectionString) {
  const { Pool } = require("pg");
  const needsSsl = !/localhost|127\.0\.0\.1/.test(connectionString) && !/sslmode=disable/.test(connectionString);
  const pool = new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.DB_POOL_SIZE || 5)
  });

  return {
    kind: "postgres",
    query: (sql, params) => pool.query(sql, params),
    exec: (sql) => pool.query(sql),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn((sql, params) => client.query(sql, params));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
}

async function createPgliteBackend(dataDir) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;

  return {
    kind: dataDir ? "pglite" : "memory",
    query: (sql, params) => db.query(sql, params),
    exec: (sql) => db.exec(sql),
    transaction: (fn) => db.transaction((tx) => fn((sql, params) => tx.query(sql, params))),
    close: () => db.close()
  };
}

async function seedIfEmpty(db) {
  const { rows } = await db.query("SELECT COUNT(*)::int AS total FROM products");
  if (rows[0].total > 0 || process.env.DB_SKIP_SEED === "1") {
    return;
  }

  for (const name of seedBrands) {
    await db.query("INSERT INTO brands (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
  }
  for (const name of seedCategories) {
    await db.query("INSERT INTO categories (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
  }
  for (const product of seedProducts()) {
    await db.query(
      `INSERT INTO products (brand, category, name, description, price_cents, cost_cents, stock, has_sizes, has_numbers, sizes, numbers, images, featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        product.brand, product.category, product.name, product.description,
        product.priceCents, product.costCents, product.stock,
        product.hasSizes, product.hasNumbers,
        JSON.stringify(product.sizes), JSON.stringify(product.numbers), JSON.stringify(product.images),
        product.featured
      ]
    );
  }
}

async function initDb() {
  if (backend) {
    return backend;
  }

  if (process.env.DATABASE_URL) {
    backend = await createPostgresBackend(process.env.DATABASE_URL);
  } else if (process.env.DB_MEMORY === "1") {
    backend = await createPgliteBackend(null);
  } else {
    const dir = process.env.DB_DIR || path.resolve(__dirname, "..", "data", "pglite");
    backend = await createPgliteBackend(dir);
  }

  await backend.exec(SCHEMA);
  await seedIfEmpty(backend);
  return backend;
}

function getDb() {
  if (!backend) {
    throw new Error("Banco de dados não inicializado.");
  }
  return backend;
}

async function closeDb() {
  if (backend) {
    const current = backend;
    backend = null;
    await current.close();
  }
}

module.exports = { initDb, getDb, closeDb };
