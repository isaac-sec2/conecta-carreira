function el(id) {
  return document.getElementById(id);
}

function mostrarToast(tipo, titulo, mensagem = "") {
  const container = el("toast-container");
  if (!container) return;
  const tipoSeguro = ["success", "error", "warning", "info"].includes(tipo) ? tipo : "info";
  const icons = {
    success: "check-circle",
    error: "x-circle",
    warning: "alert-triangle",
    info: "info"
  };
  const toast = document.createElement("div");
  toast.className = `toast toast--${tipoSeguro}`;
  const iconWrap = document.createElement("span");
  iconWrap.className = "toast__icon";
  iconWrap.setAttribute("aria-hidden", "true");
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", icons[tipoSeguro]);
  iconWrap.appendChild(icon);
  const content = document.createElement("div");
  content.className = "toast__content";
  const title = document.createElement("div");
  title.className = "toast__title";
  title.textContent = String(titulo || "");
  content.appendChild(title);
  if (mensagem) {
    const message = document.createElement("div");
    message.className = "toast__message";
    message.textContent = String(mensagem);
    content.appendChild(message);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast__close";
  close.setAttribute("aria-label", "Fechar");
  const closeIcon = document.createElement("i");
  closeIcon.setAttribute("data-lucide", "x");
  close.appendChild(closeIcon);
  close.addEventListener("click", () => toast.remove());
  toast.append(iconWrap, content, close);
  container.appendChild(toast);
  window.lucide?.createIcons?.();
  window.setTimeout(() => {
    if (!toast.isConnected) return;
    toast.classList.add("removing");
    window.setTimeout(() => toast.remove(), 200);
  }, 5000);
}

function toastSuccess(titulo, mensagem) { mostrarToast("success", titulo, mensagem); }
function toastError(titulo, mensagem) { mostrarToast("error", titulo, mensagem); }
function toastInfo(titulo, mensagem) { mostrarToast("info", titulo, mensagem); }
function toastWarning(titulo, mensagem) { mostrarToast("warning", titulo, mensagem); }

function setFieldError(fieldId, message) {
  const field = el(fieldId);
  if (!field) return;
  const group = field.closest(".form-group");
  const errorEl = el(`err-${fieldId}`);
  group?.classList.add("has-error");
  if (errorEl) {
    errorEl.textContent = String(message || "");
    errorEl.hidden = false;
  }
  field.setAttribute("aria-invalid", "true");
  const errorId = `err-${fieldId}`;
  const described = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  if (!described.includes(errorId)) described.push(errorId);
  field.setAttribute("aria-describedby", described.join(" "));
  field.setAttribute("aria-errormessage", errorId);
}

function clearFieldError(fieldId) {
  const field = el(fieldId);
  if (!field) return;
  const group = field.closest(".form-group");
  const errorEl = el(`err-${fieldId}`);
  group?.classList.remove("has-error");
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.hidden = true;
  }
  field.setAttribute("aria-invalid", "false");
  const errorId = `err-${fieldId}`;
  const described = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean).filter(id => id !== errorId);
  if (described.length) field.setAttribute("aria-describedby", described.join(" "));
  else field.removeAttribute("aria-describedby");
  field.removeAttribute("aria-errormessage");
}

function validateCurriculoForm() {
  let valid = true;
  const nome = (el("nome")?.value || "").trim();
  const objetivo = (el("objetivo")?.value || "").trim();
  const contato = (el("contato")?.value || "").trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^\+?[\d\s().-]+$/;

  if (!nome) {
    setFieldError("nome", "Nome é obrigatório");
    valid = false;
  } else if (nome.length < 3) {
    setFieldError("nome", "Nome muito curto");
    valid = false;
  } else {
    clearFieldError("nome");
  }

  if (!objetivo) {
    setFieldError("objetivo", "Informe a vaga que busca");
    valid = false;
  } else {
    clearFieldError("objetivo");
  }

  const telefone = contato.replace(/\D/g, "");
  const telefoneValido = /^\+?[\d\s().-]+$/.test(contato) && telefone.length >= 10 && telefone.length <= 15;
  if (contato && !emailRegex.test(contato) && !(phoneRegex.test(contato) && telefoneValido)) {
    setFieldError("contato", "Email ou telefone inválido");
    valid = false;
  } else {
    clearFieldError("contato");
  }

  [["linkedin", "LinkedIn"], ["github", "GitHub"]].forEach(([id, plataforma]) => {
    const valor = (el(id)?.value || "").trim();
    const dominio = id === "linkedin" ? "linkedin.com" : "github.com";
    if (valor && !normalizarPerfil(valor, `https://www.${dominio}${id === "linkedin" ? "/in/" : "/"}`)) {
      setFieldError(id, `Use uma URL válida do ${plataforma}`);
      valid = false;
    } else {
      clearFieldError(id);
    }
  });
  return valid;
}

const STORAGE_KEYS = {
  CURRICULOS: "conecta-curriculos",
  ENTREVISTAS: "conecta-entrevistas"
};

const historicoSessao = {
  curriculo: [],
  entrevista: []
};

function clonarRegistro(registro) {
  try {
    return JSON.parse(JSON.stringify(registro));
  } catch {
    return { ...registro };
  }
}

function salvarHistorico(tipo, dados) {
  const lista = tipo === "curriculo" ? historicoSessao.curriculo : historicoSessao.entrevista;
  const registro = clonarRegistro({ ...dados, timestamp: Date.now() });
  lista.unshift(registro);
  if (lista.length > 20) lista.length = 20;
}

function obterHistorico(tipo) {
  const lista = tipo === "curriculo" ? historicoSessao.curriculo : historicoSessao.entrevista;
  return lista.map(clonarRegistro);
}

function removerStorageLegado() {
  for (const key of Object.values(STORAGE_KEYS)) {
    try { window.localStorage?.removeItem(key); } catch { }
  }
}

function markdownParaHtml(texto) {
  const fonte = String(texto || "");
  if (window.marked?.parse && window.DOMPurify?.sanitize) {
    try {
      return window.DOMPurify.sanitize(window.marked.parse(fonte));
    } catch { }
  }
  return escaparHtml(fonte).replace(/\n/g, "<br>");
}

