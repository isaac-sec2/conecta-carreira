/* Conecta Carreira — cliente da IA via backend Python.
   A chave do Gemini fica SÓ no servidor (.env), nunca aqui. */
// No Live Server, o frontend fica em :5500 e o Flask em :5000.
const URL_BACKEND = window.location.port === "5500"
  ? "http://localhost:5000/api/gemini"
  : `${window.location.origin}/api/gemini`;

/* ---------- helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tenta extrair a mensagem de erro da resposta do backend */
async function extrairErroApi(resposta) {
  try {
    const json = await resposta.json();
    const msg = json?.erro || json?.error?.message || `Erro HTTP ${resposta.status}`;
    return traduzirErro(msg, resposta.status);
  } catch {
    return traduzirErro(`Erro HTTP ${resposta.status}`, resposta.status);
  }
}

/** Traduz erros técnicos em mensagens claras p/ o usuário final */
function traduzirErro(msg, status) {
  const m = String(msg || "").toLowerCase();
  if (status === 429 || m.includes("muitas requisições") || m.includes("quota") || m.includes("rate")) {
    return "Muita gente usando agora. Aguarde 1 minuto e clique em Tentar novamente.";
  }
  if (!navigator.onLine || m.includes("failed to fetch") || m.includes("network") || m.includes("conexão")) {
    return "Sem conexão com o servidor. Verifique sua internet e se o backend está rodando.";
  }
  if (m.includes("chave") || status === 401 || status === 403) {
    return "Serviço de IA temporariamente indisponível (chave inválida no servidor). Avise o responsável.";
  }
  if (m.includes("demorou demais") || status === 504) {
    return "A IA demorou demais para responder. Clique em Tentar novamente.";
  }
  if (status === 500 && m.includes("não configurado")) {
    return msg; // já é amigável
  }
  return String(msg);
}

/** Verifica se a resposta foi bloqueada ou truncada */
function verificarStatusResposta(dado) {
  const cand = dado?.candidates?.[0];
  if (!cand) {
    // Resposta vazia = provavelmente bloqueada por safety
    const block = dado?.promptFeedback?.blockReason;
    if (block) return new Error(`Resposta bloqueada pela API: ${block}`);
    return null;
  }

  const motivo = cand.finishReason;
  if (motivo && motivo !== "STOP" && motivo !== "MAX_TOKENS") {
    return new Error(`Resposta interrompida: ${motivo}`);
  }
  // MAX_TOKENS não é erro fatal, mas sinaliza truncamento
  if (motivo === "MAX_TOKENS") return "TRUNCADO";
  return null;
}

/**
 * Chama o Gemini com streaming.
 * 
 * @param {string}   prompt
 * @param {Function} aoReceberTrecho  — callback(trecho, textoAcumulado)
 * @param {Object}   opcoes           — {
 *     maxTokens?: number,
 *     temperature?: number,
 *     retries?: number,      // padrão 2
 *     timeoutMs?: number,    // padrão 60000
 *     signal?: AbortSignal   // para cancelar de fora
 *   }
 */
async function chamarGemini(prompt, aoReceberTrecho, opcoes = {}) {
  const retries   = opcoes.retries ?? 2;
  const timeoutMs = opcoes.timeoutMs ?? 60000;
  const sinalExterno = opcoes.signal;

  const body = JSON.stringify({
    prompt,
    maxTokens: opcoes.maxTokens || 1024,
    temperature: opcoes.temperature !== undefined ? opcoes.temperature : 0.7,
  });

  let ultimoErro;

  for (let tentativa = 0; tentativa <= retries; tentativa++) {
    const controller = new AbortController();
    let timeoutId;

    // Junta o timeout interno com um sinal externo (se vier)
    const abortar = () => controller.abort();
    if (sinalExterno) sinalExterno.addEventListener("abort", abortar);

    try {
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const resposta = await fetch(URL_BACKEND, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body,
      });

      if (!resposta.ok) {
        const msg = await extrairErroApi(resposta);
        const erroApi = new Error(msg);
        erroApi.status = resposta.status;
        throw erroApi;
      }

      /* ---------- streaming SSE ---------- */
      const reader = resposta.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let textoCompleto = "";
      let foiTruncado = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const linhas = buffer.split("\n");
          buffer = linhas.pop(); // guarda fragmento incompleto

          for (const linha of linhas) {
            if (!linha.startsWith("data: ")) continue;
            const jsonTexto = linha.slice(6).trim();
            if (!jsonTexto || jsonTexto === "[DONE]") continue;

            try {
              const dado = JSON.parse(jsonTexto);

              // Verifica bloqueios / truncamento
              const status = verificarStatusResposta(dado);
              if (status instanceof Error) throw status;
              if (status === "TRUNCADO") foiTruncado = true;

              const trecho = dado.candidates?.[0]?.content?.parts?.[0]?.text || "";
              if (trecho) {
                textoCompleto += trecho;
                if (aoReceberTrecho) aoReceberTrecho(trecho, textoCompleto);
              }
            } catch (e) {
              // Se for erro de bloqueio/truncamento, propaga
              if (e.message?.includes("bloqueada") || e.message?.includes("interrompida")) {
                throw e;
              }
              // Senão, ignora linha malformada no meio do stream
            }
          }
        }
      } finally {
        reader.releaseLock(); // ← evita memory leak e conexão zumbi
      }

      if (foiTruncado) {
        console.warn("[Gemini] A resposta foi cortada por atingir o limite de tokens.");
      }

      return textoCompleto || "Ops, a resposta veio vazia. Tente reformular o pedido.";

    } catch (erro) {
      ultimoErro = erro;

      // AbortError = usuário cancelou ou timeout
      if (erro.name === "AbortError") {
        throw new Error(
          sinalExterno?.aborted
            ? "Requisição cancelada."
            : "A IA demorou demais para responder. Verifique sua internet."
        );
      }

      // Retry com backoff (exceto na última tentativa)
      // Para erros 5xx (503, 500, etc), usar delay maior
      const isServerError = [500, 502, 503, 504].includes(erro.status);
      if (tentativa < retries) {
        const baseDelay = isServerError ? 3000 : 1000;
        const delay = Math.min(baseDelay * 2 ** tentativa, isServerError ? 15000 : 8000);
        console.warn(`[Gemini] Falha na tentativa ${tentativa + 1}${isServerError ? " (erro do servidor)" : ""}, tentando de novo em ${delay}ms…`);
        await sleep(delay);
      }
    } finally {
      clearTimeout(timeoutId);
      if (sinalExterno) sinalExterno.removeEventListener("abort", abortar);
    }
  }

  // Esgotou todas as tentativas
  throw ultimoErro;
}