# Conecta Carreira — Frontend + Backend Python

Interface para gerar currículos e simular entrevistas com IA.
A chave do Gemini fica **só no backend** (`.env`), nunca no frontend.

## Stack
- Frontend: HTML/CSS/JS vanilla (sem build)
  - marked + DOMPurify (Markdown → HTML seguro)
  - jsPDF (geração de PDF client-side)
  - Lucide Icons
- Backend: Python Flask (proxy da API Gemini com streaming SSE)

## Estrutura
```
├── index.html      # HTML principal
├── style.css       # Design system tema LAGO (OKLCH, dark mode, responsivo)
├── script.js       # Lógica: forms, chat, PDF, TXT, edição, histórico
├── api.js          # Cliente da IA — chama /api/gemini (sem chave!) + erros claros
├── app.py          # Backend: valida, rate-limit, log seguro, proxy streaming
├── requirements.txt
├── Dockerfile      # Deploy do backend
├── tests/          # pytest: health, validação, rate-limit, stream mockado
├── .env.example    # Copie para .env e coloque sua chave
└── worker.js       # (legado) não é mais necessário
```

## Rodar local

```bash
pip install -r requirements.txt
cp .env.example .env   # Linux/Mac  |  copy .env.example .env  (Windows)
# edite o .env e coloque sua GEMINI_KEY

python app.py
# abra http://localhost:5000
```

Endpoints:
- `GET /` → index.html
- `GET /api/health` (alias `/api/status`) → status detalhado
- `POST /api/gemini` → proxy do Gemini (streaming SSE)

```bash
curl http://localhost:5000/api/health
curl -X POST http://localhost:5000/api/gemini \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Diga olá","maxTokens":100}'
```

## Testes

```bash
pip install -r requirements.txt
pytest -q
```
9 testes: health, validação de `maxTokens`/`temperature`/prompt, stream mockado
(sem gastar cota), rate-limit 429 e bloqueio de `/.env` e `/app.py`.

> Teste com a API real: configure a `GEMINI_KEY` no `.env`, rode o backend,
> gere um currículo e rode a entrevista completa (3 perguntas + feedback).
> Erros comuns já têm mensagem clara + botão **Tentar novamente**.

## Segurança
- `.env` está no `.gitignore` (+ `.dockerignore`) — **nunca commite sua chave**.
- A chave antiga (`AQ.Ab8...`) estava exposta no `api.js` — **revogue ela no
  Google AI Studio e gere uma nova**, depois coloque só no `.env` do servidor.
- Backend valida `maxTokens` (1–4096), `temperature` (0–1) e prompt (máx 12000 chars).
- Rate-limit: 20 req/min por IP em `/api/gemini` (429 + `Retry-After`).
- Logs nunca imprimem a chave; erros do Google são traduzidos p/ mensagens claras.
- Em produção, restrinja o CORS: `ALLOWED_ORIGINS=https://seu-site.vercel.app`.

## Funcionalidades
- **Currículo**: validação antes da IA, progresso com tempo + prévia ao vivo,
  erro com Tentar novamente, **editar antes de baixar**, baixar **PDF e TXT**,
  copiar, exemplo de preenchimento, limpar histórico.
- **Entrevista**: 3 etapas, erro com Tentar novamente (sem duplicar resposta),
  Enter envia, Esc cancela, limpar histórico.
- **Acessibilidade**: skip-link, `role=alert`, foco no resultado/erro, labels.
- **Mobile**: botões em largura total, chat e toasts adaptados.

## Publicação

**Backend (Render / Railway / Fly.io):**
1. Suba o repo sem o `.env`.
2. Configure as envs na hospedagem: `GEMINI_KEY`, `GEMINI_MODEL`,
   `ALLOWED_ORIGINS=https://SEU-FRONTEND`.
3. Com Docker: build automático via `Dockerfile` (`gunicorn app:app`).
   Sem Docker (Render): Build `pip install -r requirements.txt`,
   Start `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 70`.
4. Teste `https://SEU-BACKEND/api/health`.

**Frontend (Vercel / Netlify):**
- Se o Flask servir tudo, nem precisa separar. Para separar:
  Vercel/Netlify com a pasta como estática e `URL_BACKEND` em `api.js`
  apontando p/ `https://SEU-BACKEND/api/gemini`, com `ALLOWED_ORIGINS`
  liberando o domínio do frontend. Use sempre HTTPS.
