document.addEventListener("DOMContentLoaded", function () {
  renderPaymentSummary();
  setupPaymentBrick();
});

function apiUrl(path) { return getApiUrl(path); }

function renderPaymentSummary() {
  var items = window.JSMP.getCartDetails();
  var orderNode = document.querySelector("#payment-summary");
  if (!items.length) { orderNode.innerHTML = '<div class="summary-card"><p class="muted-text">Nenhum item no carrinho.</p></div>'; return; }
  var subtotal = items.reduce(function (sum, item) { return sum + item.subtotal; }, 0);
  var shipping = getCheckoutShipping();
  orderNode.innerHTML = '<div class="summary-card"><h3>Seu pedido</h3><div class="summary-list">' + items.map(function (item) {
    return '<div class="summary-line"><span>' + item.name + " x" + item.quantity + '</span><strong>' + formatCurrency(item.subtotal) + "</strong></div>";
  }).join("") + '<div class="summary-line"><span>' + shipping.label + '</span><strong>' + formatCurrency(shipping.amount) + '</strong></div><div class="summary-line"><span>Total final</span><strong class="product-price">' + formatCurrency(subtotal + shipping.amount) + "</strong></div></div></div>";
}

async function setupPaymentBrick() {
  var items = window.JSMP.getCartDetails();
  if (!items.length) { setPaymentFeedback("Adicione itens ao carrinho para continuar.", "error"); return; }
  try {
    var configResponse = await fetch(apiUrl("/api/payments/config"));
    var config = await configResponse.json();
    if (!configResponse.ok || !config.ok) throw new Error(config.message || "Nao foi possivel carregar o pagamento.");
    if (!window.MercadoPago) throw new Error("O Mercado Pago nao carregou. Atualize a pagina e tente novamente.");

    var mp = new MercadoPago(config.publicKey, { locale: "pt-BR" });
    var bricksBuilder = mp.bricks();
    await bricksBuilder.create("payment", "paymentBrick_container", {
      initialization: { amount: getCheckoutTotal(), payer: { email: (window.JSMP.getSession() || {}).email || "" } },
      customization: { paymentMethods: { creditCard: "all", debitCard: "all", bankTransfer: "all" } },
      callbacks: {
        onReady: function () { setPaymentFeedback("Escolha a forma de pagamento para concluir.", ""); },
        onSubmit: function (data) {
          try { return submitBrickPayment(data.formData, buildOrderPayload()); }
          catch (error) { setPaymentFeedback(error.message, "error"); return Promise.reject(error); }
        },
        onError: function () { setPaymentFeedback("Nao foi possivel carregar uma opcao de pagamento.", "error"); }
      }
    });
  } catch (error) { setPaymentFeedback(error.message || "Erro ao iniciar o pagamento.", "error"); }
}

function buildOrderPayload() {
  var items = window.JSMP.getCartDetails();
  var shipping = getCheckoutShipping();
  var session = window.JSMP.getSession();
  var subtotal = items.reduce(function (sum, item) { return sum + item.subtotal; }, 0);
  return { customerName: session ? session.name : "Cliente visitante", customerEmail: session ? session.email : "", shippingMethod: shipping.method, shipping: shipping.amount, shippingLabel: shipping.label, deliveryAddress: getDeliveryAddress(shipping), subtotal: subtotal, total: Number((subtotal + shipping.amount).toFixed(2)), items: items.map(function (item) { return { productId: item.productId, name: item.name, brand: item.brand, quantity: item.quantity, size: item.size || "", number: item.number || "", price: item.price, subtotal: item.subtotal }; }) };
}

function getCheckoutTotal() {
  var items = window.JSMP.getCartDetails();
  var shipping = getCheckoutShipping();
  return Number((items.reduce(function (sum, item) { return sum + item.subtotal; }, 0) + shipping.amount).toFixed(2));
}

function getDeliveryAddress(shipping) {
  var address = { street: document.querySelector("#delivery-street").value.trim(), number: document.querySelector("#delivery-number").value.trim(), complement: document.querySelector("#delivery-complement").value.trim(), neighborhood: document.querySelector("#delivery-neighborhood").value.trim(), city: document.querySelector("#delivery-city").value.trim(), cep: shipping.cep || "" };
  if (shipping.method !== "retirada" && (!address.street || !address.number || !address.neighborhood || !address.city)) throw new Error("Informe o endereco completo para a entrega.");
  return address;
}

function submitBrickPayment(formData, order) {
  return new Promise(function (resolve, reject) {
    fetch(apiUrl("/api/payments/process"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formData: formData, order: order }) })
      .then(function (response) { return response.json().then(function (data) { return { response: response, data: data }; }); })
      .then(function (result) {
        if (!result.response.ok || !result.data.ok) throw new Error(result.data.message || "Pagamento nao processado.");
        handlePaymentResult(result.data, order);
        resolve();
      })
      .catch(function (error) { setPaymentFeedback(error.message || "Erro ao processar pagamento.", "error"); reject(); });
  });
}

function handlePaymentResult(payment, order) {
  if (payment.status === "approved") {
    order.paymentMethod = resolvePaymentMethod(payment.paymentType);
    var result = window.JSMP.createOrder(order);
    if (!result.ok) { setPaymentFeedback(result.message, "error"); return; }
    window.JSMP.clearCart(); clearCartShipping(); setupHeader(); renderPaymentSummary();
    setPaymentFeedback("Pagamento aprovado pelo Mercado Pago. Pedido registrado com sucesso.", "success");
    return;
  }
  if (payment.pix && payment.pix.qrCodeBase64) {
    showPixCode(payment.pix, payment.id);
    setPaymentFeedback("PIX gerado. Escaneie o QR Code ou copie o codigo para pagar.", "success");
    return;
  }
  setPaymentFeedback("Pagamento em processamento: " + (payment.statusDetail || payment.status) + ".", "");
}

function showPixCode(pix, paymentId) {
  var node = document.querySelector("#pix-result");
  node.innerHTML = '<div class="summary-card"><h3>Pagamento PIX</h3><img class="pix-qr-code" src="data:image/png;base64,' + pix.qrCodeBase64 + '" alt="QR Code PIX"><label for="pix-copy-code">PIX Copia e Cola</label><textarea id="pix-copy-code" class="input" readonly>' + escapePaymentText(pix.qrCode || "") + '</textarea><p class="muted-text">Pagamento #' + paymentId + " aguardando confirmacao.</p></div>";
}

function resolvePaymentMethod(type) { return type === "bank_transfer" ? "pix" : type === "debit_card" ? "debito" : "credito"; }
function setPaymentFeedback(message, tone) { var node = document.querySelector("#payment-feedback"); node.className = "feedback" + (tone ? " " + tone : ""); node.textContent = message; }
function escapePaymentText(value) { return String(value || "").replace(/[&<>\"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
function getCheckoutShipping() { return getCartShipping() || { method: "retirada", label: "Retirada na loja", amount: 0 }; }
