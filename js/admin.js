// Painel administrativo com CRUD simples persistido no LocalStorage.
document.addEventListener("DOMContentLoaded", async function () {
  var adminRoot = document.querySelector("[data-admin-view]");
  if (!adminRoot) {
    return;
  }

  if (!await protectAdminPage()) {
    return;
  }

  setupAdminNavigation();

  if (document.body.getAttribute("data-admin-view") === "products") {
    fillBrandOptions();
    fillCategoryOptions();
    renderTaxonomyLists();
    renderAdminProducts();
    setupAdminForm();
  }

  if (document.body.getAttribute("data-admin-view") === "billing") {
    renderBillingDashboard();
    setupBillingControls();
  }
});

var adminFormImages = [];

async function protectAdminPage() {
  var session = window.JSMP.getSession();
  var gate = document.querySelector("#admin-gate");
  var panel = document.querySelector("#admin-panel");

  if (!session || session.role !== "admin" || !session.adminToken) {
    if (gate) {
      gate.style.display = "block";
    }
    if (panel) {
      panel.style.display = "none";
    }
    return false;
  }

  try {
    var response = await fetch(getApiUrl("/api/auth/admin/verify"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: session.adminToken }) });
    var data = await response.json();
    if (!response.ok || !data.ok) throw new Error("Sessao invalida");
  } catch (error) {
    window.JSMP.logout();
    if (gate) gate.style.display = "block";
    if (panel) panel.style.display = "none";
    return false;
  }

  if (gate) {
    gate.style.display = "none";
  }
  if (panel) {
    panel.style.display = "grid";
  }
  return true;
}

function setupAdminNavigation() {
  var currentView = document.body.getAttribute("data-admin-view");

  document.querySelectorAll("[data-admin-link]").forEach(function (link) {
    if (link.getAttribute("data-admin-link") === currentView) {
      link.classList.add("active");
    }
  });
}

function fillBrandOptions(selectedValue) {
  var select = document.querySelector("#brand");
  if (!select) {
    return;
  }

  var brands = window.JSMP.getBrands().slice().sort();
  if (selectedValue && brands.indexOf(selectedValue) === -1) {
    brands.push(selectedValue);
  }

  select.innerHTML =
    '<option value="">Selecione</option>' +
    brands
      .map(function (brand) {
        return '<option value="' + brand + '">' + brand + "</option>";
      })
      .join("");

  if (selectedValue) {
    select.value = selectedValue;
  }
}

function fillCategoryOptions(selectedValue) {
  var select = document.querySelector("#category");
  if (!select) {
    return;
  }

  var categories = window.JSMP.getCategories().slice().sort();
  if (selectedValue && categories.indexOf(selectedValue) === -1) {
    categories.push(selectedValue);
  }

  select.innerHTML =
    '<option value="">Selecione</option>' +
    categories
      .map(function (category) {
        return '<option value="' + category + '">' + category + "</option>";
      })
      .join("");

  if (selectedValue) {
    select.value = selectedValue;
  }
}

function renderTaxonomyLists() {
  renderTagList("#admin-brand-list", window.JSMP.getBrands().slice().sort(), "Nenhuma marca cadastrada.");
  renderTagList("#admin-category-list", window.JSMP.getCategories().slice().sort(), "Nenhuma categoria cadastrada.");
}

function renderTagList(selector, items, emptyMessage) {
  var node = document.querySelector(selector);
  if (!node) {
    return;
  }

  if (!items.length) {
    node.innerHTML = '<span class="muted-text">' + emptyMessage + "</span>";
    return;
  }

  node.innerHTML = items.map(function (item) {
    return '<span class="tag">' + item + "</span>";
  }).join("");
}

