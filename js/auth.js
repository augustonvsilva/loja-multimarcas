// Login, cadastro e recuperacao de senha.
document.addEventListener("DOMContentLoaded", function () {
  setupLoginForm();
  setupRegisterForm();
  setupRecoveryForms();
});

function setupRecoveryForms() {
  var requestForm = document.querySelector("#password-recovery-form");
  var resetForm = document.querySelector("#password-reset-form");
  if (!requestForm || !resetForm) return;
  var feedback = document.querySelector("#recovery-feedback");
  var token = new URLSearchParams(window.location.search).get("token");

  requestForm.hidden = Boolean(token);
  resetForm.hidden = !token;

  requestForm.addEventListener("submit", function (event) {
    event.preventDefault();
    setFormBusy(requestForm, true);
    window.JSMP.request("POST", "/api/auth/forgot", { email: requestForm.email.value.trim() }, { auth: false })
      .then(function (data) {
        feedback.className = "feedback success";
        feedback.textContent = data.message;
      })
      .catch(function (error) {
        feedback.className = "feedback error";
        feedback.innerHTML = escapeHtml(error.message) + ' <a href="https://wa.me/' + window.JSMP_STORE.whatsapp + '" target="_blank" rel="noopener">Abrir WhatsApp</a>';
      })
      .then(function () { setFormBusy(requestForm, false); });
  });

  resetForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (resetForm.password.value.length < 8 || resetForm.password.value !== resetForm.confirmPassword.value) {
      feedback.className = "feedback error";
      feedback.textContent = "As senhas precisam ser iguais e ter pelo menos 8 caracteres.";
      return;
    }
    setFormBusy(resetForm, true);
    window.JSMP.request("POST", "/api/auth/reset", { token: token, password: resetForm.password.value }, { auth: false })
      .then(function () {
        feedback.className = "feedback success";
        feedback.innerHTML = 'Senha alterada! <a href="./login.html">Entrar agora</a>';
        resetForm.hidden = true;
      })
      .catch(function (error) {
        feedback.className = "feedback error";
        feedback.textContent = error.message;
        setFormBusy(resetForm, false);
      });
  });
}

function nextUrl(user) {
  var next = new URLSearchParams(window.location.search).get("next");
  if (next && /^\.?\/?[a-z0-9\-\/]+\.html(#[a-z]+)?$/i.test(next)) return next;
  return user.role === "admin" ? "./admin/pedidos.html" : "./conta.html";
}

function setFormBusy(form, busy) {
  var button = form.querySelector('[type="submit"]');
  if (button) {
    button.disabled = busy;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent = busy ? "Aguarde..." : button.dataset.label;
  }
}

function setupLoginForm() {
  var form = document.querySelector("#login-form");
  if (!form) return;
  var feedback = document.querySelector("#login-feedback");
  var current = window.JSMP.getUser();
  if (current) {
    feedback.className = "feedback success";
    feedback.innerHTML = "Você já está conectado como " + escapeHtml(current.email) + '. <a href="' + nextUrl(current) + '">Continuar</a>';
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    setFormBusy(form, true);
    window.JSMP.login(form.email.value.trim(), form.password.value)
      .then(function (user) {
        feedback.className = "feedback success";
        feedback.textContent = "Login realizado. Redirecionando...";
        window.location.href = nextUrl(user);
      })
      .catch(function (error) {
        feedback.className = "feedback error";
        feedback.textContent = error.message;
        setFormBusy(form, false);
      });
  });
}

function setupRegisterForm() {
  var form = document.querySelector("#register-form");
  if (!form) return;
  var feedback = document.querySelector("#register-feedback");

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (form.password.value.length < 8) {
      feedback.className = "feedback error";
      feedback.textContent = "A senha precisa ter pelo menos 8 caracteres.";
      return;
    }
    if (form.password.value !== form.confirmPassword.value) {
      feedback.className = "feedback error";
      feedback.textContent = "As senhas precisam ser iguais.";
      return;
    }
    if (form.acceptTerms && !form.acceptTerms.checked) {
      feedback.className = "feedback error";
      feedback.textContent = "Aceite a política de privacidade para continuar.";
      return;
    }
    setFormBusy(form, true);
    window.JSMP.register({
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value
    }).then(function (user) {
      feedback.className = "feedback success";
      feedback.textContent = "Conta criada! Redirecionando...";
      window.location.href = nextUrl(user);
    }).catch(function (error) {
      feedback.className = "feedback error";
      feedback.textContent = error.message;
      setFormBusy(form, false);
    });
  });
}
