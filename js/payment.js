var PENDING_CHECKOUT_KEY = "jsmp_pending_checkout";

document.addEventListener("DOMContentLoaded", function () {
  var form = document.querySelector("#payment-form");
  var orderNode = document.querySelector("#payment-summary");
  if (!form || !orderNode) return;

  renderPaymentSummary();
  checkReturnedPayment();
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    startMercadoPagoCheckout(form);
  });
});

function renderPaymentSummary() {
  var items = window.JSMP.getCartDetails();
  var orderNode = document.querySelector("#payment-summary");
  if (!items.length) {
    orderNode.innerHTML = '<div class="summary-card"><p class="muted-text">Nenhum item no carrinho.</p></div>';
    return;
  }

  var subtotal = items.reduce(function (sum, item) { return sum + item.subtotal; }, 0);
  var shippingQuote = getCheckoutShipping();
  var total = subtotal + shippingQuote.amount;
  orderNode.innerHTML = [
    '<div class="summary-card">', "<h3>Seu pedido</h3>", '<div class="summary-list">',
    items.map(function (item) {
      return '<div class="summary-line"><span>' + item.name + " x" + item.quantity + '</span><strong>' + formatCurrency(item.subtotal) + "</strong></div>";
    }).join(""),
    '<div class="summary-line"><span>' + shippingQuote.label + '</span><strong>' + formatCurrency(shippingQuote.amount) + "</strong></div>",
    '<div class="summary-line"><span>Total final</span><strong class="product-price">' + formatCurrency(total) + "</strong></div>",
    "</div></div>"
  ].join("");
}

function getApiBaseUrl() {
  return window.JSMP_API_BASE_URL || window.location.origin;
}

function apiUrl(path) {
  return getApiBaseUrl().replace(/\/$/, "") + path;
}

async function startMercadoPagoCheckout(form) {
  var items = window.JSMP.getCartDetails();
  if (!items.length) {
    setPaymentFeedback("Seu carrinho esta vazio.", "error");
    return;
  }

  var subtotal = items.reduce(function (sum, item) { return sum + item.subtotal; }, 0);
  var shippingQuote = getCheckoutShipping();
  var session = window.JSMP.getSession();
  var orderPayload = {
    customerName: session ? session.name : "Cliente visitante",
    customerEmail: session ? session.email : "",
    paymentMethod: "mercado-pago",
    shippingMethod: shippingQuote.method,
    subtotal: subtotal,
    shipping: shippingQuote.amount,
    total: subtotal + shippingQuote.amount,
    items: items.map(function (item) {
      return { productId: item.productId, name: item.name, brand: item.brand, quantity: item.quantity, price: item.price, subtotal: item.subtotal };
    })
  };

  form.querySelector("button[type=submit]").disabled = true;
  setPaymentFeedback("Criando checkout seguro...", "");
  try {
    var response = await fetch(apiUrl("/api/payments/checkout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({}, orderPayload, {
        shippingLabel: shippingQuote.label,
        siteUrl: window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "")
      }))
    });
    var data = await response.json();
    if (!response.ok || !data.ok || !data.checkoutUrl) throw new Error(data.message || "Nao foi possivel iniciar o pagamento.");
    localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify({ externalReference: data.externalReference, order: orderPayload }));
    window.location.assign(data.checkoutUrl);
  } catch (error) {
    setPaymentFeedback(error.message || "Erro ao conectar ao Mercado Pago.", "error");
    form.querySelector("button[type=submit]").disabled = false;
  }
}

async function checkReturnedPayment() {
  var query = new URLSearchParams(window.location.search);
  var paymentId = query.get("payment_id") || query.get("collection_id");
  if (!paymentId) return;

  var pending = readPendingCheckout();
  if (!pending) {
    setPaymentFeedback("Pagamento recebido. Nao localizamos o pedido neste navegador.", "error");
    return;
  }

  setPaymentFeedback("Confirmando pagamento com o Mercado Pago...", "");
  try {
    var response = await fetch(apiUrl("/api/payments/status?payment_id=" + encodeURIComponent(paymentId)));
    var data = await response.json();
    if (!response.ok || !data.ok || data.externalReference !== pending.externalReference) throw new Error(data.message || "Nao foi possivel validar o pagamento.");

    if (data.status === "approved") {
      pending.order.paymentMethod = resolvePaymentMethod(data.paymentType);
      var orderResult = window.JSMP.createOrder(pending.order);
      if (!orderResult.ok) throw new Error(orderResult.message);
      localStorage.removeItem(PENDING_CHECKOUT_KEY);
      window.JSMP.clearCart();
      clearCartShipping();
      setupHeader();
      renderPaymentSummary();
      setPaymentFeedback("Pagamento aprovado pelo Mercado Pago. Pedido registrado com sucesso.", "success");
    } else if (data.status === "pending" || data.status === "in_process") {
      setPaymentFeedback("Seu pagamento esta " + (data.status === "pending" ? "pendente" : "em analise") + ". Aguarde a confirmacao.", "");
    } else {
      localStorage.removeItem(PENDING_CHECKOUT_KEY);
      setPaymentFeedback("O pagamento nao foi aprovado. Voce pode tentar novamente.", "error");
    }
  } catch (error) {
    setPaymentFeedback(error.message || "Erro ao confirmar o pagamento.", "error");
  }
}

function readPendingCheckout() {
  try { return JSON.parse(localStorage.getItem(PENDING_CHECKOUT_KEY) || "null"); } catch (error) { return null; }
}

function resolvePaymentMethod(type) {
  if (type === "bank_transfer") return "pix";
  if (type === "debit_card") return "debito";
  return "credito";
}

function setPaymentFeedback(message, tone) {
  var feedback = document.querySelector("#payment-feedback");
  if (!feedback) return;
  feedback.className = "feedback" + (tone ? " " + tone : "");
  feedback.textContent = message;
}

function getCheckoutShipping() {
  return getCartShipping() || { method: "retirada", label: "Retirada na loja", amount: 0, deadline: "no mesmo dia util", description: "Retirada na loja." };
}
