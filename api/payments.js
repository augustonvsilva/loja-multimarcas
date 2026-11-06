// Integracao com o Mercado Pago (Checkout Bricks + webhook).
const crypto = require("crypto");
const { HttpError } = require("./http");

const MP_API = "https://api.mercadopago.com";

function accessToken() {
  return String(process.env.MERCADOPAGO_ACCESS_TOKEN || "");
}

function hasMercadoPagoCredentials() {
  const token = accessToken();
  return Boolean(token && !token.includes("seu_access_token"));
}

function getPublicKey() {
  const key = String(process.env.MERCADOPAGO_PUBLIC_KEY || "");
  return key && !key.includes("sua_chave_publica") ? key : "";
}

function isTestMode() {
  return accessToken().startsWith("TEST-");
}

async function mpRequest(path, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(MP_API + path, {
      ...options,
      signal: controller.signal,
      headers: {
        "Authorization": "Bearer " + accessToken(),
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(options && options.headers)
      }
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      data = { message: text };
    }
    if (!response.ok) {
      const cause = data && Array.isArray(data.cause) && data.cause[0] && data.cause[0].description;
      console.error("[mercadopago]", response.status, JSON.stringify(data).slice(0, 500));
      throw new HttpError(502, "Mercado Pago recusou a operação" + (cause ? ": " + cause : "."));
    }
    return data;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "Não foi possível falar com o Mercado Pago. Tente novamente.");
  } finally {
    clearTimeout(timer);
  }
}

function getWebhookUrl() {
  try {
    const url = new URL(String(process.env.MERCADOPAGO_WEBHOOK_URL || ""));
    return url.protocol === "https:" ? url.href : undefined;
  } catch (error) {
    return undefined;
  }
}

async function createPayment({ order, formData, idempotencyKey }) {
  const payer = (formData && formData.payer) || {};
  const paymentMethodId = String((formData && formData.payment_method_id) || "").trim();
  if (!paymentMethodId) {
    throw new HttpError(400, "Escolha a forma de pagamento.");
  }

  const [firstName, ...rest] = String(order.customer_name || "").split(" ");
  const body = {
    transaction_amount: Number((order.total_cents / 100).toFixed(2)),
    description: "Pedido #" + order.id + " - JS Multimarcas Premium",
    payment_method_id: paymentMethodId,
    external_reference: String(order.id),
    statement_descriptor: "JS MULTIMARCAS",
    payer: {
      email: String(payer.email || order.customer_email),
      first_name: firstName || undefined,
      last_name: rest.join(" ") || undefined
    },
    additional_info: {
      items: (order.items || []).map((item) => ({
        id: String(item.productId),
        title: item.name,
        quantity: item.quantity,
        unit_price: Number((item.unitPriceCents / 100).toFixed(2))
      }))
    },
    notification_url: getWebhookUrl()
  };
  if (formData.token) body.token = String(formData.token);
  if (formData.installments) body.installments = Number(formData.installments);
  if (formData.issuer_id) body.issuer_id = String(formData.issuer_id);
  if (payer.identification && payer.identification.type && payer.identification.number) {
    body.payer.identification = { type: String(payer.identification.type), number: String(payer.identification.number) };
  }
  if (paymentMethodId === "pix") {
    body.date_of_expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString().replace("Z", "-00:00");
  }

  return mpRequest("/v1/payments", {
    method: "POST",
    headers: { "X-Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body)
  });
}

async function getPayment(paymentId) {
  const id = String(paymentId || "").replace(/\D/g, "");
  if (!id) throw new HttpError(400, "Pagamento inválido.");
  return mpRequest("/v1/payments/" + id, { method: "GET" });
}

function extractPix(payment) {
  const data = payment && payment.point_of_interaction && payment.point_of_interaction.transaction_data;
  if (!data || !data.qr_code) return null;
  return { qrCodeBase64: data.qr_code_base64, qrCode: data.qr_code, ticketUrl: data.ticket_url };
}

// Valida a assinatura x-signature do webhook quando MERCADOPAGO_WEBHOOK_SECRET esta configurado.
// https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
function verifyWebhookSignature(request, dataId) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return true;
  const header = String(request.headers["x-signature"] || "");
  const requestId = String(request.headers["x-request-id"] || "");
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=").map((s) => s.trim())));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : dataId;
  let manifest = "";
  if (id) manifest += "id:" + id + ";";
  if (requestId) manifest += "request-id:" + requestId + ";";
  manifest += "ts:" + parts.ts + ";";
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(parts.v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  hasMercadoPagoCredentials,
  getPublicKey,
  isTestMode,
  createPayment,
  getPayment,
  extractPix,
  verifyWebhookSignature
};
