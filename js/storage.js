// Nucleo do site: cliente da API, sessao, carrinho e utilitarios compartilhados.
// Produtos, pedidos e clientes vivem no servidor. Apenas carrinho e sessao ficam no navegador.
(function () {
  var KEYS = {
    cart: "jsmp_cart",
    session: "jsmp_auth",
    shipping: "jsmp_cart_shipping",
    productsCache: "jsmp_products_cache",
    lastOrder: "jsmp_last_order"
  };
  var PRODUCTS_CACHE_MS = 5 * 60 * 1000;
  var DEFAULT_API = "https://loja-multimarcas.onrender.com";

  // Dados da versao antiga (jsmp_products, jsmp_orders...) sao ignorados, mas nao apagados.

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {}
  }

  function remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {}
  }

  // ---------- API ----------

  function apiBase() {
    if (window.JSMP_API_BASE_URL) return window.JSMP_API_BASE_URL.replace(/\/$/, "");
    // O GitHub Pages so serve arquivos estaticos; nos demais enderecos (dominio
    // proprio, onrender.com, localhost) o mesmo servidor responde a API.
    if (/\.github\.io$/.test(window.location.hostname) || window.location.protocol === "file:") {
      return DEFAULT_API;
    }
    return window.location.origin;
  }

  function apiUrl(path) {
    return apiBase() + path;
  }

  function request(method, path, body, options) {
    var opts = options || {};
    var session = getSession();
    var headers = { "Accept": "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (session && session.token && opts.auth !== false) headers["Authorization"] = "Bearer " + session.token;

    return fetch(apiUrl(path), {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
      .catch(function () {
        throw new Error("Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.");
      })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (response.status === 401 && session && opts.auth !== false && path.indexOf("/api/auth/login") !== 0) {
            clearSession();
          }
          if (!response.ok || data.ok === false) {
            var error = new Error(data.message || "Erro inesperado (" + response.status + ").");
            error.status = response.status;
            throw error;
          }
          return data;
        });
      });
  }

  // ---------- Produtos (com cache para abrir rapido) ----------

  function loadProducts(onUpdate) {
    var cache = readJSON(KEYS.productsCache, null);
    var fetchFresh = request("GET", "/api/products", undefined, { auth: false }).then(function (data) {
      writeJSON(KEYS.productsCache, { savedAt: Date.now(), products: data.products });
      return data.products;
    });

    if (cache && Array.isArray(cache.products)) {
      var isFresh = Date.now() - cache.savedAt < PRODUCTS_CACHE_MS;
      fetchFresh.then(function (products) {
        if (onUpdate && JSON.stringify(products) !== JSON.stringify(cache.products)) onUpdate(products);
      }).catch(function () {});
      if (isFresh || onUpdate) return Promise.resolve(cache.products);
    }
    return fetchFresh;
  }

  function findProduct(products, id) {
    return products.find(function (item) { return item.id === Number(id); }) || null;
  }

  function invalidateProducts() {
    remove(KEYS.productsCache);
  }

  // ---------- Sessao ----------

  function getSession() {
    var session = readJSON(KEYS.session, null);
    return session && session.token && session.user ? session : null;
  }

  function getUser() {
    var session = getSession();
    return session ? session.user : null;
  }

  function saveSession(token, user) {
    writeJSON(KEYS.session, { token: token, user: user });
  }

  function clearSession() {
    remove(KEYS.session);
  }

  function login(email, password) {
    return request("POST", "/api/auth/login", { email: email, password: password }, { auth: false }).then(function (data) {
      saveSession(data.token, data.user);
      return data.user;
    });
  }

  function register(payload) {
    return request("POST", "/api/auth/register", payload, { auth: false }).then(function (data) {
      saveSession(data.token, data.user);
      return data.user;
    });
  }

  // ---------- Carrinho ----------

  function getCart() {
    var cart = readJSON(KEYS.cart, []);
    return Array.isArray(cart) ? cart.filter(function (item) { return item && item.productId && item.quantity > 0; }) : [];
  }

  function saveCart(cart) {
    writeJSON(KEYS.cart, cart);
  }

  function cartKey(productId, size, number) {
    return [productId, size || "", number || ""].join("|");
  }

  // settings.ifMissing: nao soma outra unidade se o item ja estiver no carrinho
  // (usado pelo "Comprar agora").
  function addToCart(product, options, settings) {
    var payload = options || {};
    if (!product || Number(product.stock || 0) <= 0) {
      return { ok: false, message: "Produto indisponível no momento." };
    }
    var key = cartKey(product.id, payload.size, payload.number);
    var cart = getCart();
    if (settings && settings.ifMissing && cart.some(function (entry) { return entry.key === key; })) {
      return { ok: true };
    }
    var inCart = cart.reduce(function (sum, entry) {
      return entry.productId === product.id ? sum + entry.quantity : sum;
    }, 0);
    if (inCart >= Number(product.stock)) {
      return { ok: false, message: "Você já tem no carrinho todo o estoque disponível deste produto." };
    }
    var item = cart.find(function (entry) { return entry.key === key; });
    if (item) {
      item.quantity += 1;
    } else {
      cart.push({ key: key, productId: product.id, size: payload.size || "", number: payload.number || "", quantity: 1 });
    }
    saveCart(cart);
    return { ok: true };
  }

  function updateCartItem(key, quantity) {
    var qty = Math.max(1, Math.min(10, Math.floor(Number(quantity) || 1)));
    saveCart(getCart().map(function (item) {
      if (item.key === key) item.quantity = qty;
      return item;
    }));
  }

  function removeCartItem(key) {
    saveCart(getCart().filter(function (item) { return item.key !== key; }));
  }

  function clearCart() {
    saveCart([]);
    remove(KEYS.shipping);
  }

  function cartCount() {
    return getCart().reduce(function (sum, item) { return sum + item.quantity; }, 0);
  }

  // Junta o carrinho com os dados atuais dos produtos; remove itens que nao existem mais.
  function getCartDetails(products) {
    var cart = getCart();
    var details = [];
    var valid = [];
    cart.forEach(function (item) {
      var product = findProduct(products, item.productId);
      if (!product) return;
      var quantity = Math.min(item.quantity, Math.max(Number(product.stock || 0), 0)) || 0;
      valid.push(item);
      details.push({
        key: item.key,
        productId: product.id,
        name: product.name,
        brand: product.brand,
        price: product.price,
        image: product.image,
        stock: Number(product.stock || 0),
        quantity: item.quantity,
        availableQuantity: quantity,
        size: item.size || "",
        number: item.number || "",
        subtotal: product.price * item.quantity
      });
    });
    if (valid.length !== cart.length) saveCart(valid);
    return details;
  }

  function cartPayload() {
    return getCart().map(function (item) {
      return { productId: item.productId, size: item.size, number: item.number, quantity: item.quantity };
    });
  }

  // ---------- Frete escolhido ----------

  function getShipping() {
    return readJSON(KEYS.shipping, null);
  }

  function saveShipping(shipping) {
    writeJSON(KEYS.shipping, shipping);
  }

  function clearShipping() {
    remove(KEYS.shipping);
  }

  // ---------- Ultimo pedido (para acompanhar PIX) ----------

  function saveLastOrder(order) {
    writeJSON(KEYS.lastOrder, order);
  }

  function getLastOrder() {
    return readJSON(KEYS.lastOrder, null);
  }

  function clearLastOrder() {
    remove(KEYS.lastOrder);
  }

  // ---------- Utilitarios ----------

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  function imageUrl(url) {
    var value = String(url || "");
    if (value.indexOf("/api/images/") === 0) return apiUrl(value);
    if (/^(https:|data:image\/)/.test(value)) return value;
    return "";
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  window.JSMP = {
    apiUrl: apiUrl,
    request: request,
    loadProducts: loadProducts,
    findProduct: findProduct,
    invalidateProducts: invalidateProducts,
    getSession: getSession,
    getUser: getUser,
    clearSession: clearSession,
    login: login,
    register: register,
    getCart: getCart,
    addToCart: addToCart,
    updateCartItem: updateCartItem,
    removeCartItem: removeCartItem,
    clearCart: clearCart,
    cartCount: cartCount,
    getCartDetails: getCartDetails,
    cartPayload: cartPayload,
    getShipping: getShipping,
    saveShipping: saveShipping,
    clearShipping: clearShipping,
    saveLastOrder: saveLastOrder,
    getLastOrder: getLastOrder,
    clearLastOrder: clearLastOrder,
    escapeHtml: escapeHtml,
    imageUrl: imageUrl,
    formatCurrency: formatCurrency
  };
})();
