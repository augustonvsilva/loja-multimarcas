// Minha conta: dados do cliente e historico de pedidos (vindos do servidor).
var ORDER_STATUS_LABELS = {
  pending: "Aguardando pagamento",
  paid: "Pagamento aprovado",
  preparing: "Em separação",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  rejected: "Pagamento recusado"
};

document.addEventListener("DOMContentLoaded", function () {
  var details = document.querySelector("#account-details");
  if (!details) return;

  var user = window.JSMP.getUser();
  if (!user) {
    window.location.href = "./login.html?next=conta.html";
    return;
  }
  if (user.role === "admin") {
    window.location.href = "./admin/pedidos.html";
    return;
  }

  details.innerHTML = [
    '<span class="eyebrow">Minha conta</span>',
    "<h1>Olá, " + escapeHtml(String(user.name).split(" ")[0]) + "</h1>",
    '<div class="summary-list">',
    '<div class="summary-line"><span>Nome</span><strong>' + escapeHtml(user.name) + "</strong></div>",
    '<div class="summary-line"><span>Email</span><strong>' + escapeHtml(user.email) + "</strong></div>",
    "</div>",
    '<div class="button-row"><a class="btn-secondary" href="./produtos.html">Ver produtos</a><button class="btn-ghost" type="button" data-logout>Sair</button></div>'
  ].join("");
  setupHeader();

  var ordersNode = document.querySelector("#account-orders");
  ordersNode.innerHTML = loadingMarkup("Carregando pedidos...");
  window.JSMP.request("GET", "/api/account/orders").then(function (data) {
    ordersNode.innerHTML = [
      '<div id="pedidos" class="summary-card">',
      "<h3>Meus pedidos</h3>",
      data.orders.length ? data.orders.map(function (order) {
        return [
          '<details class="account-order">',
          "<summary>",
          "<span>Pedido #" + order.id + '<br><small class="muted-text">' + new Date(order.createdAt).toLocaleDateString("pt-BR") + "</small></span>",
          '<span class="status-pill status-' + escapeHtml(order.status) + '">' + escapeHtml(ORDER_STATUS_LABELS[order.status] || order.status) + "</span>",
          "<strong>" + formatCurrency(order.total) + "</strong>",
          "</summary>",
          '<div class="summary-list">',
          order.items.map(function (item) {
            var variation = item.size ? " · Tam. " + item.size : item.number ? " · Nº " + item.number : "";
            return '<div class="summary-line"><span>' + item.quantity + "x " + escapeHtml(item.name + variation) + "</span><strong>" + formatCurrency(item.subtotal) + "</strong></div>";
          }).join(""),
          '<div class="summary-line"><span>' + escapeHtml(order.shippingLabel) + "</span><strong>" + formatCurrency(order.shipping) + "</strong></div>",
          "</div>",
          "</details>"
        ].join("");
      }).join("") : '<p class="muted-text">Você ainda não possui pedidos.</p>',
      "</div>"
    ].join("");
  }).catch(function (error) {
    if (error.status === 401) {
      window.location.href = "./login.html?next=conta.html";
      return;
    }
    ordersNode.innerHTML = errorMarkup(error);
  });
});
