function el(id) {
  return document.getElementById(id);
}

function mostrarToast(tipo, titulo, mensagem = "") {
  const container = el("toast-container");
  if (!container) return;
  const tipoSeguro = ["success", "error", "warning", "info"].includes(tipo) ? tipo : "info";
  const toast = document.createElement("div");
  toast.className = `toast toast--${tipoSeguro}`;
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
  close.textContent = "×";
  close.addEventListener("click", () => toast.remove());
  toast.append(content, close);
  container.appendChild(toast);
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
  const group = field.closest(".field");
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
  const group = field.closest(".field");
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

  const contatoValido = parte => {
    const digitos = parte.replace(/\D/g, "").length;
    return emailRegex.test(parte) || (phoneRegex.test(parte) && digitos >= 10 && digitos <= 15);
  };
  if (!contato) {
    setFieldError("contato", "Informe um email ou telefone");
    valid = false;
  } else if (!contato.split("|").every(parte => contatoValido(parte.trim()))) {
    setFieldError("contato", "Email ou telefone inválido");
    valid = false;
  } else {
    clearFieldError("contato");
  }

  if (!(el("formacao")?.value || "").trim() && !(el("habilidades")?.value || "").trim()) {
    setFieldError("formacao", "Preencha a formação ou as habilidades");
    valid = false;
  } else {
    clearFieldError("formacao");
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

function removerStorageLegado() {
  for (const key of Object.values(STORAGE_KEYS)) {
    try { window.localStorage?.removeItem(key); } catch { }
  }
}

// Só formatação de texto: imagem, vídeo e style carregam URLs externas sozinhos e poderiam vazar dados pessoais.
const FILTRO_MARKDOWN = Object.freeze({
  ALLOWED_TAGS: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "ul", "ol", "li", "strong", "em", "del", "code", "pre", "blockquote", "a", "table", "thead", "tbody", "tr", "th", "td"],
  ALLOWED_ATTR: ["href", "title"]
});

function markdownParaHtml(texto) {
  const fonte = String(texto || "");
  if (window.marked?.parse && window.DOMPurify?.sanitize) {
    try {
      return window.DOMPurify.sanitize(window.marked.parse(fonte), FILTRO_MARKDOWN);
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
      if (host !== dominio && !host.endsWith(`.${dominio}`)) return "";
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
  if (/^([a-z0-9-]+\.)?(linkedin\.com|github\.com)\//i.test(texto)) return linkSeguro(`https://${texto}`, dominio);
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
  "descricao-vaga",
  "foto"
];

let gerandoCurriculo = false;
let abortControllerCurriculo = null;
let ultimoMarkdownCurriculo = "";
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
Um resumo com 2 a 5 frases completas, específico para a vaga, usando só fatos informados. Com poucos dados, escreva menos frases em vez de preencher.
## Formação Acadêmica
Use bullets com curso, instituição e situação. Se a instituição não foi informada, escreva apenas curso + situação — NUNCA invente nome de instituição nem use placeholders como "Instituição de Ensino Superior".
## Experiência Profissional
Use bullets com atividades e aprendizados concretos. Se nenhuma experiência foi informada, omita esta seção.
## Projetos Relevantes
Inclua somente projetos que o candidato informou. Para cada projeto, escreva o título em negrito seguido de 2 a 4 bullets com o que foi feito e aprendido. NÃO escreva parágrafo introdutório — vá direto aos bullets, sem repetir a mesma informação duas vezes. Se nenhum projeto foi informado, omita esta seção.
## Habilidades
Liste só as habilidades informadas pelo candidato, separando técnicas e comportamentais em bullets. Nunca copie habilidades da descrição da vaga nem acrescente qualidades pessoais.
## Certificações e Cursos
Inclua somente o que o candidato chamou claramente de curso ou certificação; habilidades soltas como "Excel básico" ficam só em Habilidades. Mantenha o status dado pelo candidato (concluído / em andamento / estudando para). Se o status não foi informado, liste o nome sem afirmar conclusão e sem afirmar que é certificação obtida.
## Idiomas
Inclua somente o idioma informado pelo candidato. Se não houver idioma informado, omita esta seção completamente.
## Pontos fortes para a vaga
Quando houver descrição da vaga, liste de 2 a 5 combinações entre o perfil e a vaga, incluindo potencial e conhecimentos em desenvolvimento quando fizer sentido. Quando não houver descrição, omita esta seção.
## Próximos passos para se preparar
Liste de 2 a 4 habilidades, experiências ou ideias de projeto simples que o candidato pode desenvolver para a vaga. Explique cada ponto de forma acolhedora e prática. Ideias de projeto são sugestões para o futuro, nunca fatos do currículo.

REGRAS:
- Retorne somente o Markdown do currículo, sem comentários antes ou depois.
- Use exatamente os títulos acima, com ##. Omita qualquer seção do currículo sem dados informados.
- "Pontos fortes para a vaga" e "Próximos passos para se preparar" são orientações ao candidato: ficam no fim, falam diretamente com ele e não fazem parte do currículo.
- Não repita a mesma informação em duas seções diferentes.
- Padronize o nome da vaga/objetivo com capitalização correta (ex.: "Analista SOC"), sem mudar o sentido do que o candidato escreveu.
- Não escreva frases genéricas como "profissional dedicado" sem explicar evidências concretas.
- Não invente empresas, empregos, projetos, certificados, idiomas, tecnologias, habilidades, números ou experiências.
- Pode transformar os dados em descrições profissionais melhores, mas sem criar fatos.
- Nunca use linguagem de julgamento, como "não tem perfil", "inexperiente", "falta", "ausência" ou "não atende". Prefira "pode desenvolver", "ainda não foi informado" ou "seria interessante praticar".
- Não compare um estudante com um profissional sênior. Se a vaga exigir experiência que o candidato ainda não possui, apresente isso como um objetivo de desenvolvimento, sem desqualificá-lo.
- Reescreva experiências, projetos escolares, cursos e atividades com verbos de ação fortes e use palavras-chave da vaga somente para descrever o que o candidato informou. A descrição da vaga nunca é fonte de fatos sobre o candidato.
- Não inclua título com o nome, contato, LinkedIn ou GitHub: esses dados serão inseridos separadamente.

DADOS DO CANDIDATO:
Nome: ${snapshot.nome}
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

function separarOrientacao(markdown) {
  const secoes = String(markdown || "").split(/^(?=#{1,6}\s)/m);
  const ehOrientacao = secao => /^#{1,6}\s*\**\s*(pontos fortes|pr[oó]ximos passos)/i.test(secao);
  return {
    curriculo: secoes.filter(secao => !ehOrientacao(secao)).join(""),
    orientacao: secoes.filter(ehOrientacao).join("")
  };
}

function renderizarOrientacao(markdown) {
  const box = el("orientacao-curriculo");
  const texto = el("orientacao-curriculo-texto");
  if (!box || !texto) return;
  texto.innerHTML = markdownParaHtml(markdown);
  box.hidden = !String(markdown || "").trim();
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
  renderizarOrientacao("");
  const avisoCorte = el("aviso-corte-curriculo");
  if (avisoCorte) avisoCorte.hidden = true;
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
    let cortado = false;
    const respostaMarkdown = await chamarGemini(promptCompleto, aoTrecho, {
      maxTokens: 4096,
      temperature: 0.55,
      signal: controller.signal,
      retries: 2,
      aoCortar: () => { cortado = true; }
    });
    if (!ehAtual()) return;
    if (!respostaMarkdown.trim()) throw new Error("A IA retornou uma resposta vazia.");

    const { curriculo, orientacao } = separarOrientacao(respostaMarkdown);
    ultimoMarkdownCurriculo = curriculo;
    ultimoSnapshotCurriculo = snapshot;
    renderCurriculoMarkdown(curriculo, caixa, snapshot);
    renderizarOrientacao(orientacao);
    const avisoCorte = el("aviso-corte-curriculo");
    if (avisoCorte) avisoCorte.hidden = !cortado;
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
  // Mesma ordem do PDF: nome, vaga e, numa linha, os contatos.
  if (dados.objetivo) {
    const objetivo = document.createElement("p");
    objetivo.className = "cv-objetivo";
    objetivo.textContent = dados.objetivo;
    header.appendChild(objetivo);
  }
  if (dados.contato) {
    const contato = document.createElement("p");
    contato.className = "cv-contato";
    contato.textContent = dados.contato;
    header.appendChild(contato);
  }
  const localizacao = [dados.cidade, dados.estado].filter(Boolean).join(" - ");
  if (localizacao) {
    const local = document.createElement("p");
    local.className = "cv-local";
    local.textContent = localizacao;
    header.appendChild(local);
  }
  [ [linkedin, "LinkedIn"], [github, "GitHub"] ].forEach(([url, label]) => {
    if (!url) return;
    const paragraph = document.createElement("p");
    paragraph.className = "cv-link";
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    link.setAttribute("aria-label", `${label}: ${link.textContent}`);
    paragraph.appendChild(link);
    header.appendChild(paragraph);
  });
  const markdown = document.createElement("div");
  markdown.className = "curriculo-markdown";
  markdown.innerHTML = markdownParaHtml(texto);
  marcarComoNoPdf(markdown);
  caixa.replaceChildren(header, markdown);
  atualizarFotoNoCurriculo();
}

// A mesma regra decide etiquetas na prévia e no PDF.
function listaEmEtiquetas(secao, lista) {
  return /habilidad|compet|idioma/i.test(secao)
    && [...lista.children].every(item => dividirHabilidade(item.textContent).itens.every(t => t.length <= 50));
}

// Marca o resumo e transforma habilidades em etiquetas, sem mudar o texto: PDF e cópia leem "Técnicas: Excel, Word".
function marcarComoNoPdf(markdown) {
  let secao = "";
  [...markdown.children].forEach(no => {
    if (["H1", "H2"].includes(no.tagName)) secao = no.textContent.trim();
    else if (no.tagName === "P" && /resumo|perfil/i.test(secao)) no.classList.add("cv-resumo");
    else if (["UL", "OL"].includes(no.tagName) && listaEmEtiquetas(secao, no)) {
      no.classList.add("cv-etiquetas");
      [...no.children].forEach(item => {
        const { rotulo, itens } = dividirHabilidade(item.textContent);
        const partes = [];
        if (rotulo) {
          const titulo = document.createElement("strong");
          titulo.textContent = `${rotulo}: `;
          partes.push(titulo);
          item.classList.add("cv-etiquetas__grupo");
        }
        itens.forEach((texto, i) => {
          if (i) {
            const separador = document.createElement("span");
            separador.className = "cv-etiquetas__sep";
            separador.textContent = ", ";
            partes.push(separador);
          }
          const etiqueta = document.createElement("span");
          etiqueta.className = "cv-etiqueta";
          etiqueta.textContent = texto;
          partes.push(etiqueta);
        });
        item.replaceChildren(...partes);
      });
    }
  });
}

const FOTO_FORMATOS = ["image/jpeg", "image/png", "image/webp"];
const FOTO_MAX_BYTES = 10 * 1024 * 1024;
const FOTO_LARGURA_PX = 354; // 3 cm a 300 dpi
const FOTO_ALTURA_PX = 472; // 4 cm a 300 dpi
let fotoCurriculo = ""; // data URL só na memória da página: nunca entra no prompt nem é enviada

function recorte3x4(largura, altura) {
  const larguraRecorte = Math.min(largura, altura * 3 / 4);
  const alturaRecorte = larguraRecorte * 4 / 3;
  // Em foto alta, corta mais embaixo que em cima: o rosto costuma estar na parte de cima.
  return { x: (largura - larguraRecorte) / 2, y: (altura - alturaRecorte) / 4, largura: larguraRecorte, altura: alturaRecorte };
}

function atualizarFotoNoCurriculo() {
  document.querySelector("#resultado-curriculo .curriculo-foto")?.remove();
  const header = document.querySelector("#resultado-curriculo .curriculo-header");
  if (!header || !fotoCurriculo) return;
  const imagem = document.createElement("img");
  imagem.className = "curriculo-foto";
  imagem.src = fotoCurriculo;
  imagem.alt = "Foto 3x4 do candidato";
  header.prepend(imagem);
}

function definirFoto(dataUrl) {
  fotoCurriculo = dataUrl;
  const previa = el("foto-previa");
  const imagem = el("foto-previa-img");
  if (imagem) imagem.src = dataUrl;
  if (previa) previa.hidden = !dataUrl;
  atualizarFotoNoCurriculo();
}

function removerFoto() {
  const campo = el("foto");
  if (campo) campo.value = "";
  clearFieldError("foto");
  definirFoto("");
}

async function carregarFoto(arquivo) {
  clearFieldError("foto");
  if (!arquivo) return;
  const campo = el("foto");
  const recusar = mensagem => {
    if (campo) campo.value = "";
    setFieldError("foto", mensagem);
  };
  if (!FOTO_FORMATOS.includes(arquivo.type)) return recusar("Use uma foto em JPG, PNG ou WEBP");
  if (arquivo.size > FOTO_MAX_BYTES) return recusar("Use uma foto de até 10 MB");
  const url = URL.createObjectURL(arquivo);
  try {
    const imagem = new Image();
    imagem.src = url;
    await imagem.decode();
    const { x, y, largura, altura } = recorte3x4(imagem.naturalWidth, imagem.naturalHeight);
    const tela = document.createElement("canvas");
    tela.width = FOTO_LARGURA_PX;
    tela.height = FOTO_ALTURA_PX;
    const contexto = tela.getContext("2d");
    contexto.fillStyle = "#fff"; // PNG transparente não pode virar fundo preto no JPEG
    contexto.fillRect(0, 0, tela.width, tela.height);
    contexto.drawImage(imagem, x, y, largura, altura, 0, 0, tela.width, tela.height);
    // Regravar pelo canvas também descarta os metadados da foto, como o local onde foi tirada.
    definirFoto(tela.toDataURL("image/jpeg", 0.88));
  } catch {
    recusar("Não foi possível abrir essa foto. Tente outra");
  } finally {
    URL.revokeObjectURL(url);
  }
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

// Texto da folha sem o visual de etiquetas: "Técnicas: Excel, Word" numa linha, como no currículo gerado.
function textoDaFolha(caixa) {
  if (!caixa) return "";
  caixa.classList.add("cv-texto");
  try { return caixa.innerText.trim(); } finally { caixa.classList.remove("cv-texto"); }
}

async function copiarCurriculo() {
  const caixa = el("resultado-curriculo");
  const texto = textoDaFolha(caixa);
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
}

// Azul-marinho e verde-petróleo: sóbrios para o RH e ainda legíveis impressos em preto e branco.
const PDF_COR = Object.freeze({
  faixa: [27, 42, 65], destaque: [14, 124, 107], destaqueClaro: [125, 211, 192],
  etiquetaFundo: [227, 242, 239], etiquetaTexto: [11, 93, 81],
  texto: [38, 38, 38], suave: [107, 114, 128], claro: [214, 222, 232], linha: [226, 232, 240]
});

// Trechos de texto com o negrito marcado; sublistas ficam de fora porque têm seus próprios itens.
function runsDoNo(no, negrito = false, runs = []) {
  no.childNodes.forEach(filho => {
    if (filho.nodeType === Node.TEXT_NODE) runs.push({ texto: filho.textContent, negrito });
    else if (filho.nodeType === Node.ELEMENT_NODE && !["UL", "OL"].includes(filho.tagName)) {
      runsDoNo(filho, negrito || ["STRONG", "B"].includes(filho.tagName), runs);
      if (["P", "BR"].includes(filho.tagName)) runs.push({ texto: " ", negrito });
    }
  });
  return runs;
}

// Quebra trechos com negrito em linhas que cabem na largura; medir(texto, negrito) devolve a largura.
function quebrarLinhas(runs, largura, medir) {
  const linhas = [[]];
  let usado = 0;
  runs.forEach(({ texto, negrito }) => {
    String(texto).replace(/\s+/g, " ").split(/(?<= )/).forEach(palavra => {
      let linha = linhas[linhas.length - 1];
      if (linha.length && usado + medir(palavra.trimEnd(), negrito) > largura) {
        linhas.push(linha = []);
        usado = 0;
      }
      if (!linha.length && !palavra.trim()) return;
      const ultimo = linha[linha.length - 1];
      if (ultimo?.negrito === negrito) ultimo.texto += palavra;
      else linha.push({ texto: palavra, negrito });
      usado += medir(palavra, negrito);
    });
  });
  return linhas.filter(linha => linha.length).map(linha => {
    linha[linha.length - 1].texto = linha[linha.length - 1].texto.trimEnd();
    return linha;
  });
}

// "Técnicas: Excel, Word" vira { rotulo: "Técnicas", itens: ["Excel", "Word"] } para as etiquetas do PDF.
function dividirHabilidade(texto) {
  const limpo = String(texto || "").replace(/\s+/g, " ").trim();
  const partes = limpo.match(/^([^:,]{2,40}):\s*(.*)$/);
  const itens = (partes ? partes[2] : limpo).split(/[,;]/).map(item => item.trim().replace(/\.$/, "")).filter(Boolean);
  // "Inglês: intermediário" fica numa etiqueta só, em vez de um rótulo com um item.
  if (!partes || itens.length < 2) return { rotulo: "", itens: limpo ? [limpo.replace(/\.$/, "")] : [] };
  return { rotulo: partes[1].trim(), itens };
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
    botao.textContent = "Gerando...";
    botao.disabled = true;
  }
  try {
    if (!window.jspdf?.jsPDF) throw new Error("Gerador de PDF indisponível. Recarregue a página e tente novamente.");
    const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const M = 18, W = 174, PAGINA = 210, LIMITE = 278;
    const cor = (rgb, alvo = "texto") => alvo === "texto" ? doc.setTextColor(...rgb) : alvo === "fundo" ? doc.setFillColor(...rgb) : doc.setDrawColor(...rgb);
    const fonte = (tamanho, negrito = false) => { doc.setFont("helvetica", negrito ? "bold" : "normal"); doc.setFontSize(tamanho); };
    const medidor = tamanho => (texto, negrito) => { fonte(tamanho, negrito); return doc.getTextWidth(texto); };
    const passo = tamanho => tamanho * 0.52; // altura da linha em mm para a fonte em pt
    // Tudo vem da folha na tela, não do formulário: o que a pessoa editou é o que sai no PDF.
    const cabecalho = elemento.querySelector(".curriculo-header");
    const ler = seletor => cabecalho?.querySelector(seletor)?.textContent.replace(/\s+/g, " ").trim() || "";
    const nomeCv = ler("h2") || nome;
    doc.setProperties({ title: `Currículo - ${nomeCv}`, author: nomeCv, creator: "Conecta Carreira" });

    // Cabeçalho: nome, vaga e contatos numa faixa escura, com a foto à direita.
    const foto = elemento.querySelector(".curriculo-foto")?.src;
    const larguraCab = foto ? W - 38 : W;
    const contatos = [
      ...ler(".cv-contato").split("|").map(t => t.trim()).filter(Boolean)
        .map(t => ({ texto: t, url: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? `mailto:${t}` : "" })),
      ...(ler(".cv-local") ? [{ texto: ler(".cv-local"), url: "" }] : []),
      ...[...(cabecalho?.querySelectorAll(".cv-link a") || [])]
        .map(a => ({ texto: a.href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), url: a.href }))
    ];
    const separador = "   ·   ";
    fonte(9);
    const linhasContato = [[]];
    let usadoContato = 0;
    contatos.forEach(item => {
      const largura = doc.getTextWidth(item.texto);
      const espaco = linhasContato[linhasContato.length - 1].length ? doc.getTextWidth(separador) : 0;
      if (espaco && usadoContato + espaco + largura > larguraCab) { linhasContato.push([]); usadoContato = largura; }
      else usadoContato += espaco + largura;
      linhasContato[linhasContato.length - 1].push(item);
    });
    fonte(24, true);
    const linhasNome = doc.splitTextToSize(nomeCv, larguraCab);
    const objetivo = ler(".cv-objetivo");
    fonte(11.5);
    const linhasObjetivo = objetivo ? doc.splitTextToSize(objetivo, larguraCab) : [];
    let y = 17 + (linhasNome.length - 1) * 10;
    const yObjetivo = y + 7.5;
    if (linhasObjetivo.length) y = yObjetivo + (linhasObjetivo.length - 1) * 6;
    const yContato = y + 7.5;
    if (contatos.length) y = yContato + (linhasContato.length - 1) * 5;
    const alturaFaixa = Math.max(y + 9, foto ? 56 : 0);

    cor(PDF_COR.faixa, "fundo");
    doc.rect(0, 0, PAGINA, alturaFaixa, "F");
    cor(PDF_COR.destaque, "fundo");
    doc.rect(0, alturaFaixa, PAGINA, 1.2, "F");
    fonte(24, true);
    cor([255, 255, 255]);
    doc.text(linhasNome, M, 17, { lineHeightFactor: 1.2 });
    fonte(11.5);
    cor(PDF_COR.destaqueClaro);
    if (linhasObjetivo.length) doc.text(linhasObjetivo, M, yObjetivo, { lineHeightFactor: 1.45 });
    fonte(9);
    linhasContato.forEach((linha, i) => {
      let x = M;
      linha.forEach((item, j) => {
        if (j) { cor(PDF_COR.destaqueClaro); doc.text(separador, x, yContato + i * 5); x += doc.getTextWidth(separador); }
        cor(PDF_COR.claro);
        if (item.url) doc.textWithLink(item.texto, x, yContato + i * 5, { url: item.url });
        else doc.text(item.texto, x, yContato + i * 5);
        x += doc.getTextWidth(item.texto);
      });
    });
    if (foto) {
      cor([255, 255, 255], "fundo");
      doc.rect(PAGINA - M - 31, 7, 32, 42, "F");
      doc.addImage(foto, "JPEG", PAGINA - M - 30, 8, 30, 40);
    }

    // Corpo: cada seção com título marcado, listas com marcador e habilidades em etiquetas.
    y = alturaFaixa + 13;
    const garantir = altura => { if (y + altura > LIMITE) { doc.addPage(); y = 24; } };
    const escreverTrechos = (runs, x, largura, tamanho, rgb) => {
      quebrarLinhas(runs, largura, medidor(tamanho)).forEach(linha => {
        garantir(passo(tamanho));
        let cx = x;
        linha.forEach(trecho => {
          fonte(tamanho, trecho.negrito);
          cor(rgb);
          doc.text(trecho.texto, cx, y);
          cx += doc.getTextWidth(trecho.texto);
        });
        y += passo(tamanho);
      });
    };
    let primeiroTitulo = true;
    const titulo = texto => {
      if (!primeiroTitulo) y += 3;
      primeiroTitulo = false;
      garantir(20);
      fonte(11, true);
      cor(PDF_COR.destaque);
      // Sem espaço extra entre letras: sistemas que leem currículos leriam "R E S U M O".
      doc.text(texto.toUpperCase(), M, y);
      cor(PDF_COR.linha, "linha");
      doc.setLineWidth(0.3);
      doc.line(M, y + 2.2, M + W, y + 2.2);
      y += 8.5;
    };
    const desenharLista = (lista, nivel = 0) => {
      [...lista.children].forEach((item, i) => {
        const x = M + nivel * 5;
        garantir(passo(10) + 1);
        cor(PDF_COR.destaque, "fundo");
        cor(PDF_COR.destaque);
        if (lista.tagName === "OL") { fonte(10, true); doc.text(`${i + 1}.`, x, y); }
        else doc.circle(x + 1.2, y - 1.2, nivel ? 0.5 : 0.7, "F");
        escreverTrechos(runsDoNo(item), x + 5, W - nivel * 5 - 5, 10, PDF_COR.texto);
        y += 1.2;
        item.querySelectorAll(":scope > ul, :scope > ol").forEach(sub => desenharLista(sub, nivel + 1));
      });
      y += 1.5;
    };
    const desenharEtiquetas = lista => {
      const grupos = [];
      [...lista.children].forEach(item => {
        const { rotulo, itens } = dividirHabilidade(item.textContent);
        const anterior = grupos[grupos.length - 1];
        if (!rotulo && anterior && !anterior.rotulo) anterior.itens.push(...itens);
        else grupos.push({ rotulo, itens });
      });
      grupos.forEach(({ rotulo, itens }) => {
        if (rotulo) { garantir(13); fonte(9.5, true); cor(PDF_COR.texto); doc.text(rotulo, M, y); y += 5.5; }
        garantir(8);
        let x = M;
        itens.forEach(item => {
          fonte(9);
          const largura = doc.getTextWidth(item) + 6;
          if (x > M && x + largura > M + W) { x = M; y += 8; garantir(8); }
          cor(PDF_COR.etiquetaFundo, "fundo");
          doc.roundedRect(x, y - 4.4, largura, 6.4, 3.2, 3.2, "F");
          cor(PDF_COR.etiquetaTexto);
          doc.text(item, x + 3, y);
          x += largura + 2.5;
        });
        y += 9.5;
      });
    };

    let secao = "";
    for (const no of elemento.querySelector(".curriculo-markdown")?.children || []) {
      const tag = no.tagName;
      if (["H1", "H2"].includes(tag)) {
        secao = no.textContent.trim();
        titulo(secao);
      } else if (/^H[3-6]$/.test(tag)) {
        garantir(14);
        escreverTrechos([{ texto: no.textContent, negrito: true }], M, W, 10.5, PDF_COR.faixa);
        y += 0.8;
      } else if (["UL", "OL"].includes(tag)) {
        if (listaEmEtiquetas(secao, no)) desenharEtiquetas(no);
        else desenharLista(no);
      } else if (tag === "TABLE") {
        [...no.rows].forEach((linha, i) => escreverTrechos([{ texto: [...linha.cells].map(c => c.textContent.trim()).join("   |   "), negrito: i === 0 }], M, W, 10, PDF_COR.texto));
        y += 2.5;
      } else if (no.textContent.trim()) {
        const resumo = tag === "P" && /resumo|perfil/i.test(secao);
        const inicio = y, pagina = doc.getNumberOfPages();
        const tamanho = resumo ? 10.5 : 10;
        escreverTrechos(runsDoNo(no), resumo ? M + 4 : M, resumo ? W - 4 : W, tamanho, tag === "BLOCKQUOTE" ? PDF_COR.suave : PDF_COR.texto);
        if (resumo && doc.getNumberOfPages() === pagina) {
          cor(PDF_COR.destaque, "fundo");
          doc.rect(M, inicio - 3.8, 0.9, y - passo(tamanho) - inicio + 5, "F");
        }
        y += 2.5;
      }
    }

    const total = doc.getNumberOfPages();
    for (let pagina = 1; pagina <= total; pagina++) {
      doc.setPage(pagina);
      if (pagina > 1) { cor(PDF_COR.destaque, "fundo"); doc.rect(0, 0, PAGINA, 3, "F"); }
      cor(PDF_COR.linha, "linha");
      doc.setLineWidth(0.3);
      doc.line(M, 286, M + W, 286);
      fonte(8);
      cor(PDF_COR.suave);
      doc.text(nomeCv, M, 291);
      doc.text(`Página ${pagina} de ${total}`, M + W, 291, { align: "right" });
    }
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
  btn.textContent = editando ? "Salvar edição" : "Editar";
  if (caixa) {
    caixa.contentEditable = editando ? "true" : "false";
    caixa.classList.toggle("editando", editando);
  }
  if (editando) {
    caixa.focus?.();
    toastInfo("Modo edição", "Clique no texto e corrija. Depois clique em Salvar edição.");
  }
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
  const texto = textoDaFolha(el("resultado-curriculo"));
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
  removerStorageLegado();
  if (tipo === "curriculo") {
    el("area-vaga")?.remove();
    contextoVaga = "";
    removerFoto();
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
let contextoVaga = "";
let contextoEntrevista = "";
let operacaoEntrevista = 0;

function definirRotuloBotaoIniciar(texto) {
  const botao = el("btn-iniciar");
  if (!botao) return;
  botao.textContent = texto;
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
  if (estado === ESTADOS_ENTREVISTA.COMPLETED) definirRotuloBotaoIniciar("Começar novamente");
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
  mensagem.className = `msg ${quem === "ia" ? "msg-ia" : "msg-user"}`;
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
  mensagem.className = "msg msg-ia msg-digitando";
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
  mensagem.className = "msg msg-ia msg-erro";
  mensagem.setAttribute("role", "alert");
  const textoErro = document.createElement("p");
  textoErro.textContent = String(texto || "Não foi possível concluir a ação.");
  mensagem.appendChild(textoErro);
  if (typeof acao === "function") {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "btn btn--secondary";
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

function montarContextoVaga(snapshot) {
  // Limite para sobrar espaço ao histórico dentro do máximo de 12000 caracteres do prompt.
  const dados = [
    `Formação: ${snapshot.formacao || "não informada"}`,
    `Experiências: ${snapshot.experiencia || "não informadas"}`,
    `Habilidades e cursos: ${snapshot.habilidades || "não informados"}`,
    `Descrição da vaga: ${snapshot.descricaoVaga || "não informada"}`
  ].join("\n").slice(0, 3000);
  return `\nUse estes dados para fazer perguntas específicas para esta vaga e este candidato, sem presumir nada além deles:\n${dados}\n`;
}

function promptPrimeiraPerguntaEntrevista(area, contexto = "") {
  return `Você é um orientador de carreira e recrutador experiente, simulando uma entrevista para **${area}** com um estudante do ensino médio ou candidato ao primeiro emprego.
${contexto}
REGRAS:
- Faça APENAS a 1ª pergunta, direta, acolhedora e fácil de responder
- Não presuma experiência profissional. Aceite exemplos da escola, cursos, projetos, voluntariado, família e atividades do dia a dia
- Comece pedindo uma apresentação breve e perguntando o que despertou o interesse pela área
- MÁXIMO 2 frases, sem linguagem corporativa complicada
- Retorne APENAS a pergunta, sem introduções nem "Aqui está a pergunta:"`;
}

function promptProximaPerguntaEntrevista(area, historico, numero, contexto = "") {
  return `Você é um orientador de carreira conduzindo uma entrevista para **${area}** com um estudante ou candidato ao primeiro emprego.
${contexto}
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

function promptFeedbackEntrevista(area, historico, contexto = "") {
  return `Você é um orientador de carreira acolhedor. A entrevista para **${area}** foi concluída por um estudante ou candidato ao primeiro emprego.
${contexto}
Histórico completo:
${[...historico].join("\n")}

Dê um feedback final construtivo e fácil de entender:
1. Dois pontos fortes percebidos nas respostas, sempre citando exemplos do histórico
2. Duas dicas práticas e possíveis de aplicar, sem tratar a falta de experiência como defeito
3. Uma sugestão de resposta ou atitude para continuar treinando
4. Encerramento motivador e realista

Formato: use os títulos "## Pontos fortes", "## Para praticar" e "## Próximo passo", cada um em linha própria. Parágrafos curtos, tom encorajador, sem dar nota ou reprovar. MÁXIMO 220 palavras.`;
}

function solicitarEntrevista(prompt, tipo, token, concluir) {
  if (token !== operacaoEntrevista) return;

  const estadoSolicitacao = tipo === "feedback" ? ESTADOS_ENTREVISTA.LOADING_FEEDBACK : ESTADOS_ENTREVISTA.LOADING_QUESTION;
  definirEstadoEntrevista(estadoSolicitacao);
  const controller = new AbortController();
  abortControllerEntrevista = controller;
  const digitando = mostrarDigitando();
  const ativo = () => token === operacaoEntrevista && !controller.signal.aborted;
  const aoTrecho = criarAtualizadorDigitando(digitando, ativo);

  return chamarGemini(prompt, aoTrecho, {
    maxTokens: tipo === "feedback" ? 1024 : 400,
    temperature: 0.6,
    signal: controller.signal,
    aoCortar: () => toastWarning("Resposta incompleta", "A IA atingiu o limite de tamanho e o texto foi cortado.")
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
  contextoEntrevista = selectArea?.selectedOptions[0]?.id === "area-vaga" ? contextoVaga : "";
  historicoChat = [];
  perguntaAtual = 1;
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
  adicionarMensagem(`Ótimo! Vamos simular uma entrevista para **${areaEntrevista}**. Serão ${TOTAL_PERGUNTAS} perguntas e um feedback no final.`, "ia");
  atualizarProgresso();
  const prompt = promptPrimeiraPerguntaEntrevista(areaEntrevista, contextoEntrevista);
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
    const prompt = promptProximaPerguntaEntrevista(areaEntrevista, historicoChat, numero, contextoEntrevista);
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

  perguntaAtual = TOTAL_PERGUNTAS + 1;
  atualizarProgresso();
  const prompt = promptFeedbackEntrevista(areaEntrevista, historicoChat, contextoEntrevista);
  return solicitarEntrevista(prompt, "feedback", token, (feedback, bolha) => {
    if (token !== operacaoEntrevista) {
      bolha?.remove();
      return;
    }
    bolha?.classList.remove("msg-digitando");
    historicoChat.push(`Feedback: ${feedback}`);
    definirEstadoEntrevista(ESTADOS_ENTREVISTA.COMPLETED);
    anunciarRecrutador(feedback);
    atualizarProgresso();
    toastSuccess("Entrevista finalizada!", "Confira seu feedback abaixo");
  });
}

function criarEmptyStateEntrevista() {
  const empty = document.createElement("div");
  empty.className = "vazio";
  empty.id = "empty-state";
  const title = document.createElement("p");
  title.className = "vazio__titulo";
  title.textContent = "A conversa aparece aqui";
  const description = document.createElement("p");
  description.textContent = "Escolha a área e comece. O recrutador virtual faz uma pergunta de cada vez.";
  empty.append(title, description);
  return empty;
}

function resetarEntrevista() {
  operacaoEntrevista += 1;
  abortControllerEntrevista?.abort();
  abortControllerEntrevista = null;
  historicoChat = [];
  perguntaAtual = 0;
  areaEntrevista = "";
  contextoEntrevista = "";
  const chat = el("chat-box");
  if (chat) chat.replaceChildren(criarEmptyStateEntrevista());
  const resposta = el("resposta");
  if (resposta) resposta.value = "";
  definirEstadoEntrevista(ESTADOS_ENTREVISTA.IDLE);
  atualizarProgresso();
  document.querySelectorAll(".progress-step").forEach(step => step.classList.remove("active", "completed"));
  const area = el("area");
  if (area) area.disabled = false;
}

function treinarParaVaga() {
  const snapshot = ultimoSnapshotCurriculo;
  const select = el("area");
  if (!snapshot || !select) {
    toastWarning("Nada para treinar", "Gere um currículo primeiro");
    return;
  }
  resetarEntrevista();
  let opcao = el("area-vaga");
  if (!opcao) {
    opcao = document.createElement("option");
    opcao.id = "area-vaga";
    select.prepend(opcao);
  }
  opcao.value = snapshot.objetivo;
  opcao.textContent = `Esta vaga: ${snapshot.objetivo}`;
  opcao.selected = true;
  contextoVaga = montarContextoVaga(snapshot);
  ativarAba("entrevista");
  el("ferramentas")?.scrollIntoView({ block: "start" });
  return iniciarEntrevista();
}

function cancelarEntrevista() {
  if (estadoEntrevista === ESTADOS_ENTREVISTA.IDLE) return;
  resetarEntrevista();
  toastInfo("Encerrado", "Simulação de entrevista cancelada");
}

["nome", "contato", "linkedin", "github", "formacao", "experiencia", "habilidades", "objetivo"].forEach(id => {
  el(id)?.addEventListener("input", () => clearFieldError(id));
});
el("habilidades")?.addEventListener("input", () => clearFieldError("formacao"));
el("foto")?.addEventListener("change", evento => carregarFoto(evento.target.files?.[0]));

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

const botoesHero = document.querySelectorAll(".btn-tab");

// As abas em si ficam com o system.js do kit (role="tab").
function ativarAba(target) {
  el(`tab-${target}`)?.click();
}

botoesHero.forEach(botao => {
  botao.addEventListener("click", evento => {
    evento.preventDefault();
    ativarAba(botao.dataset.tab);
    const ferramentas = el("ferramentas");
    const reduzir = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    ferramentas?.scrollIntoView({ behavior: reduzir ? "auto" : "smooth", block: "start" });
  });
});

removerStorageLegado();
