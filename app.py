"""
Conecta Carreira — Backend Python (Flask)
Esconde a GEMINI_KEY no servidor. O frontend NUNCA vê a chave.

Rodar:
    pip install -r requirements.txt
    cp .env.example .env   # e coloque sua chave
    python app.py

Aí abra: http://localhost:5000
"""

import logging
import os
import time
from collections import defaultdict, deque

import requests
from flask import Flask, request, Response, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("conecta")

VERSAO = "1.1.0"
INICIO = time.time()

GEMINI_KEY = os.getenv("GEMINI_KEY", "").strip()
MODELO = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite").strip()
PORT = int(os.getenv("PORT", "5000"))

# CORS restrito: lista separada por vírgula. Ex:
#   ALLOWED_ORIGINS=http://localhost:5000,https://seu-site.vercel.app
# Se vazio, libera geral (dev) mas avisa no log.
_raw_origins = os.getenv("ALLOWED_ORIGINS", os.getenv("ALLOWED_ORIGIN", "")).strip()
if _raw_origins in ("", "*"):
    ORIGINS = "*"
    if not _raw_origins:
        log.warning("ALLOWED_ORIGINS vazio: liberando CORS geral (ok p/ dev, restrinja em produção).")
else:
    ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

# Rate limit simples em memória: 20 req/min por IP em /api/gemini
RATE_MAX = int(os.getenv("RATE_LIMIT_MAX", "20"))
RATE_JANELA = int(os.getenv("RATE_LIMIT_WINDOW", "60"))
_reqs_por_ip: dict[str, deque] = defaultdict(deque)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# static_folder=None de propósito: o Flask serviria .env sozinho.
# Servimos os arquivos manualmente em static_files() com bloqueio.
app = Flask(__name__, static_folder=None)
CORS(app, resources={r"/api/*": {"origins": ORIGINS}})


def ip_cliente() -> str:
    return request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0].strip()


def checar_rate_limit(ip: str) -> tuple[bool, int]:
    """Retorna (permitido, segundos_para_retry)."""
    agora = time.time()
    fila = _reqs_por_ip[ip]
    while fila and fila[0] <= agora - RATE_JANELA:
        fila.popleft()
    if len(fila) >= RATE_MAX:
        retry = int(fila[0] + RATE_JANELA - agora) + 1
        return False, max(retry, 1)
    fila.append(agora)
    return True, 0


def validar_entrada(dados: dict) -> tuple[str, int, float, str]:
    """Valida e normaliza prompt/maxTokens/temperature. Retorna (prompt, max, temp, erro)."""
    prompt = str(dados.get("prompt", "")).strip()
    if not prompt:
        return "", 0, 0.0, "Campo 'prompt' vazio. Preencha os campos obrigatórios no formulário."
    if len(prompt) > 12000:
        return "", 0, 0.0, f"Prompt muito longo ({len(prompt)} caracteres, máx 12000). Resuma a descrição da vaga."

    try:
        max_tokens = int(dados.get("maxTokens", 1024))
    except (TypeError, ValueError):
        return "", 0, 0.0, "maxTokens inválido (use um número inteiro)."
    try:
        temperature = float(dados.get("temperature", 0.7))
    except (TypeError, ValueError):
        return "", 0, 0.0, "temperature inválida (use um número entre 0 e 1)."

    if not 1 <= max_tokens <= 4096:
        return "", 0, 0.0, "maxTokens fora do intervalo permitido (1 a 4096)."
    if not 0.0 <= temperature <= 1.0:
        return "", 0, 0.0, "temperature fora do intervalo permitido (0 a 1)."

    return prompt, max_tokens, temperature, ""


def erro_amigavel(status: int, detalhe: str) -> str:
    d = (detalhe or "").lower()
    if status == 400 and "api key" in d:
        return "Chave da IA inválida no servidor. Avise o responsável pelo projeto."
    if status in (401, 403):
        return "Chave da IA inválida ou sem permissão. Avise o responsável pelo projeto."
    if status == 404:
        return "Modelo da IA não encontrado. O servidor pode estar com o nome do modelo desatualizado."
    if status == 429:
        return "Muitas pessoas usando a IA agora (limite do Google). Aguarde 1 minuto e tente de novo."
    if status in (500, 502, 503, 504):
        return "O Google IA está instável agora. Aguarde alguns segundos e tente novamente."
    return detalhe or f"Erro HTTP {status}"


# ---------- Frontend estático ----------
@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    # Nunca servir segredos ou código do servidor
    if filename in (".env", "app.py", ".gitignore"):
        return jsonify({"erro": "Não encontrado"}), 404
    full = os.path.join(BASE_DIR, filename)
    if os.path.isfile(full):
        return send_from_directory(BASE_DIR, filename)
    return jsonify({"erro": "Não encontrado"}), 404