function setupAdminForm() {
  var form = document.querySelector("#admin-form");
  var feedback = document.querySelector("#admin-feedback");
  if (!form || !feedback) {
    return;
  }

  ["price", "cost", "stock"].forEach(function (fieldName) {
    form[fieldName].addEventListener("input", updateProfitPreview);
  });

  form.images.addEventListener("change", handleAdminImageSelection);
  form.hasSizes.addEventListener("change", updateMeasureGroups);
  form.hasNumbers.addEventListener("change", updateMeasureGroups);

  document.querySelector("[data-add-brand]").addEventListener("click", function () {
    var value = window.JSMP.addBrand(form.newBrandName.value);
    if (!value) {
      setAdminFeedback("Digite o nome da marca antes de adicionar.", "error");
      return;
    }

    fillBrandOptions(value);
    renderTaxonomyLists();
    form.newBrandName.value = "";
    setAdminFeedback("Marca adicionada com sucesso.", "success");
  });

  document.querySelector("[data-add-category]").addEventListener("click", function () {
    var value = window.JSMP.addCategory(form.newCategoryName.value);
    if (!value) {
      setAdminFeedback("Digite o nome da categoria antes de adicionar.", "error");
      return;
    }

    fillCategoryOptions(value);
    renderTaxonomyLists();
    form.newCategoryName.value = "";
    setAdminFeedback("Categoria adicionada com sucesso.", "success");
  });

  adminFormImages = [];
  clearMeasureSelections();
  updateMeasureGroups();
  renderAdminImagePreview();
  updateProfitPreview();

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    var sizeValues = getCheckedValues('input[name="sizeOptions"]');
    var numberValues = getCheckedValues('input[name="numberOptions"]');

    if (form.hasSizes.checked && !sizeValues.length) {
      setAdminFeedback("Marque ao menos um tamanho para produtos de roupa.", "error");
      return;
    }

    if (form.hasNumbers.checked && !numberValues.length) {
      setAdminFeedback("Marque ao menos uma numeracao para calcados.", "error");
      return;
    }

    var products = window.JSMP.getProducts();
    var editingId = Number(form.productId.value);
    var isEditing = Boolean(editingId);
    var uploadedImages = await readFilesAsDataUrls(form.images.files);
    var existingProduct = isEditing ? window.JSMP.getProductById(editingId) : null;
    var finalImages = uploadedImages.length
      ? uploadedImages
      : adminFormImages.length
        ? adminFormImages.slice()
        : form.image.value.trim()
          ? [form.image.value.trim()]
          : existingProduct && existingProduct.images && existingProduct.images.length
            ? existingProduct.images.slice()
            : [createFallbackImage(form.brand.value, form.name.value.trim())];

    var payload = {
      id: isEditing ? editingId : Date.now(),
      brand: form.brand.value,
      category: form.category.value,
      name: form.name.value.trim(),
      description: form.description.value.trim(),
      price: Number(form.price.value),
      cost: Number(form.cost.value),
      stock: Math.max(0, Number(form.stock.value) || 0),
      hasSizes: form.hasSizes.checked,
      hasNumbers: form.hasNumbers.checked,
      sizes: form.hasSizes.checked ? sizeValues : [],
      numbers: form.hasNumbers.checked ? numberValues : [],
      images: finalImages,
      image: finalImages[0],
      featured: form.featured.checked
    };

    if (isEditing) {
      products = products.map(function (item) {
        return item.id === editingId ? payload : item;
      });
    } else {
      products.push(payload);
    }

    window.JSMP.addBrand(payload.brand);
    window.JSMP.addCategory(payload.category);
    window.JSMP.saveProducts(products);

    form.reset();
    form.productId.value = "";
    adminFormImages = [];
    clearMeasureSelections();
    fillBrandOptions();
    fillCategoryOptions();
    renderTaxonomyLists();
    updateMeasureGroups();
    renderAdminImagePreview();
    updateProfitPreview();
    renderAdminProducts();
    setAdminFeedback(isEditing ? "Produto atualizado com sucesso." : "Produto adicionado com sucesso.", "success");
  });
}

