// Rotas da API REST da loja.
const { HttpError, readBody, sendJson, getClientIp, createRateLimiter } = require("./http");
const auth = require("./auth");
const store = require("./store");
const payments = require("./payments");
const { quoteShipping, normalizeCep } = require("./shipping");
const { getDb } = require("./db");
const email = require("./email");

const SITE_URL = (process.env.SITE_URL || "https://augustonvsilva.github.io/loja-multimarcas").replace(/\/$/, "");

// Dispara emails quando o pedido acabou de ser pago (sem travar a resposta).
function afterPaymentUpdate(row) {
  if (row && row.just_paid) {
    email.notifyOrderPaid(row).catch((error) => console.error("[email] pedido", error.message));
  }
  return row;
}

const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
const checkoutLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
const shippingLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60 });

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, key) => {
    keys.push(key);
    return "([^/]+)";
  }) + "/?$");
  routes.push({ method, regex, keys, handler });
}

function toOptionPayload(optionItem) {
  return {
    method: optionItem.method,
    label: optionItem.label,
    amount: store.fromCents(optionItem.amountCents),
    deadline: optionItem.deadline,
    description: optionItem.description,
    source: optionItem.source
  };
}

// ---------- Saude ----------

route("GET", "/api/health", async (req, res) => {
  await getDb().query("SELECT 1");
  sendJson(res, 200, {
    ok: true,
    database: getDb().kind,
    payments: payments.hasMercadoPagoCredentials() ? (payments.isTestMode() ? "test" : "live") : "not-configured",
    admin: auth.hasAdminCredentials(),
    email: email.isEmailConfigured()
  });
});

// ---------- Catalogo ----------

route("GET", "/api/products", async (req, res) => {
  sendJson(res, 200, { ok: true, products: await store.listProducts() });
});

route("GET", "/api/products/:id", async (req, res, params) => {
  const product = await store.getProduct(params.id);
  if (!product) throw new HttpError(404, "Produto não encontrado.");
  sendJson(res, 200, { ok: true, product });
});

route("GET", "/api/taxonomy", async (req, res) => {
  sendJson(res, 200, { ok: true, ...(await store.getTaxonomy()) });
});

route("GET", "/api/images/:id", async (req, res, params) => {
  const image = await store.getImage(params.id);
  if (!image) throw new HttpError(404, "Imagem não encontrada.");
  res.writeHead(200, {
    "Content-Type": image.contentType,
    "Content-Length": image.data.length,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Cross-Origin-Resource-Policy": "cross-origin"
  });
  res.end(image.data);
});

// ---------- Frete ----------

route("POST", "/api/shipping/quote", async (req, res) => {
  shippingLimiter(getClientIp(req));
  const body = await readBody(req);
  let subtotalCents = Math.round(Number(body.subtotal || 0) * 100);
  let itemCount = Number(body.itemCount || 1);
  if (Array.isArray(body.cart) && body.cart.length) {
    const priced = await store.priceCart(body.cart).catch(() => null);
    if (priced) {
      subtotalCents = priced.subtotalCents;
      itemCount = priced.itemCount;
    }
  }
  const options = await quoteShipping({ cep: body.cep, subtotalCents, itemCount });
  if (!options) throw new HttpError(400, "CEP inválido. Digite os 8 números.");
  sendJson(res, 200, { ok: true, cep: normalizeCep(body.cep), options: options.map(toOptionPayload) });
});

// ---------- Autenticacao ----------

route("POST", "/api/auth/register", async (req, res) => {
  loginLimiter("register:" + getClientIp(req));
  const body = await readBody(req);
  const name = store.cleanText(body.name, 120);
  const email = store.normalizeEmail(body.email);
  const password = String(body.password || "");
  if (name.length < 2) throw new HttpError(400, "Informe seu nome completo.");
  if (!store.isValidEmail(email)) throw new HttpError(400, "Informe um email válido.");
  if (password.length < 8) throw new HttpError(400, "A senha precisa ter pelo menos 8 caracteres.");
  if (email === String(process.env.ADMIN_EMAIL || "").toLowerCase()) throw new HttpError(409, "Este email já está cadastrado.");

  const customer = await store.createCustomer({ name, email, passwordHash: auth.hashPassword(password) });
  sendJson(res, 201, {
    ok: true,
    token: auth.createCustomerToken(customer),
    user: { name: customer.name, email: customer.email, role: "customer" }
  });
});

