import json
import os
import subprocess
import sys
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod


class FakeUpstream:
    def __init__(self, status_code=200, chunks=None, error=None, headers=None):
        self.status_code = status_code
        self.chunks = chunks or []
        self.error = error
        self.headers = headers or {}
        self.closed = False

    def iter_lines(self, chunk_size=4096, decode_unicode=False):
        data = b"".join(self.chunks)
        yield from data.splitlines()
        if self.error:
            raise self.error

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def limpar_estado():
    appmod._reqs_por_ip.clear()
    appmod._last_rate_cleanup = 0.0
    appmod.app.config["TESTING"] = True
    yield
    appmod._reqs_por_ip.clear()
    appmod.app.config["TESTING"] = False


@pytest.fixture()
def client():
    with appmod.app.test_client() as test_client:
        yield test_client


def ativar_chave(monkeypatch, value="fake"):
    monkeypatch.setattr(appmod, "GEMINI_KEY", value)


def mock_post(monkeypatch, upstream):
    chamadas = []

    def postar(*args, **kwargs):
        chamadas.append((args, kwargs))
        return upstream

    monkeypatch.setattr(appmod.requests, "post", postar)
    return chamadas


def evento(texto="ok", finish="STOP"):
    payload = {"candidates": [{"content": {"parts": [{"text": texto}]}, "finishReason": finish}]}
    return f"data: {json.dumps(payload)}\n\n".encode()


def test_health_pronto(client, monkeypatch):
    ativar_chave(monkeypatch)
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["ready"] is True
    assert body["chave_configurada"] is True
    assert "modelo" in body
    assert "versao" in body
    assert "limites" in body


def test_health_sem_chave_indisponivel(client, monkeypatch):
    ativar_chave(monkeypatch, "")
    response = client.get("/api/health")
    assert response.status_code == 503
    body = response.get_json()
    assert body["ok"] is False
    assert body["ready"] is False
    assert body["chave_configurada"] is False


def test_alias_status(client, monkeypatch):
    ativar_chave(monkeypatch)
    assert client.get("/api/status").status_code == 200


def test_gemini_sem_chave_retorna_503(client, monkeypatch):
    ativar_chave(monkeypatch, "")
    response = client.post("/api/gemini", json={"prompt": "oi"})
    assert response.status_code == 503
    assert response.get_json()["codigo"] == "SEM_CHAVE"


def test_exige_content_type_json(client, monkeypatch):
    ativar_chave(monkeypatch)
    response = client.post("/api/gemini", data='{"prompt":"oi"}', content_type="text/plain")
    assert response.status_code == 415


def test_json_invalido_retorna_400(client, monkeypatch):
    ativar_chave(monkeypatch)
    response = client.post("/api/gemini", data="{", content_type="application/json")
    assert response.status_code == 400


def test_json_nao_objeto_retorna_400(client, monkeypatch):
    ativar_chave(monkeypatch)
    response = client.post("/api/gemini", json=["prompt"])
    assert response.status_code == 400


def test_corpo_acima_do_limite_retorna_413(client, monkeypatch):
    ativar_chave(monkeypatch)
    anterior = appmod.app.config["MAX_CONTENT_LENGTH"]
    appmod.app.config["MAX_CONTENT_LENGTH"] = 128
    try:
        response = client.post("/api/gemini", json={"prompt": "x" * 200})
    finally:
        appmod.app.config["MAX_CONTENT_LENGTH"] = anterior
    assert response.status_code == 413


@pytest.mark.parametrize("payload", [
    {"prompt": None},
    {"prompt": []},
    {"prompt": "   "},
    {"prompt": "x" * 12001},
    {"prompt": "oi", "maxTokens": True},
    {"prompt": "oi", "maxTokens": 1.5},
    {"prompt": "oi", "maxTokens": "10"},
    {"prompt": "oi", "maxTokens": 0},
    {"prompt": "oi", "maxTokens": 4097},
    {"prompt": "oi", "temperature": True},
    {"prompt": "oi", "temperature": "0.7"},
    {"prompt": "oi", "temperature": -0.1},
    {"prompt": "oi", "temperature": 1.1},
])
def test_validacao_rejeita_tipos_e_limites(client, monkeypatch, payload):
    ativar_chave(monkeypatch)
    chamadas = mock_post(monkeypatch, FakeUpstream())
    response = client.post("/api/gemini", json=payload)
    assert response.status_code == 400
    assert chamadas == []