function updateMeasureGroups() {
  var form = document.querySelector("#admin-form");
  if (!form) {
    return;
  }

  var sizesGroup = document.querySelector("#sizes-group");
  var numbersGroup = document.querySelector("#numbers-group");

  sizesGroup.hidden = !form.hasSizes.checked;
  numbersGroup.hidden = !form.hasNumbers.checked;
}

function getCheckedValues(selector) {
  return Array.from(document.querySelectorAll(selector + ":checked")).map(function (input) {
    return input.value;
  });
}

function clearMeasureSelections() {
  document.querySelectorAll('input[name="sizeOptions"], input[name="numberOptions"]').forEach(function (input) {
    input.checked = false;
  });
}

function setMeasureSelections(type, values) {
  var lookup = {};
  values.forEach(function (value) {
    lookup[value] = true;
  });

  document.querySelectorAll('input[name="' + type + 'Options"]').forEach(function (input) {
    input.checked = Boolean(lookup[input.value]);
  });
}

function setAdminFeedback(message, tone) {
  var feedback = document.querySelector("#admin-feedback");
  if (!feedback) {
    return;
  }

  feedback.className = "feedback " + (tone || "success");
  feedback.textContent = message;
}

function setupBillingControls() {
  var filter = document.querySelector("#billing-filter");
  var expenseForm = document.querySelector("#expense-form");

  if (filter) {
    filter.addEventListener("change", renderBillingDashboard);
  }

  if (expenseForm) {
    expenseForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var amount = Number(expenseForm.amount.value);

      if (!expenseForm.description.value.trim() || !expenseForm.category.value.trim() || amount <= 0) {
        document.querySelector("#expense-feedback").className = "feedback error";
        document.querySelector("#expense-feedback").textContent = "Preencha a despesa com descricao, categoria e valor maior que zero.";
        return;
      }

      window.JSMP.addExpense({
        description: expenseForm.description.value.trim(),
        category: expenseForm.category.value.trim(),
        amount: amount
      });

      document.querySelector("#expense-feedback").className = "feedback success";
      document.querySelector("#expense-feedback").textContent = "Despesa registrada com sucesso.";
      expenseForm.reset();
      renderBillingDashboard();
    });
  }
}

function renderAdminProducts() {
  var products = window.JSMP.getProducts();
  var table = document.querySelector("#admin-products");
  if (!table) {
    return;
  }

  table.innerHTML = [
    "<table class=\"order-table\">",
    "<thead>",
    "<tr><th>Produto</th><th>Marca</th><th>Categoria</th><th>Preco</th><th>Estoque</th><th>Lucro</th><th>Variacoes</th><th>Acoes</th></tr>",
    "</thead>",
    "<tbody>",
    products.map(function (item) {
      return [
        "<tr>",
        "<td>" + item.name + "</td>",
        "<td>" + item.brand + "</td>",
        "<td>" + (item.category || "Sem categoria") + "</td>",
        "<td>" + formatCurrency(item.price) + "</td>",
        "<td>" + Number(item.stock || 0) + "</td>",
        "<td>" + formatCurrency((item.price || 0) - (item.cost || 0)) + "</td>",
        "<td>" + buildVariationSummary(item) + "</td>",
        '<td><div class="inline-actions"><button class="btn-secondary" data-edit="' + item.id + '">Editar</button><button class="btn-danger" data-delete="' + item.id + '">Remover</button></div></td>',
        "</tr>"
      ].join("");
    }).join(""),
    "</tbody>",
    "</table>"
  ].join("");

  attachAdminActions();
}

function buildVariationSummary(product) {
  var parts = [];

  if (product.hasSizes) {
    parts.push("Tamanhos: " + product.sizes.join(", "));
  }

  if (product.hasNumbers) {
    parts.push("Numeracao: " + product.numbers.join(", "));
  }

  return parts.join(" | ") || "Sem grade";
}

