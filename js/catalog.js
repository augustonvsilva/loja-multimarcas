// Renderiza grades de produtos reutilizando os dados do LocalStorage.
document.addEventListener("DOMContentLoaded", function () {
  setupCatalogFilters();
  setupCatalogControls();
  renderDynamicBrandGrid();

  var grids = document.querySelectorAll("[data-product-grid]");
  if (!grids.length) {
    return;
  }

  grids.forEach(function (grid) {
    renderGrid(grid);
  });
});

function setupCatalogControls() {
  var search = document.querySelector("#catalog-search");
  var sort = document.querySelector("#catalog-sort");

  if (search) {
    search.addEventListener("input", rerenderCatalogGrids);
  }

  if (sort) {
    sort.addEventListener("change", rerenderCatalogGrids);
  }
}

function rerenderCatalogGrids() {
  document.querySelectorAll("[data-product-grid]").forEach(function (grid) {
    renderGrid(grid);
  });
}

function setupCatalogFilters() {
  var brandFilters = document.querySelector("#brand-filters");
  var categoryFilters = document.querySelector("#category-filters");

  if (!brandFilters && !categoryFilters) {
    return;
  }

  var products = window.JSMP.getProducts();
  var params = new URLSearchParams(window.location.search);
  var activeBrand = params.get("brand") || "";
  var activeCategory = params.get("category") || "";
  var brands = uniqueItems(products.map(function (product) {
    return product.brand;
  })).sort();
  var categories = uniqueItems(
    products
      .filter(function (product) {
        return !activeBrand || product.brand === activeBrand;
      })
      .map(function (product) {
        return product.category;
      })
  ).sort();

  if (brandFilters) {
    brandFilters.innerHTML = buildFilterChip("./produtos.html", "Todos", !activeBrand && !activeCategory);
    brandFilters.innerHTML += brands.map(function (brand) {
      return buildFilterChip(buildCatalogUrl(brand, ""), brand, activeBrand === brand);
    }).join("");
  }

  if (categoryFilters) {
    categoryFilters.innerHTML = buildFilterChip(buildCatalogUrl(activeBrand, ""), "Todas", !activeCategory);
    categoryFilters.innerHTML += categories.map(function (category) {
      return buildFilterChip(buildCatalogUrl(activeBrand, category), category, activeCategory === category);
    }).join("");
  }
}

function renderDynamicBrandGrid() {
  var grid = document.querySelector("[data-dynamic-brand-grid]");
  if (!grid) {
    return;
  }

  var products = window.JSMP.getProducts();
  var brands = uniqueItems(products.map(function (product) {
    return product.brand;
  })).sort();

  grid.innerHTML = brands.map(function (brand) {
    var brandProducts = products.filter(function (product) {
      return product.brand === brand;
    });
    var categories = uniqueItems(brandProducts.map(function (product) {
      return product.category;
    }));
    var highlight = categories[0] || "Colecao premium";

    return [
      '<a class="brand-card reveal" href="' + buildCatalogUrl(brand, "") + '">',
      "<span>" + brand + "</span>",
      "<h3>" + highlight + " em destaque.</h3>",
      '<p class="muted-text">' + brandProducts.length + " produto(s) disponiveis nesta marca.</p>",
      "</a>"
    ].join("");
  }).join("");
}

function buildFilterChip(href, label, isActive) {
  return '<a class="filter-chip' + (isActive ? ' active' : '') + '" href="' + href + '">' + label + "</a>";
}

function buildCatalogUrl(brand, category) {
  var params = new URLSearchParams();

  if (brand) {
    params.set("brand", brand);
  }

  if (category) {
    params.set("category", category);
  }

  var query = params.toString();
  return "./produtos.html" + (query ? "?" + query : "");
}

function uniqueItems(items) {
  return items.filter(function (item, index, array) {
    return item && array.indexOf(item) === index;
  });
}

