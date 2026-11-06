// Vitrine: grades de produtos, filtros por marca/categoria, busca e ordenacao.
var catalogProducts = [];

document.addEventListener("DOMContentLoaded", function () {
  var grids = document.querySelectorAll("[data-product-grid]");
  var brandGrid = document.querySelector("[data-dynamic-brand-grid]");
  if (!grids.length && !brandGrid) return;

  grids.forEach(function (grid) { grid.innerHTML = loadingMarkup("Carregando produtos..."); });
  setupCatalogControls();

  window.JSMP.loadProducts(renderCatalog)
    .then(renderCatalog)
    .catch(function (error) {
      grids.forEach(function (grid) { grid.innerHTML = errorMarkup(error); });
    });
});

function renderCatalog(products) {
  catalogProducts = products || [];
  setupCatalogFilters();
  renderDynamicBrandGrid();
  rerenderCatalogGrids();
}

function setupCatalogControls() {
  var search = document.querySelector("#catalog-search");
  var sort = document.querySelector("#catalog-sort");
  var params = new URLSearchParams(window.location.search);
  if (search) {
    search.value = params.get("q") || "";
    search.addEventListener("input", rerenderCatalogGrids);
  }
  if (sort) sort.addEventListener("change", rerenderCatalogGrids);
}

function rerenderCatalogGrids() {
  document.querySelectorAll("[data-product-grid]").forEach(renderGrid);
}

function uniqueItems(items) {
  return items.filter(function (item, index, array) {
    return item && array.indexOf(item) === index;
  });
}

function buildCatalogUrl(brand, category) {
  var params = new URLSearchParams();
  if (brand) params.set("brand", brand);
  if (category) params.set("category", category);
  var query = params.toString();
  return "./produtos.html" + (query ? "?" + query : "");
}

function buildFilterChip(href, label, isActive) {
  return '<a class="filter-chip' + (isActive ? " active" : "") + '" href="' + escapeHtml(href) + '">' + escapeHtml(label) + "</a>";
}

function setupCatalogFilters() {
  var brandFilters = document.querySelector("#brand-filters");
  var categoryFilters = document.querySelector("#category-filters");
  if (!brandFilters && !categoryFilters) return;

  var params = new URLSearchParams(window.location.search);
  var activeBrand = params.get("brand") || "";
  var activeCategory = params.get("category") || "";
  var brands = uniqueItems(catalogProducts.map(function (p) { return p.brand; })).sort();
  var categories = uniqueItems(catalogProducts
    .filter(function (p) { return !activeBrand || p.brand === activeBrand; })
    .map(function (p) { return p.category; })).sort();

  if (brandFilters) {
    brandFilters.innerHTML = buildFilterChip("./produtos.html", "Todas", !activeBrand) +
      brands.map(function (brand) { return buildFilterChip(buildCatalogUrl(brand, ""), brand, activeBrand === brand); }).join("");
  }
  if (categoryFilters) {
    categoryFilters.innerHTML = buildFilterChip(buildCatalogUrl(activeBrand, ""), "Todas", !activeCategory) +
      categories.map(function (category) { return buildFilterChip(buildCatalogUrl(activeBrand, category), category, activeCategory === category); }).join("");
  }
}

function renderDynamicBrandGrid() {
  var grid = document.querySelector("[data-dynamic-brand-grid]");
  if (!grid) return;
  var brands = uniqueItems(catalogProducts.map(function (p) { return p.brand; })).sort();
  grid.innerHTML = brands.map(function (brand) {
    var items = catalogProducts.filter(function (p) { return p.brand === brand; });
    var highlight = uniqueItems(items.map(function (p) { return p.category; }))[0] || "Colecao premium";
    return [
      '<a class="brand-card reveal" href="' + escapeHtml(buildCatalogUrl(brand, "")) + '">',
      "<span>" + escapeHtml(brand) + "</span>",
      "<h3>" + escapeHtml(highlight) + " em destaque.</h3>",
      '<p class="muted-text">' + items.length + " produto(s) nesta marca.</p>",
      "</a>"
    ].join("");
  }).join("");
}

