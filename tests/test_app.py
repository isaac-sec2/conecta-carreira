"""Testes do backend Conecta Carreira. Rode: pytest -q"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod


@pytest.fixture(autouse=True)
def _limpar_rate():
    appmod._reqs_por_ip.clear()
    yield
    appmod._reqs_por_ip.clear()


@pytest.fixture()
def client():
    appmod.app.config["TESTING"] = True
    with appmod.app.test_client() as c:
        yield c


def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    corpo = r.get_json()
    assert corpo["ok"] is True
    assert "modelo" in corpo
    assert "chave_configurada" in corpo
    assert "versao" in corpo
    assert "limites" in corpo


def test_status_alias(client):
    assert client.get("/api/status").status_code == 200


def test_gemini_sem_chave_retorna_500_amigavel(client, monkeypatch):
    monkeypatch.setattr(appmod, "GEMINI_KEY", "")
    r = client.post("/api/gemini", json={"prompt": "oi"})
    assert r.status_code == 500
    assert "erro" in r.get_json()


def test_gemini_prompt_vazio_400(client, monkeypatch):
    monkeypatch.setattr(appmod, "GEMINI_KEY", "fake")
    r = client.post("/api/gemini", json={"prompt": "   "})
    assert r.status_code == 400


def test_gemini_maxtokens_invalido_400(client, monkeypatch):
    monkeypatch.setattr(appmod, "GEMINI_KEY", "fake")
    for payload in ({"prompt": "oi", "maxTokens": 0},
                    {"prompt": "oi", "maxTokens": 99999},
                    {"prompt": "oi", "temperature": 5}):
        r = client.post("/api/gemini", json=payload)
        assert r.status_code == 400, payload


def test_gemini_prompt_longo_400(client, monkeypatch):
    monkeypatch.setattr(appmod, "GEMINI_KEY", "fake")
    r = client.post("/api/gemini", json={"prompt": "x" * 12001})
    assert r.status_code == 400


def test_gemini_stream_mockado(client, monkeypatch):
    """Simula o Google retornando SSE sem gastar cota."""
    monkeypatch.setattr(appmod, "GEMINI_KEY", "fake")

    class FakeUpstream:
        status_code = 200

        def iter_content(self, chunk_size=4096):
            yield b'data: {"candidates":[{"content":{"parts":[{"text":"ola"}]},"finishReason":"STOP"}]}\n\n'

        def close(self):
            pass

    monkeypatch.setattr(appmod.requests, "post", lambda *a, **k: FakeUpstream())
    r = client.post("/api/gemini", json={"prompt": "oi", "maxTokens": 10})
    assert r.status_code == 200
    assert "ola" in r.get_data(as_text=True)


def test_rate_limit_429(client, monkeypatch):
    monkeypatch.setattr(appmod, "GEMINI_KEY", "fake")
    monkeypatch.setattr(appmod, "RATE_MAX", 2)

    class FakeUpstream:
        status_code = 200

        def iter_content(self, chunk_size=4096):
            yield b'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n'

        def close(self):
            pass

    monkeypatch.setattr(appmod.requests, "post", lambda *a, **k: FakeUpstream())
    assert client.post("/api/gemini", json={"prompt": "a"}).status_code == 200
    assert client.post("/api/gemini", json={"prompt": "b"}).status_code == 200
    r = client.post("/api/gemini", json={"prompt": "c"})
    assert r.status_code == 429
    assert "Retry-After" in r.headers


def test_static_nao_vaza_env(client):
    assert client.get("/.env").status_code == 404
    assert client.get("/app.py").status_code == 404
