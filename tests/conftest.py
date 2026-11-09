import os

# load_dotenv não sobrescreve o que já está definido; assim o .env local não muda os testes
# e a chave real nunca é carregada.
os.environ.update(
    GEMINI_KEY="",
    ALLOWED_ORIGINS="",
    TRUST_PROXY="false",
    CLIENT_IP_HEADER="",
    RATE_LIMIT_MAX="20",
    RATE_LIMIT_WINDOW="60",
    RATE_LIMIT_MAX_KEYS="10000",
    MAX_STREAMS="8",
    MAX_REQUESTS_PER_DAY="1000",
)
