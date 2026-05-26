# JessAPI - Multi-session Baileys bridge

API Node.js que gerencia múltiplas sessões do WhatsApp via `@whiskeysockets/baileys`.
Projetada para ser consumida por uma aplicação externa (ex: Django) através de REST + Webhooks.

## Variáveis de ambiente
- `PORT` - porta HTTP (default `3000`).
- `API_KEY` - chave simples para proteger a API (obrigatória).
- `WEBHOOK_URL` - URL para onde os eventos serão enviados por POST (opcional).
- `WEBHOOK_SECRET` - segredo opcional para assinar os webhooks (HMAC SHA256). Se setado, a API incluirá o header `x-jess-signature: sha256=<hex>`.

## Instalação (local)

1. Instale dependências:

```bash
npm install
```

2. Defina as variáveis de ambiente (exemplo):

```bash
export API_KEY="minha_chave_segura"
export PORT=3000
# export WEBHOOK_URL="https://meu-django/external-webhook"
```

3. Inicie o servidor:

```bash
npm start
```

## Docker (compose)

O `docker-compose.yml` já mapeia `./auth_sessions:/app/auth_sessions` para persistir credenciais por sessão.

Exemplo:

```bash
docker-compose up --build -d
docker-compose logs -f
```

Certifique-se de exportar `API_KEY` e `WEBHOOK_URL` no ambiente do compose (ou no arquivo `.env`).
Se usar assinatura HMAC, exporte também `WEBHOOK_SECRET` para que os webhooks sejam assinados.

## Endpoints (REST)

- `POST /sessions/:id` — cria/conecta uma sessão (retorna `{ id, status, qr? }`).
- `GET /sessions` — lista sessões ativas.
- `GET /sessions/:id/status` — retorna status e `lastQr`.
- `POST /messages/send` — envia mensagem. Body JSON: `{ id_sessao, numero, texto }`.
- `DELETE /sessions/:id` — desconecta e limpa a pasta `auth_sessions/:id`.

Todas as requisições devem enviar o header `x-api-key: <API_KEY>`.

## Webhooks

Se `WEBHOOK_URL` estiver configurada, a API enviará `POST` para essa URL nos seguintes eventos:

- `qr_generated`: { sessionId, qr }
- `connected`: { sessionId }
- `disconnected`: { sessionId, reason, error }
- `message_received`: { sessionId, from, text }

O corpo do POST tem o formato: `{ event, payload, ts }`.

### Verificando a assinatura (exemplo em Python / Django)

```python
import hmac
import hashlib

def verify_signature(secret: str, body: bytes, header_sig: str) -> bool:
  # header_sig esperado: 'sha256=<hex>'
  if not header_sig or not header_sig.startswith('sha256='):
    return False
  expected = header_sig.split('=',1)[1]
  mac = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
  return hmac.compare_digest(mac, expected)
```

## Exemplos `curl`

Substitua `MY_API_KEY` pela sua chave.

Listar sessões:

```bash
curl -H "x-api-key: MY_API_KEY" http://localhost:3000/sessions
```

Criar sessão (gera QR ou conecta se já autenticado):

```bash
curl -X POST -H "x-api-key: MY_API_KEY" http://localhost:3000/sessions/test1
```

Checar status:

```bash
curl -H "x-api-key: MY_API_KEY" http://localhost:3000/sessions/test1/status
```

Enviar mensagem:

```bash
curl -X POST -H "x-api-key: MY_API_KEY" -H "Content-Type: application/json" \
  -d '{"id_sessao":"test1","numero":"5581999999999","texto":"Olá do Django"}' \
  http://localhost:3000/messages/send
```

Deletar sessão:

```bash
curl -X DELETE -H "x-api-key: MY_API_KEY" http://localhost:3000/sessions/test1
```

## Observações

- As pastas de autenticação ficam em `./auth_sessions/<sessionId>` e devem ser montadas em produção para persistência.
- Proteja o `WEBHOOK_URL` e a `API_KEY` — não exponha publicamente sem autenticação adicional.
