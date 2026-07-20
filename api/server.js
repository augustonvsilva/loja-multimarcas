const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const TOKEN_CACHE_MARGIN_MS = 60 * 1000;

loadEnvFile(path.join(ROOT_DIR, ".env"));

const PORT = Number(process.env.PORT || 3000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

const CORREIOS_SERVICES = [
  { code: "03298", method: "correios-pac", label: "Correios PAC" },
  { code: "03220", method: "correios-sedex", label: "Correios Sedex" }
];

let tokenCache = null;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  fs.readFileSync(filePath, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key && typeof process.env[key] === "undefined") {
      process.env[key] = value;
    }
  });
}

function normalizeCep(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function onlyNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function getCorreiosBaseUrl(resource) {
  const isHomologation = String(process.env.CORREIOS_ENV || "").toLowerCase() === "homologation";
  if (resource === "preco") {
    return isHomologation ? "https://apihom.correios.com.br/preco/v1" : "https://api.correios.com.br/preco/v1";
  }
  if (resource === "prazo") {
    return isHomologation ? "https://apihom.correios.com.br/prazo/v3" : "https://api.correios.com.br/prazo/v3";
  }
  return isHomologation ? "https://apihom.correios.com.br/token/v1" : "https://api.correios.com.br/token/v1";
}

function hasCorreiosCredentials() {
  return Boolean(
    process.env.CORREIOS_USERNAME &&
    process.env.CORREIOS_API_PASSWORD &&
    process.env.CORREIOS_CARD_NUMBER
  );
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data && (data.msg || data.message || data.mensagem || data.raw);
    throw new Error(message || "Erro ao consultar os Correios.");
  }

  return data;
}

async function getCorreiosToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + TOKEN_CACHE_MARGIN_MS) {
    return tokenCache.token;
  }

  if (!hasCorreiosCredentials()) {
    throw new Error("Credenciais dos Correios nao configuradas.");
  }

  const body = {
    numero: process.env.CORREIOS_CARD_NUMBER,
    contrato: process.env.CORREIOS_CONTRACT_NUMBER || undefined,
    dr: process.env.CORREIOS_DR ? Number(process.env.CORREIOS_DR) : undefined
  };

  const data = await requestJson(getCorreiosBaseUrl("token") + "/autentica/cartaopostagem", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(process.env.CORREIOS_USERNAME + ":" + process.env.CORREIOS_API_PASSWORD).toString("base64"),
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(body)
  });

  const token = data.token || data.accessToken || data.access_token;
  if (!token) {
    throw new Error("Token dos Correios nao retornado.");
  }

  const expiresAt = data.expiraEm
    ? new Date(data.expiraEm).getTime()
    : Date.now() + 50 * 60 * 1000;

  tokenCache = { token, expiresAt };
  return token;
}

function buildPackage(payload) {
  const itemCount = Math.max(1, Number(payload.itemCount || 1));
  const defaultWeight = onlyNumber(process.env.CORREIOS_DEFAULT_WEIGHT_GRAMS, 500);

  return {
    weight: Math.max(defaultWeight, defaultWeight * itemCount),
    length: onlyNumber(payload.lengthCm || process.env.CORREIOS_DEFAULT_LENGTH_CM, 20),
    width: onlyNumber(payload.widthCm || process.env.CORREIOS_DEFAULT_WIDTH_CM, 20),
    height: onlyNumber(payload.heightCm || process.env.CORREIOS_DEFAULT_HEIGHT_CM, 10)
  };
}

function buildCorreiosProductParams(service, payload) {
  const originCep = normalizeCep(process.env.CORREIOS_ORIGIN_CEP || "02992130");
  const destinationCep = normalizeCep(payload.cep);
  const box = buildPackage(payload);

  return {
    coProduto: service.code,
    nuRequisicao: service.method,
    nuContrato: process.env.CORREIOS_CONTRACT_NUMBER || undefined,
    nuDR: process.env.CORREIOS_DR ? Number(process.env.CORREIOS_DR) : undefined,
    cepOrigem: originCep,
    cepDestino: destinationCep,
    psObjeto: String(box.weight),
    tpObjeto: "2",
    comprimento: String(box.length),
    largura: String(box.width),
    altura: String(box.height),
    vlDeclarado: payload.subtotal ? String(Number(payload.subtotal).toFixed(2)) : undefined
  };
}

