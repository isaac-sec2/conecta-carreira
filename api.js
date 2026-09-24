const LIMITE_MAX_PROMPT = 12000;

function obterUrlBackend() {
  const base = window.location.href || (window.location.origin && window.location.origin !== "null" ? window.location.origin : "http://localhost/");
  const configuracao = window.CONNECTA_CONFIG?.apiBaseUrl;
  const meta = document.querySelector('meta[name="api-base-url"]')?.content;
  const valor = typeof configuracao === "string" && configuracao.trim()
    ? configuracao.trim()
    : typeof meta === "string" && meta.trim()
      ? meta.trim()
      : "";

  if (valor) {
    try {
      const url = new URL(valor, base);
      const caminho = url.pathname.replace(/\/+$/, "");
      if (!/\/api\/gemini$/i.test(caminho)) {
        url.pathname = /\/api$/i.test(caminho) ? `${caminho}/gemini` : `${caminho}/api/gemini`;
      }
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return new URL("/api/gemini", base).toString();
    }
  }

  const hostLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
  if (hostLocal && String(window.location.port) === "5500") {
    return "http://localhost:5000/api/gemini";
  }
  return new URL("/api/gemini", window.location.href).toString();
}

const URL_BACKEND = obterUrlBackend();

function criarErroCancelamento() {
  const erro = new Error("Requisição cancelada.");
  erro.name = "AbortError";
  erro.retryable = false;
  return erro;
}

function criarErroTimeout() {
  const erro = new Error("A IA demorou demais para responder. Verifique sua internet.");
  erro.name = "TimeoutError";
  erro.retryable = true;
  erro.timeout = true;
  return erro;
}

function criarErroProtocolo(mensagem) {
  const erro = new Error(mensagem);
  erro.name = "Resposta invalida";
  erro.retryable = false;
  return erro;
}

function criarErroTransporte(mensagem) {
  const erro = new Error(mensagem);
  erro.name = "NetworkError";
  erro.retryable = true;
  return erro;
}

function criarErroApi(mensagem, status = 0, opcoes = {}) {
  const erro = new Error(mensagem || `Erro HTTP ${status || "desconhecido"}`);
  const codigoStatus = Number(status);
  erro.status = Number.isFinite(codigoStatus) ? codigoStatus : 0;
  erro.retryAfter = opcoes.retryAfter ?? null;
  const texto = String(mensagem || "").toLowerCase();
  const erroPermanente = opcoes.permanente === true
    || codigoStatus === 501
    || codigoStatus === 505
    || texto.includes("chave ausente")
    || texto.includes("não configurado")
    || texto.includes("nao configurado")
    || texto.includes("sem chave")
    || texto.includes("chave inválida")
    || texto.includes("chave invalida")
    || (codigoStatus >= 500 && texto.includes("chave"));
  erro.permanente = erroPermanente;
  erro.retryable = opcoes.retryable !== undefined
    ? Boolean(opcoes.retryable) && !erroPermanente
    : !erroPermanente && (codigoStatus === 408 || codigoStatus === 429 || (codigoStatus >= 500 && codigoStatus <= 599));
  return erro;
}

function traduzirErro(msg, status) {
  const m = String(msg || "").toLowerCase();
  const semConexao = typeof navigator !== "undefined" && navigator.onLine === false;
  if (status === 429 || m.includes("muitas requisições") || m.includes("quota") || m.includes("rate")) {
    return "Muita gente usando agora. Aguarde 1 minuto e clique em Tentar novamente.";
  }
  if (semConexao || m.includes("failed to fetch") || m.includes("network") || m.includes("conexão")) {
    return "Sem conexão com o servidor. Verifique sua internet e se o backend está rodando.";
  }
  if (m.includes("chave") || status === 401 || status === 403) {
    return "Serviço de IA temporariamente indisponível (chave inválida no servidor). Avise o responsável.";
  }
  if (m.includes("demorou demais") || status === 504) {
    return "A IA demorou demais para responder. Clique em Tentar novamente.";
  }
  return String(msg || `Erro HTTP ${status || "desconhecido"}`);
}

async function extrairErroApi(resposta) {
  let mensagem = `Erro HTTP ${resposta.status}`;
  try {
    const corpo = await resposta.json();
    const valor = typeof corpo?.erro === "string"
      ? corpo.erro
      : typeof corpo?.error === "string"
        ? corpo.error
        : corpo?.error?.message || corpo?.erro?.message;
    if (valor) mensagem = String(valor);
  } catch {
    mensagem = `Erro HTTP ${resposta.status}`;
  }
  return traduzirErro(mensagem, resposta.status);
}

function calcularRetryAfter(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const segundos = Number(valor);
  if (Number.isFinite(segundos) && segundos >= 0) {
    return Math.min(segundos * 1000, 120000);
  }
  const data = Date.parse(String(valor));
  if (!Number.isNaN(data)) {
    return Math.min(Math.max(data - Date.now(), 0), 120000);
  }
  return null;
}

