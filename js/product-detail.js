document.addEventListener("DOMContentLoaded", function () {
  var root = document.querySelector("#product-detail");
  if (!root) {
    return;
  }

  var params = new URLSearchParams(window.location.search);
  var productId = Number(params.get("id"));
  var product = window.JSMP.getProductById(productId);

  if (!product) {
    root.innerHTML = '<div class="empty-state">Produto nao encontrado. Volte para o catalogo e escolha outro item.</div>';
    return;
  }

  renderProductDetail(root, product);
});

function renderProductDetail(root, product) {
  root.innerHTML = [
    '<article class="glass-panel product-detail-card reveal">',
    '<div class="product-detail-media">',
    '<img id="product-main-image" class="product-detail-image" src="' + product.image + '" alt="' + product.name + '">',
    '<div class="product-gallery">',
    (product.images || [product.image]).map(function (image, index) {
      return '<button class="product-thumb-button' + (index === 0 ? ' active' : '') + '" type="button" data-product-thumb="' + image + '"><img class="product-thumb-image" src="' + image + '" alt="' + product.name + '"></button>';
    }).join(""),
    "</div>",
    "</div>",
    '<div class="product-detail-content">',
    '<div class="tag-list"><span class="badge">' + product.brand + '</span><span class="tag">' + (product.category || "Sem categoria") + "</span></div>",
    "<h1>" + product.name + "</h1>",
    '<strong class="product-price">' + formatCurrency(product.price) + "</strong>",
    '<div class="tag-list">' + buildStockTag(product.stock) + "</div>",
    '<p class="page-subtitle">' + product.description + "</p>",
    buildDetailLines(product),
    '<section class="shipping-card shipping-card-product">',
    '<div class="shipping-card-header">',
    "<div>",
    '<span class="eyebrow">Entrega</span>',
    "<h3>Consulte o frete</h3>",
    "</div>",
    '<p class="muted-text">Saida da loja no Pan-Americano, Jaragua-SP.</p>',
    "</div>",
    '<div class="shipping-card-form">',
    '<div class="shipping-input-wrap">',
    '<label for="product-cep">CEP</label>',
    '<input class="input shipping-input" id="product-cep" type="text" inputmode="numeric" placeholder="00000-000" maxlength="9">',
    "</div>",
    '<button class="btn-secondary shipping-action" id="product-shipping-button" type="button">Calcular</button>',
    "</div>",
    '<div id="product-shipping-feedback" class="shipping-result">Informe seu CEP para ver retirada, entrega local e Correios.</div>',
    "</section>",
    '<form id="product-purchase-form" class="form-grid product-purchase-form">',
    buildVariantFields(product),
    '<div class="field-full">',
    '<button class="btn" type="submit"' + (Number(product.stock || 0) > 0 ? "" : " disabled") + '>Adicionar ao carrinho</button>',
    '<a class="btn-secondary" href="./produtos.html">Voltar ao catalogo</a>',
    "</div>",
    "</form>",
    '<div id="product-feedback" class="feedback">' + buildFeedbackMessage(product) + "</div>",
    "</div>",
    "</article>"
  ].join("");

  document.querySelectorAll("[data-product-thumb]").forEach(function (button) {
    button.addEventListener("click", function () {
      document.querySelector("#product-main-image").src = button.getAttribute("data-product-thumb");
      document.querySelectorAll("[data-product-thumb]").forEach(function (item) {
        item.classList.remove("active");
      });
      button.classList.add("active");
    });
  });

  document.querySelector("#product-shipping-button").addEventListener("click", function () {
    var cep = document.querySelector("#product-cep").value;
    var feedback = document.querySelector("#product-shipping-feedback");
    feedback.className = "shipping-result";
    feedback.textContent = "Consultando frete...";

    quoteShipping(cep, product.price, 1).then(function (result) {
      if (!result) {
        feedback.className = "shipping-result error";
        feedback.textContent = "Digite um CEP valido com 8 numeros.";
        return;
      }

      feedback.className = "shipping-result success";
      feedback.innerHTML = [
        '<strong>Opcoes para ' + (result.formattedCep || result.cep) + "</strong>",
        buildProductShippingOptions(result.options)
      ].join("");
    });
  });

  document.querySelector("#product-purchase-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var sizeField = event.target.size;
    var numberField = event.target.number;
    var size = sizeField ? sizeField.value : "";
    var number = numberField ? numberField.value : "";
    var feedback = document.querySelector("#product-feedback");

    if (product.hasSizes && !size) {
      feedback.className = "feedback error";
      feedback.textContent = "Selecione o tamanho para continuar.";
      return;
    }

    if (product.hasNumbers && !number) {
      feedback.className = "feedback error";
      feedback.textContent = "Selecione a numeracao para continuar.";
      return;
    }

    if (Number(product.stock || 0) <= 0) {
      feedback.className = "feedback error";
      feedback.textContent = "Este produto esta indisponivel no momento.";
      return;
    }

    var result = window.JSMP.addToCart(product.id, {
      size: size,
      number: number
    });

    if (!result.ok) {
      feedback.className = "feedback error";
      feedback.textContent = result.message;
      return;
    }

    feedback.className = "feedback success";
    feedback.textContent = "Produto adicionado ao carrinho com sucesso.";
    setupHeader();
  });
}

