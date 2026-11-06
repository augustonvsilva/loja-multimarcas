// Catalogo inicial usado apenas quando o banco esta vazio.
// Substitua pelos produtos reais pelo painel administrativo.

const seedBrands = ["Nike", "Adidas", "Lacoste", "Armani", "Hugo Boss"];
const seedCategories = ["Camisetas", "Polos", "Jaquetas", "Moletons", "Calcas", "Conjuntos", "Camisas", "Blazers", "Tenis", "Acessorios"];

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" }[c]));
}

function buildImage(brand, product, accent) {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="920" viewBox="0 0 800 920">',
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#111111"/><stop offset="100%" stop-color="#2a2a2a"/></linearGradient></defs>',
    '<rect width="800" height="920" rx="42" fill="url(#bg)"/>',
    '<circle cx="620" cy="170" r="170" fill="' + accent + '" fill-opacity="0.28"/>',
    '<circle cx="160" cy="760" r="210" fill="#000000" fill-opacity="0.24"/>',
    '<text x="80" y="160" fill="#f1cf6c" font-family="Segoe UI, Arial" font-weight="700" font-size="56">' + escapeXml(brand) + "</text>",
    '<text x="80" y="250" fill="#ffffff" font-family="Segoe UI, Arial" font-weight="700" font-size="72">' + escapeXml(product) + "</text>",
    '<rect x="80" y="340" width="640" height="420" rx="36" fill="#0e0e0e" stroke="#d4af37" stroke-opacity="0.55"/>',
    '<path d="M250 650 C320 510, 490 500, 560 650" stroke="#f1cf6c" stroke-width="18" fill="none" stroke-linecap="round"/>',
    '<path d="M300 610 C360 450, 470 430, 520 610" stroke="#ffffff" stroke-opacity="0.86" stroke-width="14" fill="none" stroke-linecap="round"/>',
    '<rect x="300" y="600" width="220" height="44" rx="18" fill="#d4af37" fill-opacity="0.88"/>',
    '<text x="80" y="830" fill="#d8cfbc" font-family="Segoe UI, Arial" font-size="34">JS Multimarcas Premium</text>',
    "</svg>"
  ].join("");
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function seedProducts() {
  const rows = [
    ["Nike", "Jaquetas", "Jaqueta Urban Gold", "Jaqueta premium com acabamento estruturado, forro confortável e visual urbano para compor looks de destaque.", 42990, 24850, 8, ["P", "M", "G", "GG"], [], "Urban Gold", "#d4af37", true],
    ["Nike", "Tenis", "Tênis Air Premium", "Tenis com proposta esportiva sofisticada, solado macio e design pensado para uso diário com presença premium.", 69990, 42130, 6, [], ["38", "39", "40", "41", "42", "43"], "Air Premium", "#9f7a15", true],
    ["Adidas", "Conjuntos", "Conjunto Black Edition", "Conjunto premium de pegada contemporânea, ideal para quem quer conforto e visual refinado no mesmo look.", 38990, 22240, 10, ["P", "M", "G", "GG"], [], "Black Edition", "#b8921f", true],
    ["Adidas", "Tenis", "Sneaker Elite Runner", "Sneaker com perfil esportivo moderno, detalhes elegantes e excelente versatilidade para a rotina.", 64990, 39020, 5, [], ["39", "40", "41", "42", "43"], "Elite Runner", "#e2c15c", false],
    ["Lacoste", "Polos", "Polo Signature Luxe", "Polo sofisticada com corte premium, tecido encorpado e acabamento discreto para looks casuais elegantes.", 31990, 17480, 12, ["P", "M", "G", "GG"], [], "Signature Luxe", "#c6a136", true],
    ["Lacoste", "Tenis", "Tênis Club Premium", "Modelo casual com identidade clean, conforto para o dia todo e leitura de luxo discreto.", 57990, 33170, 4, [], ["38", "39", "40", "41", "42"], "Club Premium", "#8f6e16", false],
    ["Armani", "Camisas", "Camisa Executive Fit", "Camisa de alfaiataria moderna com caimento premium e proposta versátil para ocasiões executivas e sociais.", 55990, 31860, 7, ["P", "M", "G", "GG"], [], "Executive Fit", "#f1cf6c", true],
    ["Armani", "Blazers", "Blazer Milano Noir", "Blazer com corte elegante, estrutura refinada e visual de alto impacto para compor a vitrine premium.", 89990, 52140, 3, ["M", "G", "GG"], [], "Milano Noir", "#cda73c", false],
    ["Hugo Boss", "Polos", "Polo Metropolitan", "Polo de visual marcante e sofisticado, pensada para quem busca elegância sem perder conforto.", 34990, 19640, 9, ["P", "M", "G", "GG"], [], "Metropolitan", "#d4af37", true],
    ["Hugo Boss", "Tenis", "Tênis Urban Tailor", "Tenis com linhas premium e acabamento urbano, criado para destacar o visual com conforto.", 62990, 37210, 5, [], ["39", "40", "41", "42", "43", "44"], "Urban Tailor", "#99761b", false]
  ];

  return rows.map(([brand, category, name, description, priceCents, costCents, stock, sizes, numbers, label, accent, featured]) => ({
    brand,
    category,
    name,
    description,
    priceCents,
    costCents,
    stock,
    hasSizes: sizes.length > 0,
    hasNumbers: numbers.length > 0,
    sizes,
    numbers,
    images: [buildImage(brand.toUpperCase(), label, accent)],
    featured
  }));
}

module.exports = { seedBrands, seedCategories, seedProducts };