function renderBillingDashboard() {
  var orders = getFilteredOrders();
  var expenses = window.JSMP.getExpenses();
  var summaryNode = document.querySelector("#billing-summary");
  var ordersNode = document.querySelector("#billing-orders");
  var expensesNode = document.querySelector("#expense-list");

  if (!summaryNode || !ordersNode || !expensesNode) {
    return;
  }

  var revenue = orders.reduce(function (sum, order) {
    return sum + order.total;
  }, 0);
  var expenseTotal = expenses.reduce(function (sum, item) {
    return sum + item.amount;
  }, 0);
  var averageTicket = orders.length ? revenue / orders.length : 0;
  var netBalance = revenue - expenseTotal;

  summaryNode.innerHTML = [
    createFinanceCard("Faturamento", formatCurrency(revenue), "Total das vendas registradas"),
    createFinanceCard("Pedidos pagos", String(orders.length), "Pedidos aprovados no periodo"),
    createFinanceCard("Ticket medio", formatCurrency(averageTicket), "Media por venda realizada"),
    createFinanceCard("Saldo liquido", formatCurrency(netBalance), "Receita menos despesas operacionais")
  ].join("");

  if (!orders.length) {
    ordersNode.innerHTML = '<div class="empty-state">Nenhum pedido encontrado no periodo selecionado.</div>';
  } else {
    ordersNode.innerHTML = [
      '<table class="order-table">',
      "<thead><tr><th>Pedido</th><th>Cliente</th><th>Metodo</th><th>Data</th><th>Total</th></tr></thead>",
      "<tbody>",
      orders.slice(0, 8).map(function (order) {
        return [
          "<tr>",
          "<td>#"+ order.id + "<br><span class=\"muted-text\">" + order.items.length + " item(ns)</span></td>",
          "<td>" + order.customerName + "<br><span class=\"muted-text\">" + (order.customerEmail || "visitante") + "</span></td>",
          "<td>" + formatPaymentMethod(order.paymentMethod) + "</td>",
          "<td>" + formatDate(order.createdAt) + "</td>",
          '<td><strong class="product-price">' + formatCurrency(order.total) + "</strong></td>",
          "</tr>"
        ].join("");
      }).join(""),
      "</tbody>",
      "</table>"
    ].join("");
  }

  if (!expenses.length) {
    expensesNode.innerHTML = '<div class="empty-state">Nenhuma despesa cadastrada ainda.</div>';
  } else {
    expensesNode.innerHTML = expenses
      .slice(0, 8)
      .map(function (expense) {
        return [
          '<div class="finance-row">',
          "<div>",
          "<strong>" + expense.description + "</strong>",
          '<div class="muted-text">' + expense.category + " • " + formatDate(expense.createdAt) + "</div>",
          "</div>",
          '<div class="inline-actions">',
          '<strong class="finance-negative">' + formatCurrency(expense.amount) + "</strong>",
          '<button class="btn-danger" type="button" data-remove-expense="' + expense.id + '">Remover</button>',
          "</div>",
          "</div>"
        ].join("");
      })
      .join("");

    attachExpenseActions();
  }
}

