// Painel administrativo: produtos, pedidos e faturamento (tudo via API autenticada).
var ADMIN_STATUS_LABELS = {
  pending: "Aguardando pagamento",
  paid: "Pago",
  preparing: "Em separação",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  rejected: "Recusado"
};
var REVENUE_STATUSES = ["paid", "preparing", "shipped", "delivered"];
var adminState = { products: [], orders: [], expenses: [], images: [] };

document.addEventListener("DOMContentLoaded", function () {
  var view = document.body.getAttribute("data-admin-view");
  if (!view) return;

  var user = window.JSMP.getUser();
  if (!user || user.role !== "admin") {
    showAdminGate();
    return;
  }

  window.JSMP.request("GET", "/api/auth/me").then(function (data) {
    if (data.user.role !== "admin") throw new Error("forbidden");
    document.querySelector("#admin-gate").hidden = true;
    document.querySelector("#admin-panel").hidden = false;
    document.querySelectorAll("[data-admin-link]").forEach(function (link) {
      link.classList.toggle("active", link.getAttribute("data-admin-link") === view);
    });
    if (view === "products") initProductsView();
    if (view === "orders") initOrdersView();
    if (view === "billing") initBillingView();
  }).catch(showAdminGate);
});

function showAdminGate() {
  document.querySelector("#admin-gate").hidden = false;
  document.querySelector("#admin-panel").hidden = true;
}

function adminRequest(method, path, body) {
  return window.JSMP.request(method, path, body).catch(function (error) {
    if (error.status === 401) {
      showAdminGate();
    }
    throw error;
  });
}

