const LIMITE_CORPO = 64 * 1024;
const LIMITE_PROMPT = 12000;

function respostaCors(origem, status, corpo, headers = {}) {
  return new Response(corpo, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origem,
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function erroJson(origem, status, mensagem, headers = {}) {
  return respostaCors(origem, status, JSON.stringify({ erro: mensagem }), headers);
}

function normalizarOrigem(valor) {
  try {
    const url = new URL(String(valor || ""));
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return "";
  }
}

function validarEntrada(dados) {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;
  if (typeof dados.prompt !== "string") return null;
  const prompt = dados.prompt.trim();
  if (!prompt || prompt.length > LIMITE_PROMPT) return null;
  const maxTokens = dados.maxTokens ?? 1024;
  const temperature = dados.temperature ?? 0.7;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) return null;
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 1) return null;
  return { prompt, maxTokens, temperature };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ ok: Boolean(env.GEMINI_KEY) }), {
        status: env.GEMINI_KEY ? 200 : 503,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (url.pathname !== "/api/gemini") return erroJson("*", 404, "Não encontrado");

    const allowedOrigin = normalizarOrigem(env.ALLOWED_ORIGIN);
    const requestOrigin = normalizarOrigem(request.headers.get("Origin"));
    if (!allowedOrigin) return erroJson("", 503, "CORS não configurado.");
    if (requestOrigin && requestOrigin !== allowedOrigin) return erroJson("", 403, "Origem não autorizada.");

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return erroJson(allowedOrigin, 405, "Método não permitido.", { Allow: "POST, OPTIONS" });

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > LIMITE_CORPO) return erroJson(allowedOrigin, 413, "Corpo da requisição grande demais.");
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return erroJson(allowedOrigin, 415, "Envie Content-Type: application/json.");
    }
    if (!env.GEMINI_KEY) return erroJson(allowedOrigin, 503, "Serviço de IA não configurado.");

    let entrada;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > LIMITE_CORPO) {
        return erroJson(allowedOrigin, 413, "Corpo da requisição grande demais.");
      }
      entrada = validarEntrada(JSON.parse(raw));
    } catch {
      return erroJson(allowedOrigin, 400, "Corpo JSON inválido.");
    }
    if (!entrada) return erroJson(allowedOrigin, 400, "Parâmetros inválidos.");

    const modelo = String(env.GEMINI_MODEL || "gemini-2.5-flash-lite");
    const target = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:streamGenerateContent?alt=sse`;
    let upstream;
    try {
      const timeout = AbortSignal.timeout(65000);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      upstream = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: entrada.prompt }] }],
          generationConfig: { maxOutputTokens: entrada.maxTokens, temperature: entrada.temperature },
        }),
        signal,
      });
    } catch (error) {
      const timeoutError = error?.name === "TimeoutError";
      return erroJson(allowedOrigin, timeoutError ? 504 : 502, timeoutError ? "A IA demorou demais." : "Falha de conexão com a IA.");
    }

    if (!upstream.ok) {
      const retryAfter = upstream.headers.get("Retry-After");
      return erroJson(allowedOrigin, upstream.status, "O serviço de IA recusou a solicitação.", retryAfter ? { "Retry-After": retryAfter } : {});
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