function attachAdminActions() {
  document.querySelectorAll("[data-delete]").forEach(function (button) {
    button.addEventListener("click", function () {
      var id = Number(button.getAttribute("data-delete"));
      var products = window.JSMP.getProducts().filter(function (item) {
        return item.id !== id;
      });
      window.JSMP.saveProducts(products);
      renderAdminProducts();
      setAdminFeedback("Produto removido com sucesso.", "success");
    });
  });

  document.querySelectorAll("[data-edit]").forEach(function (button) {
    button.addEventListener("click", function () {
      var id = Number(button.getAttribute("data-edit"));
      var product = window.JSMP.getProducts().find(function (item) {
        return item.id === id;
      });
      var form = document.querySelector("#admin-form");

      fillBrandOptions(product.brand);
      fillCategoryOptions(product.category);
      form.productId.value = product.id;
      form.brand.value = product.brand;
      form.category.value = product.category || "";
      form.name.value = product.name;
      form.description.value = product.description || "";
      form.price.value = product.price;
      form.cost.value = product.cost || 0;
      form.stock.value = Number(product.stock || 0);
      form.hasSizes.checked = Boolean(product.hasSizes);
      form.hasNumbers.checked = Boolean(product.hasNumbers);
      clearMeasureSelections();
      setMeasureSelections("size", product.sizes || []);
      setMeasureSelections("number", product.numbers || []);
      form.image.value = product.image;
      form.images.value = "";
      adminFormImages = (product.images || [product.image]).slice();
      renderAdminImagePreview();
      form.featured.checked = Boolean(product.featured);
      updateMeasureGroups();
      updateProfitPreview();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function handleAdminImageSelection(event) {
  readFilesAsDataUrls(event.target.files).then(function (images) {
    adminFormImages = images;
    renderAdminImagePreview();
  });
}

function renderAdminImagePreview() {
  var preview = document.querySelector("#admin-image-preview");
  if (!preview) {
    return;
  }

  if (!adminFormImages.length) {
    preview.innerHTML = '<div class="muted-text">Nenhuma imagem selecionada.</div>';
    return;
  }

  preview.innerHTML = adminFormImages
    .map(function (image, index) {
      return '<img class="admin-preview-thumb" src="' + image + '" alt="Preview ' + (index + 1) + '">';
    })
    .join("");
}

function readFilesAsDataUrls(fileList) {
  var files = Array.from(fileList || []);
  return Promise.all(
    files.map(function (file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          resolve(reader.result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    })
  );
}

function updateProfitPreview() {
  var form = document.querySelector("#admin-form");
  var profitNode = document.querySelector("#admin-profit-preview");
  if (!form || !profitNode) {
    return;
  }

  var price = Number(form.price.value) || 0;
  var cost = Number(form.cost.value) || 0;
  profitNode.textContent = formatCurrency(price - cost);
}

function attachExpenseActions() {
  document.querySelectorAll("[data-remove-expense]").forEach(function (button) {
    button.addEventListener("click", function () {
      window.JSMP.removeExpense(Number(button.getAttribute("data-remove-expense")));
      renderBillingDashboard();
    });
  });
}

function getFilteredOrders() {
  var orders = window.JSMP.getOrders();
  var filter = document.querySelector("#billing-filter");
  var mode = filter ? filter.value : "all";
  var now = new Date();

  return orders.filter(function (order) {
    var diffDays = (now - new Date(order.createdAt)) / (1000 * 60 * 60 * 24);

    if (mode === "week") {
      return diffDays <= 7;
    }

    if (mode === "month") {
      return diffDays <= 30;
    }

    return true;
  });
}

function createFinanceCard(label, value, note) {
  return [
    '<article class="summary-card">',
    '<span class="eyebrow">' + label + "</span>",
    '<strong class="finance-kpi">' + value + "</strong>",
    '<p class="muted-text">' + note + "</p>",
    "</article>"
  ].join("");
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatPaymentMethod(method) {
  var labels = {
    credito: "Credito",
    debito: "Debito",
    pix: "PIX",
    "mercado-pago": "Mercado Pago"
  };

  return labels[method] || method;
}

function createFallbackImage(brand, name) {
  var safeBrand = brand || "Premium";
  var safeName = name || "Colecao";
  var svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="920" viewBox="0 0 800 920">',
    '<rect width="100%" height="100%" fill="#141414"/>',
    '<circle cx="620" cy="180" r="170" fill="#d4af37" fill-opacity="0.25"/>',
    '<text x="70" y="180" fill="#f1cf6c" font-size="56" font-family="Segoe UI, Arial">' + safeBrand + "</text>",
    '<text x="70" y="300" fill="#ffffff" font-size="68" font-family="Segoe UI, Arial">' + safeName + "</text>",
    "</svg>"
  ].join("");

  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}
