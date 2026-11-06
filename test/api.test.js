// Testes de integracao da API usando banco em memoria e Mercado Pago simulado.
process.env.DB_MEMORY = "1";
process.env.ADMIN_EMAIL = "admin@teste.com";
process.env.ADMIN_PASSWORD = "senha-admin-forte";
process.env.AUTH_SECRET = "segredo-de-teste-com-mais-de-16";
process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-token";
process.env.MERCADOPAGO_PUBLIC_KEY = "TEST-public";
delete process.env.DATABASE_URL;
delete process.env.CORREIOS_USERNAME;

const test = require("node:test");
const assert = require("node:assert/strict");
const { initDb, closeDb } = require("../api/db");
const { createServer } = require("../api/server");

const realFetch = global.fetch;
const mpPayments = new Map();
let nextMpStatus = "approved";
let lastMpBody = null;

// Intercepta apenas chamadas ao Mercado Pago.
global.fetch = async (url, options) => {
  const href = String(url);
  if (!href.startsWith("https://api.mercadopago.com")) {
    return realFetch(url, options);
  }
  if (href.endsWith("/v1/payments") && options.method === "POST") {
    lastMpBody = JSON.parse(options.body);
    const id = 9000 + mpPayments.size;
    const payment = {
      id,
      status: nextMpStatus,
      status_detail: nextMpStatus === "approved" ? "accredited" : "pending_waiting_transfer",
      external_reference: lastMpBody.external_reference,
      payment_type_id: lastMpBody.payment_method_id === "pix" ? "bank_transfer" : "credit_card",
      point_of_interaction: lastMpBody.payment_method_id === "pix" ? { transaction_data: { qr_code: "PIXCODE", qr_code_base64: "AAAA" } } : undefined
    };
    mpPayments.set(String(id), payment);
    return new Response(JSON.stringify(payment), { status: 201 });
  }
  const match = /\/v1\/payments\/(\d+)$/.exec(href);
  if (match && mpPayments.has(match[1])) {
    return new Response(JSON.stringify(mpPayments.get(match[1])), { status: 200 });
  }
  return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
};

let server;
let base;

async function api(method, path, body, token) {
  const response = await realFetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json().catch(() => null), headers: response.headers };
}

async function adminToken() {
  const { data } = await api("POST", "/api/auth/login", { email: "admin@teste.com", password: "senha-admin-forte" });
  return data.token;
}

test.before(async () => {
  await initDb();
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  base = "http://127.0.0.1:" + server.address().port;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDb();
});

test("lista produtos do catalogo inicial sem expor custo", async () => {
  const { status, data } = await api("GET", "/api/products");
  assert.equal(status, 200);
  assert.ok(data.products.length >= 10);
  assert.equal(data.products[0].cost, undefined);
});

test("bloqueia rotas administrativas sem token", async () => {
  const { status } = await api("GET", "/api/admin/orders");
  assert.equal(status, 401);
});

test("admin cria, edita e remove produto", async () => {
  const token = await adminToken();
  const created = await api("POST", "/api/admin/products", {
    brand: "Reserva", category: "Bermudas", name: "Bermuda <b>Teste</b>", description: "x",
    price: 199.9, cost: 80, stock: 3, hasSizes: true, sizes: ["M", "G", "INVALIDO"]
  }, token);
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.product.sizes, ["M", "G"]);

  const taxonomy = await api("GET", "/api/taxonomy");
  assert.ok(taxonomy.data.brands.includes("Reserva"));

  const updated = await api("PUT", "/api/admin/products/" + created.data.product.id, { ...created.data.product, price: 149.9 }, token);
  assert.equal(updated.data.product.price, 149.9);

  const removed = await api("DELETE", "/api/admin/products/" + created.data.product.id, null, token);
  assert.equal(removed.status, 200);
});

test("rejeita produto invalido", async () => {
  const token = await adminToken();
  const { status, data } = await api("POST", "/api/admin/products", { brand: "", name: "", price: -1, stock: 1.5 }, token);
  assert.equal(status, 400);
  assert.match(data.message, /marca/);
});

test("cadastro e login de cliente com senha hash", async () => {
  const reg = await api("POST", "/api/auth/register", { name: "Maria Cliente", email: "Maria@Teste.com", password: "12345678" });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.email, "maria@teste.com");

  const dup = await api("POST", "/api/auth/register", { name: "Maria", email: "maria@teste.com", password: "12345678" });
  assert.equal(dup.status, 409);

  const bad = await api("POST", "/api/auth/login", { email: "maria@teste.com", password: "errada" });
  assert.equal(bad.status, 401);

  const ok = await api("POST", "/api/auth/login", { email: "maria@teste.com", password: "12345678" });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.role, "customer");

  const adminAttempt = await api("GET", "/api/admin/orders", null, ok.data.token);
  assert.equal(adminAttempt.status, 401);
});