function linkSeguro(valor, dominioPermitido = "") {
  if (!valor) return "";
  try {
    const url = new URL(String(valor));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (dominioPermitido) {
      const dominio = dominioPermitido.toLowerCase().replace(/^www\./, "");
      const host = url.hostname.toLowerCase();
      if (host !== dominio && host !== `www.${dominio}`) return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function normalizarPerfil(valor, base) {
  const texto = String(valor || "").trim().replace(/^@/, "");
  if (!texto) return "";
  const dominio = new URL(base).hostname.replace(/^www\./, "");
  if (/^https?:\/\//i.test(texto)) return linkSeguro(texto, dominio);
  if (/^(www\.)?(linkedin\.com|github\.com)\//i.test(texto)) return linkSeguro(`https://${texto}`, dominio);
  return "";
}

function escaparHtml(texto) {
  return String(texto || "").replace(/[&<>'"]/g, caractere => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  }[caractere]));
}

const CAMPOS_CURRICULO = [
  "nome",
  "contato",
  "linkedin",
  "github",
  "cidade",
  "estado",
  "idioma",
  "formacao",
  "experiencia",
  "habilidades",
  "objetivo",
  "descricao-vaga"
];

let gerandoCurriculo = false;
let abortControllerCurriculo = null;
let ultimoMarkdownCurriculo = "";
let ultimoPromptCurriculo = null;
let ultimoSnapshotCurriculo = null;
let geracaoCurriculoToken = 0;
let progressoTimer = null;
let progressoInicio = 0;
let estadosDesabilitadosCurriculo = new Map();

function capturarSnapshotCurriculo() {
  const valor = id => (el(id)?.value || "").trim();
  return Object.freeze({
    nome: valor("nome"),
    contato: valor("contato"),
    linkedin: normalizarPerfil(valor("linkedin"), "https://www.linkedin.com/in/"),
    github: normalizarPerfil(valor("github"), "https://github.com/"),
    cidade: valor("cidade"),
    estado: valor("estado"),
    idioma: valor("idioma"),
    formacao: valor("formacao"),
    experiencia: valor("experiencia"),
    habilidades: valor("habilidades"),
    objetivo: valor("objetivo"),
    descricaoVaga: valor("descricao-vaga")
  });
}

function montarPromptCurriculo(snapshot) {
  return `Atue como um profissional experiente de recrutamento e seleção, especialista em primeiro emprego, estágio, aprendizagem e recolocação. Escreva um currículo profissional em Markdown, com conteúdo desenvolvido e específico para a vaga.

Analise a descrição da vaga e extraia mentalmente as principais competências técnicas, responsabilidades e palavras-chave. Compare esses requisitos com os dados reais do candidato.
Considere que o candidato pode ser estudante do ensino médio, estar buscando o primeiro emprego ou ainda estar construindo experiência. Nesse caso, formação, projetos escolares, cursos, trabalhos voluntários, atividades informais, interesses práticos e potencial também são relevantes.

FORMATO OBRIGATÓRIO:
## Resumo Profissional
Um resumo com 4 a 6 frases completas, específico para a vaga.
## Formação Acadêmica
Use bullets com curso, instituição e situação. Se a instituição não foi informada, escreva apenas curso + situação — NUNCA invente nome de instituição nem use placeholders como "Instituição de Ensino Superior".
## Experiência Profissional
Use bullets com atividades e aprendizados concretos. Se não houver experiência formal, escreva "Ainda não possui experiência formal" e siga para projetos.
## Projetos Relevantes
Se não houver experiência formal, crie até 2 projetos acadêmicos ou autodidatas plausíveis usando SOMENTE as habilidades e a formação informadas. Para cada projeto, escreva o título em negrito seguido de 2 a 4 bullets com o que foi feito e aprendido. NÃO escreva parágrafo introdutório — vá direto aos bullets, sem repetir a mesma informação duas vezes.
## Habilidades
Separe habilidades técnicas e comportamentais em bullets.
## Certificações e Cursos
Inclua somente os que foram informados, mantendo o status dado pelo candidato (concluído / em andamento / estudando para). Se o status não foi informado, liste o nome sem afirmar conclusão e sem afirmar que é certificação obtida.
## Idiomas
Inclua somente o idioma informado pelo candidato. Se não houver idioma informado, omita esta seção completamente.
## Pontos fortes para a vaga
Quando houver descrição da vaga, liste de 2 a 5 combinações entre o perfil e a vaga, incluindo potencial e conhecimentos em desenvolvimento quando fizer sentido. Quando não houver descrição, omita esta seção.
## Próximos passos para se preparar
Quando houver descrição da vaga, liste de 2 a 4 habilidades ou experiências que o candidato pode desenvolver. Explique cada ponto de forma acolhedora e prática. Quando não houver descrição, omita esta seção.

REGRAS:
- Retorne somente o Markdown do currículo, sem comentários antes ou depois.
- Não repita a mesma informação em duas seções diferentes.
- Padronize o nome da vaga/objetivo com capitalização correta (ex.: "Analista SOC"), sem mudar o sentido do que o candidato escreveu.
- Não escreva frases genéricas como "profissional dedicado" sem explicar evidências concretas.
- Não invente empresas, empregos, certificados, idiomas, tecnologias, números ou experiências.
- Pode transformar os dados em descrições profissionais melhores, mas sem criar fatos.
- Nunca use linguagem de julgamento, como "não tem perfil", "inexperiente", "falta", "ausência" ou "não atende". Prefira "pode desenvolver", "ainda não foi informado" ou "seria interessante praticar".
- Não compare um estudante com um profissional sênior. Se a vaga exigir experiência que o candidato ainda não possui, apresente isso como um objetivo de desenvolvimento, sem desqualificá-lo.
- Reescreva experiências, projetos escolares, cursos e atividades com verbos de ação fortes e incorpore palavras-chave da vaga somente quando forem compatíveis com os dados reais.
- Não inclua LinkedIn ou GitHub: esses links serão inseridos separadamente.

DADOS DO CANDIDATO:
Nome: ${snapshot.nome}
Contato: ${snapshot.contato || "Não informado"}
Vaga desejada: ${snapshot.objetivo}
Formação: ${snapshot.formacao || "Não informada"}
Experiências: ${snapshot.experiencia || "Nenhuma formal"}
Habilidades e cursos: ${snapshot.habilidades || "Não informadas"}

DESCRIÇÃO DA VAGA:
${snapshot.descricaoVaga || "Não informada. Gere um currículo geral para a vaga desejada."}

Cidade: ${snapshot.cidade || "Não informada"}
Estado: ${snapshot.estado || "Não informado"}
Idioma: ${snapshot.idioma || "Não informado"}`;
}

const LIMITE_PROMPT_CLIENTE = typeof LIMITE_MAX_PROMPT === "number" ? LIMITE_MAX_PROMPT : 12000;

function validarLimitePrompt(prompt) {
  const texto = String(prompt || "");
  if (!texto.trim()) {
    const erro = new Error("O pedido não pode ficar vazio.");
    erro.codigo = "PROMPT_VAZIO";
    erro.retryable = false;
    throw erro;
  }
  if (Array.from(texto).length > LIMITE_PROMPT_CLIENTE) {
    const erro = new Error(`O pedido excede o limite de ${LIMITE_PROMPT_CLIENTE} caracteres. Reduza os dados e tente novamente.`);
    erro.status = 400;
    erro.codigo = "PROMPT_TOO_LARGE";
    erro.retryable = false;
    throw erro;
  }
  return texto;
}

function mostrarErroCurriculo(mensagem) {
  const box = el("erro-curriculo");
  const msg = el("erro-curriculo-msg");
  if (!box || !msg) {
    toastError("Erro ao gerar", mensagem);
    return;
  }
  msg.textContent = String(mensagem || "Não foi possível gerar agora.");
  box.hidden = false;
  box.focus?.({ preventScroll: true });
}

function esconderErroCurriculo() {
  const box = el("erro-curriculo");
  if (box) box.hidden = true;
}

function tentarNovamenteCurriculo() {
  if (gerandoCurriculo) return;
  esconderErroCurriculo();
  gerarCurriculo();
}

function definirCamposCurriculoDesabilitados(desabilitar) {
  if (desabilitar) {
    if (estadosDesabilitadosCurriculo.size) return;
    [...CAMPOS_CURRICULO, "btn-exemplo", "btn-limpar-curriculo"].forEach(id => {
      const field = el(id);
      if (!field) return;
      estadosDesabilitadosCurriculo.set(field, field.disabled);
      field.disabled = true;
    });
    return;
  }
  estadosDesabilitadosCurriculo.forEach((estado, field) => {
    if (field.isConnected) field.disabled = estado;
  });
  estadosDesabilitadosCurriculo.clear();
}

function renderizarPreviaCurriculo(caixa, nome, acumulado) {
  if (!caixa) return;
  caixa.replaceChildren();
  const header = document.createElement("div");
  header.className = "curriculo-header";
  const titulo = document.createElement("h2");
  titulo.textContent = nome;
  header.appendChild(titulo);
  const markdown = document.createElement("div");
  markdown.className = "curriculo-markdown";
  const previa = document.createElement("p");
  previa.textContent = `${String(acumulado || "").slice(-600)}…`;
  markdown.appendChild(previa);
  caixa.append(header, markdown);
}

function iniciarProgressoCurriculo(atualizadorPreview, token) {
  const wrap = el("progress-curriculo");
  const bar = el("progress-curriculo-bar");
  const label = el("progress-curriculo-label");
  const caixa = el("resultado-curriculo");
  const skeleton = el("skeleton-curriculo");
  progressoInicio = Date.now();
  if (wrap) wrap.hidden = false;
  if (bar) bar.style.width = "5%";
  if (label) label.textContent = "Gerando seu currículo… aguarde";
  clearInterval(progressoTimer);
  progressoTimer = setInterval(() => {
    if (token !== geracaoCurriculoToken) return;
    const segundos = Math.floor((Date.now() - progressoInicio) / 1000);
    if (label) label.textContent = `Gerando seu currículo… ${segundos}s — a IA está escrevendo, aguarde`;
    if (bar) {
      const atual = parseFloat(bar.style.width) || 5;
      bar.style.width = `${Math.min(90, atual + 2)}%`;
    }
  }, 500);
  let primeira = true;
  return (trecho, acumulado) => {
    if (token !== geracaoCurriculoToken) return;
    if (primeira) {
      primeira = false;
      if (caixa) caixa.style.display = "block";
      if (skeleton) skeleton.hidden = true;
    }
    atualizadorPreview?.(acumulado);
    if (bar) bar.style.width = `${Math.min(90, (parseFloat(bar.style.width) || 5) + 0.5)}%`;
  };
}

function pararProgressoCurriculo(ok, token = geracaoCurriculoToken) {
  if (token !== geracaoCurriculoToken) return;
  clearInterval(progressoTimer);
  progressoTimer = null;
  const wrap = el("progress-curriculo");
  const bar = el("progress-curriculo-bar");
  const label = el("progress-curriculo-label");
  if (bar) bar.style.width = ok ? "100%" : "0%";
  if (label && ok) label.textContent = "Pronto!";
  if (wrap) {
    window.setTimeout(() => {
      if (token === geracaoCurriculoToken) wrap.hidden = true;
    }, ok ? 600 : 0);
  }
}

function limparResultadoCurriculo() {
  ultimoMarkdownCurriculo = "";
  ultimoPromptCurriculo = null;
  ultimoSnapshotCurriculo = null;
  const caixa = el("resultado-curriculo");
  if (caixa) {
    caixa.replaceChildren();
    caixa.style.display = "none";
    caixa.setAttribute("aria-busy", "false");
    caixa.removeAttribute("tabindex");
  }
  const botoes = el("botoes-resultado");
  if (botoes) botoes.style.display = "none";
  const skeleton = el("skeleton-curriculo");
  if (skeleton) skeleton.hidden = true;
  const btnEditar = el("btn-editar");
  if (btnEditar) {
    editandoCurriculo = false;
    btnEditar.setAttribute("aria-label", "Editar currículo");
  }
  if (caixa) caixa.contentEditable = "false";
}

async function gerarCurriculo() {
  if (gerandoCurriculo) return;
  if (!validateCurriculoForm()) {
    toastError("Preencha os campos obrigatórios", "Verifique os campos marcados em vermelho");
    return;
  }

  const snapshot = capturarSnapshotCurriculo();
  const promptCompleto = montarPromptCurriculo(snapshot);
  limparResultadoCurriculo();
  esconderErroCurriculo();
  try {
    validarLimitePrompt(promptCompleto);
  } catch (erro) {
    mostrarErroCurriculo(erro.message);
    return;
  }

  const requestId = geracaoCurriculoToken + 1;
  geracaoCurriculoToken = requestId;
  const controller = new AbortController();
  abortControllerCurriculo = controller;
  const caixa = el("resultado-curriculo");
  const skeleton = el("skeleton-curriculo");
  const botao = el("btn-gerar");
  const btnCancelar = el("btn-cancelar-curriculo");
  const textoOriginalBotao = botao?.innerHTML || "";
  const ehAtual = () => requestId === geracaoCurriculoToken && !controller.signal.aborted;

  gerandoCurriculo = true;
  definirCamposCurriculoDesabilitados(true);
  if (botao) {
    botao.disabled = true;
    botao.innerHTML = "Gerando…";
  }
  if (btnCancelar) btnCancelar.hidden = false;
  if (caixa) {
    caixa.style.display = "none";
    caixa.setAttribute("aria-busy", "true");
  }
  if (skeleton) skeleton.hidden = false;
  const botoes = el("botoes-resultado");
  if (botoes) botoes.style.display = "none";

  try {
    const aoTrecho = iniciarProgressoCurriculo(acumulado => {
      if (!ehAtual()) return;
      renderizarPreviaCurriculo(caixa, snapshot.nome, acumulado);
    }, requestId);
    const respostaMarkdown = await chamarGemini(promptCompleto, aoTrecho, {
      maxTokens: 3072,
      temperature: 0.55,
      signal: controller.signal,
      retries: 2
    });
    if (!ehAtual()) return;
    if (!respostaMarkdown.trim()) throw new Error("A IA retornou uma resposta vazia.");

    ultimoMarkdownCurriculo = respostaMarkdown;
    ultimoPromptCurriculo = promptCompleto;
    ultimoSnapshotCurriculo = snapshot;
    renderCurriculoMarkdown(respostaMarkdown, caixa, snapshot);
    if (caixa) {
      caixa.style.display = "block";
      caixa.setAttribute("aria-busy", "false");
      caixa.setAttribute("tabindex", "-1");
      caixa.focus?.({ preventScroll: true });
    }
    if (skeleton) skeleton.hidden = true;
    pararProgressoCurriculo(true, requestId);
    if (botoes) botoes.style.display = "flex";
    atualizarBotaoEditar(false);
    toastSuccess("Currículo gerado!", "Revise, edite se quiser, e baixe em PDF ou texto");
    salvarHistorico("curriculo", { snapshot, markdown: respostaMarkdown });
  } catch (erro) {
    if (!ehAtual() && !controller.signal.aborted) return;
    pararProgressoCurriculo(false, requestId);
    limparResultadoCurriculo();
    const cancelado = erro.name === "AbortError" || controller.signal.aborted || String(erro.message || "").includes("cancelada");
    if (cancelado) {
      toastInfo("Cancelado", "Geração do currículo cancelada");
    } else {
      const mensagem = typeof traduzirErro === "function" ? traduzirErro(erro.message, erro.status) : erro.message;
      mostrarErroCurriculo(mensagem);
      toastError("Erro ao gerar", "Veja a mensagem acima do resultado e tente de novo");
    }
    if (skeleton) skeleton.hidden = true;
  } finally {
    if (requestId === geracaoCurriculoToken) {
      gerandoCurriculo = false;
      abortControllerCurriculo = null;
      definirCamposCurriculoDesabilitados(false);
      if (botao) {
        botao.disabled = false;
        botao.innerHTML = textoOriginalBotao;
      }
      if (btnCancelar) btnCancelar.hidden = true;
      window.lucide?.createIcons?.();
    }
  }
}

function renderCurriculoMarkdown(texto, caixa, dados) {
  if (!caixa) return;
  const linkedin = linkSeguro(dados.linkedin);
  const github = linkSeguro(dados.github);
  const header = document.createElement("div");
  header.className = "curriculo-header";
  const nome = document.createElement("h2");
  nome.textContent = dados.nome;
  header.appendChild(nome);
  if (dados.contato) {
    const contato = document.createElement("p");
    contato.textContent = dados.contato;
    header.appendChild(contato);
  }
  if (dados.objetivo) {
    const objetivo = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `Objetivo: ${dados.objetivo}`;
    objetivo.appendChild(strong);
    header.appendChild(objetivo);
  }
  const localizacao = [dados.cidade, dados.estado].filter(Boolean).join(" - ");
  if (localizacao) {
    const local = document.createElement("p");
    local.textContent = localizacao;
    header.appendChild(local);
  }
  [ [linkedin, "LinkedIn"], [github, "GitHub"] ].forEach(([url, label]) => {
    if (!url) return;
    const paragraph = document.createElement("p");
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${label}: ${url}`;
    paragraph.appendChild(link);
    header.appendChild(paragraph);
  });
  const markdown = document.createElement("div");
  markdown.className = "curriculo-markdown";
  markdown.innerHTML = markdownParaHtml(texto);
  caixa.replaceChildren(header, markdown);
  window.lucide?.createIcons?.();
}

async function copiarTextoFallback(texto) {
  const area = document.createElement("textarea");
  area.value = texto;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand?.("copy");
  area.remove();
  if (!copied) throw new Error("Não foi possível copiar o texto.");
}

async function copiarCurriculo() {
  const caixa = el("resultado-curriculo");
  const texto = caixa?.innerText?.trim() || "";
  if (!texto || !ultimoMarkdownCurriculo.trim()) {
    toastWarning("Nada para copiar", "Gere um currículo primeiro");
    return;
  }
  const botao = el("btn-copiar");
  try {
    if (window.navigator?.clipboard?.writeText) await window.navigator.clipboard.writeText(texto);
    else await copiarTextoFallback(texto);
    botao?.classList.add("copiado");
    botao?.setAttribute("aria-label", "Currículo copiado");
    window.setTimeout(() => {
      botao?.classList.remove("copiado");
      botao?.setAttribute("aria-label", "Copiar currículo");
    }, 1600);
    toastSuccess("Copiado!", "Currículo copiado para a área de transferência");
  } catch {
    toastError("Não foi possível copiar", "Tente selecionar o texto e copiar manualmente.");
  }
}

function restaurarBotaoPdf(botao, textoOriginal) {
  if (!botao) return;
  botao.innerHTML = textoOriginal;
  botao.disabled = false;
  window.lucide?.createIcons?.();
}

function baixarPDF() {
  const elemento = el("resultado-curriculo");
  const nome = ultimoSnapshotCurriculo?.nome || "curriculo";
  const botao = el("btn-pdf");
  if (!ultimoMarkdownCurriculo.trim() || !elemento) {
    toastWarning("Nada para baixar", "Gere um currículo primeiro");
    return;
  }
  const textoOriginal = botao?.innerHTML || "";
  if (botao) {
    botao.innerHTML = '<i data-lucide="loader" aria-hidden="true" style="animation: spin 1s linear infinite"></i> Gerando...';
    botao.disabled = true;
    window.lucide?.createIcons?.();
  }
  try {
    if (!window.jspdf?.jsPDF) throw new Error("Gerador de PDF indisponível. Recarregue a página e tente novamente.");
    const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const margem = 18;
    const larguraTexto = 174;
    const alturaLinha = 6;
    let y = 20;
    const escrever = (texto, tamanho = 10, negrito = false, espacamento = 0) => {
      const conteudo = String(texto || "").replace(/\s+/g, " ").trim();
      if (!conteudo) return;
      doc.setFont("helvetica", negrito ? "bold" : "normal");
      doc.setFontSize(tamanho);
      const linhas = doc.splitTextToSize(conteudo, larguraTexto);
      if (y + linhas.length * alturaLinha > 278) {
        doc.addPage();
        y = 20;
      }
      doc.text(linhas, margem, y);
      y += linhas.length * alturaLinha + espacamento;
    };
    elemento.querySelectorAll(".curriculo-header h2, .curriculo-header p, .curriculo-markdown h2, .curriculo-markdown h3, .curriculo-markdown h4, .curriculo-markdown p, .curriculo-markdown li").forEach(item => {
      const tag = item.tagName.toLowerCase();
      const titulo = ["h2", "h3", "h4"].includes(tag);
      escrever(item.textContent, titulo ? (tag === "h2" ? 18 : 12) : 10, titulo, titulo ? 2 : 1);
    });
    doc.save(`${nome.replace(/\s+/g, "_")}_curriculo.pdf`);
    restaurarBotaoPdf(botao, textoOriginal);
    toastSuccess("PDF gerado!", "Currículo salvo como PDF");
  } catch (erro) {
    restaurarBotaoPdf(botao, textoOriginal);
    toastError("Erro ao gerar PDF", erro.message);
  }
}

function cancelarGeracao() {
  if (!abortControllerCurriculo) return;
  abortControllerCurriculo.abort();
  if (gerandoCurriculo) {
    pararProgressoCurriculo(false, geracaoCurriculoToken);
    limparResultadoCurriculo();
  }
}

let editandoCurriculo = false;
function atualizarBotaoEditar(editando) {
  editandoCurriculo = Boolean(editando);
  const btn = el("btn-editar");
  const caixa = el("resultado-curriculo");
  if (!btn || !caixa) return;
  btn.replaceChildren();
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", editando ? "check" : "pencil");
  icon.setAttribute("aria-hidden", "true");
  const texto = document.createElement("span");
  texto.textContent = editando ? "Salvar edição" : "Editar";
  btn.append(icon, texto);
  if (caixa) {
    caixa.contentEditable = editando ? "true" : "false";
    caixa.classList.toggle("editando", editando);
  }
  if (editando) {
    caixa.focus?.();
    toastInfo("Modo edição", "Clique no texto e corrija. Depois clique em Salvar edição.");
  }
  window.lucide?.createIcons?.();
}

function alternarEdicaoCurriculo() {
  if (!ultimoMarkdownCurriculo.trim()) {
    toastWarning("Nada para editar", "Gere um currículo primeiro");
    return;
  }
  const caixa = el("resultado-curriculo");
  if (caixa) ultimoMarkdownCurriculo = caixa.innerText;
  atualizarBotaoEditar(!editandoCurriculo);
  if (!editandoCurriculo) toastSuccess("Edição salva", "Agora você pode baixar o PDF ou texto");
}

function baixarTXT() {
  const texto = el("resultado-curriculo")?.innerText?.trim() || "";
  if (!texto || !ultimoMarkdownCurriculo.trim()) {
    toastWarning("Nada para baixar", "Gere o currículo primeiro");
    return;
  }
  const nome = (ultimoSnapshotCurriculo?.nome || "curriculo").replace(/\s+/g, "_");
  const blob = new Blob([texto], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${nome}_curriculo.txt`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  toastSuccess("Texto baixado!", "Currículo salvo como .txt");
}

function preencherExemplo() {
  const exemplo = {
    nome: "Maria Silva",
    contato: "maria.silva@email.com",
    linkedin: "linkedin.com/in/maria-silva",
    github: "github.com/mariasilva",
    cidade: "São Paulo",
    estado: "SP",
    idioma: "Inglês intermediário",
    formacao: "Ensino médio completo, cursando Técnico em Administração",
    experiencia: "Voluntariado na festa junina da escola (organização e caixa); projeto de vendas de brigadeiros",
    habilidades: "Excel básico, comunicação, trabalho em equipe, curso de informática",
    objetivo: "Jovem aprendiz em administração",
    "descricao-vaga": "Vaga de jovem aprendiz: atendimento, organização de documentos, Excel básico, boa comunicação."
  };
  Object.entries(exemplo).forEach(([id, value]) => {
    const field = el(id);
    if (!field) return;
    field.value = value;
    clearFieldError(id);
  });
  toastInfo("Exemplo preenchido", "Ajuste com seus dados e clique em Gerar");
  el("nome")?.focus();
}

function limparHistorico(tipo) {
  const lista = tipo === "curriculo" ? historicoSessao.curriculo : historicoSessao.entrevista;
  lista.length = 0;
  removerStorageLegado();
  if (tipo === "curriculo") {
    limparResultadoCurriculo();
  } else {
    resetarEntrevista();
  }
  toastSuccess("Histórico limpo", tipo === "curriculo" ? "Currículos apagados nesta sessão" : "Entrevistas apagadas nesta sessão");
}

const TOTAL_PERGUNTAS = 3;
const ESTADOS_ENTREVISTA = Object.freeze({
  IDLE: "idle",
  LOADING_QUESTION: "loadingQuestion",
  WAITING_ANSWER: "waitingAnswer",
  LOADING_FEEDBACK: "loadingFeedback",
  COMPLETED: "completed",
  ERROR: "error"
});

let estadoEntrevista = ESTADOS_ENTREVISTA.IDLE;
let historicoChat = [];
let perguntaAtual = 0;
let entrevistaCarregando = false;
let abortControllerEntrevista = null;
let areaEntrevista = "";
let operacaoEntrevista = 0;
let ultimaAcaoEntrevista = null;

function definirRotuloBotaoIniciar(texto, icone = "play") {
  const botao = el("btn-iniciar");
  if (!botao) return;
  botao.replaceChildren();
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", icone);
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = texto;
  botao.append(icon, label);
  window.lucide?.createIcons?.();
}

function definirStatusEntrevista(texto) {
  const status = el("entrevista-status");
  if (status) status.textContent = String(texto || "");
}

function anunciarRecrutador(texto) {
  const status = el("entrevista-status");
  if (status) status.textContent = `Recrutador: ${String(texto || "")}`;
}

function definirEstadoEntrevista(estado) {
  estadoEntrevista = estado;
  entrevistaCarregando = estado === ESTADOS_ENTREVISTA.LOADING_QUESTION || estado === ESTADOS_ENTREVISTA.LOADING_FEEDBACK;
  const area = el("area");
  const resposta = el("resposta");
  const chatInput = el("chat-input");
  const btnEnviar = el("btn-enviar");
  const btnIniciar = el("btn-iniciar");
  const btnCancelar = el("btn-cancelar-entrevista");
  const progressSteps = el("progress-steps");
  const chat = el("chat-box");
  const interviewing = estado !== ESTADOS_ENTREVISTA.IDLE && estado !== ESTADOS_ENTREVISTA.COMPLETED;
  if (area) area.disabled = interviewing;
  if (chatInput) chatInput.hidden = estado !== ESTADOS_ENTREVISTA.WAITING_ANSWER;
  if (resposta) resposta.disabled = estado !== ESTADOS_ENTREVISTA.WAITING_ANSWER;
  if (btnEnviar) btnEnviar.disabled = estado !== ESTADOS_ENTREVISTA.WAITING_ANSWER;
  if (btnIniciar) btnIniciar.hidden = interviewing;
  if (btnCancelar) btnCancelar.hidden = !interviewing;
  if (progressSteps) progressSteps.hidden = estado === ESTADOS_ENTREVISTA.IDLE;
  if (chat) chat.setAttribute("aria-busy", String(entrevistaCarregando));
  if (estado === ESTADOS_ENTREVISTA.IDLE) definirRotuloBotaoIniciar("Começar simulação");
  if (estado === ESTADOS_ENTREVISTA.COMPLETED) definirRotuloBotaoIniciar("Começar novamente", "rotate-ccw");
  if (estado === ESTADOS_ENTREVISTA.LOADING_QUESTION) definirStatusEntrevista("Preparando a próxima pergunta.");
  if (estado === ESTADOS_ENTREVISTA.WAITING_ANSWER) definirStatusEntrevista("Sua resposta está sendo esperada.");
  if (estado === ESTADOS_ENTREVISTA.LOADING_FEEDBACK) definirStatusEntrevista("Preparando seu feedback final.");
  if (estado === ESTADOS_ENTREVISTA.ERROR) definirStatusEntrevista("A última ação não foi concluída. Use Tentar novamente ou encerre a simulação.");
  if (estado === ESTADOS_ENTREVISTA.COMPLETED) definirStatusEntrevista("Entrevista concluída. Confira o feedback e comece uma nova simulação quando quiser.");
}

function travarChat(travar) {
  entrevistaCarregando = Boolean(travar);
  const resposta = el("resposta");
  const btnEnviar = el("btn-enviar");
  const chat = el("chat-box");
  const bloqueado = Boolean(travar) || estadoEntrevista !== ESTADOS_ENTREVISTA.WAITING_ANSWER;
  if (resposta) resposta.disabled = bloqueado;
  if (btnEnviar) btnEnviar.disabled = bloqueado;
  if (chat) chat.setAttribute("aria-busy", String(entrevistaCarregando));
}

function atualizarProgresso() {
  const steps = document.querySelectorAll(".progress-step");
  steps.forEach((step, index) => {
    const stepNum = index + 1;
    step.classList.remove("active", "completed");
    if (estadoEntrevista === ESTADOS_ENTREVISTA.COMPLETED || stepNum < perguntaAtual) {
      step.classList.add("completed");
    } else if (stepNum === perguntaAtual && estadoEntrevista !== ESTADOS_ENTREVISTA.IDLE) {
      step.classList.add("active");
    }
  });
}

function adicionarMensagem(texto, quem) {
  const chat = el("chat-box");
  if (!chat) return null;
  el("empty-state")?.remove();
  const mensagem = document.createElement("div");
  mensagem.className = `msg rounded-2xl rounded-tl-none ${quem === "ia" ? "msg-ia" : "msg-user"}`;
  mensagem.setAttribute("role", "group");
  mensagem.setAttribute("aria-label", quem === "ia" ? "Mensagem do recrutador" : "Sua resposta");
  if (quem === "ia") mensagem.innerHTML = markdownParaHtml(texto);
  else mensagem.textContent = String(texto || "");
  chat.appendChild(mensagem);
  chat.scrollTop = chat.scrollHeight;
  return mensagem;
}

function mostrarDigitando() {
  const chat = el("chat-box");
  if (!chat) return null;
  const mensagem = document.createElement("div");
  mensagem.className = "msg msg-ia msg-digitando rounded-2xl rounded-tl-none";
  mensagem.setAttribute("aria-hidden", "true");
  mensagem.textContent = "digitando...";
  chat.appendChild(mensagem);
  chat.scrollTop = chat.scrollHeight;
  return mensagem;
}

function criarAtualizadorDigitando(bolhaDigitando, ativo) {
  const chat = el("chat-box");
  let primeiroTrecho = true;
  return (trecho, textoAteAgora) => {
    if (!bolhaDigitando?.isConnected || (ativo && !ativo())) return;
    if (primeiroTrecho) {
      bolhaDigitando.classList.remove("msg-digitando");
      bolhaDigitando.removeAttribute("aria-hidden");
      bolhaDigitando.setAttribute("role", "group");
      bolhaDigitando.setAttribute("aria-label", "Mensagem do recrutador");
      primeiroTrecho = false;
    }
    bolhaDigitando.innerHTML = markdownParaHtml(textoAteAgora);
    if (chat) chat.scrollTop = chat.scrollHeight;
  };
}

function removerMensagensErroEntrevista() {
  document.querySelectorAll("#chat-box .msg-erro").forEach(mensagem => mensagem.remove());
}

function adicionarMensagemErro(texto, acao) {
  const chat = el("chat-box");
  if (!chat) return null;
  el("empty-state")?.remove();
  const mensagem = document.createElement("div");
  mensagem.className = "msg msg-ia msg-erro rounded-2xl rounded-tl-none";
  mensagem.setAttribute("role", "alert");
  const textoErro = document.createElement("p");
  textoErro.textContent = String(texto || "Não foi possível concluir a ação.");
  mensagem.appendChild(textoErro);
  if (typeof acao === "function") {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "btn btn-tentar";
    botao.textContent = "Tentar novamente";
    botao.addEventListener("click", () => {
      mensagem.remove();
      acao();
    });
    mensagem.appendChild(botao);
  }
  chat.appendChild(mensagem);
  chat.scrollTop = chat.scrollHeight;
  return mensagem;
}

function formatarErroEntrevista(erro) {
  const mensagem = erro?.message || "Não foi possível concluir a ação.";
  return typeof traduzirErro === "function" ? traduzirErro(mensagem, erro?.status) : mensagem;
}

function ehCancelamentoEntrevista(erro, controller) {
  return Boolean(controller?.signal?.aborted)
    || erro?.name === "AbortError"
    || String(erro?.message || "").includes("cancelada");
}

function promptPrimeiraPerguntaEntrevista(area) {
  return `Você é um orientador de carreira e recrutador experiente, simulando uma entrevista para **${area}** com um estudante do ensino médio ou candidato ao primeiro emprego.

REGRAS:
- Faça APENAS a 1ª pergunta, direta, acolhedora e fácil de responder
- Não presuma experiência profissional. Aceite exemplos da escola, cursos, projetos, voluntariado, família e atividades do dia a dia
- Comece pedindo uma apresentação breve e perguntando o que despertou o interesse pela área
- MÁXIMO 2 frases, sem linguagem corporativa complicada
- Retorne APENAS a pergunta, sem introduções nem "Aqui está a pergunta:"`;
}

function promptProximaPerguntaEntrevista(area, historico, numero) {
  return `Você é um orientador de carreira conduzindo uma entrevista para **${area}** com um estudante ou candidato ao primeiro emprego.
Histórico:
${[...historico].join("\n")}

REGRAS:
- Diga primeiro uma frase curta reconhecendo algo concreto da resposta anterior
- Faça a próxima pergunta (${numero}/${TOTAL_PERGUNTAS}) de forma direta e simples
- Progrida nesta ordem: apresentação/interesse, situação ou comportamento, e aprendizado/como lidaria com um desafio
- Se a área for técnica, prefira fundamentos e raciocínio, não ferramentas avançadas ou experiência corporativa
- Aceite exemplos de escola, cursos, projetos, voluntariado e vida cotidiana
- Nunca diga que a pessoa não serve para a vaga, não tem perfil ou está despreparada
- Tom profissional, encorajador e conciso; máximo 3 frases`;
}

function promptFeedbackEntrevista(area, historico) {
  return `Você é um orientador de carreira acolhedor. A entrevista para **${area}** foi concluída por um estudante ou candidato ao primeiro emprego.
Histórico completo:
${[...historico].join("\n")}

Dê um feedback final construtivo e fácil de entender:
1. Dois pontos fortes percebidos nas respostas, sempre citando exemplos do histórico
2. Duas dicas práticas e possíveis de aplicar, sem tratar a falta de experiência como defeito
3. Uma sugestão de resposta ou atitude para continuar treinando
4. Encerramento motivador e realista

Formato: use os títulos "Pontos fortes", "Para praticar" e "Próximo passo". Parágrafos curtos, tom encorajador, sem dar nota ou reprovar. MÁXIMO 220 palavras.`;
}

function solicitarEntrevista(prompt, tipo, token, concluir) {
  if (token !== operacaoEntrevista) return;
  try {
    validarLimitePrompt(prompt);
  } catch (erro) {
    definirEstadoEntrevista(ESTADOS_ENTREVISTA.ERROR);
    adicionarMensagemErro(formatarErroEntrevista(erro));
    return;
  }

  const estadoSolicitacao = tipo === "feedback" ? ESTADOS_ENTREVISTA.LOADING_FEEDBACK : ESTADOS_ENTREVISTA.LOADING_QUESTION;
  definirEstadoEntrevista(estadoSolicitacao);
  const controller = new AbortController();
  abortControllerEntrevista = controller;
  const digitando = mostrarDigitando();
  const ativo = () => token === operacaoEntrevista && !controller.signal.aborted;
  const aoTrecho = criarAtualizadorDigitando(digitando, ativo);

  return chamarGemini(prompt, aoTrecho, {
    maxTokens: tipo === "feedback" ? 500 : 400,
    temperature: 0.6,
    signal: controller.signal
  }).then(resposta => {
    if (!ativo()) {
      digitando?.remove();
      return;
    }
    if (!String(resposta || "").trim()) throw new Error("A IA retornou uma resposta vazia.");
    concluir(resposta, digitando);
  }).catch(erro => {
    digitando?.remove();
    if (token !== operacaoEntrevista || ehCancelamentoEntrevista(erro, controller)) return;
    definirEstadoEntrevista(ESTADOS_ENTREVISTA.ERROR);
    const retry = () => {
      if (token !== operacaoEntrevista || estadoEntrevista !== ESTADOS_ENTREVISTA.ERROR) return;
      removerMensagensErroEntrevista();
      solicitarEntrevista(prompt, tipo, token, concluir);
    };
    ultimaAcaoEntrevista = retry;
    adicionarMensagemErro(formatarErroEntrevista(erro), retry);
  }).finally(() => {
    if (token === operacaoEntrevista && abortControllerEntrevista === controller) {
      abortControllerEntrevista = null;
      entrevistaCarregando = false;
      const chat = el("chat-box");
      if (chat) chat.setAttribute("aria-busy", "false");
    }
  });
}

async function iniciarEntrevista() {
  if ([ESTADOS_ENTREVISTA.LOADING_QUESTION, ESTADOS_ENTREVISTA.LOADING_FEEDBACK].includes(estadoEntrevista)) return;
  const selectArea = el("area");
  const area = (selectArea?.value || "").trim();
  if (!area) {
    selectArea?.focus();
    return;
  }
  operacaoEntrevista += 1;
  abortControllerEntrevista?.abort();
  const token = operacaoEntrevista;
  areaEntrevista = area;
  historicoChat = [];
  perguntaAtual = 1;
  ultimaAcaoEntrevista = null;
  const chat = el("chat-box");
  if (chat) chat.replaceChildren();
  const progressSteps = el("progress-steps");
  if (progressSteps) progressSteps.hidden = false;
  const resposta = el("resposta");
  if (resposta) resposta.value = "";
  const btnIniciar = el("btn-iniciar");
  if (btnIniciar) btnIniciar.hidden = true;
  const btnCancelar = el("btn-cancelar-entrevista");
  if (btnCancelar) btnCancelar.hidden = false;
  definirEstadoEntrevista(ESTADOS_ENTREVISTA.LOADING_QUESTION);
  adicionarMensagem(`Ótimo! Vamos simular uma entrevista para **${areaEntrevista}**. Serão ${TOTAL_PERGUNTAS} perguntas. Preparado(a)?`, "ia");
  atualizarProgresso();
  const prompt = promptPrimeiraPerguntaEntrevista(areaEntrevista);
  return solicitarEntrevista(prompt, "question", token, (primeiraPergunta, bolha) => {
    if (token !== operacaoEntrevista) {
      bolha?.remove();
      return;
    }
    bolha?.classList.remove("msg-digitando");
    historicoChat.push(`Recrutador: ${primeiraPergunta}`);
    definirEstadoEntrevista(ESTADOS_ENTREVISTA.WAITING_ANSWER);
    anunciarRecrutador(primeiraPergunta);
    atualizarProgresso();
    el("resposta")?.focus();
  });
}

async function enviarResposta() {
  if (estadoEntrevista !== ESTADOS_ENTREVISTA.WAITING_ANSWER || entrevistaCarregando) return;
  const campo = el("resposta");
  const resposta = (campo?.value || "").trim();
  if (!resposta) return;
  adicionarMensagem(resposta, "user");
  historicoChat.push(`Candidato: ${resposta}`);
  if (campo) campo.value = "";
  const token = operacaoEntrevista;
  if (perguntaAtual < TOTAL_PERGUNTAS) {
    const numero = perguntaAtual + 1;
    perguntaAtual = numero;
    atualizarProgresso();
    const prompt = promptProximaPerguntaEntrevista(areaEntrevista, historicoChat, numero);
    return solicitarEntrevista(prompt, "question", token, (proxima, bolha) => {
      if (token !== operacaoEntrevista) {
        bolha?.remove();
        return;
      }
      bolha?.classList.remove("msg-digitando");
      historicoChat.push(`Recrutador: ${proxima}`);
      definirEstadoEntrevista(ESTADOS_ENTREVISTA.WAITING_ANSWER);
      anunciarRecrutador(proxima);
      atualizarProgresso();
      el("resposta")?.focus();
    });
  }

  const prompt = promptFeedbackEntrevista(areaEntrevista, historicoChat);
  return solicitarEntrevista(prompt, "feedback", token, (feedback, bolha) => {
    if (token !== operacaoEntrevista) {
      bolha?.remove();
      return;
    }
    bolha?.classList.remove("msg-digitando");
    historicoChat.push(`Feedback: ${feedback}`);
    perguntaAtual = TOTAL_PERGUNTAS;
    definirEstadoEntrevista(ESTADOS_ENTREVISTA.COMPLETED);
    anunciarRecrutador(feedback);
    atualizarProgresso();
    salvarHistorico("entrevista", { area: areaEntrevista, historico: [...historicoChat] });
    toastSuccess("Entrevista finalizada!", "Confira seu feedback abaixo");
  });
}

function criarEmptyStateEntrevista() {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.id = "empty-state";
  const icon = document.createElement("div");
  icon.className = "empty-state__icon";
  icon.setAttribute("aria-hidden", "true");
  const iconElement = document.createElement("i");
  iconElement.setAttribute("data-lucide", "message-square");
  icon.appendChild(iconElement);
  const title = document.createElement("div");
  title.className = "empty-state__title";
  title.textContent = "Simulação pronta para começar";
  const description = document.createElement("p");
  description.className = "empty-state__desc";
  description.textContent = 'Selecione uma área e clique em "Começar simulação" para treinar com nosso recrutador virtual.';
  empty.append(icon, title, description);
  return empty;
}

function resetarEntrevista() {
  operacaoEntrevista += 1;
  abortControllerEntrevista?.abort();
  abortControllerEntrevista = null;
  historicoChat = [];
  perguntaAtual = 0;
  areaEntrevista = "";
  ultimaAcaoEntrevista = null;
  const chat = el("chat-box");
  if (chat) chat.replaceChildren(criarEmptyStateEntrevista());
  const resposta = el("resposta");
  if (resposta) resposta.value = "";
  definirEstadoEntrevista(ESTADOS_ENTREVISTA.IDLE);
  atualizarProgresso();
  document.querySelectorAll(".progress-step").forEach(step => step.classList.remove("active", "completed"));
  const area = el("area");
  if (area) area.disabled = false;
  window.lucide?.createIcons?.();
}

function cancelarEntrevista() {
  if (estadoEntrevista === ESTADOS_ENTREVISTA.IDLE) return;
  resetarEntrevista();
  toastInfo("Encerrado", "Simulação de entrevista cancelada");
}

["nome", "contato", "linkedin", "github", "formacao", "experiencia", "habilidades", "objetivo"].forEach(id => {
  el(id)?.addEventListener("input", () => clearFieldError(id));
});

el("resposta")?.addEventListener("keydown", evento => {
  if (evento.key === "Enter" && !evento.shiftKey && !evento.isComposing) {
    evento.preventDefault();
    enviarResposta();
  }
});

document.addEventListener("keydown", evento => {
  if (evento.key === "Escape") {
    if (gerandoCurriculo) {
      evento.preventDefault();
      cancelarGeracao();
      return;
    }
    if (estadoEntrevista !== ESTADOS_ENTREVISTA.IDLE && estadoEntrevista !== ESTADOS_ENTREVISTA.COMPLETED) {
      evento.preventDefault();
      cancelarEntrevista();
    }
  }
  if ((evento.ctrlKey || evento.metaKey) && evento.key === "Enter" && document.activeElement?.id === "objetivo") {
    evento.preventDefault();
    gerarCurriculo();
  }
});

const botoesAbas = document.querySelectorAll(".tab-btn");
const botoesHero = document.querySelectorAll(".btn-tab");
const paineis = document.querySelectorAll(".tab-panel");

function ativarAba(target) {
  botoesAbas.forEach(botao => {
    const ativo = botao.dataset.tab === target;
    botao.classList.toggle("active", ativo);
    botao.setAttribute("aria-selected", String(ativo));
    botao.tabIndex = ativo ? 0 : -1;
  });
  paineis.forEach(painel => {
    const ativo = painel.id === `${target}-panel`;
    painel.classList.toggle("active", ativo);
    painel.setAttribute("aria-hidden", String(!ativo));
  });
}

botoesAbas.forEach((botao, index) => {
  botao.addEventListener("click", () => ativarAba(botao.dataset.tab));
  botao.addEventListener("keydown", evento => {
    if (!["ArrowLeft", "ArrowRight"].includes(evento.key)) return;
    evento.preventDefault();
    const proximo = (index + (evento.key === "ArrowRight" ? 1 : -1) + botoesAbas.length) % botoesAbas.length;
    botoesAbas[proximo].focus();
    ativarAba(botoesAbas[proximo].dataset.tab);
  });
});

botoesHero.forEach(botao => {
  botao.addEventListener("click", evento => {
    evento.preventDefault();
    ativarAba(botao.dataset.tab);
    const ferramentas = el("ferramentas");
    const reduzir = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    ferramentas?.scrollIntoView({ behavior: reduzir ? "auto" : "smooth", block: "start" });
  });
});

const botaoTema = el("toggle-tema");
const CHAVE_TEMA = "conecta-carreira-tema";

function atualizarIconeTema(ehEscuro) {
  if (!botaoTema) return;
  botaoTema.setAttribute("aria-label", ehEscuro ? "Alternar para modo claro" : "Alternar para modo escuro");
  const icone = botaoTema.querySelector("[data-lucide]") || botaoTema.querySelector("svg");
  if (icone && window.lucide?.createIcons) {
    icone.setAttribute("data-lucide", ehEscuro ? "sun" : "moon");
    window.lucide.createIcons();
    return;
  }
  icone?.remove();
  botaoTema.textContent = ehEscuro ? "Sol" : "Lua";
}

atualizarIconeTema(document.documentElement.getAttribute("data-tema") === "escuro");
botaoTema?.addEventListener("click", () => {
  const estaEscuro = document.documentElement.getAttribute("data-tema") === "escuro";
  if (estaEscuro) {
    document.documentElement.removeAttribute("data-tema");
  } else {
    document.documentElement.setAttribute("data-tema", "escuro");
  }
  document.documentElement.classList.toggle("dark", !estaEscuro);
  try { window.localStorage?.setItem(CHAVE_TEMA, estaEscuro ? "claro" : "escuro"); } catch { }
  atualizarIconeTema(!estaEscuro);
});

function initLucide() {
  if (!window.lucide?.createIcons) return;
  try { window.lucide.createIcons({ strokeWidth: 2 }); } catch { }
}
removerStorageLegado();
initLucide();
