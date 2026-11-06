// Carrega variaveis de um arquivo .env local (sem sobrescrever as do ambiente).
const fs = require("fs");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && typeof process.env[key] === "undefined") {
      process.env[key] = value;
    }
  });
}

module.exports = { loadEnvFile };