function aguardarRetry(ms, sinal) {
  if (sinal?.aborted) return Promise.reject(criarErroCancelamento());
  return new Promise((resolve, reject) => {
    let timer;
    const encerrar = () => {
      if (timer !== undefined) clearTimeout(timer);
      sinal?.removeEventListener("abort", abortar);
      resolve();
    };
    const abortar = () => {
      if (timer !== undefined) clearTimeout(timer);
      sinal?.removeEventListener("abort", abortar);
      reject(criarErroCancelamento());
    };
    timer = setTimeout(encerrar, Math.max(0, ms));
    sinal?.addEventListener("abort", abortar, { once: true });
    if (sinal?.aborted) abortar();
  });
}

function erroPodeSerRetentado(erro) {
  if (!erro || erro.retryable === false || erro.permanente || erro.callback) return false;
  if (erro.name === "AbortError") return false;
  if (erro.status === 408 || erro.status === 429 || (erro.status >= 500 && erro.status <= 599)) return true;
  if (erro.status >= 400 && erro.status < 500) return false;
  if (erro.timeout || erro.name === "TimeoutError") return true;
  return erro instanceof TypeError || erro.name === "TypeError" || erro.name === "NetworkError";
}

function verificarStatusResposta(dado) {
  if (!dado || typeof dado !== "object") {
    return criarErroProtocolo("A resposta da IA não contém dados válidos.");
  }
  const candidato = dado.candidates?.[0];
  if (!candidato) {
    const bloqueio = dado.promptFeedback?.blockReason;
    if (bloqueio) return criarErroProtocolo(`Resposta bloqueada pela API: ${bloqueio}`);
    return null;
  }
  const motivo = String(candidato.finishReason || "").toUpperCase();
  if (motivo && motivo !== "STOP") {
    if (motivo === "MAX_TOKENS") {
      return criarErroProtocolo("A resposta foi cortada pelo limite de tokens. Tente reduzir o pedido.");
    }
    return criarErroProtocolo(`Resposta interrompida: ${motivo}`);
  }
  return null;
}

function extrairTextoResposta(dado) {
  const partes = dado?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(partes)) return "";
  return partes
    .map(parte => typeof parte?.text === "string" ? parte.text : "")
    .join("");
}

function extrairMensagemErroSSE(dado) {
  const valor = dado?.error ?? dado?.erro;
  if (!valor) return null;
  const mensagem = typeof valor === "string" ? valor : valor.message || "Erro retornado pela IA";
  const status = Number(valor.status || valor.statusCode || dado.status || 0);
  return criarErroApi(traduzirErro(mensagem, status), Number.isFinite(status) ? status : 0);
}

function despacharEventoSSE(estado, consumir) {
  if (!estado.temDados) return;
  const texto = estado.dados.join("\n").trim();
  estado.dados = [];
  estado.temDados = false;
  if (!texto) return;
  if (texto === "[DONE]") {
    estado.terminal = true;
    return;
  }
  let dado;
  try {
    dado = JSON.parse(texto);
  } catch {
    throw criarErroTransporte("A conexão da IA foi interrompida antes do fim da resposta.");
  }
  const erro = extrairMensagemErroSSE(dado);
  if (erro) throw erro;
  const finishReason = String(dado?.candidates?.[0]?.finishReason || "").toUpperCase();
  if (finishReason === "STOP") estado.terminal = true;
  const status = verificarStatusResposta(dado);
  if (status) throw status;
  const trecho = extrairTextoResposta(dado);
  if (trecho) consumir(trecho);
}

function processarLinhaSSE(linha, estado, consumir) {
  const normalizada = linha.endsWith("\r") ? linha.slice(0, -1) : linha;
  if (normalizada === "") {
    despacharEventoSSE(estado, consumir);
    return;
  }
  if (normalizada.startsWith(":")) return;
  const separador = normalizada.indexOf(":");
  const campo = separador < 0 ? normalizada : normalizada.slice(0, separador);
  let valor = separador < 0 ? "" : normalizada.slice(separador + 1);
  if (valor.startsWith(" ")) valor = valor.slice(1);
  if (campo === "data") {
    estado.dados.push(valor);
    estado.temDados = true;
  }
}

function receberSSE(estado, texto, consumir) {
  estado.buffer += texto;
  const linhas = [];
  let inicio = 0;
  for (let indice = 0; indice < estado.buffer.length; indice += 1) {
    if (estado.buffer[indice] !== "\n") continue;
    let fim = indice;
    if (fim > inicio && estado.buffer[fim - 1] === "\r") fim -= 1;
    linhas.push(estado.buffer.slice(inicio, fim));
    inicio = indice + 1;
  }
  estado.buffer = estado.buffer.slice(inicio);
  linhas.forEach(linha => processarLinhaSSE(linha, estado, consumir));
}