route("POST", "/api/auth/login", async (req, res) => {
  loginLimiter("login:" + getClientIp(req));
  const body = await readBody(req);
  const email = store.normalizeEmail(body.email);
  const password = String(body.password || "");

  if (auth.checkAdminCredentials(email, password)) {
    sendJson(res, 200, { ok: true, token: auth.createAdminToken(), user: { name: "Administrador", email, role: "admin" } });
    return;
  }

  const customer = email ? await store.findCustomerByEmail(email) : null;
  if (!customer || !auth.verifyPassword(password, customer.password_hash)) {
    throw new HttpError(401, "Email ou senha invalidos.");
  }
  sendJson(res, 200, {
    ok: true,
    token: auth.createCustomerToken(customer),
    user: { name: customer.name, email: customer.email, role: "customer" }
  });
});

route("POST", "/api/auth/forgot", async (req, res) => {
  loginLimiter("forgot:" + getClientIp(req));
  if (!email.isEmailConfigured()) {
    throw new HttpError(503, "Recuperação por email indisponível no momento. Fale com a loja pelo WhatsApp.");
  }
  const body = await readBody(req);
  const customer = await store.findCustomerByEmail(store.normalizeEmail(body.email));
  if (customer) {
    const link = SITE_URL + "/recuperar-senha.html?token=" + encodeURIComponent(auth.createResetToken(customer));
    await email.sendPasswordReset({ to: customer.email, name: customer.name, link });
  }
  // Mesma resposta exista ou nao a conta (nao revela emails cadastrados).
  sendJson(res, 200, { ok: true, message: "Se o email estiver cadastrado, você recebera um link em instantes." });
});

route("POST", "/api/auth/reset", async (req, res) => {
  loginLimiter("reset:" + getClientIp(req));
  const body = await readBody(req);
  const payload = auth.readResetToken(body.token);
  const customer = payload ? await store.findCustomerById(payload.sub) : null;
  if (!customer || auth.passwordFingerprint(customer.password_hash) !== payload.fp) {
    throw new HttpError(400, "Link inválido ou expirado. Peca um novo.");
  }
  const password = String(body.password || "");
  if (password.length < 8) throw new HttpError(400, "A senha precisa ter pelo menos 8 caracteres.");
  const passwordHash = auth.hashPassword(password);
  await store.updateCustomerPassword(customer.id, passwordHash);
  sendJson(res, 200, {
    ok: true,
    token: auth.createCustomerToken(customer),
    user: { name: customer.name, email: customer.email, role: "customer" }
  });
});

route("GET", "/api/auth/me", async (req, res) => {
  const session = auth.getSession(req);
  if (!session) throw new HttpError(401, "Sessão expirada.");
  sendJson(res, 200, { ok: true, user: { name: session.name, email: session.email, role: session.role } });
});

route("GET", "/api/account/orders", async (req, res) => {
  const session = auth.requireCustomer(req);
  sendJson(res, 200, { ok: true, orders: await store.listOrders({ email: String(session.email).toLowerCase() }) });
});

// ---------- Checkout ----------

route("GET", "/api/payments/config", async (req, res) => {
  const publicKey = payments.getPublicKey();
  if (!publicKey || !payments.hasMercadoPagoCredentials()) {
    throw new HttpError(503, "Pagamento online ainda não configurado. Fale com a loja pelo WhatsApp.");
  }
  sendJson(res, 200, { ok: true, publicKey, testMode: payments.isTestMode() });
});

function readAddress(body) {
  const a = body.address || {};
  return {
    street: store.cleanText(a.street, 160),
    number: store.cleanText(a.number, 20),
    complement: store.cleanText(a.complement, 80),
    neighborhood: store.cleanText(a.neighborhood, 80),
    city: store.cleanText(a.city, 80),
    state: store.cleanText(a.state, 2).toUpperCase(),
    cep: normalizeCep(a.cep || (body.shipping && body.shipping.cep))
  };
}

