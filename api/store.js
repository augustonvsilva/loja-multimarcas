// Regras de negocio e acesso ao banco: produtos, marcas, clientes, pedidos e despesas.
const crypto = require("crypto");
const { getDb } = require("./db");
const { HttpError } = require("./http");

const SIZE_OPTIONS = ["PP", "P", "M", "G", "GG", "XG", "XGG"];
const NUMBER_OPTIONS = ["33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"];
const FULFILLMENT_STATUSES = ["paid", "preparing", "shipped", "delivered", "cancelled", "refunded"];
const MAX_CART_ITEMS = 30;
const MAX_QTY_PER_ITEM = 10;

const toCents = (value) => Math.round(Number(value) * 100);
const fromCents = (cents) => Number((Number(cents || 0) / 100).toFixed(2));
const iso = (value) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

function cleanText(value, max) {
  return String(value === null || typeof value === "undefined" ? "" : value).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function cleanList(list, allowed) {
  const values = (Array.isArray(list) ? list : []).map((item) => cleanText(item, 10)).filter(Boolean);
  return values.filter((item, index) => values.indexOf(item) === index && (!allowed || allowed.includes(item)));
}

// ---------- Produtos ----------

function mapProduct(row, includePrivate) {
  const images = Array.isArray(row.images) ? row.images : [];
  const product = {
    id: row.id,
    brand: row.brand,
    category: row.category,
    name: row.name,
    description: row.description,
    price: fromCents(row.price_cents),
    stock: row.stock,
    hasSizes: row.has_sizes,
    hasNumbers: row.has_numbers,
    sizes: row.sizes || [],
    numbers: row.numbers || [],
    images,
    image: images[0] || "",
    featured: row.featured
  };
  if (includePrivate) {
    product.cost = fromCents(row.cost_cents);
    product.active = row.active;
    product.updatedAt = iso(row.updated_at);
  }
  return product;
}

async function listProducts({ includeInactive, includePrivate } = {}) {
  const { rows } = await getDb().query(
    "SELECT * FROM products " + (includeInactive ? "" : "WHERE active ") + "ORDER BY featured DESC, name ASC"
  );
  return rows.map((row) => mapProduct(row, includePrivate));
}

async function getProduct(id, { includeInactive, includePrivate } = {}) {
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) return null;
  const { rows } = await getDb().query(
    "SELECT * FROM products WHERE id = $1" + (includeInactive ? "" : " AND active"),
    [productId]
  );
  return rows[0] ? mapProduct(rows[0], includePrivate) : null;
}