function buildProductShippingOptions(options) {
  return '<div class="shipping-options compact">' + options.map(function (option) {
    return [
      '<div class="shipping-option static">',
      "<span>",
      "<strong>" + option.label + " - " + formatCurrency(option.amount) + "</strong>",
      '<small>' + option.deadline + ". " + option.description + "</small>",
      "</span>",
      "</div>"
    ].join("");
  }).join("") + "</div>";
}

function buildDetailLines(product) {
  var lines = [];

  if (product.hasSizes && product.sizes.length) {
    lines.push('<div class="detail-row">Disponivel em tamanhos: ' + product.sizes.join(", ") + "</div>");
  }

  if (product.hasNumbers && product.numbers.length) {
    lines.push('<div class="detail-row">Numeracao: ' + product.numbers.join(", ") + "</div>");
  }

  if (!lines.length) {
    lines.push('<div class="detail-row">Produto sem grade obrigatoria.</div>');
  }

  lines.push('<div class="detail-row">Estoque disponivel: ' + Number(product.stock || 0) + " unidade(s).</div>");

  return lines.join("");
}

function buildVariantFields(product) {
  var fields = [];

  if (product.hasSizes) {
    fields.push([
      '<div class="field">',
      '<label for="selected-size">Tamanho</label>',
      '<select class="select" id="selected-size" name="size" required>',
      '<option value="">Selecione</option>',
      product.sizes.map(function (size) {
        return '<option value="' + size + '">' + size + "</option>";
      }).join(""),
      "</select>",
      "</div>"
    ].join(""));
  }

  if (product.hasNumbers) {
    fields.push([
      '<div class="field">',
      '<label for="selected-number">Numeracao</label>',
      '<select class="select" id="selected-number" name="number" required>',
      '<option value="">Selecione</option>',
      product.numbers.map(function (number) {
        return '<option value="' + number + '">' + number + "</option>";
      }).join(""),
      "</select>",
      "</div>"
    ].join(""));
  }

  return fields.join("");
}

function buildFeedbackMessage(product) {
  if (product.hasSizes && product.hasNumbers) {
    return "Escolha o tamanho e a numeracao antes de adicionar.";
  }

  if (product.hasSizes) {
    return "Escolha o tamanho antes de adicionar.";
  }

  if (product.hasNumbers) {
    return "Escolha a numeracao antes de adicionar.";
  }

  return "Produto pronto para adicionar ao carrinho.";
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