route("POST", "/api/checkout", async (req, res) => {
  checkoutLimiter(getClientIp(req));
  if (!payments.hasMercadoPagoCredentials()) {
    throw new HttpError(503, "Pagamento online ainda não configurado.");
  }
  const body = await readBody(req, 200 * 1024);
  const session = auth.getSession(req);
  const customer = body.customer || {};
  const customerName = store.cleanText(customer.name || (session && session.name), 120);
  const customerEmail = store.normalizeEmail((session && session.role === "customer" && session.email) || customer.email);
  const customerPhone = store.cleanText(customer.phone, 30).replace(/[^\d()+\s-]/g, "");
  if (customerName.length < 2) throw new HttpError(400, "Informe seu nome completo.");
  if (!store.isValidEmail(customerEmail)) throw new HttpError(400, "Informe um email válido.");
  if (customerPhone.replace(/\D/g, "").length < 10) throw new HttpError(400, "Informe um telefone com DDD.");

  const priced = await store.priceCart(body.cart);
  const shippingRequest = body.shipping || {};
  const method = String(shippingRequest.method || "retirada");
  let shippingOption;
  let deliveryAddress = null;

  if (method === "retirada") {
    shippingOption = { method: "retirada", label: "Retirada na loja", amountCents: 0 };
  } else {
    const options = await quoteShipping({ cep: shippingRequest.cep, subtotalCents: priced.subtotalCents, itemCount: priced.itemCount });
    if (!options) throw new HttpError(400, "Informe um CEP válido para a entrega.");
    shippingOption = options.find((item) => item.method === method);
    if (!shippingOption) throw new HttpError(400, "Esta forma de entrega não está disponível para o CEP informado.");
    deliveryAddress = readAddress(body);
    if (!deliveryAddress.street || !deliveryAddress.number || !deliveryAddress.neighborhood || !deliveryAddress.city) {
      throw new HttpError(400, "Informe o endereço completo para a entrega.");
    }
  }

  const order = await store.createOrder({
    customerId: session && session.role === "customer" ? session.sub : null,
    customerName,
    customerEmail,
    customerPhone,
    lines: priced.lines,
    subtotalCents: priced.subtotalCents,
    shippingCents: shippingOption.amountCents,
    totalCents: priced.subtotalCents + shippingOption.amountCents,
    shippingMethod: shippingOption.method,
    shippingLabel: shippingOption.label,
    deliveryAddress
  });

  let payment;
  try {
    payment = await payments.createPayment({ order, formData: body.formData || {}, idempotencyKey: "jsmp-order-" + order.id + "-" + order.access_token.slice(0, 8) });
  } catch (error) {
    await store.applyPaymentStatus(order.id, { status: "rejected" });
    throw error;
  }

  await store.setOrderPayment(order.id, payment.id);
  const updated = afterPaymentUpdate(await store.applyPaymentStatus(order.id, payment));
  sendJson(res, 201, {
    ok: true,
    orderId: order.id,
    orderToken: order.access_token,
    status: updated.status,
    paymentStatus: payment.status,
    statusDetail: payment.status_detail,
    total: store.fromCents(order.total_cents),
    pix: payments.extractPix(payment)
  });
});

route("GET", "/api/orders/:id", async (req, res, params) => {
  const url = new URL(req.url, "http://localhost");
  let row = await store.getOrderForCustomer(params.id, url.searchParams.get("token"));
  if (!row) throw new HttpError(404, "Pedido não encontrado.");

  // Sem depender so do webhook: enquanto pendente, consulta o Mercado Pago.
  if (row.status === "pending" && row.payment_id && payments.hasMercadoPagoCredentials()) {
    try {
      const payment = await payments.getPayment(row.payment_id);
      row = afterPaymentUpdate(await store.applyPaymentStatus(row.id, payment)) || row;
    } catch (error) {
      console.warn("[pedido] falha ao atualizar status:", error.message);
    }
  }
  sendJson(res, 200, { ok: true, order: store.mapOrder(row) });
});

