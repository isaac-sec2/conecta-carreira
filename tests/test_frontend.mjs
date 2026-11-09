import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function carregarFrontend() {
  const document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    documentElement: { getAttribute: () => null },
  };
  const window = { location: { href: "http://localhost/", origin: "http://localhost", hostname: "localhost", port: "" } };
  const contexto = vm.createContext({ window, document, navigator: {}, URL, TextDecoder, AbortController, setTimeout, clearTimeout });
  for (const arquivo of ["api.js", "app.js"]) {
    vm.runInContext(readFileSync(new URL(`../public/js/${arquivo}`, import.meta.url), "utf8"), contexto);
  }
  return contexto;
}

function respostaSSE(eventos, tamanhoDoPedaco = Infinity) {
  const corpo = new TextEncoder().encode(eventos.map(evento => `data: ${JSON.stringify(evento)}\n\n`).join(""));
  let posicao = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (posicao >= corpo.length) return { done: true };
          const value = corpo.slice(posicao, posicao + tamanhoDoPedaco);
          posicao += value.length;
          return { done: false, value };
        },
        cancel: async () => {},
        releaseLock() {},
      }),
    },
  };
}

const evento = (text, finishReason) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });

test("orientação sai do currículo em qualquer posição", () => {
  const { curriculo, orientacao } = carregarFrontend().separarOrientacao(
    "## Resumo\nA\n## Pontos fortes para a vaga\nB\n## Habilidades\nC\n## **Próximos passos** para se preparar\nD\n",
  );
  assert.equal(curriculo, "## Resumo\nA\n## Habilidades\nC\n");
  assert.equal(orientacao, "## Pontos fortes para a vaga\nB\n## **Próximos passos** para se preparar\nD\n");
});

test("contato não vai para a IA", () => {
  const prompt = carregarFrontend().montarPromptCurriculo({ nome: "N", contato: "TELEFONE-X", objetivo: "O" });
  assert.ok(!prompt.includes("TELEFONE-X"));
});

test("resposta cortada mantém o texto e avisa", async () => {
  const contexto = carregarFrontend();
  contexto.fetch = async () => respostaSSE([evento("parte 1 ", ""), evento("parte 2", "MAX_TOKENS")]);
  let avisos = 0;
  const texto = await contexto.chamarGemini("oi", null, { aoCortar: () => { avisos += 1; } });
  assert.equal(texto, "parte 1 parte 2");
  assert.equal(avisos, 1);
});

test("resposta completa não avisa corte", async () => {
  const contexto = carregarFrontend();
  contexto.fetch = async () => respostaSSE([evento("tudo", "STOP")]);
  let avisos = 0;
  assert.equal(await contexto.chamarGemini("oi", null, { aoCortar: () => { avisos += 1; } }), "tudo");
  assert.equal(avisos, 0);
});

test("mensagens de erro não culpam a coisa errada", () => {
  const { traduzirErro } = carregarFrontend();
  assert.equal(traduzirErro("Falha de conexão com a IA.", 502), "Falha de conexão com a IA.");
  assert.equal(traduzirErro("Origem não autorizada.", 403), "Origem não autorizada.");
  assert.equal(traduzirErro("Failed to generate", 0), "Failed to generate");
  assert.match(traduzirErro("Failed to fetch", 0), /Sem conexão/);
  assert.match(traduzirErro("qualquer", 429), /Muita gente/);
});

test("erro do Google no meio da resposta vira mensagem em português com o código certo", async () => {
  const contexto = carregarFrontend();
  contexto.fetch = async () => respostaSSE([{ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }]);
  await assert.rejects(contexto.chamarGemini("oi", null, { retries: 0 }), error => {
    assert.match(error.message, /Muita gente/);
    assert.equal(error.status, 429);
    return true;
  });
});

