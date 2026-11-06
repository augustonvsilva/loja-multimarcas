// Pagina do carrinho: itens, quantidades, frete e resumo.
var cartProducts = [];

document.addEventListener("DOMContentLoaded", function () {
  if (!document.querySelector("#cart-items")) return;
  if (!window.JSMP.getCart().length) {
    renderCartPage();
    return;
  }
  document.querySelector("#cart-items").innerHTML = loadingMarkup("Carregando carrinho...");
  var render = function (products) {
    cartProducts = products;
    renderCartPage();
  };
  window.JSMP.loadProducts(render).then(render).catch(function (error) {
    document.querySelector("#cart-items").innerHTML = errorMarkup(error);
  });
});

function cartTotals(items) {
  return items.reduce(function (acc, item) {
    acc.subtotal += item.subtotal;
    acc.quantity += item.quantity;
    return acc;
  }, { subtotal: 0, quantity: 0 });
}

function renderCartPage() {
  var items = window.JSMP.getCartDetails(cartProducts);
  var listNode = document.querySelector("#cart-items");
  var summaryNode = document.querySelector("#cart-summary");
  setupHeader();

  if (!items.length) {
    listNode.innerHTML = '<div class="empty-state">Seu carrinho está vazio. <a href="./produtos.html">Ver produtos</a></div>';
    summaryNode.innerHTML = "";
    window.JSMP.clearShipping();
    return;
  }

  listNode.innerHTML = items.map(function (item) {
    var problem = item.stock <= 0
      ? '<p class="feedback error">Produto esgotado. Remova para continuar.</p>'
      : item.quantity > item.stock
        ? '<p class="feedback error">Apenas ' + item.stock + " unidade(s) disponível(is).</p>"
        : "";
    return [
      '<article class="cart-item reveal">',
      '<a href="./produto.html?id=' + item.productId + '"><img class="cart-thumb" src="' + escapeHtml(window.JSMP.imageUrl(item.image)) + '" alt="' + escapeHtml(item.name) + '"></a>',
      "<div>",
      '<span class="badge">' + escapeHtml(item.brand) + "</span>",
      "<h3>" + escapeHtml(item.name) + "</h3>",
      '<p class="muted-text">' + escapeHtml(buildCartVariationLabel(item)) + " · " + formatCurrency(item.price) + " cada</p>",
      '<div class="qty-stepper" role="group" aria-label="Quantidade">',
      '<button type="button" data-qty-step="-1" data-key="' + escapeHtml(item.key) + '" aria-label="Diminuir"' + (item.quantity <= 1 ? " disabled" : "") + ">−</button>",
      "<span>" + item.quantity + "</span>",
      '<button type="button" data-qty-step="1" data-key="' + escapeHtml(item.key) + '" aria-label="Aumentar"' + (item.quantity >= Math.min(item.stock, 10) ? " disabled" : "") + ">+</button>",
      "</div>",
      problem,
      "</div>",
      "<div>",
      '<strong class="product-price">' + formatCurrency(item.subtotal) + "</strong>",
      '<div class="button-row"><button class="btn-ghost" type="button" data-remove-item="' + escapeHtml(item.key) + '">Remover</button></div>',
      "</div>",
      "</article>"
    ].join("");
  }).join("");

  var totals = cartTotals(items);
  var shipping = window.JSMP.getShipping();
  var hasProblem = items.some(function (item) { return item.quantity > item.stock; });
  var shippingAmount = shipping && shipping.selected ? shipping.selected.amount : 0;

  summaryNode.innerHTML = [
    '<div class="summary-card">',
    "<h3>Resumo do pedido</h3>",
    '<div class="summary-list">',
    '<div class="summary-line"><span>Subtotal (' + totals.quantity + " itens)</span><strong>" + formatCurrency(totals.subtotal) + "</strong></div>",
    '<div class="summary-line"><span>' + (shipping && shipping.selected ? escapeHtml(shipping.selected.label) : "Frete") + "</span><strong>" + (shipping && shipping.selected ? (shippingAmount ? formatCurrency(shippingAmount) : "Grátis") : "a calcular") + "</strong></div>",
    '<div class="summary-line"><span>Total</span><strong class="product-price">' + formatCurrency(totals.subtotal + shippingAmount) + "</strong></div>",
    "</div>",
    '<section class="shipping-card shipping-card-cart">',
    '<div class="shipping-card-header"><div><span class="eyebrow">Entrega</span><h4>Como você quer receber?</h4></div></div>',
    '<div class="shipping-card-form">',
    '<div class="shipping-input-wrap"><label for="cart-cep">CEP</label><input class="input shipping-input" id="cart-cep" type="text" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" maxlength="9" value="' + escapeHtml(shipping ? formatCep(shipping.cep) : "") + '"></div>',
    '<button class="btn-secondary shipping-action" id="calc-cart-shipping" type="button">Calcular</button>',
    "</div>",
    '<div id="cart-shipping-options" class="shipping-options">' + buildCartShippingOptions(shipping) + "</div>",
    '<div id="cart-shipping-feedback" class="shipping-result">' + (shipping ? "" : 'Informe o CEP para ver as opções de entrega, ou <button class="link-button" type="button" id="choose-pickup">retire grátis na loja</button>.') + "</div>",
    "</section>",
    '<div class="button-row">',
    '<button class="btn" type="button" id="go-checkout"' + (hasProblem ? " disabled" : "") + ">Finalizar compra</button>",
    '<a class="btn-ghost" href="./produtos.html">Continuar comprando</a>',
    "</div>",
    "</div>"
  ].join("");

  attachCartEvents();
}