route("POST", "/api/payments/webhook", async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const body = await readBody(req).catch(() => ({}));
  const type = body.type || body.topic || url.searchParams.get("type") || url.searchParams.get("topic");
  const dataId = String((body.data && body.data.id) || url.searchParams.get("data.id") || url.searchParams.get("id") || "");

  if (type !== "payment" || !dataId) {
    sendJson(res, 200, { ok: true, ignored: true });
    return;
  }
  if (!payments.verifyWebhookSignature(req, dataId)) {
    throw new HttpError(401, "Assinatura inválida.");
  }

  const payment = await payments.getPayment(dataId);
  const orderId = Number(payment.external_reference);
  if (Number.isInteger(orderId) && orderId > 0) {
    afterPaymentUpdate(await store.applyPaymentStatus(orderId, payment));
  }
  sendJson(res, 200, { ok: true });
});

// ---------- Administracao ----------

route("GET", "/api/admin/products", async (req, res) => {
  auth.requireAdmin(req);
  sendJson(res, 200, { ok: true, products: await store.listProducts({ includeInactive: true, includePrivate: true }) });
});

route("POST", "/api/admin/products", async (req, res) => {
  auth.requireAdmin(req);
  sendJson(res, 201, { ok: true, product: await store.createProduct(await readBody(req, 200 * 1024)) });
});

route("PUT", "/api/admin/products/:id", async (req, res, params) => {
  auth.requireAdmin(req);
  sendJson(res, 200, { ok: true, product: await store.updateProduct(params.id, await readBody(req, 200 * 1024)) });
});

route("DELETE", "/api/admin/products/:id", async (req, res, params) => {
  auth.requireAdmin(req);
  await store.deleteProduct(params.id);
  sendJson(res, 200, { ok: true });
});

route("POST", "/api/admin/images", async (req, res) => {
  auth.requireAdmin(req);
  const body = await readBody(req, 5 * 1024 * 1024);
  sendJson(res, 201, { ok: true, url: await store.saveImage(body.dataUrl) });
});

route("POST", "/api/admin/brands", async (req, res) => {
  auth.requireAdmin(req);
  sendJson(res, 201, { ok: true, name: await store.addTaxonomy("brand", (await readBody(req)).name) });
});

route("POST", "/api/admin/categories", async (req, res) => {
  auth.requireAdmin(req);
  sendJson(res, 201, { ok: true, name: await store.addTaxonomy("category", (await readBody(req)).name) });
});

route("GET", "/api/admin/orders", async (req, res) => {
  auth.requireAdmin(req);
  sendJson(res, 200, { ok: true, orders: await store.listOrders() });
});

route("PATCH", "/api/admin/orders/:id", async (req, res, params) => {
  auth.requireAdmin(req);
  const body = await readBody(req);
  sendJson(res, 200, { ok: true, order: await store.setOrderStatus(params.id, String(body.status || ""), body.notes) });
});

route("GET", "/api/admin/expenses", async (req, res) => {
  auth.requireAdmin(req);
  sendJson(res, 200, { ok: true, expenses: await store.listExpenses() });
});

route("POST", "/api/admin/expenses", async (req, res) => {
  auth.requireAdmin(req);
  sendJson(res, 201, { ok: true, expense: await store.addExpense(await readBody(req)) });
});

route("DELETE", "/api/admin/expenses/:id", async (req, res, params) => {
  auth.requireAdmin(req);
  await store.deleteExpense(params.id);
  sendJson(res, 200, { ok: true });
});

function matchRoute(method, pathname) {
  let pathMatched = false;
  for (const entry of routes) {
    const match = entry.regex.exec(pathname);
    if (!match) continue;
    pathMatched = true;
    if (entry.method !== method) continue;
    const params = {};
    entry.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });
    return { handler: entry.handler, params };
  }
  return pathMatched ? { methodNotAllowed: true } : null;
}

module.exports = { matchRoute };
