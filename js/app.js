// Inicializa a aplicacao e atualiza elementos globais da interface.
document.addEventListener("DOMContentLoaded", function () {
  window.JSMP.seedData();
  setupHeader();
  updateFooterYear();
});

var SHIPPING_STORAGE_KEY = "jsmp_cart_shipping";
var STORE_REGION_LABEL = "Pan-Americano, Jaragua-SP";

function getApiBaseUrl() {
  if (window.JSMP_API_BASE_URL) {
    return window.JSMP_API_BASE_URL;
  }
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return window.location.origin;
  }
  return "https://loja-multimarcas.onrender.com";
}

function getApiUrl(path) {
  return getApiBaseUrl().replace(/\/$/, "") + path;
}

function getBasePath() {
  return document.body.getAttribute("data-base-path") || "./";
}

function formatCurrency(value) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function setupHeader() {
  var session = window.JSMP.getSession();
  var statusNode = document.querySelector("[data-user-status]");
  var cartCountNode = document.querySelector("[data-cart-count]");
  var logoutButtons = document.querySelectorAll("[data-logout]");
  var currentPage = document.body.getAttribute("data-page");

  document.querySelectorAll(".main-nav a[data-page-link]").forEach(function (link) {
    if (link.getAttribute("data-page-link") === currentPage) {
      link.classList.add("active");
    }
  });

  if (statusNode) {
    statusNode.textContent = session ? "Ola, " + session.name.split(" ")[0] : "Entrar";
    statusNode.setAttribute("href", session ? getBasePath() + "admin/produtos.html" : getBasePath() + "login.html");

    if (session && session.role !== "admin") {
      statusNode.setAttribute("href", getBasePath() + "produtos.html");
    }

    if (session) {
      setupAccountMenu(statusNode, session);
    }
  }

  if (cartCountNode) {
    var items = window.JSMP.getCart().reduce(function (total, item) {
      return total + item.quantity;
    }, 0);
    cartCountNode.textContent = "Carrinho (" + items + ")";
  }

  logoutButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      window.JSMP.logout();
      window.location.href = getBasePath() + "login.html";
    });
  });
}

function setupAccountMenu(statusNode, session) {
  if (statusNode.parentElement.classList.contains("account-menu")) {
    return;
  }

  var wrapper = document.createElement("div");
  wrapper.className = "account-menu";
  statusNode.parentNode.insertBefore(wrapper, statusNode);
  wrapper.appendChild(statusNode);
  statusNode.setAttribute("href", getBasePath() + "conta.html");
  statusNode.setAttribute("aria-haspopup", "true");

  var menu = document.createElement("div");
  menu.className = "account-dropdown";
  var adminLinks = session.role === "admin"
    ? '<div class="account-dropdown-divider"></div><a class="account-admin-link" href="' + getBasePath() + 'admin/produtos.html">Gestao de produtos</a><a class="account-admin-link" href="' + getBasePath() + 'admin/pedidos.html">Pedidos</a><a class="account-admin-link" href="' + getBasePath() + 'admin/faturamento.html">Faturamento</a>'
    : "";
  menu.innerHTML = [
    '<div class="account-dropdown-header">',
    '<strong>' + escapeHeaderText(session.name) + '</strong>',
    '<span>' + escapeHeaderText(session.email) + '</span>',
    "</div>",
    '<a href="' + getBasePath() + 'conta.html">Minha conta</a>',
    '<a href="' + getBasePath() + 'conta.html#pedidos">Meus pedidos</a>',
    adminLinks,
    '<button type="button" data-account-logout>Sair da conta</button>'
  ].join("");
  wrapper.appendChild(menu);

  menu.querySelector("[data-account-logout]").addEventListener("click", function () {
    window.JSMP.logout();
    window.location.href = getBasePath() + "login.html";
  });

  document.querySelectorAll(".main-nav > [data-logout]").forEach(function (button) {
    button.remove();
  });
}

function escapeHeaderText(value) {
  return String(value || "").replace(/[&<>\"']/g, function (character) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character];
  });
}

function updateFooterYear() {
  document.querySelectorAll("[data-year]").forEach(function (node) {
    node.textContent = new Date().getFullYear();
  });
}

