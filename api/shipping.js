// Calculo de frete feito no servidor (o valor cobrado nunca vem do navegador).
// Opcoes locais (retirada, entrega local, motoboy) + Correios via API oficial,
// com estimativa de tabela quando o contrato dos Correios nao esta configurado.

const STORE_ADDRESS = "Rua Jacinto Pereira, 151 - Pan-Americano, Jaraguá-SP";
const TOKEN_CACHE_MARGIN_MS = 60 * 1000;
const QUOTE_CACHE_MS = 30 * 60 * 1000;

const CORREIOS_SERVICES = [
  { code: "03298", method: "correios-pac", label: "Correios PAC" },
  { code: "03220", method: "correios-sedex", label: "Correios Sedex" }
];

let correiosToken = null;
const quoteCache = new Map();

function normalizeCep(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function option(method, label, amountCents, deadline, description, source) {
  return {
    method,
    label,
    amountCents: Math.max(0, Math.round(amountCents)),
    deadline,
    description,
    source: source || "loja"
  };
}

function isStoreRegionCep(cep) {
  return ["026", "027", "028", "029", "051", "052"].includes(cep.slice(0, 3));
}

function isSaoPauloCapitalCep(cep) {
  const prefix = Number(cep.slice(0, 2));
  return prefix >= 1 && prefix <= 5;
}

function localOptions(cep, subtotalCents, itemCount) {
  const extra = Math.max(itemCount - 1, 0);
  const options = [
    option("retirada", "Retirada na loja", 0, "no mesmo dia útil", "Retire seu pedido na loja: " + STORE_ADDRESS + ".")
  ];

  if (isStoreRegionCep(cep)) {
    options.push(option(
      "entrega-local",
      "Entrega local",
      subtotalCents >= 50000 ? 0 : 990 + extra * 200,
      "em até 1 dia útil",
      "Para Jaraguá, Pan-Americano, Pirituba, Perus e bairros próximos."
    ));
  } else if (isSaoPauloCapitalCep(cep)) {
    const discount = subtotalCents >= 70000 ? 1000 : subtotalCents >= 40000 ? 500 : 0;
    options.push(option(
      "motoboy-sp",
      "Motoboy SP capital",
      Math.max(1490, 1990 + extra * 250 - discount),
      "em 1 a 2 dias úteis",
      "Entrega por motoboy dentro da cidade de São Paulo."
    ));
  }

  return options;
}

// Estimativa usada quando a API oficial dos Correios nao esta disponivel.
function estimatedCorreiosOptions(cep, subtotalCents, itemCount) {
  const extra = Math.max(itemCount - 1, 0);
  const discount = subtotalCents >= 70000 ? 1000 : subtotalCents >= 40000 ? 500 : 0;
  const region = Number(cep.charAt(0) || 0);
  return [
    option(
      "correios-pac",
      "Correios PAC",
      Math.max(1990, 2290 + region * 210 + extra * 300 - discount),
      (4 + (region % 6)) + " a " + (7 + (region % 6)) + " dias úteis",
      "Opção econômica para envio pelos Correios.",
      "estimativa"
    ),
    option(
      "correios-sedex",
      "Correios Sedex",
      Math.max(2990, 3490 + region * 280 + extra * 400 - discount),
      (2 + (region % 3)) + " a " + (4 + (region % 3)) + " dias úteis",
      "Opção mais rápida para envio pelos Correios.",
      "estimativa"
    )
  ];
}

function hasCorreiosCredentials() {
  return Boolean(process.env.CORREIOS_USERNAME && process.env.CORREIOS_API_PASSWORD && process.env.CORREIOS_CARD_NUMBER);
}

function correiosUrl(resource) {
  const hom = String(process.env.CORREIOS_ENV || "").toLowerCase() === "homologation";
  const host = hom ? "https://apihom.correios.com.br" : "https://api.correios.com.br";
  if (resource === "preco") return host + "/preco/v1";
  if (resource === "prazo") return host + "/prazo/v1";
  return host + "/token/v1";
}

async function requestJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      data = { raw: text };
    }
    if (!response.ok) {
      const message = data && (data.msgs || data.msg || data.message || data.mensagem || data.raw);
      throw new Error(typeof message === "string" ? message : "Erro na API dos Correios.");
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function getCorreiosToken() {
  if (correiosToken && correiosToken.expiresAt > Date.now() + TOKEN_CACHE_MARGIN_MS) {
    return correiosToken.token;
  }
  const data = await requestJson(correiosUrl("token") + "/autentica/cartaopostagem", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(process.env.CORREIOS_USERNAME + ":" + process.env.CORREIOS_API_PASSWORD).toString("base64"),
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      numero: process.env.CORREIOS_CARD_NUMBER,
      contrato: process.env.CORREIOS_CONTRACT_NUMBER || undefined,
      dr: process.env.CORREIOS_DR ? Number(process.env.CORREIOS_DR) : undefined
    })
  });
  const token = data && (data.token || data.accessToken || data.access_token);
  if (!token) throw new Error("Token dos Correios não retornado.");
  correiosToken = {
    token,
    expiresAt: data.expiraEm ? new Date(data.expiraEm).getTime() : Date.now() + 50 * 60 * 1000
  };
  return token;
}