test("treino para a vaga leva o perfil às perguntas, sem nome nem contato", () => {
  const contexto = carregarFrontend();
  const dados = contexto.montarContextoVaga({ nome: "NOME-X", contato: "CONTATO-X", formacao: "FORMACAO-X", descricaoVaga: "VAGA-X" });
  const prompts = [
    contexto.promptPrimeiraPerguntaEntrevista("Aprendiz", dados),
    contexto.promptProximaPerguntaEntrevista("Aprendiz", [], 2, dados),
    contexto.promptFeedbackEntrevista("Aprendiz", [], dados),
  ];
  for (const prompt of prompts) {
    assert.ok(prompt.includes("FORMACAO-X") && prompt.includes("VAGA-X"));
    assert.ok(!prompt.includes("NOME-X") && !prompt.includes("CONTATO-X"));
  }
});

test("resposta picada no meio de linhas e de acentos chega inteira", async () => {
  const contexto = carregarFrontend();
  contexto.fetch = async () => respostaSSE([evento("ação ", ""), evento("índice", "STOP")], 3);
  assert.equal(await contexto.chamarGemini("oi"), "ação índice");
});

test("conexão encerrada antes do fim da resposta é erro", async () => {
  const contexto = carregarFrontend();
  contexto.fetch = async () => respostaSSE([evento("parcial", "")]);
  await assert.rejects(contexto.chamarGemini("oi", null, { retries: 0 }), { message: /encerrada antes/ });
});

test("pedido grande demais é recusado sem chamar o servidor", async () => {
  const contexto = carregarFrontend();
  let chamadas = 0;
  contexto.fetch = async () => { chamadas += 1; };
  await assert.rejects(contexto.chamarGemini("x".repeat(12001)), { codigo: "PROMPT_TOO_LARGE" });
  assert.equal(chamadas, 0);
});

test("perfil aceita só o domínio certo e seus subdomínios", () => {
  const { normalizarPerfil } = carregarFrontend();
  const linkedin = valor => normalizarPerfil(valor, "https://www.linkedin.com/in/");
  assert.equal(linkedin("br.linkedin.com/in/maria"), "https://br.linkedin.com/in/maria");
  assert.equal(linkedin("https://www.linkedin.com/in/maria"), "https://www.linkedin.com/in/maria");
  for (const valor of ["https://linkedin.com.evil.com/in/x", "https://evillinkedin.com/in/x", "evil.com/linkedin.com/x", "javascript:alert(1)", "maria"]) {
    assert.equal(linkedin(valor), "");
  }
});

test("formulário exige contato válido e formação ou habilidades", () => {
  const contexto = carregarFrontend();
  const campos = {};
  contexto.document.getElementById = id => (campos[id] ??= {
    value: "",
    closest: () => null,
    getAttribute: () => null,
    setAttribute() {},
    removeAttribute() {},
  });
  const validar = (contato, formacao, habilidades = "") => {
    Object.assign(contexto.document.getElementById("nome"), { value: "Maria Silva" });
    contexto.document.getElementById("objetivo").value = "Aprendiz";
    contexto.document.getElementById("contato").value = contato;
    contexto.document.getElementById("formacao").value = formacao;
    contexto.document.getElementById("habilidades").value = habilidades;
    return contexto.validateCurriculoForm();
  };
  assert.equal(validar("maria@email.com | +55 (11) 99999-0000", "Ensino médio"), true);
  assert.equal(validar("+55 (11) 99999-0000", "", "Excel"), true);
  assert.equal(validar("", "Ensino médio"), false);
  assert.equal(validar("maria@email.com | abc", "Ensino médio"), false);
  assert.equal(validar("maria@email.com", ""), false);
});

test("bloqueio de segurança continua sendo erro", async () => {
  const contexto = carregarFrontend();
  contexto.fetch = async () => respostaSSE([evento("x", "SAFETY")]);
  await assert.rejects(contexto.chamarGemini("oi", null, { retries: 0 }), { message: /SAFETY/ });
});
