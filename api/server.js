const http = require("http");
const fs = require("fs");
const path = require("path");

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
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
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