function parsePrice(value) {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  if (typeof value === "number") {
    return value;
  }

  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function extractPrice(row) {
  return parsePrice(
    row.pcFinal ||
    row.precoFinal ||
    row.valorFinal ||
    row.vlFinal ||
    row.valor ||
    row.preco
  );
}

function extractDeadline(row) {
  const value = row.prazoEntrega || row.prazo || row.nuPrazoEntrega || row.qtPrazo;
  return value ? String(value) : "";
}

async function quoteCorreios(payload) {
  const token = await getCorreiosToken();
  const priceParams = CORREIOS_SERVICES.map((service) => buildCorreiosProductParams(service, payload));
  const deadlineParams = CORREIOS_SERVICES.map((service) => ({
    coProduto: service.code,
    nuRequisicao: service.method,
    cepOrigem: normalizeCep(process.env.CORREIOS_ORIGIN_CEP || "02992130"),
    cepDestino: normalizeCep(payload.cep)
  }));

  const [priceData, deadlineData] = await Promise.all([
    requestJson(getCorreiosBaseUrl("preco") + "/nacional", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ idLote: "jsmp-preco", parametrosProduto: priceParams })
    }),
    requestJson(getCorreiosBaseUrl("prazo") + "/v1/nacional", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ idLote: "jsmp-prazo", parametrosPrazo: deadlineParams })
    })
  ]);

  const priceRows = Array.isArray(priceData) ? priceData : (priceData.retorno || priceData.precos || priceData.dados || []);
  const deadlineRows = Array.isArray(deadlineData) ? deadlineData : (deadlineData.retorno || deadlineData.prazos || deadlineData.dados || []);

  return CORREIOS_SERVICES.map((service) => {
    const priceRow = priceRows.find((row) => row.coProduto === service.code || row.nuRequisicao === service.method) || {};
    const deadlineRow = deadlineRows.find((row) => row.coProduto === service.code || row.nuRequisicao === service.method) || {};
    const price = extractPrice(priceRow);
    const deadline = extractDeadline(deadlineRow);

    if (price === null) {
      return null;
    }

    return {
      method: service.method,
      label: service.label,
      amount: Number(price.toFixed(2)),
      deadline: deadline ? deadline + " dias uteis" : "prazo informado pelos Correios",
      description: "Cotacao oficial dos Correios para postagem a partir do Pan-Americano, Jaragua-SP.",
      source: "correios-api"
    };
  }).filter(Boolean);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100000) {
        reject(new Error("Requisicao muito grande."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("JSON invalido."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(JSON.stringify(payload));
}

function hasMercadoPagoCredentials() {
  const token = String(process.env.MERCADOPAGO_ACCESS_TOKEN || "");
  return Boolean(token && !token.includes("seu_access_token"));
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch (error) {
    return null;
  }
}

function createExternalReference() {
  return "jsmp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

async function createMercadoPagoCheckout(request, response) {
  try {
    if (!hasMercadoPagoCredentials()) {
      sendJson(response, 503, { ok: false, message: "Configure o MERCADOPAGO_ACCESS_TOKEN no arquivo .env." });
      return;
    }

    const payload = await readRequestBody(request);
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) {
      sendJson(response, 400, { ok: false, message: "O carrinho esta vazio." });
      return;
    }

    const checkoutItems = items.map((item) => {
      const quantity = Math.max(1, Math.floor(Number(item.quantity) || 0));
      const unitPrice = Number(item.price);
      if (!item.name || !Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new Error("Um item do pedido e invalido.");
      }
      return { id: String(item.productId || item.id || item.name), title: String(item.name).slice(0, 256), quantity, currency_id: "BRL", unit_price: Number(unitPrice.toFixed(2)) };
    });

    const shipping = Number(payload.shipping || 0);
    if (Number.isFinite(shipping) && shipping > 0) {
      checkoutItems.push({ id: "frete", title: "Frete - " + String(payload.shippingLabel || "Entrega").slice(0, 120), quantity: 1, currency_id: "BRL", unit_price: Number(shipping.toFixed(2)) });
    }

    const externalReference = createExternalReference();
    const preference = {
      items: checkoutItems,
      external_reference: externalReference,
      statement_descriptor: "JS MULTIMARCAS",
      payment_methods: { excluded_payment_types: [{ id: "ticket" }] }
    };
    const payerEmail = String(payload.customerEmail || "").trim();
    if (payerEmail) {
      preference.payer = { email: payerEmail };
    }

    const siteUrl = validHttpUrl(process.env.MERCADOPAGO_SITE_URL || payload.siteUrl);
    if (siteUrl && siteUrl.hostname !== "localhost" && siteUrl.hostname !== "127.0.0.1") {
      const returnUrl = new URL("pagamento.html", siteUrl.href.endsWith("/") ? siteUrl.href : siteUrl.href + "/").href;
      preference.back_urls = { success: returnUrl, pending: returnUrl, failure: returnUrl };
      preference.auto_return = "approved";
    }
    const webhookUrl = validHttpUrl(process.env.MERCADOPAGO_WEBHOOK_URL);
    if (webhookUrl && webhookUrl.protocol === "https:") {
      preference.notification_url = webhookUrl.href;
    }

    const data = await requestJson("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { "Authorization": "Bearer " + process.env.MERCADOPAGO_ACCESS_TOKEN, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(preference)
    });
    sendJson(response, 201, { ok: true, preferenceId: data.id, externalReference, checkoutUrl: data.sandbox_init_point || data.init_point });
  } catch (error) {
    sendJson(response, 502, { ok: false, message: error.message || "Nao foi possivel criar o checkout do Mercado Pago." });
  }
}

async function getMercadoPagoPaymentStatus(request, response) {
  try {
    if (!hasMercadoPagoCredentials()) {
      sendJson(response, 503, { ok: false, message: "Configure o MERCADOPAGO_ACCESS_TOKEN no arquivo .env." });
      return;
    }
    const url = new URL(request.url, "http://localhost");
    const paymentId = String(url.searchParams.get("payment_id") || "").replace(/\D/g, "");
    if (!paymentId) {
      sendJson(response, 400, { ok: false, message: "payment_id invalido." });
      return;
    }
    const data = await requestJson("https://api.mercadopago.com/v1/payments/" + paymentId, {
      headers: { "Authorization": "Bearer " + process.env.MERCADOPAGO_ACCESS_TOKEN, "Accept": "application/json" }
    });
    sendJson(response, 200, { ok: true, id: data.id, status: data.status, externalReference: data.external_reference, paymentMethod: data.payment_method_id || "mercado-pago", paymentType: data.payment_type_id || "" });
  } catch (error) {
    sendJson(response, 502, { ok: false, message: error.message || "Nao foi possivel consultar o pagamento." });
  }
}

async function handleMercadoPagoWebhook(request, response) {
  try {
    const payload = await readRequestBody(request);
    console.log("Webhook Mercado Pago recebido:", JSON.stringify(payload));
    sendJson(response, 200, { ok: true });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: "Webhook invalido." });
  }
}

