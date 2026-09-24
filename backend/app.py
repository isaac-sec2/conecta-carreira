"""Conecta Carreira — backend Flask com proxy seguro para a API Gemini."""

import ipaddress
import logging
import math
import os
import threading
import time
from collections import OrderedDict, deque
from pathlib import Path
from urllib.parse import quote, urlsplit

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.middleware.proxy_fix import ProxyFix

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = PROJECT_ROOT / "public"
load_dotenv(PROJECT_ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("conecta")

VERSAO = "2.0.0"
INICIO = time.monotonic()
PUBLIC_FILES = frozenset({"index.html", "css/styles.css", "js/api.js", "js/app.js"})
MAX_CONTENT_LENGTH = 64 * 1024
PROMPT_MAX_CHARS = 12000


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"{name} deve ser um número inteiro.") from error
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} deve estar entre {minimum} e {maximum}.")
    return value


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} deve ser true ou false.")


def _normalize_origin(value: str) -> str:
    value = value.strip().rstrip("/")
    try:
        parsed = urlsplit(value)
    except ValueError as error:
        raise RuntimeError("ALLOWED_ORIGINS deve conter URLs http ou https.") from error
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError("ALLOWED_ORIGINS deve conter URLs http ou https.")
    if parsed.path or parsed.query or parsed.fragment:
        raise RuntimeError("ALLOWED_ORIGINS não pode conter caminho, query ou fragmento.")
    return f"{parsed.scheme}://{parsed.netloc}".lower()


def _parse_origins(raw: str) -> tuple[str, ...]:
    if not raw.strip():
        return ()
    items = [value.strip() for value in raw.split(",") if value.strip()]
    if "*" in items:
        if len(items) != 1:
            raise RuntimeError("Use '*' sozinho em ALLOWED_ORIGINS.")
        return ("*",)
    return tuple(_normalize_origin(value) for value in items)


GEMINI_KEY = os.getenv("GEMINI_KEY", "").strip()
MODELO = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite").strip()
if not MODELO:
    raise RuntimeError("GEMINI_MODEL nao pode ficar vazio.")
PORT = _env_int("PORT", 5000, 1, 65535)
RATE_MAX = _env_int("RATE_LIMIT_MAX", 20, 1, 10000)
RATE_JANELA = _env_int("RATE_LIMIT_WINDOW", 60, 1, 86400)
RATE_MAX_KEYS = _env_int("RATE_LIMIT_MAX_KEYS", 10000, 100, 100000)
MAX_STREAMS = _env_int("MAX_STREAMS", 8, 1, 128)
TRUST_PROXY = _env_bool("TRUST_PROXY", False)
CLIENT_IP_HEADER = os.getenv("CLIENT_IP_HEADER", "").strip().lower()
if CLIENT_IP_HEADER and not CLIENT_IP_HEADER.replace("-", "").isalnum():
    raise RuntimeError("CLIENT_IP_HEADER deve conter apenas letras e hífens.")
ORIGINS = _parse_origins(os.getenv("ALLOWED_ORIGINS", os.getenv("ALLOWED_ORIGIN", "")))

_reqs_por_ip: OrderedDict[str, deque[float]] = OrderedDict()
_rate_lock = threading.Lock()
_stream_slots = threading.BoundedSemaphore(MAX_STREAMS)
_last_rate_cleanup = 0.0

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
CORS(
    app,
    resources={r"/api/*": {"origins": list(ORIGINS)}},
    supports_credentials=False,
)

if TRUST_PROXY:
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=0, x_proto=1, x_host=1)


def _canonical_ip(value: str | None) -> str:
    if not value:
        return "unknown"
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return "unknown"


def ip_cliente() -> str:
    if TRUST_PROXY and CLIENT_IP_HEADER:
        return _canonical_ip(request.headers.get(CLIENT_IP_HEADER))
    return _canonical_ip(request.remote_addr)


def _cleanup_rate_keys(now: float) -> None:
    global _last_rate_cleanup
    if now - _last_rate_cleanup < min(5.0, float(RATE_JANELA)):
        return
    expired = [ip for ip, queue in _reqs_por_ip.items() if not queue or queue[0] <= now - RATE_JANELA]
    for ip in expired:
        _reqs_por_ip.pop(ip, None)
    _last_rate_cleanup = now


def checar_rate_limit(ip: str) -> tuple[bool, int]:
    now = time.monotonic()
    with _rate_lock:
        _cleanup_rate_keys(now)
        queue = _reqs_por_ip.get(ip)
        if queue is None:
            queue = deque()
            _reqs_por_ip[ip] = queue
        else:
            _reqs_por_ip.move_to_end(ip)
        while queue and queue[0] <= now - RATE_JANELA:
            queue.popleft()
        if len(queue) >= RATE_MAX:
            retry = max(1, math.ceil(queue[0] + RATE_JANELA - now))
            return False, retry
        queue.append(now)
        while len(_reqs_por_ip) > RATE_MAX_KEYS:
            _reqs_por_ip.popitem(last=False)
        return True, 0


