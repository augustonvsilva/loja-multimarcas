function renderAdminOrders() {
  var target = document.querySelector("#admin-orders");
  if (!target) return;
  var orders = window.JSMP.getOrders();
  target.innerHTML = orders.length ? orders.map(function (order) {
    var address = order.deliveryAddress || {};
    var addressText = order.shippingMethod === "retirada" ? "Retirada na loja" : [address.street, address.number, address.complement, address.neighborhood, address.city, address.cep ? "CEP " + formatCep(address.cep) : ""].filter(Boolean).join(", ") || "Endereco nao informado";
    var items = order.items.map(function (item) { var variation = item.size ? " • Tam. " + item.size : item.number ? " • Nº " + item.number : ""; return '<strong>' + item.quantity + "x " + escapeOrderText(item.name) + variation + "</strong>"; }).join("");
    return '<article class="admin-order-card"><div class="admin-order-header"><div><span class="eyebrow">Pedido #' + order.id + '</span><h2>' + escapeOrderText(order.customerName) + '</h2><p class="muted-text">' + escapeOrderText(order.customerEmail || "Cliente visitante") + " • " + new Date(order.createdAt).toLocaleString("pt-BR") + '</p></div><strong class="product-price">' + formatCurrency(order.total) + '</strong></div><div class="admin-order-details"><div><span>Produtos</span>' + items + '</div><div><span>Entrega escolhida</span><strong>' + escapeOrderText(order.shippingLabel || formatShippingMethod(order.shippingMethod)) + '</strong><small>' + formatCurrency(order.shipping || 0) + '</small></div><div><span>Endereco</span><strong>' + escapeOrderText(addressText) + '</strong></div></div></article>';
  }).join("") : '<div class="empty-state">Nenhum pedido registrado ainda.</div>';
}

function formatShippingMethod(method) { return { retirada: "Retirada na loja", "entrega-local": "Entrega local", "motoboy-sp": "Motoboy SP", "correios-pac": "Correios PAC", "correios-sedex": "Correios Sedex" }[method] || method; }
function escapeOrderText(value) { return String(value || "").replace(/[&<>\"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
