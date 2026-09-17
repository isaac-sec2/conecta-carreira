/* ============ TOAST NOTIFICATIONS ============ */
function showToast(tipo, titulo, mensagem = "") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast--${tipo}`;
  const icons = {
    success: "check-circle",
    error: "x-circle",
    warning: "alert-triangle",
    info: "info"
  };
  toast.innerHTML = `
    <span class="toast__icon" aria-hidden="true"><i data-lucide="${icons[tipo]}"></i></span>
    <div class="toast__content">
      <div class="toast__title">${titulo}</div>
      ${mensagem ? `<div class="toast__message">${mensagem}</div>` : ""}
    </div>
    <button class="toast__close" aria-label="Fechar" onclick="this.parentElement.remove()"><i data-lucide="x"></i></button>
  `;
  container.appendChild(toast);
  if (window.lucide) lucide.createIcons();
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add("removing");
      setTimeout(() => toast.remove(), 200);
    }
  }, 5000);
}

function toastSuccess(titulo, msg) { showToast("success", titulo, msg); }
function toastError(titulo, msg) { showToast("error", titulo, msg); }
function toastInfo(titulo, msg) { showToast("info", titulo, msg); }
function toastWarning(titulo, msg) { showToast("warning", titulo, msg); }

/* ============ FORM VALIDATION ============ */
function setFieldError(fieldId, message) {
  const group = document.getElementById(fieldId).closest(".form-group");
  const errorEl = document.getElementById(`err-${fieldId}`);
  group.classList.add("has-error");
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearFieldError(fieldId) {
  const group = document.getElementById(fieldId).closest(".form-group");
  const errorEl = document.getElementById(`err-${fieldId}`);
  group.classList.remove("has-error");
  errorEl.hidden = true;
}

function validateCurriculoForm() {
  let valid = true;
  const nome = document.getElementById("nome").value.trim();
  const objetivo = document.getElementById("objetivo").value.trim();
  const contato = document.getElementById("contato").value.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^\(?\d{2}\)?\s?\d{4,5}-?\d{4}$/;

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

  if (contato && !emailRegex.test(contato) && !phoneRegex.test(contato)) {
    setFieldError("contato", "Email ou telefone inválido");
    valid = false;
  } else {
    clearFieldError("contato");
  }

  return valid;
}

/* ============ LOCALSTORAGE HISTORY ============ */
const STORAGE_KEYS = {
  CURRICULOS: "conecta-curriculos",
  ENTREVISTAS: "conecta-entrevistas"
};

function salvarHistorico(tipo, dados) {
  try {
    const key = tipo === "curriculo" ? STORAGE_KEYS.CURRICULOS : STORAGE_KEYS.ENTREVISTAS;
    const historico = JSON.parse(localStorage.getItem(key) || "[]");
    historico.unshift({ ...dados, timestamp: Date.now() });
    if (historico.length > 20) historico.pop();
    localStorage.setItem(key, JSON.stringify(historico));
  } catch (e) {
    console.warn("Falha ao salvar histórico:", e);
  }
}

function obterHistorico(tipo) {
  try {
    const key = tipo === "curriculo" ? STORAGE_KEYS.CURRICULOS : STORAGE_KEYS.ENTREVISTAS;
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch { return []; }
}

/* ============ FORMATAÇÃO ============ */
function markdownParaHtml(texto) {
  return DOMPurify.sanitize(marked.parse(texto));
}

function normalizarPerfil(valor, base) {
  const texto = String(valor || "").trim().replace(/^@/, "");
  if (!texto) return "";
  if (/^https?:\/\//i.test(texto)) return texto;
  if (/^(www\.)?(linkedin\.com|github\.com)\//i.test(texto)) return `https://${texto}`;
  return `${base}${texto.replace(/^\/+/, "")}`;
}

