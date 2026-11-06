// Envio de emails transacionais via Resend (https://resend.com).
// Opcional: sem RESEND_API_KEY os emails sao apenas ignorados (com log).

function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

const money = (cents) => (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function sendEmail({ to, subject, html, replyTo }) {
  if (!isEmailConfigured()) {
    console.log("[email] não configurado; email ignorado:", subject);
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html, reply_to: replyTo || process.env.STORE_NOTIFY_EMAIL || undefined })
    });
    if (!response.ok) {
      console.error("[email] falha", response.status, (await response.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (error) {
    console.error("[email] erro", error.message);
    return false;
  }
}

function layout(title, body) {
  return [
    '<div style="background:#0b0b0b;padding:24px;font-family:Segoe UI,Arial,sans-serif;color:#f5f2ea">',
    '<div style="max-width:560px;margin:0 auto;background:#161616;border:1px solid #3a3220;border-radius:14px;padding:28px">',
    '<p style="color:#d4af37;letter-spacing:2px;font-size:12px;margin:0 0 8px">JS MULTIMARCAS PREMIUM</p>',
    '<h1 style="font-size:22px;margin:0 0 16px;color:#ffffff">' + escapeHtml(title) + "</h1>",
    body,
    '<p style="color:#8f8670;font-size:12px;margin-top:28px">Rua Jacinto Pereira, 151 - Pan-Americano, Jaraguá - São Paulo/SP</p>',
    "</div></div>"
  ].join("");
}

function orderTable(order) {
  const rows = (order.items || []).map((item) => {
    const variation = item.size ? " (Tam. " + item.size + ")" : item.number ? " (Nº " + item.number + ")" : "";
    return '<tr><td style="padding:6px 0">' + item.quantity + "x " + escapeHtml(item.name + variation) + '</td><td style="text-align:right">' + money(item.subtotalCents) + "</td></tr>";
  }).join("");
  return [
    '<table style="width:100%;border-collapse:collapse;color:#f5f2ea;font-size:14px">',
    rows,
    '<tr><td style="padding:6px 0">' + escapeHtml(order.shipping_label) + '</td><td style="text-align:right">' + money(order.shipping_cents) + "</td></tr>",
    '<tr><td style="padding:10px 0;border-top:1px solid #3a3220"><strong>Total</strong></td><td style="text-align:right;border-top:1px solid #3a3220;color:#f1cf6c"><strong>' + money(order.total_cents) + "</strong></td></tr>",
    "</table>"
  ].join("");
}

function addressText(order) {
  if (order.shipping_method === "retirada") return "Retirada na loja (Rua Jacinto Pereira, 151 - Pan-Americano)";
  const a = order.delivery_address || {};
  return [a.street && a.street + ", " + a.number, a.complement, a.neighborhood, a.city && a.city + (a.state ? "/" + a.state : ""), a.cep && "CEP " + a.cep].filter(Boolean).join(" - ");
}

async function notifyOrderPaid(order) {
  const customerHtml = layout("Pedido #" + order.id + " confirmado!", [
    "<p>Olá, " + escapeHtml(String(order.customer_name).split(" ")[0]) + "! Recebemos o pagamento do seu pedido e já vamos separar tudo com carinho.</p>",
    orderTable(order),
    '<p style="margin-top:16px"><strong>Entrega:</strong> ' + escapeHtml(addressText(order)) + "</p>",
    "<p>Qualquer duvida, responda este email ou chame no WhatsApp.</p>"
  ].join(""));
  await sendEmail({ to: order.customer_email, subject: "Pedido #" + order.id + " confirmado - JS Multimarcas", html: customerHtml });

  if (process.env.STORE_NOTIFY_EMAIL) {
    const storeHtml = layout("Nova venda: pedido #" + order.id, [
      "<p><strong>" + escapeHtml(order.customer_name) + "</strong><br>" + escapeHtml(order.customer_email) + "<br>" + escapeHtml(order.customer_phone) + "</p>",
      orderTable(order),
      '<p style="margin-top:16px"><strong>Entrega:</strong> ' + escapeHtml(addressText(order)) + "</p>"
    ].join(""));
    await sendEmail({ to: process.env.STORE_NOTIFY_EMAIL, subject: "Nova venda #" + order.id + " - " + money(order.total_cents), html: storeHtml, replyTo: order.customer_email });
  }
}

async function sendPasswordReset({ to, name, link }) {
  const html = layout("Redefinir sua senha", [
    "<p>Olá, " + escapeHtml(String(name).split(" ")[0]) + ". Recebemos um pedido para redefinir a senha da sua conta.</p>",
    '<p><a href="' + escapeHtml(link) + '" style="display:inline-block;background:#d4af37;color:#111;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Criar nova senha</a></p>',
    '<p style="color:#bcae88;font-size:13px">O link vale por 1 hora. Se não foi você, ignore este email.</p>'
  ].join(""));
  return sendEmail({ to, subject: "Redefinir senha - JS Multimarcas", html });
}

module.exports = { isEmailConfigured, notifyOrderPaid, sendPasswordReset };