function renderGrid(grid) {
  var mode = grid.getAttribute("data-product-grid");
  var dataBrand = grid.getAttribute("data-brand");
  var limit = Number(grid.getAttribute("data-limit") || 0);
  var params = new URLSearchParams(window.location.search);
  var queryBrand = params.get("brand") || "";
  var queryCategory = params.get("category") || "";
  var searchValue = getCatalogSearchValue();
  var sortValue = getCatalogSortValue();
  var products = window.JSMP.getProducts();
  var brand = dataBrand || queryBrand;

  if (mode === "featured") {
    products = products.filter(function (item) {
      return item.featured;
    });
  }

  if (brand) {
    products = products.filter(function (item) {
      return item.brand === brand;
    });
  }

  if (queryCategory) {
    products = products.filter(function (item) {
      return item.category === queryCategory;
    });
  }

  if (searchValue) {
    products = products.filter(function (item) {
      var haystack = [item.name, item.brand, item.category, item.description].join(" ").toLowerCase();
      return haystack.indexOf(searchValue) >= 0;
    });
  }

  products = sortProducts(products, sortValue);

  if (limit > 0) {
    products = products.slice(0, limit);
  }

  if (!products.length) {
    grid.innerHTML = '<div class="empty-state">Nenhum produto encontrado para esta selecao.</div>';
    return;
  }

  grid.innerHTML = products
    .map(function (product) {
      var inStock = Number(product.stock || 0) > 0;
      var actionButton = product.hasSizes || product.hasNumbers
        ? '<a class="btn-secondary" href="./produto.html?id=' + product.id + '">' + (inStock ? "Escolher opcoes" : "Ver detalhes") + "</a>"
        : '<button class="btn-secondary" data-add-cart="' + product.id + '"' + (inStock ? "" : " disabled") + '>Compra rapida</button>';

      return [
        '<article class="product-card reveal">',
        '<img class="product-image" src="' + product.image + '" alt="' + product.name + '">',
        '<div class="product-content">',
        '<div class="product-top">',
        "<div>",
        '<span class="badge">' + product.brand + "</span>",
        "<h3>" + product.name + "</h3>",
        "</div>",
        '<strong class="product-price">' + formatCurrency(product.price) + "</strong>",
        "</div>",
        '<div class="tag-list"><span class="tag">' + (product.category || "Sem categoria") + '</span>' + buildStockTag(product.stock) + "</div>",
        buildMeasureLine(product),
        '<p class="muted-text">' + product.description + "</p>",
        '<div class="button-row">',
        '<a class="btn" href="./produto.html?id=' + product.id + '">Ver produto</a>',
        actionButton,
        "</div>",
        "</div>",
        "</article>"
      ].join("");
    })
    .join("");

  grid.querySelectorAll("[data-add-cart]").forEach(function (button) {
    button.addEventListener("click", function () {
      var productId = Number(button.getAttribute("data-add-cart"));
      var result = window.JSMP.addToCart(productId);
      alert(result.ok ? "Produto adicionado ao carrinho com sucesso." : result.message);
      setupHeader();
    });
  });
}

function getCatalogSearchValue() {
  var node = document.querySelector("#catalog-search");
  return node ? node.value.trim().toLowerCase() : "";
}

function getCatalogSortValue() {
  var node = document.querySelector("#catalog-sort");
  return node ? node.value : "featured";
}

function sortProducts(products, mode) {
  var sorted = products.slice();

  if (mode === "price-asc") {
    sorted.sort(function (a, b) { return a.price - b.price; });
    return sorted;
  }

  if (mode === "price-desc") {
    sorted.sort(function (a, b) { return b.price - a.price; });
    return sorted;
  }

  if (mode === "name-asc") {
    sorted.sort(function (a, b) { return a.name.localeCompare(b.name, "pt-BR"); });
    return sorted;
  }

  if (mode === "stock-desc") {
    sorted.sort(function (a, b) { return Number(b.stock || 0) - Number(a.stock || 0); });
    return sorted;
  }

  sorted.sort(function (a, b) {
    if (a.featured === b.featured) {
      return a.name.localeCompare(b.name, "pt-BR");
    }

    return a.featured ? -1 : 1;
  });

  return sorted;
}

function buildMeasureLine(product) {
  var lines = [];

  if (product.hasSizes && product.sizes.length) {
    lines.push("Tamanhos: " + product.sizes.join(", "));
  }

  if (product.hasNumbers && product.numbers.length) {
    lines.push("Numeracao: " + product.numbers.join(", "));
  }

  return lines.length
    ? '<div class="detail-row">' + lines.join(" • ") + "</div>"
    : '<div class="detail-row">Produto sem grade obrigatoria.</div>';
}

function buildStockTag(stock) {
  var amount = Number(stock || 0);

  if (amount <= 0) {
    return '<span class="tag stock-tag out">Esgotado</span>';
  }

  if (amount <= 3) {
    return '<span class="tag stock-tag low">Ultimas ' + amount + " un.</span>";
  }

  return '<span class="tag stock-tag">Estoque: ' + amount + "</span>";
}