@pytest.mark.parametrize("raw", [
    b'{"prompt":"oi","maxTokens":1e309}',
    b'{"prompt":"oi","temperature":1e309}',
])
def test_numeros_nao_finitos_retornam_400(client, monkeypatch, raw):
    ativar_chave(monkeypatch)
    chamadas = mock_post(monkeypatch, FakeUpstream())
    response = client.post("/api/gemini", data=raw, content_type="application/json")
    assert response.status_code == 400
    assert chamadas == []


@pytest.mark.parametrize("payload", [
    {"contents": None},
    {"contents": []},
    {"contents": [{"parts": None}]},
    {"contents": [{"parts": [{}]}]},
    {"contents": [{"parts": [{"text": "oi"}]}], "generationConfig": None},
    {"contents": [{"parts": [{"text": "oi"}]}], "generationConfig": []},
    {"contents": [{"parts": [{"text": "   "}]}]},
])
def test_conteudo_gemini_invalido_retorna_400(client, monkeypatch, payload):
    ativar_chave(monkeypatch)
    chamadas = mock_post(monkeypatch, FakeUpstream())
    response = client.post("/api/gemini", json=payload)
    assert response.status_code == 400
    assert chamadas == []


def test_conteudo_gemini_preserva_todas_as_partes(client, monkeypatch):
    ativar_chave(monkeypatch)
    upstream = FakeUpstream(chunks=[evento("pronto")])
    chamadas = mock_post(monkeypatch, upstream)
    payload = {
        "contents": [
            {"parts": [{"text": "primeiro"}, {"text": "segundo"}]},
            {"parts": [{"text": "terceiro"}]},
        ],
        "generationConfig": {"maxOutputTokens": 77, "temperature": 0.3},
    }
    response = client.post("/api/gemini", json=payload)
    assert response.status_code == 200
    body = chamadas[0][1]["json"]
    assert body["contents"][0]["parts"][0]["text"] == "primeiro\nsegundo\nterceiro"
    assert body["generationConfig"] == {"maxOutputTokens": 77, "temperature": 0.3}


def test_chave_via_header_e_modelo_escapado(client, monkeypatch):
    ativar_chave(monkeypatch, "chave-secreta")
    monkeypatch.setattr(appmod, "MODELO", "modelo/especial")
    upstream = FakeUpstream(chunks=[evento()])
    chamadas = mock_post(monkeypatch, upstream)
    response = client.post("/api/gemini", json={"prompt": "oi"})
    assert response.status_code == 200
    args, kwargs = chamadas[0]
    assert "chave-secreta" not in args[0]
    assert "modelo%2Fespecial" in args[0]
    assert kwargs["headers"]["x-goog-api-key"] == "chave-secreta"
    assert "key=" not in args[0]


def test_limite_global_de_streams(client, monkeypatch):
    ativar_chave(monkeypatch)
    monkeypatch.setattr(appmod, "_stream_slots", threading.BoundedSemaphore(0))
    chamadas = mock_post(monkeypatch, FakeUpstream())
    response = client.post("/api/gemini", json={"prompt": "oi"})
    assert response.status_code == 503
    assert chamadas == []


def test_stream_mockado(client, monkeypatch):
    ativar_chave(monkeypatch)
    upstream = FakeUpstream(chunks=[evento("ola")])
    mock_post(monkeypatch, upstream)
    response = client.post("/api/gemini", json={"prompt": "oi", "maxTokens": 10})
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    assert "ola" in response.get_data(as_text=True)
    assert upstream.closed is True


def test_stream_parcial_e_descartado_antes_do_erro(client, monkeypatch):
    ativar_chave(monkeypatch)
    upstream = FakeUpstream(
        chunks=[b'data: {"candidates":['],
        error=requests.exceptions.ChunkedEncodingError("interrompido"),
    )
    mock_post(monkeypatch, upstream)
    response = client.post("/api/gemini", json={"prompt": "oi"})
    body = response.get_data(as_text=True)
    assert "candidates" not in body
    assert "interrompida" in body
    assert upstream.closed is True


def test_stream_interrompido_sinaliza_erro(client, monkeypatch):
    ativar_chave(monkeypatch)
    upstream = FakeUpstream(
        chunks=[evento("parcial")],
        error=requests.exceptions.ChunkedEncodingError("interrompido"),
    )
    mock_post(monkeypatch, upstream)
    response = client.post("/api/gemini", json={"prompt": "oi"})
    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert "parcial" in body
    assert "interrompida" in body
    assert upstream.closed is True


