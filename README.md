# JS Multimarcas Premium

Loja virtual da JS Multimarcas Premium (Pan-Americano, Jaraguá - SP).

- **Site:** https://augustonvsilva.github.io/loja-multimarcas/ (GitHub Pages)
- **API:** https://loja-multimarcas.onrender.com (Render) · saúde: `/api/health`

## Como funciona

| Parte | Onde roda | O que faz |
|---|---|---|
| Site (HTML/CSS/JS) | GitHub Pages | Vitrine, carrinho, checkout, conta do cliente, painel admin |
| API (`api/`) | Render | Produtos, pedidos, clientes, frete, pagamentos, emails |
| Banco | Postgres (Neon) | Todos os dados da loja |
| Pagamento | Mercado Pago (Bricks) | PIX, débito e crédito; o cartão nunca passa pelo nosso servidor |

Regras importantes, garantidas pelo servidor:
- O **preço, o frete e o estoque** são sempre recalculados no servidor. O navegador só envia *quais* produtos e quantidades.
- O pedido é criado como "aguardando pagamento" e só vira **pago** quando o Mercado Pago confirma (na hora, pelo webhook ou na consulta automática do PIX). O estoque é baixado nesse momento, uma única vez.
- Cancelar ou reembolsar um pedido no admin devolve o estoque. O estorno do dinheiro é feito no painel do Mercado Pago.
- Senhas de clientes usam hash `scrypt`; as sessões usam tokens assinados.

## Rodar localmente

Requer Node 20+.

```bash
npm install
cp .env.example .env     # preencha ADMIN_EMAIL, ADMIN_PASSWORD e AUTH_SECRET
npm start                # http://localhost:3000
```

Sem `DATABASE_URL`, o servidor usa um Postgres embutido (PGlite) gravado em `./data/`, já com produtos de exemplo.

```bash
npm test         # testes da API (checkout, estoque, webhook, admin, segurança)
npm run build    # gera os .html a partir de src/pages (rode após editar páginas)
```

## Editando o site

- **Páginas:** edite `src/pages/*.html` e rode `npm run build`. Cabeçalho, rodapé e SEO ficam em `scripts/build-pages.js`. Não edite os `.html` da raiz, porque eles são gerados.
- **Telefone, WhatsApp, email, endereço, CNPJ e horário:** `window.JSMP_STORE` no início de `js/app.js`.
- **Produtos, fotos, estoque e preços:** pelo painel em `/admin/produtos.html`, entrando com o `ADMIN_EMAIL`.
- **Regras de frete local:** `api/shipping.js`.

## Variáveis de ambiente

Todas estão documentadas em [`.env.example`](.env.example). Em produção, cadastre-as no Render. As obrigatórias:
`DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `AUTH_SECRET`, `MERCADOPAGO_PUBLIC_KEY` e `MERCADOPAGO_ACCESS_TOKEN`.

## Deploy

- Push na branch `main`: o GitHub Pages publica o site e o Render faz o deploy da API automaticamente.
- O CI (`.github/workflows/ci.yml`) roda os testes e confere se as páginas geradas estão atualizadas.

## API (resumo)

| Método | Rota | Acesso |
|---|---|---|
| GET | `/api/products`, `/api/products/:id`, `/api/taxonomy` | público |
| POST | `/api/shipping/quote` | público |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/forgot`, `/api/auth/reset` | público |
| GET | `/api/account/orders` | cliente |
| GET | `/api/payments/config` · POST `/api/checkout` · GET `/api/orders/:id?token=` | público |
| POST | `/api/payments/webhook` | Mercado Pago |
| GET/POST/PUT/DELETE | `/api/admin/products`, `/api/admin/images`, `/api/admin/orders`, `/api/admin/expenses`... | admin |
