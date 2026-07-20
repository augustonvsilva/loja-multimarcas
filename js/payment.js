// Faz a validacao do formulario de pagamento e simula a conclusao da compra.
document.addEventListener("DOMContentLoaded", function () {
  var form = document.querySelector("#payment-form");
  var orderNode = document.querySelector("#payment-summary");
  if (!form || !orderNode) {
    return;
  }

  renderPaymentSummary();

  Array.from(form.querySelectorAll('input[name="paymentMethod"]')).forEach(function (input) {
    input.addEventListener("change", togglePaymentFields);
  });

  togglePaymentFields();

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    handlePaymentSubmission(form);
  });
});

function renderPaymentSummary() {
  var items = window.JSMP.getCartDetails();
  var orderNode = document.querySelector("#payment-summary");

  if (!items.length) {
    orderNode.innerHTML = '<div class="summary-card"><p class="muted-text">Nenhum item no carrinho. Volte ao catalogo para finalizar sua compra.</p></div>';
    return;
  }

  var subtotal = items.reduce(function (sum, item) {
    return sum + item.subtotal;
  }, 0);
  var shippingQuote = getCheckoutShipping();
  var shipping = shippingQuote.amount;
  var total = subtotal + shipping;

  orderNode.innerHTML = [
    '<div class="summary-card">',
    "<h3>Seu pedido</h3>",
    '<div class="summary-list">',
    items.map(function (item) {
      return '<div class="summary-line"><span>' + item.name + " x" + item.quantity + '</span><strong>' + formatCurrency(item.subtotal) + "</strong></div>";
    }).join(""),
    '<div class="summary-line"><span>' + shippingQuote.label + '</span><strong>' + formatCurrency(shipping) + "</strong></div>",
    '<p class="muted-text">' + shippingQuote.description + "</p>",
    '<div class="summary-line"><span>Total final</span><strong class="product-price">' + formatCurrency(total) + "</strong></div>",
    "</div>",
    "</div>"
  ].join("");
}

function togglePaymentFields() {
  var selected = document.querySelector('input[name="paymentMethod"]:checked').value;
  var cardFields = document.querySelectorAll("[data-card-field]");
  var pixBox = document.querySelector("#pix-box");

  cardFields.forEach(function (field) {
    field.style.display = selected === "pix" ? "none" : "flex";
  });

  pixBox.style.display = selected === "pix" ? "block" : "none";
}

function handlePaymentSubmission(form) {
  var feedback = document.querySelector("#payment-feedback");
  var items = window.JSMP.getCartDetails();

  if (!items.length) {
    feedback.className = "feedback error";
    feedback.textContent = "Seu carrinho esta vazio.";
    return;
  }

  var selected = document.querySelector('input[name="paymentMethod"]:checked').value;
  var subtotal = items.reduce(function (sum, item) {
    return sum + item.subtotal;
  }, 0);
  var shippingQuote = getCheckoutShipping();
  var shipping = shippingQuote.amount;
  var total = subtotal + shipping;
  var session = window.JSMP.getSession();

  if (selected !== "pix") {
    if (form.cardName.value.trim().length < 3 || form.cardNumber.value.trim().length < 16 || form.cardCode.value.trim().length < 3) {
      feedback.className = "feedback error";
      feedback.textContent = "Preencha corretamente os dados do cartao.";
      return;
    }
  }

  var orderResult = window.JSMP.createOrder({
    customerName: session ? session.name : "Cliente visitante",
    customerEmail: session ? session.email : "",
    paymentMethod: selected,
    shippingMethod: shippingQuote.method,
    subtotal: subtotal,
    shipping: shipping,
    total: total,
    items: items.map(function (item) {
      return {
        productId: item.productId,
        name: item.name,
        brand: item.brand,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.subtotal
      };
    })
  });

  if (!orderResult.ok) {
    feedback.className = "feedback error";
    feedback.textContent = orderResult.message;
    return;
  }

  feedback.className = "feedback success";
  feedback.textContent = "Pagamento aprovado na simulacao. Obrigado por comprar na JS Multimarcas Premium.";
  window.JSMP.clearCart();
  clearCartShipping();
  setupHeader();
  renderPaymentSummary();
  form.reset();
  document.querySelector('#credit-option').checked = true;
  togglePaymentFields();
}

function getCheckoutShipping() {
  return getCartShipping() || {
    method: "retirada",
    label: "Retirada na loja",
    amount: 0,
    deadline: "no mesmo dia util",
    description: "Retirada na Rua Jacinto Pereira, 151 - Pan-Americano, Jaragua-SP."
  };
}