function buildCartVariationLabel(item) {
  if (item.size) return "Tamanho " + item.size;
  if (item.number) return "Número " + item.number;
  return "Tamanho único";
}

function buildCartShippingOptions(shipping) {
  if (!shipping || !shipping.options) return "";
  return shipping.options.map(function (option) {
    var checked = shipping.selected && shipping.selected.method === option.method;
    return [
      '<label class="shipping-option">',
      '<input type="radio" name="cart-shipping-method" value="' + escapeHtml(option.method) + '"' + (checked ? " checked" : "") + ">",
      "<span>",
      "<strong>" + escapeHtml(option.label) + " - " + (option.amount ? formatCurrency(option.amount) : "Grátis") + "</strong>",
      "<small>" + escapeHtml(option.deadline) + (option.source === "estimativa" ? " (valor estimado)" : "") + "</small>",
      "</span>",
      "</label>"
    ].join("");
  }).join("");
}

function calculateCartShipping() {
  var feedback = document.querySelector("#cart-shipping-feedback");
  var cep = document.querySelector("#cart-cep").value;
  feedback.className = "shipping-result";
  feedback.textContent = "Consultando frete...";
  quoteShipping(cep, { cart: window.JSMP.cartPayload() }).then(function (result) {
    if (!result) {
      feedback.className = "shipping-result error";
      feedback.textContent = "Digite um CEP válido com 8 números.";
      return;
    }
    var previous = window.JSMP.getShipping();
    var selected = result.options.find(function (o) { return previous && previous.selected && o.method === previous.selected.method; }) ||
      result.options.find(function (o) { return o.method !== "retirada"; }) || result.options[0];
    window.JSMP.saveShipping({ cep: result.cep, options: result.options, selected: selected });
    renderCartPage();
  }).catch(function (error) {
    feedback.className = "shipping-result error";
    feedback.textContent = error.message;
  });
}

function attachCartEvents() {
  document.querySelectorAll("[data-qty-step]").forEach(function (button) {
    button.addEventListener("click", function () {
      var key = button.getAttribute("data-key");
      var item = window.JSMP.getCart().find(function (entry) { return entry.key === key; });
      if (!item) return;
      window.JSMP.updateCartItem(key, item.quantity + Number(button.getAttribute("data-qty-step")));
      refreshShippingAfterCartChange();
    });
  });

  document.querySelectorAll("[data-remove-item]").forEach(function (button) {
    button.addEventListener("click", function () {
      window.JSMP.removeCartItem(button.getAttribute("data-remove-item"));
      refreshShippingAfterCartChange();
    });
  });

  var cepInput = document.querySelector("#cart-cep");
  maskCepInput(cepInput);
  cepInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      calculateCartShipping();
    }
  });
  document.querySelector("#calc-cart-shipping").addEventListener("click", calculateCartShipping);

  var pickup = document.querySelector("#choose-pickup");
  if (pickup) {
    pickup.addEventListener("click", function () {
      var option = { method: "retirada", label: "Retirada na loja", amount: 0, deadline: "no mesmo dia útil", source: "loja" };
      window.JSMP.saveShipping({ cep: "", options: [option], selected: option });
      renderCartPage();
    });
  }

  document.querySelectorAll('[name="cart-shipping-method"]').forEach(function (input) {
    input.addEventListener("change", function () {
      var shipping = window.JSMP.getShipping();
      shipping.selected = shipping.options.find(function (o) { return o.method === input.value; });
      window.JSMP.saveShipping(shipping);
      renderCartPage();
    });
  });

  document.querySelector("#go-checkout").addEventListener("click", function () {
    var shipping = window.JSMP.getShipping();
    if (!shipping || !shipping.selected) {
      var feedback = document.querySelector("#cart-shipping-feedback");
      feedback.className = "shipping-result error";
      feedback.textContent = "Calcule o frete e escolha como quer receber.";
      document.querySelector("#cart-cep").focus();
      return;
    }
    window.location.href = "./pagamento.html";
  });
}

// O valor do frete depende do carrinho; recalcula quando ele muda.
function refreshShippingAfterCartChange() {
  var shipping = window.JSMP.getShipping();
  renderCartPage();
  if (shipping && shipping.cep && window.JSMP.getCart().length) {
    calculateCartShipping();
  }
}