# ---------- Status detalhado ----------
@app.route("/api/health", methods=["GET"])
@app.route("/api/status", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "versao": VERSAO,
        "modelo": MODELO,
        "chave_configurada": bool(GEMINI_KEY),
        "uptime_segundos": int(time.time() - INICIO),
        "limites": {
            "max_tokens": [1, 4096],
            "temperature": [0.0, 1.0],
            "prompt_max_chars": 12000,
            "requisicoes_por_minuto_por_ip": RATE_MAX,
        },
        "cors": ORIGINS if isinstance(ORIGINS, str) else ORIGINS,
    })


# ---------- Proxy Gemini com streaming SSE ----------
@app.route("/api/gemini", methods=["POST", "OPTIONS"])
def gemini():
    ip = ip_cliente()
    permitido, retry = checar_rate_limit(ip)
    if not permitido:
        log.warning("Rate limit excedido ip=%s", ip)
        resp = jsonify({"erro": f"Muitas requisições. Aguarde {retry}s e tente novamente."})
        resp.status_code = 429
        resp.headers["Retry-After"] = str(retry)
        return resp

    if not GEMINI_KEY:
        log.error("GEMINI_KEY ausente (ip=%s)", ip)
        return jsonify({
            "erro": "Serviço de IA não configurado (chave ausente no servidor). "
                    "Avise o responsável pelo projeto.",
            "codigo": "SEM_CHAVE",
        }), 500

    try:
        dados = request.get_json(force=True)
    except Exception:
        return jsonify({"erro": "Corpo JSON inválido. Recarregue a página e tente de novo."}), 400

    if not isinstance(dados, dict):
        return jsonify({"erro": "Envie {prompt, maxTokens?, temperature?}."}), 400

    # Compat: aceita formato Gemini direto convertendo p/ simplificado
    if "prompt" not in dados and "contents" in dados:
        try:
            prompt_extraido = dados["contents"][0]["parts"][0]["text"]
            dados = {"prompt": prompt_extraido,
                     "maxTokens": dados.get("generationConfig", {}).get("maxOutputTokens", 1024),
                     "temperature": dados.get("generationConfig", {}).get("temperature", 0.7)}
        except (KeyError, IndexError, TypeError):
            return jsonify({"erro": "Formato 'contents' inválido."}), 400

    prompt, max_tokens, temperature, erro = validar_entrada(dados)
    if erro:
        return jsonify({"erro": erro}), 400

    corpo_gemini = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature},
        "safetySettings": [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_ONLY_HIGH"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_ONLY_HIGH"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_ONLY_HIGH"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_ONLY_HIGH"},
            {"category": "HARM_CATEGORY_CIVIC_INTEGRITY", "threshold": "BLOCK_ONLY_HIGH"},
        ],
    }

    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{MODELO}:streamGenerateContent?alt=sse&key={GEMINI_KEY}"
    )

    try:
        upstream = requests.post(url, json=corpo_gemini, stream=True, timeout=65)
    except requests.exceptions.Timeout:
        log.warning("Timeout Google ip=%s prompt=%d chars", ip, len(prompt))
        return jsonify({"erro": "A IA demorou demais para responder. Verifique sua internet e tente de novo."}), 504
    except requests.exceptions.RequestException as e:
        log.warning("Falha conexão Google ip=%s err=%s", ip, type(e).__name__)
        return jsonify({"erro": "Falha de conexão com a IA. Verifique sua internet e tente de novo."}), 502

    if upstream.status_code != 200:
        try:
            detalhe = upstream.json().get("error", {}).get("message", f"Erro HTTP {upstream.status_code}")
        except Exception:
            detalhe = f"Erro HTTP {upstream.status_code}"
        # Log SEM a chave: só status + prefixo do detalhe
        log.warning("Google erro status=%s detalhe=%.120s ip=%s", upstream.status_code, detalhe, ip)
        upstream.close()
        return jsonify({"erro": erro_amigavel(upstream.status_code, detalhe)}), upstream.status_code

    log.info("Gemini ok ip=%s prompt=%d chars max=%d temp=%.2f", ip, len(prompt), max_tokens, temperature)

    def gerar():
        try:
            for chunk in upstream.iter_content(chunk_size=4096):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    origin = request.headers.get("Origin", ORIGINS if isinstance(ORIGINS, str) else (ORIGINS[0] if ORIGINS else "*"))
    return Response(
        gerar(),
        status=200,
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": origin,
        },
    )


if __name__ == "__main__":
    if not GEMINI_KEY:
        print("⚠️  AVISO: GEMINI_KEY não encontrada. Crie um .env (veja .env.example).")
    print(f"🚀 Conecta Carreira v{VERSAO} em http://localhost:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=True)