def _erro_validacao(campo: str, esperado: str) -> tuple[str, int, float, str]:
    return "", 0, 0.0, f"Campo '{campo}' inválido ({esperado})."


def validar_entrada(dados: dict) -> tuple[str, int, float, str]:
    prompt = dados.get("prompt")
    if not isinstance(prompt, str):
        return _erro_validacao("prompt", "use texto")
    prompt = prompt.strip()
    if not prompt:
        return "", 0, 0.0, "Campo 'prompt' vazio. Preencha os campos obrigatórios no formulário."
    if len(prompt) > PROMPT_MAX_CHARS:
        return "", 0, 0.0, f"Prompt muito longo ({len(prompt)} caracteres, máx {PROMPT_MAX_CHARS}). Resuma os dados."

    max_tokens = dados.get("maxTokens", 1024)
    if isinstance(max_tokens, bool) or not isinstance(max_tokens, int):
        return _erro_validacao("maxTokens", "use um número inteiro")
    if not 1 <= max_tokens <= 4096:
        return "", 0, 0.0, "maxTokens fora do intervalo permitido (1 a 4096)."

    temperature = dados.get("temperature", 0.7)
    if isinstance(temperature, bool) or not isinstance(temperature, (int, float)):
        return _erro_validacao("temperature", "use um número")
    temperature = float(temperature)
    if not math.isfinite(temperature) or not 0.0 <= temperature <= 1.0:
        return "", 0, 0.0, "temperature fora do intervalo permitido (0 a 1)."

    return prompt, max_tokens, temperature, ""


def _contents_to_payload(dados: dict) -> dict:
    contents = dados.get("contents")
    if not isinstance(contents, list):
        raise TypeError("'contents' deve ser uma lista.")
    if not contents:
        raise ValueError("'contents' deve ser uma lista não vazia.")
    textos: list[str] = []
    for content in contents:
        if not isinstance(content, dict) or not isinstance(content.get("parts"), list):
            raise TypeError("Cada item de 'contents' deve conter uma lista 'parts'.")
        for part in content["parts"]:
            if not isinstance(part, dict) or not isinstance(part.get("text"), str):
                raise TypeError("Cada parte de 'contents' deve conter texto.")
            textos.append(part["text"])
    if not any(texto.strip() for texto in textos):
        raise ValueError("'contents' não contém texto válido.")

    generation_config = dados.get("generationConfig", {})
    if generation_config is None or not isinstance(generation_config, dict):
        raise ValueError("'generationConfig' deve ser um objeto.")
    return {
        "prompt": "\n".join(textos),
        "maxTokens": generation_config.get("maxOutputTokens", 1024),
        "temperature": generation_config.get("temperature", 0.7),
    }


def erro_amigavel(status: int) -> str:
    if status == 400:
        return "A requisição foi recusada pelo serviço de IA."
    if status in {401, 403}:
        return "Chave da IA inválida ou sem permissão. Avise o responsável pelo projeto."
    if status == 404:
        return "Modelo da IA não encontrado. Verifique a configuração do servidor."
    if status == 429:
        return "Muitas pessoas usando a IA agora. Aguarde um minuto e tente novamente."
    if status in {500, 502, 503, 504}:
        return "A IA está instável agora. Aguarde alguns segundos e tente novamente."
    return f"O serviço de IA respondeu com erro {status}."