function validateProductInput(input) {
  const brand = cleanText(input.brand, 60);
  const category = cleanText(input.category, 60);
  const name = cleanText(input.name, 120);
  const description = cleanText(input.description, 2000);
  const price = Number(input.price);
  const cost = Number(input.cost || 0);
  const stock = Number(input.stock);
  const hasSizes = Boolean(input.hasSizes);
  const hasNumbers = Boolean(input.hasNumbers);
  const sizes = hasSizes ? cleanList(input.sizes, SIZE_OPTIONS) : [];
  const numbers = hasNumbers ? cleanList(input.numbers, NUMBER_OPTIONS) : [];
  const images = (Array.isArray(input.images) ? input.images : [])
    .map((url) => String(url || "").trim())
    .filter((url) => /^\/api\/images\/[a-f0-9-]{36}$/.test(url) || /^https:\/\/[^\s"'<>]+$/.test(url) || /^data:image\/svg\+xml[^"'<>]*$/.test(url))
    .slice(0, 8);

  const errors = [];
  if (!brand) errors.push("marca");
  if (!category) errors.push("categoria");
  if (!name) errors.push("nome");
  if (!Number.isFinite(price) || price <= 0) errors.push("preço");
  if (!Number.isFinite(cost) || cost < 0) errors.push("custo");
  if (!Number.isInteger(stock) || stock < 0) errors.push("estoque");
  if (hasSizes && !sizes.length) errors.push("tamanhos");
  if (hasNumbers && !numbers.length) errors.push("numerações");
  if (errors.length) {
    throw new HttpError(400, "Verifique os campos: " + errors.join(", ") + ".");
  }

  return {
    brand, category, name, description,
    priceCents: toCents(price),
    costCents: toCents(cost),
    stock, hasSizes, hasNumbers, sizes, numbers, images,
    featured: Boolean(input.featured),
    active: typeof input.active === "boolean" ? input.active : true
  };
}

async function ensureTaxonomy(query, brand, category) {
  await query("INSERT INTO brands (name) VALUES ($1) ON CONFLICT DO NOTHING", [brand]);
  await query("INSERT INTO categories (name) VALUES ($1) ON CONFLICT DO NOTHING", [category]);
}

async function createProduct(input) {
  const p = validateProductInput(input);
  return getDb().transaction(async (query) => {
    await ensureTaxonomy(query, p.brand, p.category);
    const { rows } = await query(
      `INSERT INTO products (brand, category, name, description, price_cents, cost_cents, stock, has_sizes, has_numbers, sizes, numbers, images, featured, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [p.brand, p.category, p.name, p.description, p.priceCents, p.costCents, p.stock, p.hasSizes, p.hasNumbers,
        JSON.stringify(p.sizes), JSON.stringify(p.numbers), JSON.stringify(p.images), p.featured, p.active]
    );
    return mapProduct(rows[0], true);
  });
}

async function updateProduct(id, input) {
  const p = validateProductInput(input);
  return getDb().transaction(async (query) => {
    await ensureTaxonomy(query, p.brand, p.category);
    const { rows } = await query(
      `UPDATE products SET brand=$1, category=$2, name=$3, description=$4, price_cents=$5, cost_cents=$6, stock=$7,
         has_sizes=$8, has_numbers=$9, sizes=$10, numbers=$11, images=$12, featured=$13, active=$14, updated_at=NOW()
       WHERE id=$15 RETURNING *`,
      [p.brand, p.category, p.name, p.description, p.priceCents, p.costCents, p.stock, p.hasSizes, p.hasNumbers,
        JSON.stringify(p.sizes), JSON.stringify(p.numbers), JSON.stringify(p.images), p.featured, p.active, Number(id)]
    );
    if (!rows[0]) throw new HttpError(404, "Produto não encontrado.");
    return mapProduct(rows[0], true);
  });
}

async function deleteProduct(id) {
  const { rows } = await getDb().query("DELETE FROM products WHERE id = $1 RETURNING id", [Number(id)]);
  if (!rows[0]) throw new HttpError(404, "Produto não encontrado.");
}

async function getTaxonomy() {
  const db = getDb();
  const [brands, categories] = await Promise.all([
    db.query("SELECT name FROM brands ORDER BY name"),
    db.query("SELECT name FROM categories ORDER BY name")
  ]);
  return { brands: brands.rows.map((r) => r.name), categories: categories.rows.map((r) => r.name) };
}

async function addTaxonomy(kind, name) {
  const value = cleanText(name, 60);
  if (!value) throw new HttpError(400, "Informe o nome.");
  const table = kind === "brand" ? "brands" : "categories";
  await getDb().query("INSERT INTO " + table + " (name) VALUES ($1) ON CONFLICT DO NOTHING", [value]);
  return value;
}

// ---------- Imagens ----------

const IMAGE_TYPES = { "image/jpeg": true, "image/png": true, "image/webp": true };

async function saveImage(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match || !IMAGE_TYPES[match[1]]) {
    throw new HttpError(400, "Envie uma imagem JPG, PNG ou WEBP.");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 3 * 1024 * 1024) {
    throw new HttpError(413, "Imagem muito grande (máximo 3 MB).");
  }
  const id = crypto.randomUUID();
  await getDb().query("INSERT INTO images (id, content_type, data) VALUES ($1, $2, $3)", [id, match[1], buffer]);
  return "/api/images/" + id;
}

async function getImage(id) {
  if (!/^[a-f0-9-]{36}$/.test(String(id))) return null;
  const { rows } = await getDb().query("SELECT content_type, data FROM images WHERE id = $1", [id]);
  if (!rows[0]) return null;
  return { contentType: rows[0].content_type, data: Buffer.from(rows[0].data) };
}

// ---------- Clientes ----------

function normalizeEmail(value) {
  return cleanText(value, 160).toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

async function createCustomer({ name, email, passwordHash }) {
  try {
    const { rows } = await getDb().query(
      "INSERT INTO customers (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email",
      [name, email, passwordHash]
    );
    return rows[0];
  } catch (error) {
    if (String(error.code) === "23505" || /unique|duplicate/i.test(error.message)) {
      throw new HttpError(409, "Este email já está cadastrado.");
    }
    throw error;
  }
}

async function findCustomerByEmail(email) {
  const { rows } = await getDb().query("SELECT * FROM customers WHERE email = $1", [email]);
  return rows[0] || null;
}

async function findCustomerById(id) {
  const { rows } = await getDb().query("SELECT * FROM customers WHERE id = $1", [Number(id)]);
  return rows[0] || null;
}

async function updateCustomerPassword(id, passwordHash) {
  await getDb().query("UPDATE customers SET password_hash = $1 WHERE id = $2", [passwordHash, Number(id)]);
}

// ---------- Carrinho / Pedidos ----------

// Recalcula o carrinho a partir do banco. Precos e estoque do navegador sao ignorados.
async function priceCart(cartItems) {
  const items = Array.isArray(cartItems) ? cartItems.slice(0, MAX_CART_ITEMS) : [];
  if (!items.length) throw new HttpError(400, "O carrinho está vazio.");

  const ids = [...new Set(items.map((item) => Number(item.productId)).filter((id) => Number.isInteger(id) && id > 0))];
  const { rows } = await getDb().query("SELECT * FROM products WHERE active AND id = ANY($1::int[])", [ids]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const demand = new Map();

  const lines = items.map((item) => {
    const row = byId.get(Number(item.productId));
    if (!row) throw new HttpError(409, "Um produto do carrinho não está mais disponível.");
    const quantity = Math.floor(Number(item.quantity));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_ITEM) {
      throw new HttpError(400, "Quantidade inválida para " + row.name + ".");
    }
    const size = cleanText(item.size, 10);
    const number = cleanText(item.number, 10);
    if (row.has_sizes && !(row.sizes || []).includes(size)) {
      throw new HttpError(400, "Escolha um tamanho válido para " + row.name + ".");
    }
    if (row.has_numbers && !(row.numbers || []).includes(number)) {
      throw new HttpError(400, "Escolha uma numeração válida para " + row.name + ".");
    }
    demand.set(row.id, (demand.get(row.id) || 0) + quantity);
    return {
      productId: row.id,
      name: row.name,
      brand: row.brand,
      size: row.has_sizes ? size : "",
      number: row.has_numbers ? number : "",
      quantity,
      unitPriceCents: row.price_cents,
      subtotalCents: row.price_cents * quantity
    };
  });

  for (const [productId, quantity] of demand) {
    const row = byId.get(productId);
    if (row.stock < quantity) {
      throw new HttpError(409, "Estoque insuficiente para " + row.name + " (disponível: " + row.stock + ").");
    }
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  return { lines, subtotalCents, itemCount };
}

function mapOrder(row, { includePrivate } = {}) {
  const order = {
    id: row.id,
    status: row.status,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    items: (row.items || []).map((item) => ({
      productId: item.productId,
      name: item.name,
      brand: item.brand,
      size: item.size,
      number: item.number,
      quantity: item.quantity,
      price: fromCents(item.unitPriceCents),
      subtotal: fromCents(item.subtotalCents)
    })),
    subtotal: fromCents(row.subtotal_cents),
    shipping: fromCents(row.shipping_cents),
    total: fromCents(row.total_cents),
    shippingMethod: row.shipping_method,
    shippingLabel: row.shipping_label,
    deliveryAddress: row.delivery_address,
    paymentMethod: row.payment_method,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
  if (includePrivate) {
    order.paymentId = row.payment_id;
    order.paymentStatus = row.payment_status;
    order.notes = row.notes;
  }
  return order;
}

async function createOrder(data) {
  const accessToken = crypto.randomBytes(24).toString("base64url");
  const { rows } = await getDb().query(
    `INSERT INTO orders (access_token, customer_id, customer_name, customer_email, customer_phone, items,
       subtotal_cents, shipping_cents, total_cents, shipping_method, shipping_label, delivery_address, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending') RETURNING *`,
    [accessToken, data.customerId || null, data.customerName, data.customerEmail, data.customerPhone || "",
      JSON.stringify(data.lines), data.subtotalCents, data.shippingCents, data.totalCents,
      data.shippingMethod, data.shippingLabel, data.deliveryAddress ? JSON.stringify(data.deliveryAddress) : null]
  );
  return rows[0];
}

async function getOrderRow(id) {
  const { rows } = await getDb().query("SELECT * FROM orders WHERE id = $1", [Number(id)]);
  return rows[0] || null;
}

async function getOrderForCustomer(id, accessToken) {
  const row = await getOrderRow(id);
  if (!row || !accessToken || !crypto.timingSafeEqual(
    crypto.createHash("sha256").update(String(row.access_token)).digest(),
    crypto.createHash("sha256").update(String(accessToken)).digest()
  )) {
    return null;
  }
  return row;
}

function paymentMethodLabel(paymentTypeId) {
  if (paymentTypeId === "bank_transfer") return "pix";
  if (paymentTypeId === "debit_card") return "debito";
  if (paymentTypeId === "credit_card") return "credito";
  return paymentTypeId || "mercado-pago";
}

// Aplica o status do Mercado Pago ao pedido, baixando ou devolvendo estoque de forma atomica.
async function applyPaymentStatus(orderId, payment) {
  return getDb().transaction(async (query) => {
    const { rows } = await query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [Number(orderId)]);
    const order = rows[0];
    if (!order) return null;

    const mpStatus = String(payment.status || "");
    let status = order.status;
    if (mpStatus === "approved" && (order.status === "pending" || order.status === "rejected")) {
      status = "paid";
    } else if (mpStatus === "refunded" || mpStatus === "charged_back") {
      status = "refunded";
    } else if ((mpStatus === "rejected" || mpStatus === "cancelled") && order.status === "pending") {
      status = mpStatus === "rejected" ? "rejected" : "cancelled";
    }

    let stockApplied = order.stock_applied;
    if (status === "paid" && !stockApplied) {
      for (const item of order.items) {
        await query("UPDATE products SET stock = GREATEST(stock - $1, 0), updated_at = NOW() WHERE id = $2", [item.quantity, item.productId]);
      }
      stockApplied = true;
    } else if ((status === "refunded" || status === "cancelled") && stockApplied) {
      for (const item of order.items) {
        await query("UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2", [item.quantity, item.productId]);
      }
      stockApplied = false;
    }

    const updated = await query(
      `UPDATE orders SET status=$1, stock_applied=$2, payment_id=COALESCE($3, payment_id), payment_status=$4,
         payment_method=COALESCE(NULLIF($5, ''), payment_method), updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [status, stockApplied, payment.id ? String(payment.id) : null, mpStatus, paymentMethodLabel(payment.payment_type_id), order.id]
    );
    return { ...updated.rows[0], just_paid: status === "paid" && order.status !== "paid" };
  });
}

async function setOrderStatus(id, status, notes) {
  if (!FULFILLMENT_STATUSES.includes(status)) {
    throw new HttpError(400, "Status inválido.");
  }
  return getDb().transaction(async (query) => {
    const { rows } = await query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [Number(id)]);
    const order = rows[0];
    if (!order) throw new HttpError(404, "Pedido não encontrado.");
    if (order.status === "pending" || order.status === "rejected") {
      if (status !== "cancelled") throw new HttpError(409, "Este pedido ainda não foi pago.");
    }

    let stockApplied = order.stock_applied;
    const returning = status === "cancelled" || status === "refunded";
    if (returning && stockApplied) {
      for (const item of order.items) {
        await query("UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2", [item.quantity, item.productId]);
      }
      stockApplied = false;
    } else if (!returning && !stockApplied) {
      for (const item of order.items) {
        await query("UPDATE products SET stock = GREATEST(stock - $1, 0), updated_at = NOW() WHERE id = $2", [item.quantity, item.productId]);
      }
      stockApplied = true;
    }

    const updated = await query(
      "UPDATE orders SET status=$1, stock_applied=$2, notes=COALESCE($3, notes), updated_at=NOW() WHERE id=$4 RETURNING *",
      [status, stockApplied, typeof notes === "string" ? cleanText(notes, 1000) : null, order.id]
    );
    return mapOrder(updated.rows[0], { includePrivate: true });
  });
}

async function listOrders({ email } = {}) {
  const { rows } = email
    ? await getDb().query("SELECT * FROM orders WHERE lower(customer_email) = $1 AND status <> 'pending' AND status <> 'rejected' ORDER BY created_at DESC LIMIT 100", [email])
    : await getDb().query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 500");
  return rows.map((row) => mapOrder(row, { includePrivate: !email }));
}

async function setOrderPayment(id, paymentId) {
  await getDb().query("UPDATE orders SET payment_id = $1, updated_at = NOW() WHERE id = $2", [String(paymentId), Number(id)]);
}

// ---------- Despesas ----------

function mapExpense(row) {
  return { id: row.id, description: row.description, category: row.category, amount: fromCents(row.amount_cents), createdAt: iso(row.created_at) };
}

async function listExpenses() {
  const { rows } = await getDb().query("SELECT * FROM expenses ORDER BY created_at DESC LIMIT 500");
  return rows.map(mapExpense);
}

async function addExpense(input) {
  const description = cleanText(input.description, 200);
  const category = cleanText(input.category, 60);
  const amount = Number(input.amount);
  if (!description || !category || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, "Preencha descrição, categoria e valor maior que zero.");
  }
  const { rows } = await getDb().query(
    "INSERT INTO expenses (description, category, amount_cents) VALUES ($1, $2, $3) RETURNING *",
    [description, category, toCents(amount)]
  );
  return mapExpense(rows[0]);
}

async function deleteExpense(id) {
  await getDb().query("DELETE FROM expenses WHERE id = $1", [Number(id)]);
}

module.exports = {
  fromCents,
  cleanText,
  normalizeEmail,
  isValidEmail,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getTaxonomy,
  addTaxonomy,
  saveImage,
  getImage,
  createCustomer,
  findCustomerByEmail,
  findCustomerById,
  updateCustomerPassword,
  priceCart,
  mapOrder,
  createOrder,
  getOrderRow,
  getOrderForCustomer,
  applyPaymentStatus,
  setOrderStatus,
  setOrderPayment,
  listOrders,
  listExpenses,
  addExpense,
  deleteExpense
};