function finalizarSSE(estado, consumir) {
  if (estado.buffer) {
    const ultima = estado.buffer;
    estado.buffer = "";
    processarLinhaSSE(ultima, estado, consumir);
  }
  despacharEventoSSE(estado, consumir);
}

function validarPromptParaEnvio(prompt) {
  const texto = String(prompt || "");
  if (!texto.trim()) {
    const erro = criarErroProtocolo("O prompt não pode ficar vazio.");
    erro.codigo = "PROMPT_VAZIO";
    throw erro;
  }
  const tamanho = Array.from(texto).length;
  if (tamanho > LIMITE_MAX_PROMPT) {
    const erro = criarErroProtocolo(`O pedido excede o limite de ${LIMITE_MAX_PROMPT} caracteres. Reduza os dados e tente novamente.`);
    erro.status = 400;
    erro.codigo = "PROMPT_TOO_LARGE";
    throw erro;
  }
  return texto;
}

async function chamarGemini(prompt, aoReceberTrecho, opcoes = {}) {
  const sinalExterno = opcoes.signal;
  if (sinalExterno?.aborted) throw criarErroCancelamento();
  const promptValidado = validarPromptParaEnvio(prompt);
  const retriesInformados = Number(opcoes.retries ?? 2);
  const timeoutInformado = Number(opcoes.timeoutMs ?? 120000);
  const retries = Number.isFinite(retriesInformados) ? Math.max(0, Math.floor(retriesInformados)) : 2;
  const timeoutMs = Number.isFinite(timeoutInformado) ? Math.max(1, timeoutInformado) : 120000;
  const body = JSON.stringify({
    prompt: promptValidado,
    maxTokens: opcoes.maxTokens ?? 1024,
    temperature: opcoes.temperature !== undefined ? opcoes.temperature : 0.7,
  });
  let ultimoErro;

  if (sinalExterno?.aborted) throw criarErroCancelamento();

  for (let tentativa = 0; tentativa <= retries; tentativa += 1) {
    if (sinalExterno?.aborted) throw criarErroCancelamento();
    const controller = new AbortController();
    let timeoutId;
    let timeoutDisparado = false;
    const abortar = () => controller.abort();
    sinalExterno?.addEventListener("abort", abortar, { once: true });

    try {
      if (sinalExterno?.aborted) throw criarErroCancelamento();
      timeoutId = setTimeout(() => {
        timeoutDisparado = true;
        controller.abort();
      }, timeoutMs);

      const resposta = await fetch(URL_BACKEND, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body,
      });

      if (!resposta.ok) {
        const mensagem = await extrairErroApi(resposta);
        throw criarErroApi(mensagem, resposta.status, {
          retryAfter: calcularRetryAfter(resposta.headers?.get?.("Retry-After")),
        });
      }
      if (!resposta.body || typeof resposta.body.getReader !== "function") {
        throw criarErroProtocolo("A resposta da IA veio sem conteúdo.");
      }

      const reader = resposta.body.getReader();
      const decoder = new TextDecoder();
      const estado = { buffer: "", dados: [], temDados: false, terminal: false };
      let textoCompleto = "";
      const receber = trecho => {
        textoCompleto += trecho;
        if (!aoReceberTrecho) return;
        try {
          aoReceberTrecho(trecho, textoCompleto);
        } catch (erro) {
          if (erro && typeof erro === "object") {
            erro.callback = true;
            erro.retryable = false;
          }
          throw erro;
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receberSSE(estado, decoder.decode(value, { stream: true }), receber);
        }
        const resto = decoder.decode();
        if (resto) receberSSE(estado, resto, receber);
        finalizarSSE(estado, receber);
        if (!estado.terminal) {
          throw criarErroTransporte("A conexão da IA foi encerrada antes de uma resposta completa.");
        }
      } finally {
        try { await reader.cancel(); } catch { }
        try { reader.releaseLock(); } catch { }
      }

      if (!textoCompleto.trim()) {
        throw criarErroProtocolo("A IA retornou uma resposta vazia. Tente novamente.");
      }
      return textoCompleto;
    } catch (erro) {
      if (sinalExterno?.aborted) throw criarErroCancelamento();
      let erroAtual = erro;
      if (erro?.name === "AbortError" && timeoutDisparado) erroAtual = criarErroTimeout();
      ultimoErro = erroAtual;
      if (tentativa >= retries || !erroPodeSerRetentado(erroAtual)) throw erroAtual;
      const retryAfter = erroAtual.retryAfter;
      const base = erroAtual.status >= 500 ? 3000 : 1000;
      const backoff = Math.min(base * (2 ** tentativa), erroAtual.status >= 500 ? 15000 : 8000);
      const espera = Math.max(backoff, Number.isFinite(retryAfter) ? retryAfter : 0);
      await aguardarRetry(espera, sinalExterno);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      sinalExterno?.removeEventListener("abort", abortar);
    }
  }

  throw ultimoErro || criarErroProtocolo("Não foi possível concluir a solicitação.");
}