function escaparHtml(texto) {
  return String(texto || "").replace(/[&<>'"]/g, caractere => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[caractere]));
}

/* ============ FERRAMENTA 1: GERADOR DE CURRÍCULO ============ */
let gerandoCurriculo = false;
let abortControllerCurriculo = null;
let ultimoMarkdownCurriculo = "";
let ultimoPromptCurriculo = null;
let progressoTimer = null;
let progressoInicio = 0;

/* ---- Erro com botão Tentar novamente ---- */
function mostrarErroCurriculo(mensagem) {
  const box = document.getElementById("erro-curriculo");
  const msg = document.getElementById("erro-curriculo-msg");
  if (!box || !msg) { toastError("Erro ao gerar", mensagem); return; }
  msg.textContent = mensagem;
  box.hidden = false;
  box.focus?.();
}

function esconderErroCurriculo() {
  const box = document.getElementById("erro-curriculo");
  if (box) box.hidden = true;
}

function tentarNovamenteCurriculo() {
  esconderErroCurriculo();
  gerarCurriculo();
}

/* ---- Progresso durante respostas longas ---- */
function iniciarProgressoCurriculo(atualizadorPreview) {
  const wrap = document.getElementById("progress-curriculo");
  const bar = document.getElementById("progress-curriculo-bar");
  const label = document.getElementById("progress-curriculo-label");
  progressoInicio = Date.now();
  if (wrap) wrap.hidden = false;
  if (bar) bar.style.width = "5%";
  clearInterval(progressoTimer);
  progressoTimer = setInterval(() => {
    const seg = Math.floor((Date.now() - progressoInicio) / 1000);
    if (label) label.textContent = `Gerando seu currículo… ${seg}s — a IA está escrevendo, aguarde`;
    // Barra indeterminada: avança devagar até 90%
    if (bar) {
      const atual = parseFloat(bar.style.width) || 5;
      bar.style.width = Math.min(90, atual + 2) + "%";
    }
  }, 500);
  // Retorna callback de streaming p/ mostrar prévia ao vivo
  let primeira = true;
  return (trecho, acumulado) => {
    if (primeira) {
      primeira = false;
      const caixa = document.getElementById("resultado-curriculo");
      caixa.style.display = "block";
      document.getElementById("skeleton-curriculo").hidden = true;
    }
    if (atualizadorPreview) atualizadorPreview(acumulado);
    if (bar) bar.style.width = Math.min(90, (parseFloat(bar.style.width) || 5) + 0.5) + "%";
  };
}

function pararProgressoCurriculo(ok) {
  clearInterval(progressoTimer);
  const wrap = document.getElementById("progress-curriculo");
  const bar = document.getElementById("progress-curriculo-bar");
  const label = document.getElementById("progress-curriculo-label");
  if (bar) bar.style.width = ok ? "100%" : "0%";
  if (label && ok) label.textContent = "Pronto!";
  setTimeout(() => { if (wrap) wrap.hidden = true; }, ok ? 600 : 0);
}

async function gerarCurriculo() {
  if (gerandoCurriculo) return;

  if (!validateCurriculoForm()) {
    toastError("Preencha os campos obrigatórios", "Verifique os campos marcados em vermelho");
    return;
  }

  const nome = document.getElementById("nome").value.trim();
  const contato = document.getElementById("contato").value.trim();
  const linkedin = normalizarPerfil(document.getElementById("linkedin").value, "https://www.linkedin.com/in/");
  const github = normalizarPerfil(document.getElementById("github").value, "https://github.com/");
  const cidade = document.getElementById("cidade").value.trim();
  const estado = document.getElementById("estado").value.trim();
  const idioma = document.getElementById("idioma").value.trim();
  const formacao = document.getElementById("formacao").value.trim();
  const experiencia = document.getElementById("experiencia").value.trim();
  const habilidades = document.getElementById("habilidades").value.trim();
  const objetivo = document.getElementById("objetivo").value.trim();
  const descricaoVaga = document.getElementById("descricao-vaga").value.trim();

  const caixa = document.getElementById("resultado-curriculo");
  const skeleton = document.getElementById("skeleton-curriculo");
  const botao = document.getElementById("btn-gerar");
  const btnCancelar = document.getElementById("btn-cancelar-curriculo");

  gerandoCurriculo = true;
  abortControllerCurriculo = new AbortController();
  const textoOriginalBotao = botao.innerHTML;
  botao.disabled = true;
  botao.innerHTML = "Gerando…";
  btnCancelar.hidden = false;
  caixa.style.display = "none";
  skeleton.hidden = false;
  esconderErroCurriculo();
  document.getElementById("botoes-resultado").style.display = "none";

  const prompt = `Atue como um profissional experiente de recrutamento e seleção, especialista em primeiro emprego, estágio, aprendizagem e recolocação. Escreva um currículo profissional em Markdown, com conteúdo desenvolvido e específico para a vaga.

Analise a descrição da vaga e extraia mentalmente as principais competências técnicas, responsabilidades e palavras-chave. Compare esses requisitos com os dados reais do candidato.
Considere que o candidato pode ser estudante do ensino médio, estar buscando o primeiro emprego ou ainda estar construindo experiência. Nesse caso, formação, projetos escolares, cursos, trabalhos voluntários, atividades informais, interesses práticos e potencial também são relevantes.

FORMATO OBRIGATÓRIO:
## Resumo Profissional
Um resumo com 4 a 6 frases completas, específico para a vaga.
## Formação Acadêmica
Use bullets com curso, instituição e situação.
## Experiência Profissional
Use bullets com atividades e aprendizados concretos. Se não houver experiência formal, escreva "Ainda não possui experiência formal" e siga para projetos.
## Projetos Relevantes
Se não houver experiência formal, crie até 2 projetos acadêmicos ou autodidatas plausíveis usando SOMENTE as habilidades e a formação informadas. Para cada projeto, escreva 2 a 4 bullets com o que foi feito e aprendido.
## Habilidades
Separe habilidades técnicas e comportamentais em bullets.
## Certificações e Cursos
Inclua somente os que foram informados.
## Idiomas
Inclua somente o idioma informado pelo candidato. Se não houver idioma informado, omita esta seção completamente.
## Pontos fortes para a vaga
Quando houver descrição da vaga, liste de 2 a 5 combinações entre o perfil e a vaga, incluindo potencial e conhecimentos em desenvolvimento quando fizer sentido. Quando não houver descrição, omita esta seção.
## Próximos passos para se preparar
Quando houver descrição da vaga, liste de 2 a 4 habilidades ou experiências que o candidato pode desenvolver. Explique cada ponto de forma acolhedora e prática. Quando não houver descrição, omita esta seção.

REGRAS:
- Retorne somente o Markdown do currículo, sem comentários antes ou depois.
- Não escreva frases genéricas como "profissional dedicado" sem explicar evidências concretas.
- Não invente empresas, empregos, certificados, idiomas, tecnologias, números ou experiências.
- Pode transformar os dados em descrições profissionais melhores, mas sem criar fatos.
- Nunca use linguagem de julgamento, como "não tem perfil", "inexperiente", "falta", "ausência" ou "não atende". Prefira "pode desenvolver", "ainda não foi informado" ou "seria interessante praticar".
- Não compare um estudante com um profissional sênior. Se a vaga exigir experiência que o candidato ainda não possui, apresente isso como um objetivo de desenvolvimento, sem desqualificá-lo.
- Reescreva experiências, projetos escolares, cursos e atividades com verbos de ação fortes e incorpore palavras-chave da vaga somente quando forem compatíveis com os dados reais.
- Não inclua LinkedIn ou GitHub: esses links serão inseridos separadamente.

DADOS DO CANDIDATO:
Nome: ${nome}
Contato: ${contato || "Não informado"}
Vaga desejada: ${objetivo}
Formação: ${formacao || "Não informada"}
Experiências: ${experiencia || "Nenhuma formal"}
Habilidades e cursos: ${habilidades || "Não informadas"}`;
  const contextoVaga = `
DESCRIÇÃO DA VAGA:
${descricaoVaga || "Não informada. Gere um currículo geral para a vaga desejada."}`;
  const dadosComplementares = `
Cidade: ${cidade || "Não informada"}
Estado: ${estado || "Não informado"}
Idioma: ${idioma || "Não informado"}`;
  const promptCompleto = `${prompt}
${contextoVaga}
${dadosComplementares}`;

  try {
    const aoTrecho = iniciarProgressoCurriculo((acumulado) => {
      // Prévia ao vivo (texto puro, sem markdown pesado a cada chunk)
      caixa.innerHTML = `<div class="curriculo-header"><h2>${escaparHtml(nome)}</h2></div>`
        + `<div class="curriculo-markdown"><p>${escaparHtml(acumulado.slice(-600))}…</p></div>`;
    });
    const respostaMarkdown = await chamarGemini(promptCompleto, aoTrecho, { maxTokens: 3072, temperature: 0.55, signal: abortControllerCurriculo.signal, retries: 3 });
    ultimoMarkdownCurriculo = respostaMarkdown;
    ultimoPromptCurriculo = promptCompleto;
    renderCurriculoMarkdown(respostaMarkdown, caixa, { nome, contato, objetivo, linkedin, github, cidade, estado });
    caixa.style.display = "block";
    caixa.setAttribute("tabindex", "-1");
    caixa.focus?.({ preventScroll: true });
    skeleton.hidden = true;
    pararProgressoCurriculo(true);
    document.getElementById("botoes-resultado").style.display = "flex";
    atualizarBotaoEditar(false);
    toastSuccess("Currículo gerado!", "Revise, edite se quiser, e baixe em PDF ou texto");

    // Salvar no histórico
    salvarHistorico("curriculo", { nome, objetivo, descricaoVaga, markdown: respostaMarkdown, html: caixa.innerHTML });

  } catch (erro) {
    pararProgressoCurriculo(false);
    if (erro.name === "AbortError" || String(erro.message || "").includes("cancelada")) {
      toastInfo("Cancelado", "Geração do currículo cancelada");
    } else {
      const msg = (typeof traduzirErro === "function") ? traduzirErro(erro.message, erro.status) : erro.message;
      mostrarErroCurriculo(msg);
      toastError("Erro ao gerar", "Veja a mensagem acima do resultado e tente de novo");
    }
    skeleton.hidden = true;
  } finally {
    gerandoCurriculo = false;
    botao.disabled = false;
    botao.innerHTML = textoOriginalBotao;
    if (window.lucide) lucide.createIcons();
    btnCancelar.hidden = true;
  }
}

function parseCurriculoJson(texto) {
  try {
    // Tentar extrair JSON do texto (pode vir com texto extra)
    const match = texto.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return JSON.parse(texto);
  } catch {
    // Fallback: criar estrutura mínima
    return {
      header: { nome: "", contato: "", objetivo: "" },
      resumo: "Erro ao processar resposta da IA. Tente novamente.",
      formacao: [],
      experiencias: [],
      habilidades: { tecnicas: [], comportamentais: [] }
    };
  }
}

function renderCurriculoMarkdown(texto, caixa, dados) {
  const links = [
    dados.linkedin ? `<p><a href="${escaparHtml(dados.linkedin)}" target="_blank" rel="noopener">LinkedIn: ${escaparHtml(dados.linkedin)}</a></p>` : "",
    dados.github ? `<p><a href="${escaparHtml(dados.github)}" target="_blank" rel="noopener">GitHub: ${escaparHtml(dados.github)}</a></p>` : ""
  ].join("");
  const contato = dados.contato ? `<p>${escaparHtml(dados.contato)}</p>` : "";
  const objetivo = dados.objetivo ? `<p><strong>Objetivo: ${escaparHtml(dados.objetivo)}</strong></p>` : "";
  const localizacao = [dados.cidade, dados.estado].filter(Boolean).map(escaparHtml).join(" - ");
  const localizacaoHtml = localizacao ? `<p>${localizacao}</p>` : "";

  caixa.innerHTML = `
    <div class="curriculo-header">
      <h2>${escaparHtml(dados.nome)}</h2>
      ${contato}
      ${objetivo}
      ${localizacaoHtml}
      ${links}
    </div>
    <div class="curriculo-markdown">${markdownParaHtml(texto)}</div>
  `;
  if (window.lucide) lucide.createIcons();
}

function renderCurriculo(c, caixa) {
  const header = c.header || {};
  const formacao = c.formacao || [];
  const experiencias = c.experiencias || [];
  const habilidades = c.habilidades || { tecnicas: [], comportamentais: [] };
  const certificacoes = c.certificacoes || [];
  const projetos = c.projetos || [];
  const idiomas = c.idiomas || [];

  let html = `
    <div class="curriculo-header" style="text-align:center; margin-bottom:24px; padding-bottom:16px; border-bottom:1px solid var(--border)">
      <h2 style="color:var(--primary); margin-bottom:4px; font-size:1.5rem">${header.nome || "Seu Nome"}</h2>
      <p style="color:var(--muted-foreground); font-size:0.9rem; margin-bottom:8px">${header.contato || ""}</p>
      <p style="font-weight:600; color:var(--primary); font-size:0.95rem">${header.objetivo || ""}</p>
      ${header.linkedin ? `<p style="font-size:0.85rem; color:var(--muted-foreground); margin-top:4px"><i data-lucide="linkedin" style="width:14px;height:14px;vertical-align:middle;margin-right:4px"></i>${header.linkedin}</p>` : ""}
      ${header.github ? `<p style="font-size:0.85rem; color:var(--muted-foreground); margin-top:4px"><i data-lucide="github" style="width:14px;height:14px;vertical-align:middle;margin-right:4px"></i>${header.github}</p>` : ""}
    </div>
  `;

  if (c.resumo && c.resumo.trim()) {
    html += `<section class="curriculo-section"><h3>Resumo Profissional</h3><p>${c.resumo}</p></section>`;
  }

  if (formacao.length) {
    html += `<section class="curriculo-section"><h3>Formação Acadêmica</h3><ul>`;
    formacao.forEach(f => {
      if (f.curso && f.curso.trim()) {
        html += `<li><strong>${f.curso}</strong> — ${f.instituicao || ""}${f.ano ? ` (${f.ano})` : ""}${f.status ? ` — ${f.status}` : ""}</li>`;
      }
    });
    html += `</ul></section>`;
  }

  if (experiencias.length) {
    html += `<section class="curriculo-section"><h3>Experiências Profissionais</h3>`;
    experiencias.forEach(e => {
      if (e.cargo && e.cargo.trim()) {
        html += `<div class="exp-item"><p><strong>${e.cargo}</strong> — ${e.empresa || ""}${e.periodo ? ` (${e.periodo})` : ""}</p>`;
        if (e.atividades?.length) {
          html += `<ul>${e.atividades.map(a => a && a.trim() ? `<li>${a}</li>` : "").join("")}</ul>`;
        }
        html += `</div>`;
      }
    });
    html += `</section>`;
  }

  if (projetos.length) {
    html += `<section class="curriculo-section"><h3>Projetos Relevantes</h3><ul>`;
    projetos.forEach(p => {
      if (p.nome && p.nome.trim()) {
        html += `<li><strong>${p.nome}</strong>${p.descricao ? ` — ${p.descricao}` : ""}${p.tecnologias ? ` [${p.tecnologias}]` : ""}${p.link ? ` <a href="${p.link}" target="_blank" rel="noopener"><i data-lucide="external-link" style="width:12px;height:12px;vertical-align:middle"></i></a>` : ""}</li>`;
      }
    });
    html += `</ul></section>`;
  }

  if (certificacoes.length) {
    html += `<section class="curriculo-section"><h3>Certificações</h3><ul>`;
    certificacoes.forEach(cert => {
      if (cert.nome && cert.nome.trim()) {
        html += `<li><strong>${cert.nome}</strong>${cert.emissor ? ` — ${cert.emissor}` : ""}${cert.ano ? ` (${cert.ano})` : ""}${cert.link ? ` <a href="${cert.link}" target="_blank" rel="noopener"><i data-lucide="external-link" style="width:12px;height:12px;vertical-align:middle"></i></a>` : ""}</li>`;
      }
    });
    html += `</ul></section>`;
  }

  if (habilidades.tecnicas.length || habilidades.comportamentais.length) {
    html += `<section class="curriculo-section"><h3>Habilidades</h3>`;
    if (habilidades.tecnicas.length) {
      html += `<p><strong>Técnicas:</strong> ${habilidades.tecnicas.filter(h => h && h.trim()).join(", ")}</p>`;
    }
    if (habilidades.comportamentais.length) {
      html += `<p><strong>Comportamentais:</strong> ${habilidades.comportamentais.filter(h => h && h.trim()).join(", ")}</p>`;
    }
    html += `</section>`;
  }

  if (idiomas.length) {
    html += `<section class="curriculo-section"><h3>Idiomas</h3><ul>`;
    idiomas.forEach(i => {
      if (i.nome && i.nome.trim()) {
        html += `<li>${i.nome}${i.nivel ? ` — ${i.nivel}` : ""}</li>`;
      }
    });
    html += `</ul></section>`;
  }

  caixa.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function copiarCurriculo() {
  const texto = document.getElementById("resultado-curriculo").innerText;
  navigator.clipboard.writeText(texto);
  toastSuccess("Copiado!", "Currículo copiado para a área de transferência");
}

function baixarPDF() {
  const elemento = document.getElementById("resultado-curriculo");
  const nome = document.getElementById("nome").value.trim() || "curriculo";
  const btnPdf = document.getElementById("btn-pdf");
  const textoOriginal = btnPdf.innerHTML;
  btnPdf.innerHTML = '<i data-lucide="loader" aria-hidden="true" style="animation: spin 1s linear infinite"></i> Gerando...';
  btnPdf.disabled = true;
  if (window.lucide) lucide.createIcons();

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
    btnPdf.innerHTML = textoOriginal;
    btnPdf.disabled = false;
    if (window.lucide) lucide.createIcons();
    toastSuccess("PDF gerado!", "Currículo salvo como PDF");
  } catch (err) {
    btnPdf.innerHTML = textoOriginal;
    btnPdf.disabled = false;
    if (window.lucide) lucide.createIcons();
    toastError("Erro ao gerar PDF", err.message);
  }
}

function cancelarGeracao() {
  if (abortControllerCurriculo) {
    abortControllerCurriculo.abort();
  }
}

/* ---- Editar currículo antes de baixar ---- */
let editandoCurriculo = false;
function atualizarBotaoEditar(editando) {
  editandoCurriculo = editando;
  const btn = document.getElementById("btn-editar");
  const caixa = document.getElementById("resultado-curriculo");
  if (!btn || !caixa) return;
  btn.innerHTML = editando
    ? '<i data-lucide="check" aria-hidden="true"></i> Salvar edição'
    : '<i data-lucide="pencil" aria-hidden="true"></i> Editar';
  caixa.contentEditable = editando ? "true" : "false";
  caixa.classList.toggle("editando", editando);
  if (editando) { caixa.focus?.(); toastInfo("Modo edição", "Clique no texto e corrija. Depois clique em Salvar edição."); }
  if (window.lucide) lucide.createIcons();
}
function alternarEdicaoCurriculo() {
  atualizarBotaoEditar(!editandoCurriculo);
  if (editandoCurriculo === false) toastSuccess("Edição salva", "Agora você pode baixar o PDF ou texto");
}

/* ---- Download em texto (.txt) ---- */
function baixarTXT() {
  const texto = document.getElementById("resultado-curriculo").innerText.trim();
  if (!texto) { toastWarning("Nada para baixar", "Gere o currículo primeiro"); return; }
  const nome = (document.getElementById("nome").value.trim() || "curriculo").replace(/\s+/g, "_");
  const blob = new Blob([texto], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nome}_curriculo.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toastSuccess("Texto baixado!", "Currículo salvo como .txt");
}

/* ---- Exemplo de preenchimento ---- */
function preencherExemplo() {
  const ex = {
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
    "descricao-vaga": "Vaga de jovem aprendiz: atendimento, organização de documentos, Excel básico, boa comunicação.",
  };
  Object.entries(ex).forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (el) { el.value = v; clearFieldError(id); }
  });
  toastInfo("Exemplo preenchido", "Ajuste com seus dados e clique em Gerar");
  document.getElementById("nome").focus?.();
}

