// Servidor HTTP da JS Multimarcas Premium: API + arquivos estaticos do site.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadEnvFile } = require("./env");

const ROOT_DIR = path.resolve(__dirname, "..");
loadEnvFile(path.join(ROOT_DIR, ".env"));

const { initDb, closeDb } = require("./db");
const { HttpError, applyCors, applySecurityHeaders, sendJson } = require("./http");
const { matchRoute } = require("./routes");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

// Somente estas pastas/arquivos do repositorio sao publicos.
const PUBLIC_DIRS = new Set(["", "admin", "assets", "css", "js"]);

function serveStatic(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch (error) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  // Espelha o caminho do GitHub Pages (/loja-multimarcas/...) para testes locais.
  if (pathname === "/loja-multimarcas") pathname = "/";
  if (pathname.startsWith("/loja-multimarcas/")) pathname = pathname.slice("/loja-multimarcas".length);
  if (pathname.endsWith("/")) pathname += "index.html";

  const segments = pathname.split("/").filter(Boolean);
  const dir = segments.slice(0, -1).join("/");
  const ext = path.extname(pathname).toLowerCase();
  const hidden = segments.some((segment) => segment.startsWith("."));
  const filePath = path.resolve(ROOT_DIR, "." + pathname);

  if (hidden || !PUBLIC_DIRS.has(dir) || !MIME_TYPES[ext] || !filePath.startsWith(ROOT_DIR + path.sep) || ext === ".json") {
    return sendNotFound(response);
  }

  fs.readFile(filePath, (error, content) => {
    if (error) return sendNotFound(response);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[ext],
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  });
}

function sendNotFound(response) {
  fs.readFile(path.join(ROOT_DIR, "404.html"), (error, content) => {
    response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    response.end(error ? "Página não encontrada" : content);
  });
}

async function handle(request, response) {
  applySecurityHeaders(response);
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname.startsWith("/api/")) {
    const match = matchRoute(request.method, pathname);
    if (!match) throw new HttpError(404, "Rota não encontrada.");
    if (match.methodNotAllowed) throw new HttpError(405, "Método não permitido.");
    await match.handler(request, response, match.params);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    serveStatic(request, response);
    return;
  }
  throw new HttpError(405, "Método não permitido.");
}

function createServer() {
  return http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { ok: false, message: error.message, ...(error.extra || {}) });
        return;
      }
      console.error("[erro]", request.method, request.url, error);
      sendJson(response, 500, { ok: false, message: "Erro interno. Tente novamente em instantes." });
    });
  });
}

async function start() {
  const db = await initDb();
  if (db.kind !== "postgres" && (process.env.RENDER || process.env.NODE_ENV === "production")) {
    console.warn("[db] ATENCAO: DATABASE_URL não configurado. Os dados ficam em disco local e serao perdidos a cada deploy/reinicio.");
  }
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, () => {
    console.log("JS Multimarcas Premium em http://localhost:" + port + " (banco: " + db.kind + ")");
  });

  const shutdown = () => {
    server.close(() => closeDb().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Falha ao iniciar o servidor:", error);
    process.exit(1);
  });
}

module.exports = { createServer };
