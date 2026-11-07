// Checkout: dados do cliente, endereco, pagamento via Mercado Pago Bricks e acompanhamento do pedido.
var checkoutState = { items: [], shipping: null, subtotal: 0, total: 0, brick: null, brickAmount: null, brickSeq: 0, addressCep: "", pollTimer: null };

document.addEventListener("DOMContentLoaded", function () {
  if (!document.querySelector("#checkout-root")) return;

  var lastOrder = window.JSMP.getLastOrder();
  if (lastOrder && lastOrder.status === "pending" && Date.now() - lastOrder.createdAt < 60 * 60 * 1000) {
    showOrderResult(lastOrder);
    return;
  }
  if (!window.JSMP.getCart().length) {
    showEmpty();
    return;
  }

  setPaymentFeedback("Carregando...", "");
  window.JSMP.loadProducts().then(prepareCheckout).catch(function (error) {
    setPaymentFeedback(error.message, "error");
  });
});

function showEmpty() {
  document.querySelector("#checkout-root").innerHTML = '<div class="empty-state">Seu carrinho está vazio. <a href="./produtos.html">Ver produtos</a></div>';
}

function prepareCheckout(products) {
  var items = window.JSMP.getCartDetails(products);
  if (!items.length) return showEmpty();
  if (items.some(function (item) { return item.quantity > item.stock; })) {
    window.location.href = "./carrinho.html";
    return;
  }
  checkoutState.items = items;
  checkoutState.subtotal = items.reduce(function (sum, item) { return sum + item.subtotal; }, 0);
  setupCustomerForm();
  setupShippingPicker();

  // Recalcula o frete salvo (o valor depende do carrinho atual).
  var saved = window.JSMP.getShipping();
  if (saved && saved.cep) {
    document.querySelector("#checkout-cep").value = formatCep(saved.cep);
    quoteAndSaveShipping(saved.cep).catch(function (error) {
      showShippingFeedback(error.message, "error");
    }).then(applyShipping);
  } else {
    applyShipping();
  }
}

// ---------- Entrega ----------

function setupShippingPicker() {
  var cepInput = document.querySelector("#checkout-cep");
  maskCepInput(cepInput);
  var calc = function () {
    showShippingFeedback("Consultando frete...", "");
    quoteAndSaveShipping(cepInput.value).then(function (result) {
      if (!result) return showShippingFeedback("Digite um CEP válido com 8 números.", "error");
      showShippingFeedback("", "");
      applyShipping();
    }).catch(function (error) {
      showShippingFeedback(error.message, "error");
    });
  };
  document.querySelector("#checkout-calc-shipping").addEventListener("click", calc);
  cepInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      calc();
    }
  });
  document.querySelector("#checkout-shipping-options").addEventListener("change", function (event) {
    if (event.target.name !== "checkout-shipping-method") return;
    selectShippingOption(event.target.value);
    applyShipping();
  });
}

function showShippingFeedback(message, tone) {
  var node = document.querySelector("#checkout-shipping-feedback");
  node.className = "shipping-result" + (tone ? " " + tone : "");
  node.textContent = message;
  node.hidden = !message;
}

// Atualiza resumo, endereco e pagamento conforme a entrega escolhida.
function applyShipping() {
  var shipping = window.JSMP.getShipping();
  checkoutState.shipping = shipping && shipping.selected ? shipping : null;
  var amount = checkoutState.shipping ? checkoutState.shipping.selected.amount : 0;
  checkoutState.total = Number((checkoutState.subtotal + amount).toFixed(2));

  document.querySelector("#checkout-shipping-options").innerHTML = buildShippingChoices(shipping, "checkout-shipping-method");
  renderSummary();
  updateDeliveryFields();

  if (!checkoutState.shipping) {
    unmountBrick();
    setPaymentFeedback("Escolha como quer receber para ver as formas de pagamento.", "");
    return;
  }
  if (!checkoutState.brick || checkoutState.brickAmount !== checkoutState.total) {
    refreshBrick();
  }
}