@pytest.mark.parametrize("status,mensagem", [
    (400, "A requisição foi recusada pelo serviço de IA."),
    (401, "Chave da IA inválida ou sem permissão. Avise o responsável pelo projeto."),
    (404, "Modelo da IA não encontrado. Verifique a configuração do servidor."),
    (429, "Muitas pessoas usando a IA agora. Aguarde um minuto e tente novamente."),
    (500, "A IA está instável agora. Aguarde alguns segundos e tente novamente."),
    (418, "O serviço de IA respondeu com erro 418."),
])
def test_erro_upstream_normalizado_e_fechado(client, monkeypatch, status, mensagem):
    ativar_chave(monkeypatch)
    upstream = FakeUpstream(status_code=status)
    mock_post(monkeypatch, upstream)
    response = client.post("/api/gemini", json={"prompt": "oi"})
    assert response.status_code == status
    assert response.get_json()["erro"] == mensagem
    assert upstream.closed is True


def test_erro_upstream_preserva_retry_after(client, monkeypatch):
    ativar_chave(monkeypatch)
    upstream = FakeUpstream(status_code=429, headers={"Retry-After": "12"})
    mock_post(monkeypatch, upstream)
    response = client.post("/api/gemini", json={"prompt": "oi"})
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "12"


def test_timeout_upstream(client, monkeypatch):
    ativar_chave(monkeypatch)

    def postar(*_args, **_kwargs):
        raise requests.exceptions.Timeout("tempo")

    monkeypatch.setattr(appmod.requests, "post", postar)
    response = client.post("/api/gemini", json={"prompt": "oi"})
    assert response.status_code == 504


def test_falha_de_conexao_upstream(client, monkeypatch):
    ativar_chave(monkeypatch)

    def postar(*_args, **_kwargs):
        raise requests.exceptions.ConnectionError("rede")

    monkeypatch.setattr(appmod.requests, "post", postar)
    response = client.post("/api/gemini", json={"prompt": "oi"})
    assert response.status_code == 502


