// Vitrine: grades de produtos, filtros por categoria/tamanho, busca e ordenacao.
var catalogProducts = [];

document.addEventListener("DOMContentLoaded", function () {
  var grids = document.querySelectorAll("[data-product-grid]");
  var categoryGrid = document.querySelector("[data-dynamic-category-grid]");
  if (!grids.length && !categoryGrid) return;

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
  renderDynamicCategoryGrid();
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

function buildCatalogUrl(category, size) {
  var params = new URLSearchParams();
  if (category) params.set("category", category);
  if (size) params.set("size", size);
  var query = params.toString();
  return "./produtos.html" + (query ? "?" + query : "");
}

function buildFilterChip(href, label, isActive) {
  return '<a class="filter-chip' + (isActive ? " active" : "") + '" href="' + escapeHtml(href) + '">' + escapeHtml(label) + "</a>";
}

function capitalize(text) {
  var value = String(text || "");
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Tamanhos de roupa na ordem da arara (PP -> XGG); numeracoes em ordem numerica.
var SIZE_ORDER = ["PP", "P", "M", "G", "GG", "XG", "XGG", "EG", "EGG", "U", "UNICO", "ÚNICO"];

function compareSizes(a, b) {
  var ia = SIZE_ORDER.indexOf(String(a).toUpperCase());
  var ib = SIZE_ORDER.indexOf(String(b).toUpperCase());
  var na = Number(a);
  var nb = Number(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  if (!isNaN(na)) return 1;
  if (!isNaN(nb)) return -1;
  return String(a).localeCompare(String(b), "pt-BR");
}

function productSizes(product) {
  return (product.hasSizes ? product.sizes || [] : []).concat(product.hasNumbers ? product.numbers || [] : []).map(String);
}

function setupCatalogFilters() {
  var categoryFilters = document.querySelector("#category-filters");
  var sizeFilters = document.querySelector("#size-filters");
  if (!categoryFilters) return;

  var params = new URLSearchParams(window.location.search);
  var activeCategory = params.get("category") || "";
  var activeSize = params.get("size") || "";
  var categories = uniqueItems(catalogProducts.map(function (p) { return p.category; }))
    .sort(function (a, b) { return a.localeCompare(b, "pt-BR"); });

  // Trocar de categoria limpa o tamanho, que pode nao existir na nova categoria.
  categoryFilters.innerHTML = buildFilterChip(buildCatalogUrl("", ""), "Todas", !activeCategory) +
    categories.map(function (category) {
      return buildFilterChip(buildCatalogUrl(category, ""), capitalize(category), activeCategory === category);
    }).join("");

  if (!sizeFilters) return;
  var inCategory = catalogProducts.filter(function (p) { return !activeCategory || p.category === activeCategory; });
  var sizes = uniqueItems([].concat.apply([], inCategory.map(productSizes))).sort(compareSizes);
  document.querySelector("#size-filter-group").hidden = !sizes.length;
  sizeFilters.innerHTML = buildFilterChip(buildCatalogUrl(activeCategory, ""), "Todos", !activeSize) +
    sizes.map(function (size) {
      return buildFilterChip(buildCatalogUrl(activeCategory, size), size, activeSize === size);
    }).join("");
}

function renderDynamicCategoryGrid() {
  var grid = document.querySelector("[data-dynamic-category-grid]");
  if (!grid) return;
  var categories = uniqueItems(catalogProducts.map(function (p) { return p.category; }))
    .sort(function (a, b) { return a.localeCompare(b, "pt-BR"); });
  grid.innerHTML = categories.map(function (category) {
    var items = catalogProducts.filter(function (p) { return p.category === category; });
    var sizes = uniqueItems([].concat.apply([], items.map(productSizes))).sort(compareSizes);
    return [
      '<a class="brand-card reveal" href="' + escapeHtml(buildCatalogUrl(category, "")) + '">',
      "<span>" + escapeHtml(capitalize(category)) + "</span>",
      "<h3>" + items.length + " produto(s)</h3>",
      '<p class="muted-text">' + (sizes.length ? "Tamanhos: " + escapeHtml(sizes.join(", ")) : "Tamanho único") + "</p>",
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
  var brand = grid.getAttribute("data-brand") || "";
  var category = params.get("category") || "";
  var size = params.get("size") || "";
  var limit = Number(grid.getAttribute("data-limit") || 0);
  var searchNode = document.querySelector("#catalog-search");
  var sortNode = document.querySelector("#catalog-sort");
  var search = normalizeSearch(searchNode ? searchNode.value.trim() : "");
  var products = catalogProducts.slice();

  if (mode === "featured") products = products.filter(function (p) { return p.featured && p.stock > 0; });
  if (brand) products = products.filter(function (p) { return p.brand === brand; });
  if (category) products = products.filter(function (p) { return p.category === category; });
  if (size) products = products.filter(function (p) { return productSizes(p).indexOf(size) >= 0; });
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
