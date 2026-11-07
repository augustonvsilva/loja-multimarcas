// Elementos globais: dados da loja, cabecalho, menu de conta, rodape, avisos e frete.

// Dados institucionais exibidos no site. Atualize aqui (um unico lugar).
window.JSMP_STORE = {
  name: "JS Multimarcas Premium",
  email: "jsmultimarcaspremium@gmail.com",
  phone: "(11) 95142-8703",
  whatsapp: "5511951428703",
  address: "Rua Jacinto Pereira, 151 - Pan-Americano, Jaraguá - São Paulo/SP",
  cep: "02992-130",
  cnpj: "57.547.395/0001-64",
  hours: "Seg a sab, 10h as 19h"
};

var escapeHtml = window.JSMP.escapeHtml;
var formatCurrency = window.JSMP.formatCurrency;

document.addEventListener("DOMContentLoaded", function () {
  setupHeader();
  fillStoreInfo();
  updateFooterYear();
  addWhatsappButton();
});

function getBasePath() {
  return document.body.getAttribute("data-base-path") || "./";
}

function setupHeader() {
  var user = window.JSMP.getUser();
  var statusNode = document.querySelector("[data-user-status]");
  var cartCountNode = document.querySelector("[data-cart-count]");
  var currentPage = document.body.getAttribute("data-page");

  document.querySelectorAll(".main-nav a[data-page-link]").forEach(function (link) {
    link.classList.toggle("active", link.getAttribute("data-page-link") === currentPage);
  });

  if (cartCountNode) {
    cartCountNode.textContent = "Carrinho (" + window.JSMP.cartCount() + ")";
  }

  if (statusNode && user && !statusNode.parentElement.classList.contains("account-menu")) {
    statusNode.textContent = "Olá, " + String(user.name || "").split(" ")[0];
    setupAccountMenu(statusNode, user);
  }

  document.querySelectorAll("[data-logout]").forEach(function (button) {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", logoutAndRedirect);
  });
}

function logoutAndRedirect() {
  window.JSMP.clearSession();
  window.location.href = getBasePath() + "login.html";
}

function setupAccountMenu(statusNode, user) {
  var base = getBasePath();
  var wrapper = document.createElement("div");
  wrapper.className = "account-menu";
  statusNode.parentNode.insertBefore(wrapper, statusNode);
  wrapper.appendChild(statusNode);
  statusNode.setAttribute("href", user.role === "admin" ? base + "admin/pedidos.html" : base + "conta.html");
  statusNode.setAttribute("aria-haspopup", "true");

  var menu = document.createElement("div");
  menu.className = "account-dropdown";
  var links = user.role === "admin"
    ? '<a href="' + base + 'admin/pedidos.html">Pedidos</a><a href="' + base + 'admin/produtos.html">Gestão de produtos</a><a href="' + base + 'admin/faturamento.html">Faturamento</a>'
    : '<a href="' + base + 'conta.html">Minha conta</a><a href="' + base + 'conta.html#pedidos">Meus pedidos</a>';
  menu.innerHTML = [
    '<div class="account-dropdown-header">',
    "<strong>" + escapeHtml(user.name) + "</strong>",
    "<span>" + escapeHtml(user.email) + "</span>",
    "</div>",
    links,
    '<div class="account-dropdown-divider"></div>',
    '<button type="button" data-account-logout>Sair da conta</button>'
  ].join("");
  wrapper.appendChild(menu);
  menu.querySelector("[data-account-logout]").addEventListener("click", logoutAndRedirect);

  document.querySelectorAll(".main-nav > [data-logout]").forEach(function (button) {
    button.remove();
  });
}

function fillStoreInfo() {
  var store = window.JSMP_STORE;
  document.querySelectorAll("[data-store]").forEach(function (node) {
    var key = node.getAttribute("data-store");
    var value = store[key];
    if (!value) {
      if (node.hasAttribute("data-store-optional")) node.remove();
      return;
    }
    if (key === "whatsapp") {
      node.setAttribute("href", "https://wa.me/" + value);
    } else if (key === "email") {
      node.textContent = value;
      if (node.tagName === "A") node.setAttribute("href", "mailto:" + value);
    } else {
      node.textContent = (node.getAttribute("data-store-prefix") || "") + value;
    }
  });
}

function addWhatsappButton() {
  var number = window.JSMP_STORE.whatsapp;
  if (!number || document.body.getAttribute("data-page") === "admin") return;
  var link = document.createElement("a");
  link.className = "whatsapp-float";
  link.href = "https://wa.me/" + number + "?text=" + encodeURIComponent("Olá! Vim pelo site da JS Multimarcas.");
  link.target = "_blank";
  link.rel = "noopener";
  link.setAttribute("aria-label", "Falar no WhatsApp");
  link.innerHTML = '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.2.6 4.4 1.7 6.3L3 29l7.3-1.9c1.8 1 3.8 1.5 5.8 1.5 7 0 12.7-5.6 12.7-12.6S23 3 16 3zm0 23.1c-1.8 0-3.6-.5-5.2-1.4l-.4-.2-4.3 1.1 1.2-4.2-.3-.4a10.4 10.4 0 0 1-1.6-5.4C5.4 9.8 10.1 5.2 16 5.2s10.6 4.6 10.6 10.4S21.9 26.1 16 26.1zm5.8-7.8c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.3.3-.6.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.2 1.4 3.5c.2.2 2.4 3.6 5.8 5 .8.4 1.4.6 1.9.7.8.3 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4z"/></svg>';
  document.body.appendChild(link);
}