function parsePrice(value) {
  if (value === null || typeof value === "undefined") return null;
  if (typeof value === "number") return value;
  const number = Number(String(value).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

async function officialCorreiosOptions(cep, subtotalCents, itemCount) {
  const token = await getCorreiosToken();
  const origin = normalizeCep(process.env.CORREIOS_ORIGIN_CEP || "02992130");
  const weightPerItem = positive(process.env.CORREIOS_DEFAULT_WEIGHT_GRAMS, 500);
  const box = {
    weight: Math.round(weightPerItem * Math.max(1, itemCount)),
    length: positive(process.env.CORREIOS_DEFAULT_LENGTH_CM, 20),
    width: positive(process.env.CORREIOS_DEFAULT_WIDTH_CM, 20),
    height: positive(process.env.CORREIOS_DEFAULT_HEIGHT_CM, 10)
  };
  const auth = { "Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json" };

  const priceParams = CORREIOS_SERVICES.map((service) => ({
    coProduto: service.code,
    nuRequisicao: service.method,
    nuContrato: process.env.CORREIOS_CONTRACT_NUMBER || undefined,
    nuDR: process.env.CORREIOS_DR ? Number(process.env.CORREIOS_DR) : undefined,
    cepOrigem: origin,
    cepDestino: cep,
    psObjeto: String(box.weight),
    tpObjeto: "2",
    comprimento: String(box.length),
    largura: String(box.width),
    altura: String(box.height),
    vlDeclarado: (subtotalCents / 100).toFixed(2)
  }));
  const deadlineParams = CORREIOS_SERVICES.map((service) => ({
    coProduto: service.code,
    nuRequisicao: service.method,
    cepOrigem: origin,
    cepDestino: cep
  }));

  const [priceData, deadlineData] = await Promise.all([
    requestJson(correiosUrl("preco") + "/nacional", { method: "POST", headers: auth, body: JSON.stringify({ idLote: "jsmp-preco", parametrosProduto: priceParams }) }),
    requestJson(correiosUrl("prazo") + "/nacional", { method: "POST", headers: auth, body: JSON.stringify({ idLote: "jsmp-prazo", parametrosPrazo: deadlineParams }) })
  ]);

  const rowsOf = (data) => (Array.isArray(data) ? data : (data && (data.retorno || data.precos || data.prazos || data.dados)) || []);
  const priceRows = rowsOf(priceData);
  const deadlineRows = rowsOf(deadlineData);

  return CORREIOS_SERVICES.map((service) => {
    const match = (row) => row.coProduto === service.code || row.nuRequisicao === service.method;
    const priceRow = priceRows.find(match) || {};
    const deadlineRow = deadlineRows.find(match) || {};
    const price = parsePrice(priceRow.pcFinal || priceRow.precoFinal || priceRow.vlFinal || priceRow.valor || priceRow.preco);
    if (price === null) return null;
    const days = deadlineRow.prazoEntrega || deadlineRow.prazo || deadlineRow.nuPrazoEntrega;
    return option(
      service.method,
      service.label,
      price * 100,
      days ? days + " dias úteis" : "prazo informado pelos Correios",
      "Cotação oficial dos Correios.",
      "correios"
    );
  }).filter(Boolean);
}

async function quoteShipping({ cep, subtotalCents, itemCount }) {
  const normalized = normalizeCep(cep);
  if (normalized.length !== 8) {
    return null;
  }
  const items = Math.max(1, Math.floor(Number(itemCount) || 1));
  const subtotal = Math.max(0, Math.round(Number(subtotalCents) || 0));
  const cacheKey = [normalized, subtotal, items].join("|");
  const cached = quoteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.options;
  }

  let correios = null;
  if (hasCorreiosCredentials()) {
    try {
      correios = await officialCorreiosOptions(normalized, subtotal, items);
    } catch (error) {
      console.warn("[frete] Correios indisponível, usando estimativa:", error.message);
    }
  }
  if (!correios || !correios.length) {
    correios = estimatedCorreiosOptions(normalized, subtotal, items);
  }

  const options = localOptions(normalized, subtotal, items).concat(correios);
  quoteCache.set(cacheKey, { options, expiresAt: Date.now() + QUOTE_CACHE_MS });
  if (quoteCache.size > 2000) {
    quoteCache.delete(quoteCache.keys().next().value);
  }
  return options;
}

module.exports = { quoteShipping, normalizeCep, STORE_ADDRESS };