function renderSummary() {
  var shipping = checkoutState.shipping ? checkoutState.shipping.selected : null;
  var shippingLine = shipping
    ? '<div class="summary-line"><span>' + escapeHtml(shipping.label) + (checkoutState.shipping.cep && shipping.method !== "retirada" ? " · CEP " + formatCep(checkoutState.shipping.cep) : "") + "</span><strong>" + (shipping.amount ? formatCurrency(shipping.amount) : "Grátis") + "</strong></div>"
    : '<div class="summary-line"><span>Entrega</span><strong>a escolher</strong></div>';
  document.querySelector("#payment-summary").innerHTML = [
    '<div class="summary-card">',
    "<h3>Seu pedido</h3>",
    '<div class="summary-list">',
    checkoutState.items.map(function (item) {
      var variation = item.size ? " · Tam. " + item.size : item.number ? " · Nº " + item.number : "";
      return '<div class="summary-line"><span>' + item.quantity + "x " + escapeHtml(item.name + variation) + "</span><strong>" + formatCurrency(item.subtotal) + "</strong></div>";
    }).join(""),
    shippingLine,
    '<div class="summary-line"><span>Total</span><strong class="product-price">' + formatCurrency(checkoutState.total) + "</strong></div>",
    "</div>",
    '<p class="muted-text">' + (shipping ? escapeHtml(shipping.deadline || "") + ". " : "") + '<a href="./carrinho.html">Editar carrinho</a></p>',
    "</div>"
  ].join("");
}

function setupCustomerForm() {
  var user = window.JSMP.getUser();
  var form = document.querySelector("#customer-form");
  if (user && user.role === "customer") {
    form.customerName.value = user.name || "";
    form.customerEmail.value = user.email || "";
    form.customerEmail.readOnly = true;
  }

  var phone = form.customerPhone;
  phone.addEventListener("input", function () {
    var d = phone.value.replace(/\D/g, "").slice(0, 11);
    phone.value = d.length > 6 ? "(" + d.slice(0, 2) + ") " + d.slice(2, d.length - 4) + "-" + d.slice(-4) : d.length > 2 ? "(" + d.slice(0, 2) + ") " + d.slice(2) : d;
  });
}

// Mostra o endereco so para entrega em casa e o preenche pelo CEP escolhido.
function updateDeliveryFields() {
  var form = document.querySelector("#customer-form");
  var shipping = checkoutState.shipping;
  var isDelivery = Boolean(shipping && shipping.selected.method !== "retirada");
  document.querySelector("#delivery-address-fields").hidden = !isDelivery;
  document.querySelectorAll("#delivery-address-fields [data-required]").forEach(function (input) {
    input.required = isDelivery;
  });
  if (!isDelivery || shipping.cep === checkoutState.addressCep) return;

  var cep = shipping.cep;
  checkoutState.addressCep = cep;
  form.cep.value = formatCep(cep);
  lookupAddress(cep).then(function (address) {
    if (!address || checkoutState.addressCep !== cep) return;
    form.street.value = address.logradouro || "";
    form.neighborhood.value = address.bairro || "";
    form.city.value = address.localidade || "";
    form.state.value = address.uf || "";
    if (form.street.value) form.number.focus({ preventScroll: true });
  });
}

function readCustomerForm() {
  var form = document.querySelector("#customer-form");
  if (!checkoutState.shipping) {
    throw new Error("Escolha como quer receber o pedido.");
  }
  if (!form.reportValidity()) {
    throw new Error("Preencha seus dados e o endereço antes de pagar.");
  }
  return {
    customer: {
      name: form.customerName.value.trim(),
      email: form.customerEmail.value.trim(),
      phone: form.customerPhone.value.trim()
    },
    address: {
      cep: checkoutState.shipping.cep,
      street: form.street.value.trim(),
      number: form.number.value.trim(),
      complement: form.complement.value.trim(),
      neighborhood: form.neighborhood.value.trim(),
      city: form.city.value.trim(),
      state: form.state.value.trim()
    }
  };
}

