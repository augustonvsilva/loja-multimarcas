// Pagina de detalhe do produto.
document.addEventListener("DOMContentLoaded", function () {
  var root = document.querySelector("#product-detail");
  if (!root) return;

  var productId = Number(new URLSearchParams(window.location.search).get("id"));
  if (!productId) {
    root.innerHTML = '<div class="empty-state">Produto não encontrado. <a href="./produtos.html">Voltar ao catálogo</a>.</div>';
    return;
  }

  root.innerHTML = loadingMarkup("Carregando produto...");
  var render = function (products) {
    var product = window.JSMP.findProduct(products, productId);
    if (!product) {
      root.innerHTML = '<div class="empty-state">Este produto não está mais disponível. <a href="./produtos.html">Ver outros produtos</a>.</div>';
      return;
    }
    renderProductDetail(root, product);
  };
  window.JSMP.loadProducts(render).then(render).catch(function (error) {
    root.innerHTML = errorMarkup(error);
  });
});

function renderProductDetail(root, product) {
  var images = (product.images && product.images.length ? product.images : [product.image]).map(window.JSMP.imageUrl);
  var inStock = Number(product.stock || 0) > 0;

  document.title = product.name + " | " + product.brand + " | JS Multimarcas Premium";
  setMetaDescription(product.name + " " + product.brand + " por " + formatCurrency(product.price) + ". " + String(product.description || "").slice(0, 120));
  injectProductSchema(product, images[0]);

  root.innerHTML = [
    '<nav class="breadcrumb" aria-label="Você esta em"><a href="./index.html">Home</a> / <a href="./produtos.html?brand=' + encodeURIComponent(product.brand) + '">' + escapeHtml(product.brand) + "</a> / <span>" + escapeHtml(product.name) + "</span></nav>",
    '<article class="glass-panel product-detail-card reveal">',
    '<div class="product-detail-media">',
    '<img id="product-main-image" class="product-detail-image" src="' + escapeHtml(images[0]) + '" alt="' + escapeHtml(product.name) + '">',
    images.length > 1 ? '<div class="product-gallery">' + images.map(function (image, index) {
      return '<button class="product-thumb-button' + (index === 0 ? " active" : "") + '" type="button" data-thumb-index="' + index + '" aria-label="Foto ' + (index + 1) + '"><img class="product-thumb-image" src="' + escapeHtml(image) + '" alt=""></button>';
    }).join("") + "</div>" : "",
    "</div>",
    '<div class="product-detail-content">',
    '<div class="tag-list"><span class="badge">' + escapeHtml(product.brand) + '</span><span class="tag">' + escapeHtml(product.category) + "</span>" + buildDetailStockTag(product.stock) + "</div>",
    "<h1>" + escapeHtml(product.name) + "</h1>",
    '<strong class="product-price">' + formatCurrency(product.price) + "</strong>",
    '<p class="muted-text">PIX, débito ou cartão de crédito parcelado.</p>',
    '<p class="page-subtitle">' + escapeHtml(product.description) + "</p>",
    '<form id="product-purchase-form" class="form-grid product-purchase-form">',
    buildOptionPicker("size", "Tamanho", product.hasSizes ? product.sizes : []),
    buildOptionPicker("number", "Numeração", product.hasNumbers ? product.numbers : []),
    '<div class="field-full button-row">',
    inStock
      ? '<button class="btn" type="submit">Comprar agora</button><button class="btn-secondary" type="button" id="add-to-cart">Adicionar ao carrinho</button>'
      : '<button class="btn" type="submit" disabled>Produto esgotado</button>',
    "</div>",
    "</form>",
    '<div id="product-feedback" class="feedback" role="status">' + (inStock ? "" : "Este produto está esgotado. Fale com a loja pelo WhatsApp para saber da reposição.") + "</div>",
    '<section class="shipping-card shipping-card-product">',
    '<div class="shipping-card-header"><div><span class="eyebrow">Entrega</span><h3>Calcule o frete</h3></div></div>',
    '<div class="shipping-card-form">',
    '<div class="shipping-input-wrap"><label for="product-cep">CEP</label><input class="input shipping-input" id="product-cep" type="text" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" maxlength="9"></div>',
    '<button class="btn-secondary shipping-action" id="product-shipping-button" type="button">Calcular</button>',
    "</div>",
    '<div id="product-shipping-feedback" class="shipping-result">Retirada na loja, entrega local, motoboy em SP ou Correios.</div>',
    "</section>",
    "</div>",
    "</article>"
  ].join("");

  root.querySelectorAll("[data-thumb-index]").forEach(function (button) {
    button.addEventListener("click", function () {
      document.querySelector("#product-main-image").src = images[Number(button.getAttribute("data-thumb-index"))];
      root.querySelectorAll("[data-thumb-index]").forEach(function (item) { item.classList.remove("active"); });
      button.classList.add("active");
    });
  });

  var cepInput = document.querySelector("#product-cep");
  maskCepInput(cepInput);
  var calc = function () {
    var feedback = document.querySelector("#product-shipping-feedback");
    feedback.className = "shipping-result";
    feedback.textContent = "Consultando frete...";
    quoteShipping(cepInput.value, { subtotal: product.price, itemCount: 1 }).then(function (result) {
      if (!result) {
        feedback.className = "shipping-result error";
        feedback.textContent = "Digite um CEP válido com 8 números.";
        return;
      }
      feedback.className = "shipping-result success";
      feedback.innerHTML = "<strong>Opções para " + escapeHtml(result.formattedCep) + '</strong><div class="shipping-options compact">' +
        result.options.map(function (option) {
          return '<div class="shipping-option static"><span><strong>' + escapeHtml(option.label) + " - " + (option.amount ? formatCurrency(option.amount) : "Grátis") + "</strong><small>" + escapeHtml(option.deadline) + "</small></span></div>";
        }).join("") + "</div>";
    }).catch(function (error) {
      feedback.className = "shipping-result error";
      feedback.textContent = error.message;
    });
  };
  document.querySelector("#product-shipping-button").addEventListener("click", calc);
  cepInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      calc();
    }
  });

  var form = document.querySelector("#product-purchase-form");
  var feedback = document.querySelector("#product-feedback");

  var readVariation = function () {
    var size = form.querySelector('input[name="size"]:checked');
    var number = form.querySelector('input[name="number"]:checked');
    if (product.hasSizes && !size) return setFeedback(feedback, "Selecione o tamanho.", "error");
    if (product.hasNumbers && !number) return setFeedback(feedback, "Selecione a numeração.", "error");
    return { size: size ? size.value : "", number: number ? number.value : "" };
  };

  // "Comprar agora": coloca o item no carrinho (sem duplicar) e vai direto ao pagamento.
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var variation = readVariation();
    if (!variation) return;
    var result = window.JSMP.addToCart(product, variation, { ifMissing: true });
    if (!result.ok) return setFeedback(feedback, result.message, "error");
    window.location.href = "./pagamento.html";
  });

  var addButton = document.querySelector("#add-to-cart");
  if (addButton) {
    addButton.addEventListener("click", function () {
      var variation = readVariation();
      if (!variation) return;
      var result = window.JSMP.addToCart(product, variation);
      if (!result.ok) return setFeedback(feedback, result.message, "error");
      feedback.className = "feedback success";
      feedback.innerHTML = 'Produto adicionado ao carrinho. <a href="./carrinho.html">Ver carrinho</a>';
      setupHeader();
    });
  }
}

