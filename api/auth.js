// Autenticacao: hash de senha (scrypt) e tokens assinados (HMAC-SHA256).
const crypto = require("crypto");
const { HttpError } = require("./http");

const ADMIN_TTL_MS = 8 * 60 * 60 * 1000;
const CUSTOMER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let ephemeralSecret = null;

function getSecret() {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16) {
    return process.env.AUTH_SECRET;
  }
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString("hex");
    console.warn("[auth] AUTH_SECRET ausente ou curto: usando chave temporaria. Sessoes expiram ao reiniciar o servidor.");
  }
  return ephemeralSecret;
}

function safeEquals(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return "scrypt$" + salt.toString("hex") + "$" + hash.toString("hex");
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function createToken(claims, ttlMs) {
  const payload = Buffer.from(JSON.stringify({ ...claims, exp: Date.now() + ttlMs })).toString("base64url");
  const signature = crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return payload + "." + signature;
}

function verifyToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac("sha256", getSecret()).update(parts[0]).digest("base64url");
  if (!safeEquals(parts[1], expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    if (payload.role === "admin" && String(payload.email).toLowerCase() !== getAdminEmail()) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function getAdminEmail() {
  return String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
}

function hasAdminCredentials() {
  return Boolean(getAdminEmail() && process.env.ADMIN_PASSWORD);
}

function checkAdminCredentials(email, password) {
  if (!hasAdminCredentials()) return false;
  const emailOk = safeEquals(String(email || "").trim().toLowerCase(), getAdminEmail());
  const passwordOk = safeEquals(password, process.env.ADMIN_PASSWORD);
  return emailOk && passwordOk;
}

function createAdminToken() {
  return createToken({ role: "admin", email: getAdminEmail(), name: "Administrador" }, ADMIN_TTL_MS);
}

function createCustomerToken(customer) {
  return createToken({ role: "customer", sub: customer.id, email: customer.email, name: customer.name }, CUSTOMER_TTL_MS);
}

// Token de redefinicao: vale 1h e deixa de valer assim que a senha muda.
function passwordFingerprint(passwordHash) {
  return crypto.createHash("sha256").update(String(passwordHash)).digest("base64url").slice(0, 16);
}

function createResetToken(customer) {
  return createToken({ role: "reset", sub: customer.id, fp: passwordFingerprint(customer.password_hash) }, 60 * 60 * 1000);
}

function readResetToken(token) {
  const payload = verifyToken(token);
  return payload && payload.role === "reset" ? payload : null;
}

function readBearer(request) {
  const header = String(request.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function getSession(request) {
  return verifyToken(readBearer(request));
}

function requireAdmin(request) {
  const session = getSession(request);
  if (!session || session.role !== "admin") {
    throw new HttpError(401, "Sessão administrativa inválida. Entre novamente.");
  }
  return session;
}

function requireCustomer(request) {
  const session = getSession(request);
  if (!session || session.role !== "customer") {
    throw new HttpError(401, "Entre na sua conta para continuar.");
  }
  return session;
}

module.exports = {
  hashPassword,
  verifyPassword,
  hasAdminCredentials,
  checkAdminCredentials,
  createAdminToken,
  createCustomerToken,
  createResetToken,
  readResetToken,
  passwordFingerprint,
  getSession,
  requireAdmin,
  requireCustomer,
  safeEquals
};