test("checkout ignora preco enviado pelo navegador e baixa estoque quando aprovado", async () => {
  const before = (await api("GET", "/api/products")).data.products.find((p) => p.name === "Polo Signature Luxe");
  nextMpStatus = "approved";
  const { status, data } = await api("POST", "/api/checkout", {
    cart: [{ productId: before.id, size: "M", quantity: 2, price: 0.01 }],
    shipping: { method: "retirada" },
    customer: { name: "Joao Silva", email: "joao@teste.com", phone: "(11) 98888-7777" },
    formData: { payment_method_id: "visa", token: "card-token", installments: 1 }
  });
  assert.equal(status, 201, JSON.stringify(data));
  assert.equal(data.status, "paid");
  assert.equal(data.total, Number((before.price * 2).toFixed(2)));
  assert.equal(lastMpBody.transaction_amount, data.total);

  const after = (await api("GET", "/api/products/" + before.id)).data.product;
  assert.equal(after.stock, before.stock - 2);

  const order = await api("GET", "/api/orders/" + data.orderId + "?token=" + data.orderToken);
  assert.equal(order.data.order.status, "paid");
  const wrongToken = await api("GET", "/api/orders/" + data.orderId + "?token=errado");
  assert.equal(wrongToken.status, 404);
});

test("checkout recusa tamanho invalido e estoque insuficiente", async () => {
  const product = (await api("GET", "/api/products")).data.products.find((p) => p.name === "Blazer Milano Noir");
  const base = { shipping: { method: "retirada" }, customer: { name: "Ana", email: "ana@teste.com", phone: "11977776666" }, formData: { payment_method_id: "visa" } };

  const badSize = await api("POST", "/api/checkout", { ...base, cart: [{ productId: product.id, size: "PP", quantity: 1 }] });
  assert.equal(badSize.status, 400);

  const tooMany = await api("POST", "/api/checkout", { ...base, cart: [{ productId: product.id, size: "M", quantity: product.stock + 1 }] });
  assert.equal(tooMany.status, 409);
});