function buildCheckoutItems(items, shipping, shippingLabel) {
  const checkoutItems = (Array.isArray(items) ? items : []).map((item) => {
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 0));
    const unitPrice = Number(item.price);
    if (!item.name || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new Error("Um item do pedido e invalido.");
    }
    return { id: String(item.productId || item.id || item.name), title: String(item.name).slice(0, 256), quantity, currency_id: "BRL", unit_price: Number(unitPrice.toFixed(2)) };
  });
  if (!checkoutItems.length) {
    throw new Error("O carrinho esta vazio.");
  }
  if (Number.isFinite(Number(shipping)) && Number(shipping) > 0) {
    checkoutItems.push({ id: "frete", title: "Frete - " + String(shippingLabel || "Entrega").slice(0, 120), quantity: 1, currency_id: "BRL", unit_price: Number(Number(shipping).toFixed(2)) });
  }
  return checkoutItems;
}

function getCheckoutTotal(items, shipping) {
  return Number((items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0) + 0).toFixed(2));
}

function getMercadoPagoWebhookUrl() {
  const webhookUrl = validHttpUrl(process.env.MERCADOPAGO_WEBHOOK_URL);
  return webhookUrl && webhookUrl.protocol === "https:" ? webhookUrl.href : undefined;
}

function handleMercadoPagoConfig(request, response) {
  const publicKey = String(process.env.MERCADOPAGO_PUBLIC_KEY || "");
  if (!publicKey || publicKey.includes("sua_chave_publica")) {
    sendJson(response, 503, { ok: false, message: "Configure o MERCADOPAGO_PUBLIC_KEY no Render." });
    return;
  }
  sendJson(response, 200, { ok: true, publicKey });
}