function mountPaymentBrick() {
  return window.JSMP.request("GET", "/api/payments/config", undefined, { auth: false }).then(function (config) {
    if (!window.MercadoPago) throw new Error("O modulo de pagamento não carregou. Atualize a página.");
    if (config.testMode) {
      document.querySelector("#test-mode-banner").hidden = false;
    }
    var mp = new MercadoPago(config.publicKey, { locale: "pt-BR" });
    var customer = window.JSMP.getUser();
    return mp.bricks().create("payment", "paymentBrick_container", {
      initialization: {
        amount: checkoutState.total,
        payer: { email: customer && customer.role === "customer" ? customer.email : "" }
      },
      customization: {
        paymentMethods: { creditCard: "all", debitCard: "all", bankTransfer: "all", maxInstallments: 12 },
        visual: { style: { theme: "dark" } }
      },
      callbacks: {
        onReady: function () {
          // Limpa so o "Carregando"; uma recusa de pagamento continua visivel.
          var node = document.querySelector("#payment-feedback");
          if (node && /^Carregando/.test(node.textContent)) setPaymentFeedback("", "");
        },
        onSubmit: function (data) {
          return submitPayment(data.formData);
        },
        onError: function (error) {
          console.error(error);
          setPaymentFeedback("Não foi possível carregar uma opção de pagamento. Atualize a página.", "error");
        }
      }
    });
  });
}

// (Re)monta o formulario de pagamento com o total atual. Se o cliente trocar a
// entrega enquanto ele carrega, a montagem antiga e descartada.
function refreshBrick() {
  var seq = ++checkoutState.brickSeq;
  var amount = checkoutState.total;
  unmountBrick();
  setPaymentFeedback("Carregando formas de pagamento...", "");
  mountPaymentBrick().then(function (controller) {
    if (seq !== checkoutState.brickSeq) {
      controller.unmount();
      return;
    }
    checkoutState.brick = controller;
    checkoutState.brickAmount = amount;
  }).catch(function (error) {
    setPaymentFeedback(error.message, "error");
  });
}

function unmountBrick() {
  if (checkoutState.brick) {
    checkoutState.brick.unmount();
    checkoutState.brick = null;
  }
  checkoutState.brickAmount = null;
}

function submitPayment(formData) {
  var details;
  try {
    details = readCustomerForm();
  } catch (error) {
    setPaymentFeedback(error.message, "error");
    document.querySelector("#customer-form").scrollIntoView({ behavior: "smooth" });
    return Promise.reject(error);
  }

  setPaymentFeedback("Processando pagamento...", "");
  return window.JSMP.request("POST", "/api/checkout", {
    cart: window.JSMP.cartPayload(),
    shipping: { method: checkoutState.shipping.selected.method, cep: checkoutState.shipping.cep },
    customer: details.customer,
    address: details.address,
    formData: formData
  }).then(function (result) {
    if (result.status === "rejected" || result.status === "cancelled") {
      var message = rejectionMessage(result.statusDetail);
      refreshBrick();
      setPaymentFeedback(message, "error");
      return;
    }
    var order = {
      orderId: result.orderId,
      token: result.orderToken,
      status: result.status,
      total: result.total,
      pix: result.pix,
      createdAt: Date.now()
    };
    window.JSMP.clearCart();
    window.JSMP.invalidateProducts();
    setupHeader();
    window.JSMP.saveLastOrder(order);
    showOrderResult(order);
  }).catch(function (error) {
    setPaymentFeedback(error.message, "error");
    throw error;
  });
}

function rejectionMessage(detail) {
  var messages = {
    cc_rejected_insufficient_amount: "Pagamento recusado: saldo ou limite insuficiente.",
    cc_rejected_bad_filled_security_code: "Pagamento recusado: confira o código de segurança do cartão.",
    cc_rejected_bad_filled_date: "Pagamento recusado: confira a validade do cartão.",
    cc_rejected_bad_filled_other: "Pagamento recusado: confira os dados do cartão.",
    cc_rejected_call_for_authorize: "Pagamento recusado: autorize a compra com o banco emissor e tente novamente.",
    cc_rejected_high_risk: "Pagamento recusado por segurança. Tente outro cartão ou pague com PIX."
  };
  return messages[detail] || "Pagamento não aprovado. Tente outro cartão ou pague com PIX.";
}