test("entrega exige endereco e calcula frete no servidor", async () => {
  const product = (await api("GET", "/api/products")).data.products.find((p) => p.name === "Polo Metropolitan");
  const quote = await api("POST", "/api/shipping/quote", { cep: "02992-130", cart: [{ productId: product.id, size: "M", quantity: 1 }] });
  assert.equal(quote.status, 200);
  const local = quote.data.options.find((o) => o.method === "entrega-local");
  assert.ok(local);

  const noAddress = await api("POST", "/api/checkout", {
    cart: [{ productId: product.id, size: "M", quantity: 1 }],
    shipping: { method: "entrega-local", cep: "02992130", amount: 0 },
    customer: { name: "Ana", email: "ana@teste.com", phone: "11977776666" },
    formData: { payment_method_id: "visa" }
  });
  assert.equal(noAddress.status, 400);

  nextMpStatus = "approved";
  const ok = await api("POST", "/api/checkout", {
    cart: [{ productId: product.id, size: "M", quantity: 1 }],
    shipping: { method: "entrega-local", cep: "02992130" },
    address: { street: "Rua A", number: "10", neighborhood: "Jaragua", city: "Sao Paulo", state: "SP" },
    customer: { name: "Ana", email: "ana@teste.com", phone: "11977776666" },
    formData: { payment_method_id: "visa" }
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.total, Number((product.price + local.amount).toFixed(2)));
});

test("PIX fica pendente, nao baixa estoque e e confirmado pelo webhook", async () => {
  const product = (await api("GET", "/api/products")).data.products.find((p) => p.name === "Jaqueta Urban Gold");
  nextMpStatus = "pending";
  const { data } = await api("POST", "/api/checkout", {
    cart: [{ productId: product.id, size: "G", quantity: 1 }],
    shipping: { method: "retirada" },
    customer: { name: "Pedro Pix", email: "pedro@teste.com", phone: "11966665555" },
    formData: { payment_method_id: "pix" }
  });
  assert.equal(data.status, "pending");
  assert.equal(data.pix.qrCode, "PIXCODE");
  assert.equal((await api("GET", "/api/products/" + product.id)).data.product.stock, product.stock);

  const paymentId = [...mpPayments.values()].find((p) => p.external_reference === String(data.orderId)).id;
  mpPayments.get(String(paymentId)).status = "approved";
  const hook = await api("POST", "/api/payments/webhook", { type: "payment", data: { id: String(paymentId) } });
  assert.equal(hook.status, 200);

  const order = await api("GET", "/api/orders/" + data.orderId + "?token=" + data.orderToken);
  assert.equal(order.data.order.status, "paid");
  assert.equal((await api("GET", "/api/products/" + product.id)).data.product.stock, product.stock - 1);

  // Webhook repetido nao baixa estoque de novo.
  await api("POST", "/api/payments/webhook", { type: "payment", data: { id: String(paymentId) } });
  assert.equal((await api("GET", "/api/products/" + product.id)).data.product.stock, product.stock - 1);
});

test("admin ve pedidos, muda status e cancelamento devolve estoque", async () => {
  const token = await adminToken();
  const orders = (await api("GET", "/api/admin/orders", null, token)).data.orders;
  const paid = orders.find((o) => o.status === "paid");
  const productBefore = (await api("GET", "/api/products/" + paid.items[0].productId)).data.product;

  const shipped = await api("PATCH", "/api/admin/orders/" + paid.id, { status: "shipped" }, token);
  assert.equal(shipped.data.order.status, "shipped");

  const cancelled = await api("PATCH", "/api/admin/orders/" + paid.id, { status: "cancelled" }, token);
  assert.equal(cancelled.data.order.status, "cancelled");
  const productAfter = (await api("GET", "/api/products/" + paid.items[0].productId)).data.product;
  assert.equal(productAfter.stock, productBefore.stock + paid.items[0].quantity);
});

test("cliente ve apenas os proprios pedidos", async () => {
  const login = await api("POST", "/api/auth/login", { email: "maria@teste.com", password: "12345678" });
  const product = (await api("GET", "/api/products")).data.products.find((p) => p.name === "Polo Metropolitan");
  nextMpStatus = "approved";
  await api("POST", "/api/checkout", {
    cart: [{ productId: product.id, size: "P", quantity: 1 }],
    shipping: { method: "retirada" },
    customer: { name: "Maria Cliente", email: "outro@email.com", phone: "11955554444" },
    formData: { payment_method_id: "visa" }
  }, login.data.token);
  const mine = await api("GET", "/api/account/orders", null, login.data.token);
  assert.equal(mine.data.orders.length, 1);
  assert.equal(mine.data.orders[0].customerEmail, "maria@teste.com");
});

test("despesas do admin", async () => {
  const token = await adminToken();
  const created = await api("POST", "/api/admin/expenses", { description: "Embalagens", category: "Operacional", amount: 120.5 }, token);
  assert.equal(created.status, 201);
  const list = await api("GET", "/api/admin/expenses", null, token);
  assert.equal(list.data.expenses[0].amount, 120.5);
  await api("DELETE", "/api/admin/expenses/" + created.data.expense.id, null, token);
  assert.equal((await api("GET", "/api/admin/expenses", null, token)).data.expenses.length, 0);
});

test("upload de imagem valida tipo e serve o arquivo", async () => {
  const token = await adminToken();
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const up = await api("POST", "/api/admin/images", { dataUrl: png }, token);
  assert.equal(up.status, 201);
  const image = await realFetch(base + up.data.url);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");

  const bad = await api("POST", "/api/admin/images", { dataUrl: "data:text/html;base64,PHNjcmlwdD4=" }, token);
  assert.equal(bad.status, 400);
});

test("nao serve arquivos sensiveis do repositorio", async () => {
  for (const path of ["/.env", "/.env.example", "/package.json", "/api/server.js", "/.git/config", "/data/pglite/PG_VERSION", "/test/api.test.js"]) {
    const response = await realFetch(base + path);
    assert.notEqual(response.status, 200, path);
  }
  const home = await realFetch(base + "/");
  assert.equal(home.status, 200);
});

test("recuperacao de senha envia link, troca senha e invalida o link", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Loja <loja@teste.com>";
  const sent = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).startsWith("https://api.resend.com")) {
      sent.push(JSON.parse(options.body));
      return new Response("{}", { status: 200 });
    }
    return previousFetch(url, options);
  };
  try {
    const unknown = await api("POST", "/api/auth/forgot", { email: "naoexiste@teste.com" });
    assert.equal(unknown.status, 200);
    assert.equal(sent.length, 0);

    await api("POST", "/api/auth/forgot", { email: "maria@teste.com" });
    assert.equal(sent.length, 1);
    const token = decodeURIComponent(/token=([^"&]+)/.exec(sent[0].html)[1]);

    const reset = await api("POST", "/api/auth/reset", { token, password: "novasenha123" });
    assert.equal(reset.status, 200);
    const reuse = await api("POST", "/api/auth/reset", { token, password: "outrasenha123" });
    assert.equal(reuse.status, 400);

    const login = await api("POST", "/api/auth/login", { email: "maria@teste.com", password: "novasenha123" });
    assert.equal(login.status, 200);
    const resetAsSession = await api("GET", "/api/account/orders", null, token);
    assert.equal(resetAsSession.status, 401);

    // Pedido pago dispara email para o cliente.
    const product = (await api("GET", "/api/products")).data.products.find((p) => p.name === "Polo Metropolitan");
    nextMpStatus = "approved";
    sent.length = 0;
    await api("POST", "/api/checkout", {
      cart: [{ productId: product.id, size: "G", quantity: 1 }],
      shipping: { method: "retirada" },
      customer: { name: "Lia", email: "lia@teste.com", phone: "11944443333" },
      formData: { payment_method_id: "visa" }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(sent.some((mail) => mail.to[0] === "lia@teste.com" && /confirmado/.test(mail.subject)));
  } finally {
    global.fetch = previousFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  }
});

test("CORS so libera origens permitidas", async () => {
  const allowed = await realFetch(base + "/api/products", { headers: { Origin: "https://augustonvsilva.github.io" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://augustonvsilva.github.io");
  const blocked = await realFetch(base + "/api/products", { headers: { Origin: "https://site-malicioso.com" } });
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);
});
