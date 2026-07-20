# API dos Correios

Esta loja agora possui um backend simples para consultar Preco e Prazo dos Correios sem expor credenciais no navegador.

## Como configurar

1. Copie `.env.example` para `.env`.
2. Preencha as variaveis do contrato:
   - `CORREIOS_USERNAME`
   - `CORREIOS_API_PASSWORD`
   - `CORREIOS_CARD_NUMBER`
   - `CORREIOS_CONTRACT_NUMBER`
   - `CORREIOS_DR`
3. Confirme o CEP de origem em `CORREIOS_ORIGIN_CEP`.
4. Rode:

```bash
npm start
```

O site abre em `http://localhost:3000`.

## Requisitos nos Correios

A API oficial exige contrato ativo, conta PJ no Meu Correios, codigo de acesso no CWS e liberacao dos servicos:

- `38202 API PRECOS`
- `38210 API PRAZOS`

Sem esses itens, a consulta oficial retorna erro. Nesse caso, o frontend continua usando o simulador local como fallback.

## Endpoint local

```http
POST /api/shipping/quote
Content-Type: application/json
```

Body:

```json
{
  "cep": "01001000",
  "subtotal": 429.9,
  "itemCount": 1
}
```

Resposta:

```json
{
  "ok": true,
  "provider": "correios",
  "cep": "01001000",
  "options": [
    {
      "method": "correios-pac",
      "label": "Correios PAC",
      "amount": 25.5,
      "deadline": "5 dias uteis",
      "description": "Cotacao oficial dos Correios para postagem a partir do Pan-Americano, Jaragua-SP.",
      "source": "correios-api"
    }
  ]
}
```