function setFeedback(node, message, tone) {
  node.className = "feedback " + tone;
  node.textContent = message;
  return null;
}

function buildOptionPicker(name, label, values) {
  if (!values || !values.length) return "";
  return [
    '<fieldset class="field-full option-picker">',
    "<legend>" + label + "</legend>",
    '<div class="option-picker-grid">',
    values.map(function (value) {
      var id = "opt-" + name + "-" + String(value).replace(/\W/g, "");
      return '<input type="radio" id="' + id + '" name="' + name + '" value="' + escapeHtml(value) + '"><label for="' + id + '">' + escapeHtml(value) + "</label>";
    }).join(""),
    "</div>",
    "</fieldset>"
  ].join("");
}

function buildDetailStockTag(stock) {
  var amount = Number(stock || 0);
  if (amount <= 0) return '<span class="tag stock-tag out">Esgotado</span>';
  if (amount <= 3) return '<span class="tag stock-tag low">Últimas ' + amount + " unidades</span>";
  return '<span class="tag stock-tag">Em estoque</span>';
}

function setMetaDescription(text) {
  var meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "description";
    document.head.appendChild(meta);
  }
  meta.content = text;
}

function injectProductSchema(product, image) {
  var schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    brand: { "@type": "Brand", name: product.brand },
    category: product.category,
    description: product.description,
    image: /^https:/.test(image) ? image : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: product.price.toFixed(2),
      availability: product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: window.location.href
    }
  };
  var script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(schema);
  document.head.appendChild(script);
}