async function processMercadoPagoBrickPayment(request, response) {
  try {
    if (!hasMercadoPagoCredentials()) {
      sendJson(response, 503, { ok: false, message: "Configure o MERCADOPAGO_ACCESS_TOKEN no Render." });
      return;
    }
    const payload = await readRequestBody(request);
    const formData = payload.formData || {};
    const order = payload.order || {};
    const items = buildCheckoutItems(order.items, order.shipping, order.shippingLabel);
    const transactionAmount = getCheckoutTotal(items, 0);
    const payer = formData.payer || {};
    const payerEmail = String(payer.email || formData.payer_email || order.customerEmail || "").trim();
    const paymentMethod = String(formData.payment_method_id || "").trim();
    if (!payerEmail || !paymentMethod) {
      sendJson(response, 400, { ok: false, message: "Informe o email e o meio de pagamento." });
      return;
    }

    const payment = {
      transaction_amount: transactionAmount,
      description: "Pedido JS Multimarcas Premium",
      payment_method_id: paymentMethod,
      external_reference: createExternalReference(),
      payer: { email: payerEmail }
    };
    if (formData.token) payment.token = String(formData.token);
    if (formData.installments) payment.installments = Number(formData.installments);
    if (formData.issuer_id) payment.issuer_id = String(formData.issuer_id);
    if (payer.identification && payer.identification.type && payer.identification.number) {
      payment.payer.identification = { type: String(payer.identification.type), number: String(payer.identification.number) };
    }
    const webhookUrl = getMercadoPagoWebhookUrl();
    if (webhookUrl) payment.notification_url = webhookUrl;

    const data = await requestJson("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.MERCADOPAGO_ACCESS_TOKEN,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Idempotency-Key": crypto.randomUUID()
      },
      body: JSON.stringify(payment)
    });
    const transactionData = data.point_of_interaction && data.point_of_interaction.transaction_data;
    sendJson(response, 201, {
      ok: true,
      id: data.id,
      status: data.status,
      statusDetail: data.status_detail,
      paymentType: data.payment_type_id || "",
      paymentMethod: data.payment_method_id || paymentMethod,
      pix: transactionData ? { qrCodeBase64: transactionData.qr_code_base64, qrCode: transactionData.qr_code, ticketUrl: transactionData.ticket_url } : null
    });
  } catch (error) {
    sendJson(response, 502, { ok: false, message: error.message || "Nao foi possivel processar o pagamento." });
  }
}

async function handleShippingQuote(request, response) {
  try {
    const payload = await readRequestBody(request);
    if (normalizeCep(payload.cep).length !== 8) {
      sendJson(response, 400, { ok: false, message: "CEP invalido." });
      return;
    }

    const options = await quoteCorreios(payload);
    sendJson(response, 200, {
      ok: true,
      provider: "correios",
      cep: normalizeCep(payload.cep),
      options
    });
  } catch (error) {
    sendJson(response, 503, {
      ok: false,
      provider: "correios",
      message: error.message || "Nao foi possivel consultar os Correios."
    });
  }
}

function serveStatic(request, response) {
  const url = new URL(request.url, "http://localhost");
  const cleanPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(ROOT_DIR, "." + cleanPath);

  if (!filePath.startsWith(ROOT_DIR) || filePath.includes(path.sep + "api" + path.sep)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(content);
  });
}

const server = http.createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    response.end();
    return;
  }

  if (request.method === "POST" && request.url === "/api/payments/checkout") {
    createMercadoPagoCheckout(request, response);
    return;
  }
  if (request.method === "GET" && request.url === "/api/payments/config") {
    handleMercadoPagoConfig(request, response);
    return;
  }
  if (request.method === "POST" && request.url === "/api/payments/process") {
    processMercadoPagoBrickPayment(request, response);
    return;
  }
  if (request.method === "GET" && request.url.startsWith("/api/payments/status")) {
    getMercadoPagoPaymentStatus(request, response);
    return;
  }
  if (request.method === "POST" && request.url === "/api/payments/webhook") {
    handleMercadoPagoWebhook(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/shipping/quote") {
    handleShippingQuote(request, response);
    return;
  }

  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log("JS Multimarcas Premium em http://localhost:" + PORT);
});