function normalizeCep(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function formatCep(cep) {
  var normalizedCep = normalizeCep(cep);
  return normalizedCep.replace(/^(\d{5})(\d{3})$/, "$1-$2");
}

function isSaoPauloCapitalCep(normalizedCep) {
  var prefix = Number(normalizedCep.slice(0, 2));
  return prefix >= 1 && prefix <= 5;
}

function isStoreRegionCep(normalizedCep) {
  return ["026", "027", "028", "029", "051", "052"].indexOf(normalizedCep.slice(0, 3)) >= 0;
}

function createShippingOption(method, label, amount, deadline, description) {
  return {
    method: method,
    label: label,
    amount: Number(Math.max(amount, 0).toFixed(2)),
    deadline: deadline,
    description: description
  };
}

function getShippingOptions(cep, subtotal, itemCount) {
  var normalizedCep = normalizeCep(cep);
  if (normalizedCep.length !== 8) {
    return null;
  }

  var quantityExtra = Math.max((itemCount || 1) - 1, 0);
  var discount = subtotal >= 700 ? 10 : subtotal >= 400 ? 5 : 0;
  var options = [
    createShippingOption(
      "retirada",
      "Retirada na loja",
      0,
      "no mesmo dia util",
      "Retire seu pedido na loja da Rua Jacinto Pereira, 151 - " + STORE_REGION_LABEL + "."
    )
  ];

  if (isStoreRegionCep(normalizedCep)) {
    options.push(createShippingOption(
      "entrega-local",
      "Entrega local",
      subtotal >= 500 ? 0 : 9.9 + quantityExtra * 2,
      "em ate 1 dia util",
      "Para Jaragua, Pan-Americano, Pirituba, Perus e bairros proximos."
    ));
  } else if (isSaoPauloCapitalCep(normalizedCep)) {
    options.push(createShippingOption(
      "motoboy-sp",
      "Motoboy SP capital",
      Math.max(14.9, 19.9 + quantityExtra * 2.5 - discount),
      "em 1 a 2 dias uteis",
      "Entrega por motoboy dentro da cidade de Sao Paulo."
    ));
  }

  var regionFactor = Number(normalizedCep.charAt(0) || 0);
  var pacAmount = 22.9 + regionFactor * 2.1 + quantityExtra * 3 - discount;
  var sedexAmount = 34.9 + regionFactor * 2.8 + quantityExtra * 4 - discount;
  options.push(createShippingOption(
    "correios-pac",
    "Correios PAC",
    Math.max(19.9, pacAmount),
    4 + (regionFactor % 6) + " a " + (7 + (regionFactor % 6)) + " dias uteis",
    "Opcao economica para envio pelos Correios."
  ));
  options.push(createShippingOption(
    "correios-sedex",
    "Correios Sedex",
    Math.max(29.9, sedexAmount),
    2 + (regionFactor % 3) + " a " + (4 + (regionFactor % 3)) + " dias uteis",
    "Opcao mais rapida para envio pelos Correios."
  ));

  return options;
}

function simulateShipping(cep, subtotal, itemCount, preferredMethod) {
  var normalizedCep = normalizeCep(cep);
  var options = getShippingOptions(cep, subtotal, itemCount);
  if (!options) {
    return null;
  }

  var selected = options.find(function (option) {
    return option.method === preferredMethod;
  }) || options.find(function (option) {
    return option.method !== "retirada";
  }) || options[0];

  return {
    cep: normalizedCep,
    formattedCep: formatCep(normalizedCep),
    method: selected.method,
    label: selected.label,
    amount: selected.amount,
    deadline: selected.deadline,
    description: selected.description,
    options: options
  };
}

function mergeShippingOptions(localOptions, correiosOptions) {
  var remoteOptions = Array.isArray(correiosOptions) ? correiosOptions : [];
  var remoteMethods = remoteOptions.map(function (option) {
    return option.method;
  });

  return localOptions
    .filter(function (option) {
      return remoteMethods.indexOf(option.method) === -1;
    })
    .concat(remoteOptions);
}

function quoteShipping(cep, subtotal, itemCount, preferredMethod) {
  var fallback = simulateShipping(cep, subtotal, itemCount, preferredMethod);
  if (!fallback) {
    return Promise.resolve(null);
  }

  return fetch("/api/shipping/quote", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      cep: fallback.cep,
      subtotal: Number(subtotal || 0),
      itemCount: Number(itemCount || 1)
    })
  })
    .then(function (response) {
      if (!response.ok) {
        throw new Error("API dos Correios indisponivel.");
      }
      return response.json();
    })
    .then(function (payload) {
      if (!payload.ok || !payload.options || !payload.options.length) {
        return fallback;
      }

      var options = mergeShippingOptions(fallback.options, payload.options);
      var selected = options.find(function (option) {
        return option.method === preferredMethod;
      }) || options.find(function (option) {
        return option.method !== "retirada";
      }) || options[0];

      return {
        cep: fallback.cep,
        formattedCep: fallback.formattedCep,
        method: selected.method,
        label: selected.label,
        amount: selected.amount,
        deadline: selected.deadline,
        description: selected.description,
        source: selected.source || "local",
        options: options
      };
    })
    .catch(function () {
      return fallback;
    });
}

function saveCartShipping(shipping) {
  localStorage.setItem(SHIPPING_STORAGE_KEY, JSON.stringify(shipping));
}

function getCartShipping() {
  try {
    var raw = localStorage.getItem(SHIPPING_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function clearCartShipping() {
  localStorage.removeItem(SHIPPING_STORAGE_KEY);
}
