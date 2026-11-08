// Gera as paginas HTML finais a partir de src/pages/*.html + layout compartilhado.
// Uso: npm run build   (rode sempre que editar algo em src/pages ou no layout)
//
// Cada arquivo em src/pages comeca com um bloco de configuracao:
// <!--page {"title": "...", "description": "...", "page": "home", "scripts": ["catalog.js"]} -->
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src", "pages");
const SITE_URL = "https://www.jsmultimarcaspremium.com.br";
const STORE = "JS Multimarcas Premium";

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith(".html") ? [full] : [];
  });
}

function assetVersion() {
  const hash = crypto.createHash("sha256");
  for (const dir of ["css", "js"]) {
    for (const file of fs.readdirSync(path.join(ROOT, dir)).sort()) {
      hash.update(fs.readFileSync(path.join(ROOT, dir, file)));
    }
  }
  return hash.digest("hex").slice(0, 10);
}

const escapeAttr = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function header(base, admin) {
  return `<header class="site-header">
    <div class="container header-bar">
      <a class="brand" href="${base}index.html">
        <div class="brand-mark"><img src="${base}assets/logo-small.png" alt="" width="52" height="52"></div>
        <div class="brand-copy">
          <strong>${STORE}</strong>
          <span>${admin ? "Painel administrativo" : "Luxo urbano em preto e dourado"}</span>
        </div>
      </a>
      <nav class="main-nav" aria-label="Principal">
        <a href="${base}index.html" data-page-link="home">Início</a>
        <a href="${base}produtos.html" data-page-link="produtos">Produtos</a>
        <a href="${base}login.html" data-page-link="login" data-user-status>Entrar</a>
        <a class="nav-pill" href="${base}carrinho.html" data-page-link="carrinho" data-cart-count>Carrinho (0)</a>
      </nav>
    </div>
  </header>`;
}

function footer(base) {
  return `<footer class="site-footer">
    <div class="container footer-grid">
      <div>
        <h4>${STORE}</h4>
        <p class="muted-text">Loja multimarcas no Pan-Americano, Jaraguá - SP. Peças selecionadas, com retirada grátis na loja e entrega para todo o Brasil.</p>
      </div>
      <div>
        <h4>Loja</h4>
        <p><a href="${base}produtos.html">Todos os produtos</a></p>
        <p><a href="${base}carrinho.html">Carrinho</a></p>
        <p><a href="${base}conta.html">Minha conta</a></p>
      </div>
      <div>
        <h4>Ajuda</h4>
        <p><a href="${base}trocas-e-devolucoes.html">Trocas e devoluções</a></p>
        <p><a href="${base}privacidade.html">Política de privacidade</a></p>
        <p><a href="${base}termos.html">Termos de uso</a></p>
        <p><a data-store="whatsapp" href="#" target="_blank" rel="noopener">Fale no WhatsApp</a></p>
      </div>
      <div>
        <h4>Contato</h4>
        <p><a data-store="email" href="#"></a></p>
        <p class="muted-text" data-store="phone"></p>
        <p class="muted-text" data-store="address"></p>
        <p class="muted-text" data-store="hours"></p>
      </div>
    </div>
    <div class="container footer-copy">
      <span>© <span data-year></span> ${STORE}.</span>
      <span data-store="cnpj" data-store-prefix="CNPJ " data-store-optional></span>
      <span>Pagamentos processados com segurança pelo Mercado Pago: PIX, débito e crédito.</span>
    </div>
  </footer>`;
}

function render(file) {
  const raw = fs.readFileSync(file, "utf8");
  const match = /^<!--page\s+([\s\S]*?)-->\s*/.exec(raw);
  if (!match) throw new Error("Bloco <!--page {...}--> ausente em " + file);
  const meta = JSON.parse(match[1]);
  const content = raw.slice(match[0].length).trim();
  const rel = path.relative(SRC, file).split(path.sep).join("/");
  const depth = rel.split("/").length - 1;
  // "base" fixo e usado no 404.html, que o GitHub Pages serve em qualquer URL.
  const base = meta.base || (depth ? "../".repeat(depth) : "./");
  const version = assetVersion.cached || (assetVersion.cached = assetVersion());
  const admin = rel.startsWith("admin/");
  const title = meta.title ? meta.title + " | " + STORE : STORE + " | Moda premium multimarcas em São Paulo";
  const description = meta.description || "Loja multimarcas no Pan-Americano (Jaraguá-SP). Compre online com PIX ou cartão, retire grátis na loja ou receba em casa.";
  const url = SITE_URL + "/" + (rel === "index.html" ? "" : rel);
  const noindex = meta.noindex || admin;
  const scripts = ["storage.js", "app.js"].concat(meta.scripts || []);

  const head = [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "<title>" + escapeAttr(title) + "</title>",
    '<meta name="description" content="' + escapeAttr(description) + '">',
    '<meta name="theme-color" content="#050505">',
    noindex ? '<meta name="robots" content="noindex, nofollow">' : '<link rel="canonical" href="' + url + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="' + STORE + '">',
    '<meta property="og:title" content="' + escapeAttr(title) + '">',
    '<meta property="og:description" content="' + escapeAttr(description) + '">',
    '<meta property="og:url" content="' + url + '">',
    '<meta property="og:image" content="' + SITE_URL + '/assets/og-image.png">',
    '<meta property="og:locale" content="pt_BR">',
    '<link rel="icon" type="image/png" href="' + base + 'assets/favicon.png">',
    '<link rel="apple-touch-icon" href="' + base + 'assets/icon-192.png">',
    '<link rel="manifest" href="' + base + 'site.webmanifest">',
    '<link rel="preconnect" href="https://loja-multimarcas.onrender.com" crossorigin>',
    '<link rel="stylesheet" href="' + base + "css/style.css?v=" + version + '">',
    meta.head || ""
  ].filter(Boolean).join("\n  ");

  const bodyAttrs = ['data-page="' + (admin ? "admin" : meta.page || "") + '"', 'data-base-path="' + base + '"']
    .concat(meta.adminView ? ['data-admin-view="' + meta.adminView + '"'] : [])
    .join(" ");

  const scriptTags = (meta.externalScripts || []).map((src) => '<script src="' + src + '"></script>')
    .concat(scripts.map((name) => '<script src="' + base + "js/" + name + "?v=" + version + '"></script>'))
    .join("\n  ");

  const html = `<!DOCTYPE html>
<!-- Arquivo gerado por scripts/build-pages.js a partir de src/pages/${rel}. Edite a fonte, nao este arquivo. -->
<html lang="pt-BR">
<head>
  ${head}
</head>
<body ${bodyAttrs}>
  <a class="skip-link" href="#conteudo">Pular para o conteúdo</a>
  ${header(base, admin)}

  <main id="conteudo" class="page-shell">
${content.split("\n").map((line) => (line ? "    " + line : line)).join("\n")}
  </main>

  ${footer(base)}

  ${scriptTags}
</body>
</html>
`;
  const out = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  return { rel, noindex };
}

function writeSitemap(pages) {
  const urls = pages.filter((p) => !p.noindex).map((p) => {
    const loc = SITE_URL + "/" + (p.rel === "index.html" ? "" : p.rel);
    return "  <url><loc>" + loc + "</loc></url>";
  });
  fs.writeFileSync(path.join(ROOT, "sitemap.xml"), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join("\n") + "\n</urlset>\n");
}

const pages = walk(SRC).sort().map(render);
writeSitemap(pages);
console.log("Paginas geradas: " + pages.length);