/* ---- Limpar histórico ---- */
function limparHistorico(tipo) {
  const key = tipo === "curriculo" ? STORAGE_KEYS.CURRICULOS : STORAGE_KEYS.ENTREVISTAS;
  try {
    localStorage.removeItem(key);
    toastSuccess("Histórico limpo", tipo === "curriculo" ? "Currículos apagados deste navegador" : "Entrevistas apagadas deste navegador");
  } catch { toastError("Erro", "Não foi possível limpar o histórico"); }
}


/* ============ FERRAMENTA 2: SIMULADOR DE ENTREVISTA ============ */
let historicoChat = [];
let perguntaAtual = 0;
let entrevistaCarregando = false;
let abortControllerEntrevista = null;
const TOTAL_PERGUNTAS = 3;

function adicionarMensagem(texto, quem) {
  const chat = document.getElementById("chat-box");
  const emptyState = document.getElementById("empty-state");
  if (emptyState) emptyState.remove();

  const div = document.createElement("div");
  div.className = "msg rounded-2xl rounded-tl-none " + (quem === "ia" ? "msg-ia" : "msg-user");
  if (quem === "ia") {
    div.innerHTML = markdownParaHtml(texto);
  } else {
    div.textContent = texto;
  }
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function mostrarDigitando() {
  const chat = document.getElementById("chat-box");
  const div = document.createElement("div");
  div.className = "msg msg-ia msg-digitando rounded-2xl rounded-tl-none";
  div.textContent = "digitando...";
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function criarAtualizadorDigitando(bolhaDigitando) {
  const chat = document.getElementById("chat-box");
  let primeiroTrecho = true;
  return (trecho, textoAteAgora) => {
    if (primeiroTrecho) {
      bolhaDigitando.classList.remove("msg-digitando");
      primeiroTrecho = false;
    }
    bolhaDigitando.innerHTML = markdownParaHtml(textoAteAgora);
    chat.scrollTop = chat.scrollHeight;
  };
}

/* ---- Erro na entrevista com botão Tentar novamente ---- */
let ultimaAcaoEntrevista = null; // () => Promise — refaz a última chamada
function adicionarMensagemErro(texto) {
  const chat = document.getElementById("chat-box");
  const emptyState = document.getElementById("empty-state");
  if (emptyState) emptyState.remove();
  const div = document.createElement("div");
  div.className = "msg msg-ia msg-erro rounded-2xl rounded-tl-none";
  div.setAttribute("role", "alert");
  div.innerHTML = `<p>❌ ${escaparHtml(texto)}</p>
    <button class="btn btn-tentar" type="button">Tentar novamente</button>`;
  div.querySelector(".btn-tentar").addEventListener("click", () => {
    div.remove();
    if (typeof ultimaAcaoEntrevista === "function") ultimaAcaoEntrevista();
  });
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function travarChat(travar) {
  entrevistaCarregando = travar;
  const resposta = document.getElementById("resposta");
  const btnEnviar = document.querySelector('.btn-enviar');
  if (resposta) resposta.disabled = travar;
  if (btnEnviar) btnEnviar.disabled = travar;
}

function atualizarProgresso() {
  const steps = document.querySelectorAll(".progress-step");
  steps.forEach((step, i) => {
    const stepNum = i + 1;
    step.classList.remove("active", "completed");
    if (stepNum < perguntaAtual) step.classList.add("completed");
    else if (stepNum === perguntaAtual) step.classList.add("active");
  });
}

async function iniciarEntrevista() {
  if (entrevistaCarregando) return;

  const area = document.getElementById("area").value;
  const botaoIniciar = document.getElementById("btn-iniciar");
  const progressSteps = document.getElementById("progress-steps");
  const chatInput = document.getElementById("chat-input");
  const btnCancelar = document.getElementById("btn-cancelar-entrevista");

  historicoChat = [];
  perguntaAtual = 1;
  document.getElementById("chat-box").innerHTML = "";
  progressSteps.hidden = false;
  chatInput.hidden = false;
  btnCancelar.hidden = false;
  botaoIniciar.hidden = true;
  atualizarProgresso();

  adicionarMensagem(`Ótimo! Vamos simular uma entrevista para **${area}**. Serão ${TOTAL_PERGUNTAS} perguntas. Preparado(a)?`, "ia");

  const prompt = `Você é um orientador de carreira e recrutador experiente, simulando uma entrevista para **${area}** com um estudante do ensino médio ou candidato ao primeiro emprego.

REGRAS:
- Faça APENAS a 1ª pergunta, direta, acolhedora e fácil de responder
- Não presuma experiência profissional. Aceite exemplos da escola, cursos, projetos, voluntariado, família e atividades do dia a dia
- Comece pedindo uma apresentação breve e perguntando o que despertou o interesse pela área
- MÁXIMO 2 frases, sem linguagem corporativa complicada
- Retorne APENAS a pergunta, sem introduções nem "Aqui está a pergunta:"`;

  travarChat(true);
  abortControllerEntrevista = new AbortController();
  botaoIniciar.disabled = true;
  const digitando = mostrarDigitando();

  const acao = async () => {
    travarChat(true);
    const d = mostrarDigitando();
    try {
      const primeiraPergunta = await chamarGemini(prompt, criarAtualizadorDigitando(d), { maxTokens: 300, temperature: 0.6, signal: abortControllerEntrevista.signal });
      historicoChat.push(`Recrutador: ${primeiraPergunta}`);
    } catch (erro) {
      d.remove();
      if (erro.name !== "AbortError" && !String(erro.message || "").includes("cancelada")) {
        const msg = (typeof traduzirErro === "function") ? traduzirErro(erro.message, erro.status) : erro.message;
        ultimaAcaoEntrevista = acao;
        adicionarMensagemErro(msg);
      }
      perguntaAtual = 0;
    } finally {
      travarChat(false);
      botaoIniciar.disabled = false;
    }
  };
  ultimaAcaoEntrevista = acao;
  try {
    const primeiraPergunta = await chamarGemini(prompt, criarAtualizadorDigitando(digitando), { maxTokens: 300, temperature: 0.6, signal: abortControllerEntrevista.signal });
    historicoChat.push(`Recrutador: ${primeiraPergunta}`);
  } catch (erro) {
    digitando.remove();
    if (erro.name !== "AbortError" && !String(erro.message || "").includes("cancelada")) {
      const msg = (typeof traduzirErro === "function") ? traduzirErro(erro.message, erro.status) : erro.message;
      ultimaAcaoEntrevista = acao;
      adicionarMensagemErro(msg);
    }
    perguntaAtual = 0;
  } finally {
    travarChat(false);
    botaoIniciar.disabled = false;
  }
}

async function enviarResposta() {
  if (entrevistaCarregando) return;

  const campo = document.getElementById("resposta");
  const resposta = campo.value.trim();
  if (!resposta || perguntaAtual === 0) return;

  adicionarMensagem(resposta, "user");
  historicoChat.push(`Candidato: ${resposta}`);
  campo.value = "";

  travarChat(true);
  const digitando = mostrarDigitando();

  if (perguntaAtual >= TOTAL_PERGUNTAS) {
    const prompt = `Você é um orientador de carreira acolhedor. A entrevista para **${document.getElementById("area").value}** foi concluída por um estudante ou candidato ao primeiro emprego.
  Histórico completo:
${historicoChat.join("\n")}

  Dê um feedback final construtivo e fácil de entender:
  1. Dois pontos fortes percebidos nas respostas, sempre citando exemplos do histórico
  2. Duas dicas práticas e possíveis de aplicar, sem tratar a falta de experiência como defeito
  3. Uma sugestão de resposta ou atitude para continuar treinando
  4. Encerramento motivador e realista

  Formato: use os títulos "Pontos fortes", "Para praticar" e "Próximo passo". Parágrafos curtos, tom encorajador, sem dar nota ou reprovar. MÁXIMO 220 palavras.`;
    try {
      const feedbackPrompt = prompt;
      const refazer = async () => {
        travarChat(true);
        const d = mostrarDigitando();
        try {
          await chamarGemini(feedbackPrompt, criarAtualizadorDigitando(d), { maxTokens: 500, temperature: 0.6, signal: abortControllerEntrevista.signal });
          perguntaAtual++;
          atualizarProgresso();
          toastSuccess("Entrevista finalizada!", "Confira seu feedback abaixo");
          salvarHistorico("entrevista", { area: document.getElementById("area").value, historico: historicoChat, timestamp: Date.now() });
        } catch (e2) {
          d.remove();
          if (e2.name !== "AbortError" && !String(e2.message || "").includes("cancelada")) {
            ultimaAcaoEntrevista = refazer;
            adicionarMensagemErro((typeof traduzirErro === "function") ? traduzirErro(e2.message, e2.status) : e2.message);
          }
        } finally { perguntaAtual = 0; travarChat(false); }
      };
      await chamarGemini(prompt, criarAtualizadorDigitando(digitando), { maxTokens: 500, temperature: 0.6, signal: abortControllerEntrevista.signal });
      perguntaAtual++;
      atualizarProgresso();
      toastSuccess("Entrevista finalizada!", "Confira seu feedback abaixo");
      
      // Salvar no histórico
      salvarHistorico("entrevista", { area: document.getElementById("area").value, historico: historicoChat, timestamp: Date.now() });
    } catch (erro) {
      digitando.remove();
      if (erro.name !== "AbortError" && !String(erro.message || "").includes("cancelada")) {
        const msg = (typeof traduzirErro === "function") ? traduzirErro(erro.message, erro.status) : erro.message;
        // retry reexecuta o feedback sem duplicar a resposta do usuário
        const feedbackPrompt = prompt;
        ultimaAcaoEntrevista = async () => {
          travarChat(true);
          const d = mostrarDigitando();
          try {
            await chamarGemini(feedbackPrompt, criarAtualizadorDigitando(d), { maxTokens: 500, temperature: 0.6, signal: abortControllerEntrevista.signal });
            perguntaAtual++;
            atualizarProgresso();
            toastSuccess("Entrevista finalizada!", "Confira seu feedback abaixo");
            salvarHistorico("entrevista", { area: document.getElementById("area").value, historico: historicoChat, timestamp: Date.now() });
          } catch (e2) {
            d.remove();
            adicionarMensagemErro((typeof traduzirErro === "function") ? traduzirErro(e2.message, e2.status) : e2.message);
          } finally { perguntaAtual = 0; travarChat(false); }
        };
        adicionarMensagemErro(msg);
      }
    } finally {
      perguntaAtual = 0;
      travarChat(false);
    }
    return;
  }

  const prompt = `Você é um orientador de carreira conduzindo uma entrevista para **${document.getElementById("area").value}** com um estudante ou candidato ao primeiro emprego.
Histórico:
${historicoChat.join("\n")}

REGRAS:
- Diga primeiro uma frase curta reconhecendo algo concreto da resposta anterior
- Faça a próxima pergunta (${perguntaAtual + 1}/${TOTAL_PERGUNTAS}) de forma direta e simples
- Progrida nesta ordem: apresentação/interesse, situação ou comportamento, e aprendizado/como lidaria com um desafio
- Se a área for técnica, prefira fundamentos e raciocínio, não ferramentas avançadas ou experiência corporativa
- Aceite exemplos de escola, cursos, projetos, voluntariado e vida cotidiana
- Nunca diga que a pessoa não serve para a vaga, não tem perfil ou está despreparada
- Tom profissional, encorajador e conciso; máximo 3 frases`;

  try {
    const proximaPrompt = prompt;
    const refazer = async () => {
      travarChat(true);
      const d = mostrarDigitando();
      try {
        const proxima = await chamarGemini(proximaPrompt, criarAtualizadorDigitando(d), { maxTokens: 400, temperature: 0.6, signal: abortControllerEntrevista.signal });
        historicoChat.push(`Recrutador: ${proxima}`);
        perguntaAtual++;
        atualizarProgresso();
      } catch (e2) {
        d.remove();
        if (e2.name !== "AbortError" && !String(e2.message || "").includes("cancelada")) {
          ultimaAcaoEntrevista = refazer;
          adicionarMensagemErro((typeof traduzirErro === "function") ? traduzirErro(e2.message, e2.status) : e2.message);
        }
      } finally { travarChat(false); }
    };
    ultimaAcaoEntrevista = refazer;
    const proxima = await chamarGemini(prompt, criarAtualizadorDigitando(digitando), { maxTokens: 400, temperature: 0.6, signal: abortControllerEntrevista.signal });
    historicoChat.push(`Recrutador: ${proxima}`);
    perguntaAtual++;
    atualizarProgresso();
  } catch (erro) {
    digitando.remove();
    if (erro.name !== "AbortError" && !String(erro.message || "").includes("cancelada")) {
      adicionarMensagemErro((typeof traduzirErro === "function") ? traduzirErro(erro.message, erro.status) : erro.message);
    }
  } finally {
    travarChat(false);
  }
}

function resetarEntrevista() {
  const chatBox = document.getElementById("chat-box");
  const chatInput = document.getElementById("chat-input");
  const btnIniciar = document.getElementById("btn-iniciar");
  const progressSteps = document.getElementById("progress-steps");
  const btnCancelar = document.getElementById("btn-cancelar-entrevista");

  chatBox.innerHTML = "";
  chatBox.innerHTML = `
    <div class="empty-state" id="empty-state">
      <div class="empty-state__icon" aria-hidden="true">💬</div>
      <div class="empty-state__title">Simulação pronta para começar</div>
      <p class="empty-state__desc">Selecione uma área e clique em "Começar simulação" para treinar com nosso recrutador virtual.</p>
    </div>
  `;
  chatInput.hidden = true;
  btnIniciar.hidden = false;
  progressSteps.hidden = true;
  btnCancelar.hidden = true;
  document.querySelectorAll(".progress-step").forEach(s => s.classList.remove("active", "completed"));
  historicoChat = [];
  perguntaAtual = 0;
}

function cancelarEntrevista() {
  if (abortControllerEntrevista) {
    abortControllerEntrevista.abort();
  }
  toastInfo("Encerrado", "Simulação de entrevista cancelada");
  setTimeout(resetarEntrevista, 500);
}

// Limpar erro ao digitar
["nome", "contato", "formacao", "experiencia", "habilidades", "objetivo"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", () => clearFieldError(id));
});

/* ============ TECLADO + ACESSIBILIDADE ============ */
// Enter envia resposta no chat; Esc cancela geração/entrevista
document.getElementById("resposta")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarResposta(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (gerandoCurriculo) cancelarGeracao();
    if (perguntaAtual > 0 && !document.getElementById("chat-input").hidden) cancelarEntrevista();
  }
  // Ctrl+Enter no campo objetivo também gera o currículo
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && document.activeElement?.id === "objetivo") {
    gerarCurriculo();
  }
});