def _safe_retry_after(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    if len(value) > 128:
        return None
    if value.isdigit() or (value[:1].isdigit() and value[-1:].isdigit() and " " in value):
        return value
    return None


def _origin_allowed() -> bool:
    origin = request.headers.get("Origin", "").strip().rstrip("/")
    if not origin:
        return True
    if "*" in ORIGINS:
        return True
    try:
        normalized = _normalize_origin(origin)
    except RuntimeError:
        return False
    if normalized in ORIGINS:
        return True
    parsed = urlsplit(normalized)
    same_origin = parsed.netloc.lower() == request.host.lower() and parsed.scheme.lower() == request.scheme.lower()
    return same_origin


@app.before_request
def enforce_origin():
    if request.path.startswith("/api/") and not _origin_allowed():
        return jsonify({"erro": "Origem não autorizada."}), 403
    return None


@app.after_request
def ensure_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
    if request.path.startswith("/api/"):
        vary = {value.strip() for value in response.headers.get("Vary", "").split(",") if value.strip()}
        vary.add("Origin")
        response.headers["Vary"] = ", ".join(sorted(vary))
    return response


@app.errorhandler(RequestEntityTooLarge)
def payload_too_large(_error):
    return jsonify({"erro": "Corpo da requisição grande demais."}), 413


@app.get("/")
def index():
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.get("/<path:filename>")
def static_files(filename):
    if filename not in PUBLIC_FILES or "\\" in filename:
        return jsonify({"erro": "Não encontrado"}), 404
    return send_from_directory(PUBLIC_DIR, filename)


@app.get("/api/health")
@app.get("/api/status")
def health():
    ready = bool(GEMINI_KEY)
    return jsonify({
        "ok": ready,
        "ready": ready,
        "versao": VERSAO,
        "modelo": MODELO,
        "chave_configurada": ready,
        "uptime_segundos": int(time.monotonic() - INICIO),
        "limites": {
            "max_tokens": [1, 4096],
            "temperature": [0.0, 1.0],
            "prompt_max_chars": PROMPT_MAX_CHARS,
            "requisicoes_por_minuto_por_ip": RATE_MAX,
        },
        "cors": list(ORIGINS),
    }), 200 if ready else 503


@app.route("/api/gemini", methods=["POST", "OPTIONS"])
def gemini():
    if request.method == "OPTIONS":
        return "", 204

    if not GEMINI_KEY:
        log.error("GEMINI_KEY ausente (ip=%s)", ip_cliente())
        return jsonify({
            "erro": "Serviço de IA não configurado (chave ausente no servidor). Avise o responsável pelo projeto.",
            "codigo": "SEM_CHAVE",
        }), 503

    if not request.is_json:
        return jsonify({"erro": "Envie Content-Type: application/json."}), 415

    try:
        dados = request.get_json()
    except (ValueError, TypeError, RecursionError):
        return jsonify({"erro": "Corpo JSON inválido."}), 400
    if not isinstance(dados, dict):
        return jsonify({"erro": "Envie um objeto JSON válido."}), 400

    if "prompt" not in dados and "contents" in dados:
        try:
            dados = _contents_to_payload(dados)
        except (TypeError, ValueError) as error:
            return jsonify({"erro": f"Formato Gemini inválido: {error}"}), 400

    prompt, max_tokens, temperature, erro = validar_entrada(dados)
    if erro:
        return jsonify({"erro": erro}), 400

    ip = ip_cliente()
    permitido, retry = checar_rate_limit(ip)
    if not permitido:
        log.warning("Rate limit excedido ip=%s", ip)
        response = jsonify({"erro": f"Muitas requisições. Aguarde {retry}s e tente novamente."})
        response.status_code = 429
        response.headers["Retry-After"] = str(retry)
        return response

    if not _stream_slots.acquire(blocking=False):
        return jsonify({"erro": "A IA está ocupada. Tente novamente em alguns instantes."}), 503
    slot_released = False

    def liberar_stream() -> None:
        nonlocal slot_released
        if not slot_released:
            _stream_slots.release()
            slot_released = True

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
    model_segment = quote(MODELO, safe="")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_segment}:streamGenerateContent?alt=sse"

    try:
        upstream = requests.post(
            url,
            headers={"x-goog-api-key": GEMINI_KEY},
            json=corpo_gemini,
            stream=True,
            timeout=(10, 65),
        )
    except requests.exceptions.Timeout:
        liberar_stream()
        log.warning("Timeout Google ip=%s prompt=%d chars", ip, len(prompt))
        return jsonify({"erro": "A IA demorou demais para responder. Tente novamente."}), 504
    except requests.exceptions.RequestException as error:
        liberar_stream()
        log.warning("Falha de conexão Google ip=%s err=%s", ip, type(error).__name__)
        return jsonify({"erro": "Falha de conexão com a IA. Tente novamente."}), 502

    if upstream.status_code != 200:
        try:
            upstream.close()
        finally:
            liberar_stream()
        log.warning("Google erro status=%s ip=%s", upstream.status_code, ip)
        response = jsonify({"erro": erro_amigavel(upstream.status_code)})
        response.status_code = upstream.status_code
        retry_after = _safe_retry_after(upstream.headers.get("Retry-After"))
        if retry_after:
            response.headers["Retry-After"] = retry_after
        return response

    log.info("Gemini ok ip=%s prompt=%d chars max=%d temp=%.2f", ip, len(prompt), max_tokens, temperature)

    def gerar():
        pending: list[bytes] = []
        pending_size = 0
        try:
            for line in upstream.iter_lines(chunk_size=4096, decode_unicode=False):
                line_size = len(line) + 1
                if pending_size + line_size > 1024 * 1024:
                    yield b'event: error\ndata: {"erro":"O evento da IA excedeu o limite permitido.","status":502}\n\n'
                    return
                pending.append(line + b"\n")
                pending_size += line_size
                if not line:
                    event = b"".join(pending)
                    pending = []
                    pending_size = 0
                    yield event
            if pending:
                yield b"".join(pending)
        except requests.exceptions.RequestException as error:
            log.warning("Stream Google interrompido ip=%s err=%s", ip, type(error).__name__)
            yield b'event: error\ndata: {"erro":"A conexao com a IA foi interrompida. Tente novamente.","status":502}\n\n'
        finally:
            try:
                upstream.close()
            finally:
                liberar_stream()

    response = Response(
        gerar(),
        status=200,
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
    response.call_on_close(liberar_stream)
    return response


if __name__ == "__main__":
    if not GEMINI_KEY:
        log.warning("GEMINI_KEY nao encontrada; veja .env.example")
    log.info("Conecta Carreira v%s em http://localhost:%s", VERSAO, PORT)
    app.run(
        host=os.getenv("HOST", "127.0.0.1"),
        port=PORT,
        debug=_env_bool("FLASK_DEBUG", False),
    )
