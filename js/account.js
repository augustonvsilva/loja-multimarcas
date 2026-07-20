document.addEventListener("DOMContentLoaded", function () {
  var session = window.JSMP.getSession();
  if (!session) {
    window.location.href = "./login.html";
    return;
  }

  document.querySelector("#account-details").innerHTML = [
    '<span class="eyebrow">Minha conta</span>',
    "<h1>Ola, " + escapeAccountText(session.name) + "</h1>",
    '<div class="summary-list">',
    '<div class="summary-line"><span>Nome</span><strong>' + escapeAccountText(session.name) + "</strong></div>",
    '<div class="summary-line"><span>Email</span><strong>' + escapeAccountText(session.email) + "</strong></div>",
    "</div>"
  ].join("");

  var orders = window.JSMP.getOrders().filter(function (order) {
    return order.customerEmail && order.customerEmail.toLowerCase() === String(session.email).toLowerCase();
  });
  document.querySelector("#account-orders").innerHTML = [
    '<div id="pedidos" class="summary-card">',
    "<h3>Meus pedidos</h3>",
    orders.length ? orders.map(function (order) {
      return '<div class="summary-line"><span>Pedido #' + order.id + '<br><small class="muted-text">' + new Date(order.createdAt).toLocaleDateString("pt-BR") + '</small></span><strong>' + formatCurrency(order.total) + "</strong></div>";
    }).join("") : '<p class="muted-text">Voce ainda nao possui pedidos registrados.</p>',
    "</div>"
  ].join("");
});

function escapeAccountText(value) {
  return String(value || "").replace(/[&<>\"']/g, function (character) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character];
  });
}