function normalizeSearch(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function sortProducts(products, mode) {
  var sorted = products.slice();
  var byName = function (a, b) { return a.name.localeCompare(b.name, "pt-BR"); };
  if (mode === "price-asc") return sorted.sort(function (a, b) { return a.price - b.price; });
  if (mode === "price-desc") return sorted.sort(function (a, b) { return b.price - a.price; });
  if (mode === "name-asc") return sorted.sort(byName);
  return sorted.sort(function (a, b) {
    var aStock = a.stock > 0 ? 0 : 1;
    var bStock = b.stock > 0 ? 0 : 1;
    if (aStock !== bStock) return aStock - bStock;
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return byName(a, b);
  });
}

function renderGrid(grid) {
  var mode = grid.getAttribute("data-product-grid");
  var params = new URLSearchParams(window.location.search);
  var brand = grid.getAttribute("data-brand") || params.get("brand") || "";
  var category = params.get("category") || "";
  var limit = Number(grid.getAttribute("data-limit") || 0);
  var searchNode = document.querySelector("#catalog-search");
  var sortNode = document.querySelector("#catalog-sort");
  var search = normalizeSearch(searchNode ? searchNode.value.trim() : "");
  var products = catalogProducts.slice();

  if (mode === "featured") products = products.filter(function (p) { return p.featured && p.stock > 0; });
  if (brand) products = products.filter(function (p) { return p.brand === brand; });
  if (category) products = products.filter(function (p) { return p.category === category; });
  if (search) {
    products = products.filter(function (p) {
      return normalizeSearch([p.name, p.brand, p.category, p.description].join(" ")).indexOf(search) >= 0;
    });
  }
  products = sortProducts(products, sortNode ? sortNode.value : "featured");
  if (limit > 0) products = products.slice(0, limit);

  var counter = document.querySelector("#catalog-count");
  if (counter) counter.textContent = products.length + " produto(s)";

  if (!products.length) {
    grid.innerHTML = '<div class="empty-state">Nenhum produto encontrado para esta selecao.</div>';
    return;
  }

  grid.innerHTML = products.map(productCardMarkup).join("");
  grid.querySelectorAll("[data-add-cart]").forEach(function (button) {
    button.addEventListener("click", function () {
      var product = window.JSMP.findProduct(catalogProducts, button.getAttribute("data-add-cart"));
      var result = window.JSMP.addToCart(product);
      showToast(result.ok ? "Produto adicionado ao carrinho." : result.message, result.ok ? "success" : "error");
      setupHeader();
    });
  });
}

function productCardMarkup(product) {
  var inStock = Number(product.stock || 0) > 0;
  var link = "./produto.html?id=" + product.id;
  var needsOptions = product.hasSizes || product.hasNumbers;
  var action = !inStock
    ? '<button class="btn-secondary" type="button" disabled>Esgotado</button>'
    : needsOptions
      ? '<a class="btn-secondary" href="' + link + '">Escolher tamanho</a>'
      : '<button class="btn-secondary" type="button" data-add-cart="' + product.id + '">Adicionar</button>';

  return [
    '<article class="product-card reveal' + (inStock ? "" : " is-sold-out") + '">',
    '<a href="' + link + '"><img class="product-image" src="' + escapeHtml(window.JSMP.imageUrl(product.image)) + '" alt="' + escapeHtml(product.name) + '" loading="lazy" width="400" height="460"></a>',
    '<div class="product-content">',
    '<div class="product-top">',
    "<div>",
    '<span class="badge">' + escapeHtml(product.brand) + "</span>",
    '<h3><a href="' + link + '">' + escapeHtml(product.name) + "</a></h3>",
    "</div>",
    '<strong class="product-price">' + formatCurrency(product.price) + "</strong>",
    "</div>",
    '<div class="tag-list"><span class="tag">' + escapeHtml(product.category) + "</span>" + buildStockTag(product.stock) + "</div>",
    '<p class="muted-text">' + formatInstallments(product.price) + "</p>",
    '<div class="button-row">',
    '<a class="btn" href="' + link + '">Ver produto</a>',
    action,
    "</div>",
    "</div>",
    "</article>"
  ].join("");
}

// Texto neutro: parcelamento e juros sao definidos na conta do Mercado Pago.
function formatInstallments() {
  return "PIX, débito ou cartão de crédito parcelado";
}

function buildStockTag(stock) {
  var amount = Number(stock || 0);
  if (amount <= 0) return '<span class="tag stock-tag out">Esgotado</span>';
  if (amount <= 3) return '<span class="tag stock-tag low">Últimas ' + amount + " unidades</span>";
  return '<span class="tag stock-tag">Em estoque</span>';
}