function updateFooterYear() {
  document.querySelectorAll("[data-year]").forEach(function (node) {
    node.textContent = new Date().getFullYear();
  });
}

// Aviso flutuante discreto (substitui alert()).
function showToast(message, tone) {
  var toast = document.createElement("div");
  toast.className = "toast" + (tone ? " " + tone : "");
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(function () { toast.classList.add("visible"); });
  setTimeout(function () {
    toast.classList.remove("visible");
    setTimeout(function () { toast.remove(); }, 300);
  }, 3200);
}

function loadingMarkup(text) {
  return '<div class="empty-state loading-state"><span class="spinner" aria-hidden="true"></span>' + escapeHtml(text || "Carregando...") + "</div>";
}

function errorMarkup(error) {
  return '<div class="empty-state">' + escapeHtml(error && error.message ? error.message : "Não foi possível carregar agora.") + ' <button class="btn-ghost" type="button" onclick="window.location.reload()">Tentar novamente</button></div>';
}

// ---------- Frete ----------

function normalizeCep(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function formatCep(cep) {
  return normalizeCep(cep).replace(/^(\d{5})(\d{3})$/, "$1-$2");
}

function maskCepInput(input) {
  input.addEventListener("input", function () {
    var digits = normalizeCep(input.value);
    input.value = digits.length > 5 ? digits.slice(0, 5) + "-" + digits.slice(5) : digits;
  });
}

// Consulta o frete no servidor. Retorna null se o CEP for invalido.
function quoteShipping(cep, payload) {
  var normalized = normalizeCep(cep);
  if (normalized.length !== 8) return Promise.resolve(null);
  var body = Object.assign({ cep: normalized }, payload || {});
  return window.JSMP.request("POST", "/api/shipping/quote", body, { auth: false }).then(function (data) {
    return { cep: normalized, formattedCep: formatCep(normalized), options: data.options };
  });
}

// ---------- Escolha da entrega (carrinho e checkout) ----------
// A retirada na loja aparece sempre, mesmo antes de o cliente informar o CEP.

function pickupOption() {
  return {
    method: "retirada",
    label: "Retirada na loja",
    amount: 0,
    deadline: "no mesmo dia útil",
    description: "Retire na loja: " + window.JSMP_STORE.address + ".",
    source: "loja"
  };
}

function shippingChoices(shipping) {
  var options = shipping && shipping.options ? shipping.options : [];
  var pickup = options.find(function (o) { return o.method === "retirada"; }) || pickupOption();
  return [pickup].concat(options.filter(function (o) { return o.method !== "retirada"; }));
}

function buildShippingChoices(shipping, inputName) {
  var selected = shipping && shipping.selected ? shipping.selected.method : "";
  return shippingChoices(shipping).map(function (option) {
    var details = option.method === "retirada"
      ? option.deadline + ". " + (option.description || "")
      : option.deadline + (option.source === "estimativa" ? " (valor estimado)" : "");
    return [
      '<label class="shipping-option">',
      '<input type="radio" name="' + inputName + '" value="' + escapeHtml(option.method) + '"' + (option.method === selected ? " checked" : "") + ">",
      "<span>",
      "<strong>" + escapeHtml(option.label) + " - " + (option.amount ? formatCurrency(option.amount) : "Grátis") + "</strong>",
      "<small>" + escapeHtml(details) + "</small>",
      "</span>",
      "</label>"
    ].join("");
  }).join("");
}

function selectShippingOption(method) {
  var shipping = window.JSMP.getShipping() || { cep: "", options: [] };
  var choice = shippingChoices(shipping).find(function (o) { return o.method === method; });
  if (!choice) return null;
  shipping.selected = choice;
  window.JSMP.saveShipping(shipping);
  return shipping;
}

// Cota o frete do carrinho atual e salva. Com um CEP novo, seleciona a primeira
// entrega em casa; ao recalcular o mesmo CEP, mantem a opcao que o cliente escolheu.
function quoteAndSaveShipping(cep) {
  return quoteShipping(cep, { cart: window.JSMP.cartPayload() }).then(function (result) {
    if (!result) return null;
    var previous = window.JSMP.getShipping();
    var keep = previous && previous.selected && previous.cep === result.cep ? previous.selected.method : "";
    var selected = result.options.find(function (o) { return keep && o.method === keep; }) ||
      result.options.find(function (o) { return o.method !== "retirada"; }) || result.options[0];
    var shipping = { cep: result.cep, options: result.options, selected: selected };
    window.JSMP.saveShipping(shipping);
    return shipping;
  });
}

// Busca endereco pelo CEP (ViaCEP) para preencher o formulario.
function lookupAddress(cep) {
  var normalized = normalizeCep(cep);
  if (normalized.length !== 8) return Promise.resolve(null);
  return fetch("https://viacep.com.br/ws/" + normalized + "/json/")
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (data) { return data && !data.erro ? data : null; })
    .catch(function () { return null; });
}