def test_preflight_permitido_nao_consome_rate_nem_upstream(client, monkeypatch):
    ativar_chave(monkeypatch)
    monkeypatch.setattr(appmod, "ORIGINS", ("https://frontend.example",))
    chamadas = mock_post(monkeypatch, FakeUpstream())
    response = client.options(
        "/api/gemini",
        headers={
            "Origin": "https://frontend.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code in {200, 204}
    assert chamadas == []
    assert not appmod._reqs_por_ip


def test_origem_malformada_retorna_403(client, monkeypatch):
    ativar_chave(monkeypatch)
    chamadas = mock_post(monkeypatch, FakeUpstream())
    response = client.post(
        "/api/gemini",
        json={"prompt": "oi"},
        headers={"Origin": "https://["},
    )
    assert response.status_code == 403
    assert chamadas == []


def test_origem_nao_permitida_retorna_403_sem_upstream(client, monkeypatch):
    ativar_chave(monkeypatch)
    monkeypatch.setattr(appmod, "ORIGINS", ("https://permitida.example",))
    chamadas = mock_post(monkeypatch, FakeUpstream())
    response = client.post(
        "/api/gemini",
        json={"prompt": "oi"},
        headers={"Origin": "https://proibida.example"},
    )
    assert response.status_code == 403
    assert chamadas == []
    assert not appmod._reqs_por_ip


def test_origem_configurada_e_permitida(client, monkeypatch):
    ativar_chave(monkeypatch)
    monkeypatch.setattr(appmod, "ORIGINS", ("https://permitida.example",))
    mock_post(monkeypatch, FakeUpstream(chunks=[evento()]))
    response = client.post(
        "/api/gemini",
        json={"prompt": "oi"},
        headers={"Origin": "https://permitida.example"},
    )
    assert response.status_code == 200


def test_origem_da_mesma_origem_e_permitida(client, monkeypatch):
    ativar_chave(monkeypatch)
    monkeypatch.setattr(appmod, "ORIGINS", ())
    mock_post(monkeypatch, FakeUpstream(chunks=[evento()]))
    response = client.post(
        "/api/gemini",
        json={"prompt": "oi"},
        headers={"Origin": "http://localhost"},
    )
    assert response.status_code == 200


def test_client_ip_header_configuravel_e_rate_limit(client, monkeypatch):
    ativar_chave(monkeypatch)
    monkeypatch.setattr(appmod, "TRUST_PROXY", True)
    monkeypatch.setattr(appmod, "CLIENT_IP_HEADER", "cf-connecting-ip")
    monkeypatch.setattr(appmod, "RATE_MAX", 1)
    mock_post(monkeypatch, FakeUpstream(chunks=[evento()]))
    first = client.post(
        "/api/gemini",
        json={"prompt": "a"},
        headers={"CF-Connecting-IP": "203.0.113.10", "X-Forwarded-For": "198.51.100.1"},
    )
    second = client.post(
        "/api/gemini",
        json={"prompt": "b"},
        headers={"CF-Connecting-IP": "203.0.113.10", "X-Forwarded-For": "198.51.100.2"},
    )
    assert first.status_code == 200
    assert second.status_code == 429


def test_x_forwarded_for_nao_contorna_rate_limit(client, monkeypatch):
    ativar_chave(monkeypatch)
    monkeypatch.setattr(appmod, "RATE_MAX", 1)
    upstream = FakeUpstream(chunks=[evento()])
    mock_post(monkeypatch, upstream)
    first = client.post(
        "/api/gemini",
        json={"prompt": "a"},
        headers={"X-Forwarded-For": "203.0.113.1"},
    )
    second = client.post(
        "/api/gemini",
        json={"prompt": "b"},
        headers={"X-Forwarded-For": "203.0.113.2"},
    )
    assert first.status_code == 200
    assert second.status_code == 429
    assert "Retry-After" in second.headers


def test_rate_limit_check_append_atomico(client, monkeypatch):
    ativar_chave(monkeypatch)
    monkeypatch.setattr(appmod, "RATE_MAX", 1)
    upstream = FakeUpstream(chunks=[evento()])
    mock_post(monkeypatch, upstream)

    def enviar(_indice):
        with appmod.app.test_client() as parallel_client:
            return parallel_client.post("/api/gemini", json={"prompt": "oi"}).status_code

    with ThreadPoolExecutor(max_workers=8) as executor:
        statuses = list(executor.map(enviar, range(8)))
    assert statuses.count(200) == 1
    assert statuses.count(429) == 7


def test_rate_limit_remove_chaves_expiradas(monkeypatch):
    momento = 100.0
    monkeypatch.setattr(appmod.time, "monotonic", lambda: momento)
    monkeypatch.setattr(appmod, "RATE_MAX", 2)
    monkeypatch.setattr(appmod, "RATE_MAX_KEYS", 100)
    appmod._reqs_por_ip["2001:db8::1"] = deque([momento])
    momento = 161.0
    permitido, _retry = appmod.checar_rate_limit("2001:db8::1")
    assert permitido is True
    assert "2001:db8::1" in appmod._reqs_por_ip


def test_security_headers(client):
    response = client.get("/")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]


def test_json_profundamente_aninhado_retorna_400(client, monkeypatch):
    ativar_chave(monkeypatch)
    raw = b'{"prompt":' + (b"[" * 2000) + b"0" + (b"]" * 2000) + b"}"
    response = client.post("/api/gemini", data=raw, content_type="application/json")
    assert response.status_code == 400


def test_cors_real_depende_da_configuracao_de_importacao():
    codigo = """
import json
import app
client = app.app.test_client()
permitido = client.options(
    "/api/gemini",
    headers={
        "Origin": "https://frontend.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    },
)
proibido = client.options(
    "/api/gemini",
    headers={
        "Origin": "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    },
)
print(json.dumps({
    "permitido_status": permitido.status_code,
    "permitido_origin": permitido.headers.get("Access-Control-Allow-Origin"),
    "permitido_methods": permitido.headers.get("Access-Control-Allow-Methods"),
    "permitido_headers": permitido.headers.get("Access-Control-Allow-Headers"),
    "permitido_vary": permitido.headers.get("Vary"),
    "proibido_status": proibido.status_code,
    "proibido_origin": proibido.headers.get("Access-Control-Allow-Origin"),
}))
"""
    env = os.environ.copy()
    env.update({
        "GEMINI_KEY": "fake",
        "ALLOWED_ORIGINS": "https://frontend.example",
        "TRUST_PROXY": "false",
        "CLIENT_IP_HEADER": "",
    })
    resultado = subprocess.run(
        [sys.executable, "-c", codigo],
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    body = json.loads(resultado.stdout)
    assert body["permitido_status"] in {200, 204}
    assert body["permitido_origin"] == "https://frontend.example"
    assert "POST" in body["permitido_methods"]
    assert "content-type" in body["permitido_headers"].lower()
    assert "Origin" in body["permitido_vary"]
    assert body["proibido_status"] == 403
    assert body["proibido_origin"] is None


@pytest.mark.parametrize("path", [
    "/index.html",
    "/style.css",
    "/script.js",
    "/api.js",
])
def test_assets_publicos_servidos(client, path):
    assert client.get(path).status_code == 200


@pytest.mark.parametrize("path", [
    "/.env",
    "/tests/%2e%2e/.env",
    "/%2e%2e/.env",
    "/.git/config",
    "/app.py",
    "/requirements.txt",
    "/Dockerfile",
    "/tests/test_app.py",
    "/index.html/../app.py",
    "/api.js/extra",
])
def test_arquivos_privados_bloqueados(client, path):
    assert client.get(path).status_code == 404
