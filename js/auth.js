// Trata login e cadastro simulados no front-end.
document.addEventListener("DOMContentLoaded", function () {
  setupLoginForm();
  setupRegisterForm();
  setupRecoveryForm();
});

function setupLoginForm() {
  var form = document.querySelector("#login-form");
  if (!form) {
    return;
  }

  var feedback = document.querySelector("#login-feedback");
  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var email = form.email.value.trim();
    var password = form.password.value.trim();
    var result = window.JSMP.login(email, password);

    if (!result.ok) {
      feedback.className = "feedback error";
      feedback.textContent = result.message;
      return;
    }

    feedback.className = "feedback success";
    feedback.textContent = "Login realizado com sucesso. Redirecionando...";
    setTimeout(function () {
      window.location.href = result.user.role === "admin" ? "./admin/produtos.html" : "./produtos.html";
    }, 900);
  });
}

function setupRecoveryForm() {
  var form = document.querySelector("#password-recovery-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var feedback = document.querySelector("#recovery-feedback");
    feedback.className = "feedback error";
    feedback.textContent = "O envio de codigo por e-mail ainda precisa ser configurado no servidor.";
  });
}

function setupRegisterForm() {
  var form = document.querySelector("#register-form");
  if (!form) {
    return;
  }

  var feedback = document.querySelector("#register-feedback");
  form.addEventListener("submit", function (event) {
    event.preventDefault();

    if (form.password.value !== form.confirmPassword.value) {
      feedback.className = "feedback error";
      feedback.textContent = "As senhas precisam ser iguais.";
      return;
    }

    var result = window.JSMP.register({
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value.trim()
    });

    if (!result.ok) {
      feedback.className = "feedback error";
      feedback.textContent = result.message;
      return;
    }

    feedback.className = "feedback success";
    feedback.textContent = "Cadastro concluido. Sua conta ja esta conectada.";
    setTimeout(function () {
      window.location.href = "./produtos.html";
    }, 900);
  });
}