/* ============ ABAS ============ */
const botoesAbas = document.querySelectorAll(".tab-btn");
const botoesHero = document.querySelectorAll(".btn-tab");
const paineis = document.querySelectorAll(".tab-panel");

function ativarAba(target) {
  botoesAbas.forEach((botao) => {
    const ativo = botao.dataset.tab === target;
    botao.classList.toggle("active", ativo);
    botao.setAttribute("aria-selected", String(ativo));
  });

  paineis.forEach((painel) => {
    painel.classList.toggle("active", painel.id === `${target}-panel`);
  });
}

botoesAbas.forEach((botao) => {
  botao.addEventListener("click", () => ativarAba(botao.dataset.tab));
});

botoesHero.forEach((botao) => {
  botao.addEventListener("click", (evento) => {
    evento.preventDefault();
    ativarAba(botao.dataset.tab);
    document.getElementById("ferramentas").scrollIntoView({ behavior: "smooth", block: "start" });
  });
});


/* ============ MODO CLARO / ESCURO ============ */
const botaoTema = document.getElementById("toggle-tema");
const CHAVE_TEMA = "conecta-carreira-tema";
const iconTema = botaoTema.querySelector("[data-lucide]");

function atualizarIconeTema(ehEscuro) {
  if (iconTema) {
    iconTema.setAttribute("data-lucide", ehEscuro ? "sun" : "moon");
    if (window.lucide) lucide.createIcons();
  }
  botaoTema.setAttribute("aria-label", ehEscuro ? "Alternar para modo claro" : "Alternar para modo escuro");
}

atualizarIconeTema(document.documentElement.getAttribute("data-tema") === "escuro");

botaoTema.addEventListener("click", () => {
  const estaEscuro = document.documentElement.getAttribute("data-tema") === "escuro";
  if (estaEscuro) {
    document.documentElement.removeAttribute("data-tema");
    localStorage.setItem(CHAVE_TEMA, "claro");
  } else {
    document.documentElement.setAttribute("data-tema", "escuro");
    localStorage.setItem(CHAVE_TEMA, "escuro");
  }
  document.documentElement.classList.toggle("dark", !estaEscuro);
  atualizarIconeTema(!estaEscuro);
});

/* ============ LUCIDE ICONS INIT ============ */
function initLucide() {
  if (window.lucide) {
    lucide.createIcons({ strokeWidth: 2 });
  } else {
    setTimeout(initLucide, 50);
  }
}
initLucide();