function showOrderResult(order) {
  var root = document.querySelector("#checkout-root");
  var paid = order.status === "paid";
  var pix = order.pix;
  root.innerHTML = [
    '<div class="admin-card order-result">',
    '<span class="eyebrow">Pedido #' + escapeHtml(order.orderId) + "</span>",
    "<h2>" + (paid ? "Pagamento aprovado!" : pix ? "Pague com PIX para concluir" : "Pagamento em análise") + "</h2>",
    paid
      ? '<p class="muted-text">Recebemos seu pedido e já vamos separar os produtos. Você recebera as atualizações pelo email e WhatsApp informados.</p>'
      : pix
        ? '<p class="muted-text">Escaneie o QR Code no app do seu banco ou use o PIX Copia e Cola. O código expira em 30 minutos. Esta página atualiza sozinha quando o pagamento for confirmado.</p>'
        : '<p class="muted-text">O Mercado Pago está analisando o pagamento. Esta página atualiza sozinha.</p>',
    pix && !paid ? [
      '<img class="pix-qr-code" src="data:image/png;base64,' + escapeHtml(pix.qrCodeBase64) + '" alt="QR Code PIX" width="240" height="240">',
      '<label for="pix-copy-code">PIX Copia e Cola</label>',
      '<textarea id="pix-copy-code" class="input" readonly rows="3">' + escapeHtml(pix.qrCode) + "</textarea>",
      '<button class="btn-secondary" type="button" id="copy-pix">Copiar código PIX</button>'
    ].join("") : "",
    '<div id="order-status" class="feedback' + (paid ? " success" : "") + '" role="status">' + (paid ? "Pedido confirmado." : "Aguardando confirmação do pagamento...") + "</div>",
    '<div class="button-row"><a class="btn" href="./produtos.html">Continuar comprando</a>' + (window.JSMP.getUser() ? '<a class="btn-ghost" href="./conta.html#pedidos">Meus pedidos</a>' : "") + "</div>",
    "</div>"
  ].join("");
  document.querySelector("#payment-summary").innerHTML = "";

  var copy = document.querySelector("#copy-pix");
  if (copy) {
    copy.addEventListener("click", function () {
      var field = document.querySelector("#pix-copy-code");
      field.select();
      (navigator.clipboard ? navigator.clipboard.writeText(field.value) : Promise.reject()).catch(function () {
        document.execCommand("copy");
      });
      showToast("Código PIX copiado.", "success");
    });
  }

  if (paid) {
    window.JSMP.clearLastOrder();
  } else {
    pollOrder(order);
  }
}

function pollOrder(order) {
  clearTimeout(checkoutState.pollTimer);
  var startedAt = Date.now();
  var check = function () {
    window.JSMP.request("GET", "/api/orders/" + encodeURIComponent(order.orderId) + "?token=" + encodeURIComponent(order.token), undefined, { auth: false })
      .then(function (data) {
        var status = data.order.status;
        if (status === "pending") {
          if (Date.now() - startedAt < 45 * 60 * 1000) checkoutState.pollTimer = setTimeout(check, 5000);
          return;
        }
        window.JSMP.clearLastOrder();
        if (status === "paid" || status === "preparing" || status === "shipped" || status === "delivered") {
          showOrderResult(Object.assign({}, order, { status: "paid" }));
        } else {
          var node = document.querySelector("#order-status");
          node.className = "feedback error";
          node.textContent = "O pagamento não foi concluído (PIX expirado ou recusado). Seus produtos continuam disponíveis na loja.";
        }
      })
      .catch(function () {
        checkoutState.pollTimer = setTimeout(check, 10000);
      });
  };
  checkoutState.pollTimer = setTimeout(check, 4000);
}

function setPaymentFeedback(message, tone) {
  var node = document.querySelector("#payment-feedback");
  if (!node) return;
  node.className = "feedback" + (tone ? " " + tone : "");
  node.textContent = message;
  node.hidden = !message;
}
