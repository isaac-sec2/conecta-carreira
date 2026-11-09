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

function respostaSSE(eventos) {
  const corpo = new TextEncoder().encode(eventos.map(evento => `data: ${JSON.stringify(evento)}\n\n`).join(""));
  let lido = false;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (lido) return { done: true };
          lido = true;
          return { done: false, value: corpo };
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

test("bloqueio de segurança continua sendo erro", async () => {
  const contexto = carregarFrontend();
  contexto.fetch = async () => respostaSSE([evento("x", "SAFETY")]);
  await assert.rejects(contexto.chamarGemini("oi", null, { retries: 0 }), { message: /SAFETY/ });
});