function setAdminFeedback(selector, message, tone) {
  var node = document.querySelector(selector);
  if (!node) return;
  node.className = "feedback " + (tone || "success");
  node.textContent = message;
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ======================= PRODUTOS =======================

function initProductsView() {
  var form = document.querySelector("#admin-form");
  ["price", "cost"].forEach(function (name) { form[name].addEventListener("input", updateProfitPreview); });
  form.images.addEventListener("change", handleImageSelection);
  form.hasSizes.addEventListener("change", updateMeasureGroups);
  form.hasNumbers.addEventListener("change", updateMeasureGroups);
  document.querySelector("#admin-search").addEventListener("input", renderAdminProducts);
  document.querySelector("[data-add-brand]").addEventListener("click", function () { addTaxonomy("brand"); });
  document.querySelector("[data-add-category]").addEventListener("click", function () { addTaxonomy("category"); });
  document.querySelector("#admin-form-reset").addEventListener("click", resetProductForm);
  form.addEventListener("submit", saveProduct);

  resetProductForm();
  loadProductsAndTaxonomy();
}

function loadProductsAndTaxonomy() {
  document.querySelector("#admin-products").innerHTML = loadingMarkup("Carregando produtos...");
  return Promise.all([
    adminRequest("GET", "/api/admin/products"),
    window.JSMP.request("GET", "/api/taxonomy", undefined, { auth: false })
  ]).then(function (results) {
    adminState.products = results[0].products;
    fillSelect("#brand", results[1].brands);
    fillSelect("#category", results[1].categories);
    renderAdminProducts();
  }).catch(function (error) {
    document.querySelector("#admin-products").innerHTML = errorMarkup(error);
  });
}

function fillSelect(selector, values, selected) {
  var select = document.querySelector(selector);
  var current = selected || select.value;
  var list = values.slice();
  if (current && list.indexOf(current) === -1) list.push(current);
  select.innerHTML = '<option value="">Selecione</option>' + list.sort().map(function (value) {
    return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + "</option>";
  }).join("");
  select.value = current || "";
}

function addTaxonomy(kind) {
  var input = document.querySelector(kind === "brand" ? "#new-brand-name" : "#new-category-name");
  var name = input.value.trim();
  if (!name) {
    setAdminFeedback("#admin-feedback", "Digite o nome antes de adicionar.", "error");
    return;
  }
  adminRequest("POST", kind === "brand" ? "/api/admin/brands" : "/api/admin/categories", { name: name }).then(function (data) {
    var select = document.querySelector(kind === "brand" ? "#brand" : "#category");
    var values = Array.from(select.options).map(function (o) { return o.value; }).filter(Boolean);
    fillSelect(kind === "brand" ? "#brand" : "#category", values, data.name);
    input.value = "";
    setAdminFeedback("#admin-feedback", (kind === "brand" ? "Marca" : "Categoria") + " adicionada.", "success");
  }).catch(function (error) {
    setAdminFeedback("#admin-feedback", error.message, "error");
  });
}

function renderAdminProducts() {
  var table = document.querySelector("#admin-products");
  var search = document.querySelector("#admin-search").value.trim().toLowerCase();
  var products = adminState.products.filter(function (p) {
    return !search || (p.name + " " + p.brand + " " + p.category).toLowerCase().indexOf(search) >= 0;
  });
  if (!products.length) {
    table.innerHTML = '<div class="empty-state">Nenhum produto encontrado.</div>';
    return;
  }
  table.innerHTML = [
    '<div class="table-scroll"><table class="order-table">',
    "<thead><tr><th>Produto</th><th>Preço</th><th>Estoque</th><th>Margem</th><th>Status</th><th></th></tr></thead>",
    "<tbody>",
    products.map(function (p) {
      var margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0;
      return [
        "<tr>",
        '<td><div class="admin-product-cell"><img src="' + escapeHtml(window.JSMP.imageUrl(p.image)) + '" alt=""><div><strong>' + escapeHtml(p.name) + '</strong><br><span class="muted-text">' + escapeHtml(p.brand + " · " + p.category) + "</span></div></div></td>",
        "<td>" + formatCurrency(p.price) + "</td>",
        '<td class="' + (p.stock <= 0 ? "finance-negative" : "") + '">' + p.stock + "</td>",
        "<td>" + formatCurrency(p.price - p.cost) + '<br><span class="muted-text">' + margin + "%</span></td>",
        "<td>" + (p.active ? (p.featured ? "Destaque" : "Ativo") : '<span class="muted-text">Oculto</span>') + "</td>",
        '<td><div class="inline-actions"><button class="btn-secondary" type="button" data-edit="' + p.id + '">Editar</button><button class="btn-danger" type="button" data-delete="' + p.id + '">Excluir</button></div></td>',
        "</tr>"
      ].join("");
    }).join(""),
    "</tbody></table></div>"
  ].join("");

  table.querySelectorAll("[data-edit]").forEach(function (button) {
    button.addEventListener("click", function () { editProduct(Number(button.getAttribute("data-edit"))); });
  });
  table.querySelectorAll("[data-delete]").forEach(function (button) {
    button.addEventListener("click", function () { deleteProduct(Number(button.getAttribute("data-delete"))); });
  });
}

function resetProductForm() {
  var form = document.querySelector("#admin-form");
  form.reset();
  form.productId.value = "";
  form.active.checked = true;
  adminState.images = [];
  document.querySelector("#admin-form-title").textContent = "Cadastrar produto";
  updateMeasureGroups();
  renderImagePreview();
  updateProfitPreview();
}

function editProduct(id) {
  var p = adminState.products.find(function (item) { return item.id === id; });
  if (!p) return;
  var form = document.querySelector("#admin-form");
  form.productId.value = p.id;
  fillSelect("#brand", Array.from(form.brand.options).map(function (o) { return o.value; }).filter(Boolean), p.brand);
  fillSelect("#category", Array.from(form.category.options).map(function (o) { return o.value; }).filter(Boolean), p.category);
  form.name.value = p.name;
  form.description.value = p.description || "";
  form.price.value = p.price;
  form.cost.value = p.cost || 0;
  form.stock.value = p.stock;
  form.hasSizes.checked = p.hasSizes;
  form.hasNumbers.checked = p.hasNumbers;
  document.querySelectorAll('input[name="sizeOptions"]').forEach(function (input) { input.checked = p.sizes.indexOf(input.value) >= 0; });
  document.querySelectorAll('input[name="numberOptions"]').forEach(function (input) { input.checked = p.numbers.indexOf(input.value) >= 0; });
  form.featured.checked = p.featured;
  form.active.checked = p.active;
  form.images.value = "";
  adminState.images = (p.images || []).slice();
  document.querySelector("#admin-form-title").textContent = "Editar: " + p.name;
  updateMeasureGroups();
  renderImagePreview();
  updateProfitPreview();
  form.scrollIntoView({ behavior: "smooth" });
}

function deleteProduct(id) {
  var p = adminState.products.find(function (item) { return item.id === id; });
  if (!p || !window.confirm('Excluir "' + p.name + '"? Para apenas esconder da loja, edite e desmarque "Visível na loja".')) return;
  adminRequest("DELETE", "/api/admin/products/" + id).then(function () {
    adminState.products = adminState.products.filter(function (item) { return item.id !== id; });
    window.JSMP.invalidateProducts();
    renderAdminProducts();
    setAdminFeedback("#admin-feedback", "Produto excluído.", "success");
  }).catch(function (error) {
    setAdminFeedback("#admin-feedback", error.message, "error");
  });
}

function updateMeasureGroups() {
  var form = document.querySelector("#admin-form");
  document.querySelector("#sizes-group").hidden = !form.hasSizes.checked;
  document.querySelector("#numbers-group").hidden = !form.hasNumbers.checked;
}

function updateProfitPreview() {
  var form = document.querySelector("#admin-form");
  var price = Number(form.price.value) || 0;
  var cost = Number(form.cost.value) || 0;
  var margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
  document.querySelector("#admin-profit-preview").textContent = formatCurrency(price - cost) + " (" + margin + "%)";
}

// Reduz a foto no navegador antes de enviar (max 1400px, JPEG).
function resizeImage(file) {
  return new Promise(function (resolve, reject) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      reject(new Error("Formato não suportado: " + file.name + ". Use JPG, PNG ou WEBP."));
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error("Não foi possível ler " + file.name)); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { reject(new Error("Imagem inválida: " + file.name)); };
      img.onload = function () {
        var max = 1400;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function handleImageSelection(event) {
  var files = Array.from(event.target.files || []).slice(0, 8);
  if (!files.length) return;
  setAdminFeedback("#admin-feedback", "Enviando " + files.length + " foto(s)...", "");
  files.reduce(function (chain, file) {
    return chain.then(function (urls) {
      return resizeImage(file)
        .then(function (dataUrl) { return adminRequest("POST", "/api/admin/images", { dataUrl: dataUrl }); })
        .then(function (data) { return urls.concat(data.url); });
    });
  }, Promise.resolve([])).then(function (urls) {
    adminState.images = adminState.images.concat(urls).slice(0, 8);
    renderImagePreview();
    event.target.value = "";
    setAdminFeedback("#admin-feedback", "Fotos enviadas. Clique em Salvar produto para confirmar.", "success");
  }).catch(function (error) {
    setAdminFeedback("#admin-feedback", error.message, "error");
  });
}

function renderImagePreview() {
  var preview = document.querySelector("#admin-image-preview");
  if (!adminState.images.length) {
    preview.innerHTML = '<div class="muted-text">Nenhuma foto. A primeira foto e a capa do produto.</div>';
    return;
  }
  preview.innerHTML = adminState.images.map(function (url, index) {
    return '<div class="admin-preview-item"><img class="admin-preview-thumb" src="' + escapeHtml(window.JSMP.imageUrl(url)) + '" alt="Foto ' + (index + 1) + '">' +
      (index > 0 ? '<button type="button" class="btn-ghost" data-cover="' + index + '" title="Usar como capa">Capa</button>' : '<span class="tag">Capa</span>') +
      '<button type="button" class="btn-danger" data-remove-image="' + index + '" aria-label="Remover foto">×</button></div>';
  }).join("");
  preview.querySelectorAll("[data-remove-image]").forEach(function (button) {
    button.addEventListener("click", function () {
      adminState.images.splice(Number(button.getAttribute("data-remove-image")), 1);
      renderImagePreview();
    });
  });
  preview.querySelectorAll("[data-cover]").forEach(function (button) {
    button.addEventListener("click", function () {
      var index = Number(button.getAttribute("data-cover"));
      adminState.images.unshift(adminState.images.splice(index, 1)[0]);
      renderImagePreview();
    });
  });
}

function checkedValues(name) {
  return Array.from(document.querySelectorAll('input[name="' + name + '"]:checked')).map(function (input) { return input.value; });
}

function saveProduct(event) {
  event.preventDefault();
  var form = event.target;
  var id = Number(form.productId.value);
  var payload = {
    brand: form.brand.value,
    category: form.category.value,
    name: form.name.value.trim(),
    description: form.description.value.trim(),
    price: Number(form.price.value),
    cost: Number(form.cost.value || 0),
    stock: Math.floor(Number(form.stock.value)),
    hasSizes: form.hasSizes.checked,
    hasNumbers: form.hasNumbers.checked,
    sizes: form.hasSizes.checked ? checkedValues("sizeOptions") : [],
    numbers: form.hasNumbers.checked ? checkedValues("numberOptions") : [],
    images: adminState.images,
    featured: form.featured.checked,
    active: form.active.checked
  };
  if (!payload.images.length) {
    setAdminFeedback("#admin-feedback", "Adicione pelo menos uma foto do produto.", "error");
    return;
  }
  var button = form.querySelector('[type="submit"]');
  button.disabled = true;
  adminRequest(id ? "PUT" : "POST", id ? "/api/admin/products/" + id : "/api/admin/products", payload).then(function (data) {
    if (id) {
      adminState.products = adminState.products.map(function (p) { return p.id === id ? data.product : p; });
    } else {
      adminState.products.unshift(data.product);
    }
    window.JSMP.invalidateProducts();
    resetProductForm();
    renderAdminProducts();
    setAdminFeedback("#admin-feedback", id ? "Produto atualizado." : "Produto cadastrado.", "success");
  }).catch(function (error) {
    setAdminFeedback("#admin-feedback", error.message, "error");
  }).then(function () {
    button.disabled = false;
  });
}

// ======================= PEDIDOS =======================

function initOrdersView() {
  document.querySelector("#orders-filter").addEventListener("change", renderAdminOrders);
  document.querySelector("#orders-refresh").addEventListener("click", loadOrders);
  loadOrders();
}

function loadOrders() {
  var target = document.querySelector("#admin-orders");
  target.innerHTML = loadingMarkup("Carregando pedidos...");
  return adminRequest("GET", "/api/admin/orders").then(function (data) {
    adminState.orders = data.orders;
    renderAdminOrders();
  }).catch(function (error) {
    target.innerHTML = errorMarkup(error);
  });
}

function renderAdminOrders() {
  var target = document.querySelector("#admin-orders");
  var filter = document.querySelector("#orders-filter").value;
  var orders = adminState.orders.filter(function (order) {
    if (filter === "open") return ["paid", "preparing", "shipped"].indexOf(order.status) >= 0;
    if (filter === "all") return true;
    return order.status === filter;
  });
  var openCount = adminState.orders.filter(function (o) { return o.status === "paid" || o.status === "preparing"; }).length;
  document.querySelector("#orders-counter").textContent = openCount ? openCount + " pedido(s) para separar/enviar" : "Nenhum pedido aguardando envio";

  if (!orders.length) {
    target.innerHTML = '<div class="empty-state">Nenhum pedido neste filtro.</div>';
    return;
  }

  target.innerHTML = orders.map(function (order) {
    var a = order.deliveryAddress || {};
    var address = order.shippingMethod === "retirada"
      ? "Retirada na loja"
      : [a.street && a.street + ", " + a.number, a.complement, a.neighborhood, a.city && a.city + (a.state ? "/" + a.state : ""), a.cep && "CEP " + formatCep(a.cep)].filter(Boolean).join(" · ");
    var phoneDigits = String(order.customerPhone || "").replace(/\D/g, "");
    var whatsapp = phoneDigits ? "https://wa.me/55" + phoneDigits.replace(/^55/, "") + "?text=" + encodeURIComponent("Olá " + order.customerName.split(" ")[0] + "! Sobre seu pedido #" + order.id + " na JS Multimarcas: ") : "";
    var statusOptions = ["paid", "preparing", "shipped", "delivered", "cancelled", "refunded"].map(function (status) {
      return '<option value="' + status + '"' + (order.status === status ? " selected" : "") + ">" + ADMIN_STATUS_LABELS[status] + "</option>";
    }).join("");
    var canChange = order.status !== "pending" && order.status !== "rejected";

    return [
      '<article class="admin-order-card">',
      '<div class="admin-order-header">',
      "<div>",
      '<span class="eyebrow">Pedido #' + order.id + " · " + formatDateTime(order.createdAt) + "</span>",
      "<h2>" + escapeHtml(order.customerName) + "</h2>",
      '<p class="muted-text">' + escapeHtml(order.customerEmail) + (order.customerPhone ? " · " + escapeHtml(order.customerPhone) : "") + "</p>",
      "</div>",
      '<div class="admin-order-total"><span class="status-pill status-' + escapeHtml(order.status) + '">' + escapeHtml(ADMIN_STATUS_LABELS[order.status] || order.status) + '</span><strong class="product-price">' + formatCurrency(order.total) + '</strong><span class="muted-text">' + escapeHtml(order.paymentMethod || "") + "</span></div>",
      "</div>",
      '<div class="admin-order-details">',
      "<div><span>Produtos</span>" + order.items.map(function (item) {
        var variation = item.size ? " · Tam. " + item.size : item.number ? " · Nº " + item.number : "";
        return "<strong>" + item.quantity + "x " + escapeHtml(item.name + variation) + "</strong>";
      }).join("") + "</div>",
      "<div><span>Entrega</span><strong>" + escapeHtml(order.shippingLabel) + "</strong><small>" + formatCurrency(order.shipping) + "</small></div>",
      "<div><span>Endereço</span><strong>" + escapeHtml(address || "Não informado") + "</strong></div>",
      "</div>",
      '<div class="admin-order-actions">',
      canChange ? '<label>Status <select class="select" data-order-status="' + order.id + '">' + statusOptions + "</select></label>" : '<span class="muted-text">Pagamento ' + (order.status === "pending" ? "ainda não confirmado" : "recusado") + ".</span>",
      whatsapp ? '<a class="btn-secondary" href="' + escapeHtml(whatsapp) + '" target="_blank" rel="noopener">WhatsApp do cliente</a>' : "",
      "</div>",
      "</article>"
    ].join("");
  }).join("");

  target.querySelectorAll("[data-order-status]").forEach(function (select) {
    select.addEventListener("change", function () {
      var id = Number(select.getAttribute("data-order-status"));
      var status = select.value;
      if ((status === "cancelled" || status === "refunded") && !window.confirm("Marcar o pedido #" + id + " como " + ADMIN_STATUS_LABELS[status].toLowerCase() + "? O estoque será devolvido. (O estorno do dinheiro e feito no painel do Mercado Pago.)")) {
        renderAdminOrders();
        return;
      }
      select.disabled = true;
      adminRequest("PATCH", "/api/admin/orders/" + id, { status: status }).then(function (data) {
        adminState.orders = adminState.orders.map(function (o) { return o.id === id ? data.order : o; });
        window.JSMP.invalidateProducts();
        renderAdminOrders();
        showToast("Pedido #" + id + " atualizado.", "success");
      }).catch(function (error) {
        showToast(error.message, "error");
        renderAdminOrders();
      });
    });
  });
}

// ======================= FATURAMENTO =======================

function initBillingView() {
  document.querySelector("#billing-filter").addEventListener("change", renderBillingDashboard);
  document.querySelector("#expense-form").addEventListener("submit", submitExpense);
  document.querySelector("#billing-summary").innerHTML = loadingMarkup("Carregando...");
  Promise.all([adminRequest("GET", "/api/admin/orders"), adminRequest("GET", "/api/admin/expenses")]).then(function (results) {
    adminState.orders = results[0].orders;
    adminState.expenses = results[1].expenses;
    renderBillingDashboard();
  }).catch(function (error) {
    document.querySelector("#billing-summary").innerHTML = errorMarkup(error);
  });
}

function inPeriod(dateValue) {
  var mode = document.querySelector("#billing-filter").value;
  var date = new Date(dateValue);
  var now = new Date();
  if (mode === "month") return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  if (mode === "30d") return now - date <= 30 * 86400000;
  if (mode === "7d") return now - date <= 7 * 86400000;
  return true;
}

function renderBillingDashboard() {
  var orders = adminState.orders.filter(function (o) { return REVENUE_STATUSES.indexOf(o.status) >= 0 && inPeriod(o.createdAt); });
  var expenses = adminState.expenses.filter(function (e) { return inPeriod(e.createdAt); });
  var revenue = orders.reduce(function (sum, o) { return sum + o.total; }, 0);
  var shipping = orders.reduce(function (sum, o) { return sum + o.shipping; }, 0);
  var expenseTotal = expenses.reduce(function (sum, e) { return sum + e.amount; }, 0);

  document.querySelector("#billing-summary").innerHTML = [
    financeCard("Faturamento", formatCurrency(revenue), "Pedidos pagos no período (inclui frete)"),
    financeCard("Pedidos pagos", String(orders.length), "Ticket médio " + formatCurrency(orders.length ? revenue / orders.length : 0)),
    financeCard("Despesas", formatCurrency(expenseTotal), "Lançadas no período"),
    financeCard("Saldo", formatCurrency(revenue - shipping - expenseTotal), "Vendas sem frete menos despesas")
  ].join("");

  var ordersNode = document.querySelector("#billing-orders");
  ordersNode.innerHTML = orders.length ? [
    '<div class="table-scroll"><table class="order-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Pagamento</th><th>Total</th></tr></thead><tbody>',
    orders.slice(0, 20).map(function (o) {
      return "<tr><td>#" + o.id + '<br><span class="muted-text">' + formatDateTime(o.createdAt) + "</span></td><td>" + escapeHtml(o.customerName) + "</td><td>" + escapeHtml(o.paymentMethod) + '</td><td><strong class="product-price">' + formatCurrency(o.total) + "</strong></td></tr>";
    }).join(""),
    "</tbody></table></div>"
  ].join("") : '<div class="empty-state">Nenhuma venda no período.</div>';

  var expensesNode = document.querySelector("#expense-list");
  expensesNode.innerHTML = expenses.length ? expenses.map(function (e) {
    return '<div class="finance-row"><div><strong>' + escapeHtml(e.description) + '</strong><div class="muted-text">' + escapeHtml(e.category) + " · " + new Date(e.createdAt).toLocaleDateString("pt-BR") + '</div></div><div class="inline-actions"><strong class="finance-negative">' + formatCurrency(e.amount) + '</strong><button class="btn-danger" type="button" data-remove-expense="' + e.id + '">Remover</button></div></div>';
  }).join("") : '<div class="empty-state">Nenhuma despesa no período.</div>';

  expensesNode.querySelectorAll("[data-remove-expense]").forEach(function (button) {
    button.addEventListener("click", function () {
      var id = Number(button.getAttribute("data-remove-expense"));
      adminRequest("DELETE", "/api/admin/expenses/" + id).then(function () {
        adminState.expenses = adminState.expenses.filter(function (e) { return e.id !== id; });
        renderBillingDashboard();
      }).catch(function (error) { showToast(error.message, "error"); });
    });
  });
}

function financeCard(label, value, note) {
  return '<article class="summary-card"><span class="eyebrow">' + escapeHtml(label) + '</span><strong class="finance-kpi">' + escapeHtml(value) + '</strong><p class="muted-text">' + escapeHtml(note) + "</p></article>";
}

function submitExpense(event) {
  event.preventDefault();
  var form = event.target;
  adminRequest("POST", "/api/admin/expenses", {
    description: form.description.value.trim(),
    category: form.category.value.trim(),
    amount: Number(form.amount.value)
  }).then(function (data) {
    adminState.expenses.unshift(data.expense);
    form.reset();
    setAdminFeedback("#expense-feedback", "Despesa registrada.", "success");
    renderBillingDashboard();
  }).catch(function (error) {
    setAdminFeedback("#expense-feedback", error.message, "error");
  });
}
