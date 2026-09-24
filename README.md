# Conecta Carreira — Frontend + Backend Python

Interface para gerar currículos e simular entrevistas com IA. A chave do Gemini fica somente no backend.

## Stack

- Frontend: HTML, CSS e JavaScript vanilla, sem etapa de build.
- Backend: Flask, proxy da API Gemini com streaming SSE.
- PDF: jsPDF no navegador.
- Markdown: marked com sanitização por DOMPurify.

## Estrutura

```text
conecta-carreira/
├── backend/
│   └── app.py
├── public/
│   ├── index.html
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── api.js
│       └── app.js
├── worker/
│   └── worker.js
├── tests/
│   └── test_app.py
├── .env.example
├── Dockerfile
├── render.yaml
├── requirements.txt
└── README.md
```

O Flask serve somente os quatro assets dentro de `public/`. Backend, testes, configuração e arquivos de infraestrutura não ficam acessíveis pela rota estática.

## Rodar local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Preencha `GEMINI_KEY` no `.env` e execute:

```bash
python -m backend.app
```

Abra `http://localhost:5000`. O servidor local escuta apenas `127.0.0.1`; `FLASK_DEBUG` permanece falso por padrão.

## Endpoints

- `GET /` — página principal.
- `GET /api/health` e `GET /api/status` — liveness/readiness. Retorna `503` se a chave não estiver configurada.
- `POST /api/gemini` — proxy autenticado pela chave do servidor, com resposta SSE.
- `OPTIONS /api/gemini` — preflight CORS para origens autorizadas.

Exemplo:

```bash
curl http://localhost:5000/api/health
curl -X POST http://localhost:5000/api/gemini \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Diga olá","maxTokens":100}'
```

## Testes e segurança

```bash
pip install -r requirements.txt
pytest -q
```

A suíte não chama a API real. Ela cobre health/readiness, validação estrita, limite de corpo, CORS, preflight, rate-limit, streaming, upstream e proteção de arquivos privados.

Proteções atuais:

- allowlist dos quatro assets públicos;
- CORS por allowlist, sem reflexão arbitrária de `Origin`;
- `ALLOWED_ORIGINS` vazio permite apenas uso same-origin;
- limite de 64 KiB no corpo e validação estrita do payload;
- rate-limit atômico em memória, com expiração e limite de chaves;
- limite global de oito streams para reservar capacidade para health checks;
- chave enviada ao Gemini pelo header `x-goog-api-key`;
- `.env*`, `.git`, testes e caches excluídos da imagem Docker;
- nenhum currículo ou transcript é persistido automaticamente no navegador.

CORS não é autenticação nem impede abuso por clientes não-browser. Para um serviço com escala horizontal, substitua o armazenamento em memória do rate-limit por Redis ou outro armazenamento compartilhado e aplique autenticação/quotas conforme o caso de uso.

`TRUST_PROXY` deve ficar `false` quando a aplicação estiver exposta diretamente. Ative-o somente atrás de um proxy confiável. Nesse modo, `CLIENT_IP_HEADER` informa o cabeçalho de IP sanitizado pelo proxy; no Render, o Blueprint usa `CF-Connecting-IP`, fornecido pela camada Cloudflare.

## Frontend separado

O frontend usa o mesmo domínio por padrão. Para Vercel, Netlify ou outro servidor estático, altere `public/index.html`:

```html
<meta name="api-base-url" content="https://SEU-BACKEND">
```

Depois, adicione o domínio exato do frontend em `ALLOWED_ORIGINS`:

```text
ALLOWED_ORIGINS=https://SEU-FRONTEND
```

Use sempre HTTPS. A porta `5500` mantém o fallback local para `http://localhost:5000`; o `.env.example` já autoriza `localhost:5500`, `127.0.0.1:5500` e `[::1]:5500` para desenvolvimento.

## Publicação

### Render

`render.yaml` usa o runtime Python nativo, Gunicorn `gthread`, um processo, até oito streams simultâneos, porta injetada pela plataforma e `/api/health` como readiness check. Configure `GEMINI_KEY` no painel; não coloque o valor no repositório.

### Docker

O container respeita `PORT` e usa `5000` somente como fallback:

```bash
docker build -t conecta-carreira .
docker run --rm -p 5000:5000 --env-file .env conecta-carreira
```

Em provedores que injetam outra porta, exponha a mesma variável `PORT` no serviço.

### Gunicorn sem Docker

```bash
gunicorn backend.app:app --bind 0.0.0.0:$PORT --worker-class gthread --threads 12 --workers 1 --timeout 150
```

O processo único mantém o rate-limit em memória consistente; as threads permitem atender health checks durante streams. Antes de aumentar processos ou instâncias, implemente armazenamento compartilhado.
