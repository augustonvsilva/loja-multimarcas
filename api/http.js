// Utilitarios HTTP: corpo da requisicao, respostas JSON, CORS, cabecalhos de seguranca e rate limit.

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}

const DEFAULT_ALLOWED_ORIGINS = [
  "https://augustonvsilva.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

function getAllowedOrigins() {
  const configured = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function applyCors(request, response) {
  const origin = String(request.headers.origin || "").replace(/\/$/, "");
  if (origin && getAllowedOrigins().includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.setHeader("Access-Control-Max-Age", "600");
  }
}

function applySecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (process.env.NODE_ENV === "production" || process.env.RENDER) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function readBody(request, limitBytes) {
  const limit = limitBytes || 100 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;

    request.on("data", (chunk) => {
      if (finished) return;
      size += chunk.length;
      if (size > limit) {
        finished = true;
        reject(new HttpError(413, "Requisição muito grande."));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (finished) return;
      finished = true;
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new HttpError(400, "JSON inválido."));
      }
    });
    request.on("error", (error) => {
      if (!finished) {
        finished = true;
        reject(error);
      }
    });
  });
}

function sendJson(response, status, payload) {
  if (response.headersSent) return;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function getClientIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || request.socket.remoteAddress || "unknown";
}

// Rate limit simples em memoria (janela fixa). Suficiente para uma instancia.
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref();

  return function check(key) {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      throw new HttpError(429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    }
  };
}

module.exports = {
  HttpError,
  applyCors,
  applySecurityHeaders,
  readBody,
  sendJson,
  getClientIp,
  createRateLimiter,
  getAllowedOrigins
};
