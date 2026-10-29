import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const root = new URL('../', import.meta.url).pathname;
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const data = { tipoTef: 'SITEF', codigoBandeira: 12, tipoCartao: 'CARTAO_CREDITO', codigoAdministradora: '108', subFinalizadoraKey: 5026 };
const existing = { ...data, mapaSubfinalizadoraTefKey: 77 };
const page = items => ({ content: items, totalPages: items.length ? 1 : 0 });
let vite, dom, app, api, controls, storage, processor, messages;

before(async () => {
  process.env.VITE_PROXY_URL = 'https://proxy.example/api/proxy';
  vite = await createServer({ root, server: { middlewareMode: true, hmr: false } });
});
after(async () => {
  await vite?.close();
  for (const name of ['document', 'window', 'localStorage', 'confirm']) delete globalThis[name];
});
beforeEach(async () => {
  dom = new JSDOM(html, { url: 'http://127.0.0.1:5173/bluesoft-subfinalizadora/' });
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, localStorage: dom.window.localStorage, confirm: () => true });
  localStorage.setItem('bluesoftTenant', 'tenant');
  localStorage.setItem('bluesoftToken', 'dummy');
  vite.moduleGraph.invalidateAll();
  const { BluesoftIntegrationApp } = await vite.ssrLoadModule('/src/app.js');
  const config = await vite.ssrLoadModule('/src/config.js');
  controls = config.DOM_ELEMENTS;
  api = (await vite.ssrLoadModule('/src/services/api.js')).ApiService;
  storage = (await vite.ssrLoadModule('/src/services/storage.js')).StorageManager;
  processor = (await vite.ssrLoadModule('/src/processors/dataProcessor.js')).DataProcessor;
  const alerts = (await vite.ssrLoadModule('/src/ui/alerts.js')).AlertManager;
  messages = [];
  alerts.show = message => messages.push(message);
  app = new BluesoftIntegrationApp();
  app.init();
});
afterEach(() => dom.window.close());

function responses(values, callback = () => {}) {
  const calls = [];
  api.fetchImpl = async (url, options) => {
    calls.push(options.method);
    callback(options, calls.length);
    assert.ok(values.length, 'Não deve haver requisições extras');
    const value = values.shift();
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : Response.json(value);
  };
  return calls;
}

test('análise exibe diferenças; somente a confirmação dispara PUT', async () => {
  const old = { ...existing, subFinalizadoraKey: 99 };
  const calls = responses([page([old]), page([old]), new Response(null, { status: 204 })]);
  await app.analyzeImport([data], 'Manual');
  assert.deepEqual(calls, ['GET']);
  assert.equal(controls.confirmReviewBtn.disabled, false);
  assert.match(controls.reviewBody.textContent, /Atualizar/);
  assert.match(controls.reviewBody.textContent, /77/);
  assert.match(controls.reviewBody.textContent, /99 → 5026/);
  await app.confirmReview();
  assert.deepEqual(calls, ['GET', 'GET', 'PUT']);
  assert.match(controls.reviewSummary.textContent, /1 sucesso/);
  assert.equal(app.state.history[0].success, true);
  assert.equal(controls.confirmReviewBtn.disabled, true);
  assert.equal(controls.integrationFlow.parentElement, controls.manualWorkflowHost);
  assert.equal(controls.resultsSection.closest('.tab-content').id, 'manual-tab');
  assert.equal(controls.manualResults.classList.contains('hidden'), true);
});

test('validação mostra progresso no mesmo painel antes de liberar o envio', async () => {
  let release;
  api.fetchImpl = () => new Promise(resolve => { release = () => resolve(Response.json(page([]))); });
  const panel = controls.integrationFlow;
  const pending = app.analyzeImport([data], 'Arquivo');
  assert.equal(panel.parentElement, controls.uploadWorkflowHost);
  assert.equal(panel.dataset.stage, 'analyzing');
  assert.equal(controls.progressTrack.classList.contains('indeterminate'), true);
  assert.equal(controls.progressTrack.hasAttribute('aria-valuenow'), false);
  assert.equal(controls.confirmReviewBtn.classList.contains('hidden'), true);
  assert.equal(controls.workflowContent.getAttribute('aria-busy'), 'true');
  release();
  await pending;
  assert.equal(controls.integrationFlow, panel);
  assert.equal(panel.dataset.stage, 'review');
  assert.equal(controls.confirmReviewBtn.classList.contains('hidden'), false);
  assert.match(controls.confirmReviewBtn.textContent, /Enviar 1 registro/);
  assert.equal(controls.filePreview.classList.contains('hidden'), true);
  assert.equal(controls.progressTrack.getAttribute('aria-valuenow'), '100');
});

test('envio atualiza as linhas no mesmo painel e mantém resultado e relatório acessíveis', async () => {
  responses([page([])]);
  await app.analyzeImport([data], 'Arquivo');
  let release;
  api.fetchImpl = async (_, options) => options.method === 'GET' ? Response.json(page([]))
    : new Promise(resolve => { release = () => resolve(new Response(null, { status: 201 })); });
  const pending = app.confirmReview();
  await new Promise(setImmediate);
  const row = controls.resultsBody.firstElementChild;
  assert.equal(controls.integrationFlow.dataset.stage, 'sending');
  assert.equal(row.dataset.status, 'processing');
  assert.match(row.textContent, /Em andamento/);
  assert.equal(controls.resultsSection.classList.contains('hidden'), false);
  assert.equal(controls.confirmReviewBtn.classList.contains('hidden'), true);
  release();
  await pending;
  assert.equal(controls.resultsBody.firstElementChild, row);
  assert.equal(row.dataset.status, 'success');
  assert.equal(controls.integrationFlow.dataset.stage, 'complete');
  assert.equal(controls.integrationFlow.parentElement, controls.uploadWorkflowHost);
  assert.equal(controls.processingSection.classList.contains('hidden'), false);
  assert.equal(controls.downloadReportBtn.classList.contains('hidden'), false);
  assert.equal(controls.progressTrack.getAttribute('aria-valuenow'), '100');
});

test('lote compartilha consultas e mostra todas as subfinalizadoras afetadas', async () => {
  const other = { ...data, codigoBandeira: 99, subFinalizadoraKey: 999 };
  const old = { ...existing, subFinalizadoraKey: 99 };
  const calls = responses([page([old]), page([old]), new Response(null, { status: 204 }), new Response(null, { status: 201 })]);
  await app.analyzeImport([data, other], 'Arquivo');
  assert.deepEqual(calls, ['GET']);
  assert.equal(document.getElementById('importMode'), null);
  assert.equal(controls.reviewBody.children.length, 2);
  assert.match(controls.reviewBody.textContent, /5026Atualizar/);
  assert.match(controls.reviewBody.textContent, /999Criar/);
  assert.match(controls.reviewBody.textContent, /99 → 5026/);
  await app.confirmReview();
  assert.deepEqual(calls, ['GET', 'GET', 'PUT', 'POST']);
  assert.equal(app.state.processingResults.length, 2);
  assert.match(controls.reviewSummary.textContent, /2 sucesso/);
});

test('mudança na conferência informa o bloqueio na interface sem gravar', async () => {
  const calls = responses([page([]), page([existing])]);
  await app.analyzeImport([data], 'Arquivo');
  await app.confirmReview();
  assert.deepEqual(calls, ['GET', 'GET']);
  assert.match(controls.reviewSummary.textContent, /5026 mudou desde/);
  assert.equal(app.state.processingResults.length, 0);
  assert.equal(app.busy, false);
});

test('análise idêntica informa preservação e não grava', async () => {
  const calls = responses([page([existing]), page([existing])]);
  await app.analyzeImport([data], 'Arquivo');
  assert.match(controls.reviewBody.textContent, /Manter sem alterações/);
  await app.confirmReview();
  assert.deepEqual(calls, ['GET', 'GET']);
  assert.equal(app.state.processingResults[0].action, 'unchanged');
});

test('erro de consulta bloqueia o lote inteiro', async () => {
  const calls = responses([Response.json({ detail: 'Sem permissão de consulta' }, { status: 403 })]);
  await app.analyzeImport([data, { ...data, codigoBandeira: 99, subFinalizadoraKey: 999 }], 'Arquivo');
  assert.equal(controls.confirmReviewBtn.disabled, true);
  assert.match(controls.reviewBody.textContent, /Sem permissão/);
  await app.confirmReview();
  assert.deepEqual(calls, ['GET']);
});

test('combinações de origem repetidas são bloqueadas mesmo com destinos diferentes', async () => {
  const calls = responses([]);
  await app.analyzeImport([data, { ...data, subFinalizadoraKey: 999 }], 'Arquivo');
  assert.deepEqual(calls, []);
  assert.equal(app.review, null);
  assert.match(controls.reviewSummary.textContent, /repetidas/);
});

test('alterar dados manuais ou credenciais descarta a revisão', async () => {
  for (const element of [controls.manualCodigoAdministradora, controls.tokenInput, controls.tenantInput]) {
    responses([page([])]);
    await app.analyzeImport([data], 'Manual');
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(app.review, null);
    assert.equal(controls.confirmReviewBtn.disabled, true);
  }
});

test('duplo clique não duplica gravações e controles permanecem bloqueados', async () => {
  let release;
  responses([page([])]);
  await app.analyzeImport([data], 'Arquivo');
  let calls = 0;
  api.fetchImpl = async (_, options) => {
    calls++;
    if (options.method === 'GET') await new Promise(resolve => { release = resolve; });
    return options.method === 'GET' ? Response.json(page([])) : new Response(null, { status: 201 });
  };
  const pending = app.confirmReview();
  assert.equal(controls.fileInput.disabled, true);
  assert.equal(document.getElementById('importMode'), null);
  await app.confirmReview();
  release();
  await pending;
  assert.equal(calls, 2);
  assert.equal(controls.fileInput.disabled, false);
});

test('cancelamento preserva resultado atual e impede os próximos itens', async () => {
  const second = { ...data, codigoBandeira: 99, subFinalizadoraKey: 999 };
  const calls = responses([page([]), page([]), new Response(null, { status: 201 })], options => {
    if (options.method === 'POST') controls.discardReviewBtn.click();
  });
  await app.analyzeImport([data, second], 'Arquivo');
  await app.confirmReview();
  assert.deepEqual(calls, ['GET', 'GET', 'POST']);
  assert.equal(app.state.processingResults.length, 2);
  assert.match(controls.reviewSummary.textContent, /1 cancelado/);
  assert.equal(controls.integrationFlow.dataset.stage, 'interrupted');
  assert.deepEqual([...controls.resultsBody.children].map(row => row.dataset.status), ['success', 'cancelled']);
  assert.match(controls.resultsBody.textContent, /Não enviado/);
  assert.match(app.generateReportCSV(), /999,Não enviado/);
});

test('erro de gravação fica na linha e não provoca mudança de aba', async () => {
  app.switchTab('upload', document.querySelector('[data-tab="upload"]'));
  responses([page([]), page([]), Response.json({ detail: 'Regra de negócio rejeitada' }, { status: 422 })]);
  await app.analyzeImport([data], 'Arquivo');
  await app.confirmReview();
  assert.equal(controls.integrationFlow.dataset.stage, 'failed');
  assert.match(controls.workflowState.textContent, /Concluído com erros/);
  assert.match(controls.resultsBody.textContent, /Regra de negócio rejeitada/);
  assert.equal(document.querySelector('.tab-content.active').id, 'upload-tab');
});

test('voltar da revisão restaura os dados do arquivo no mesmo painel', async () => {
  app.state.fileData = [data];
  responses([page([])]);
  await app.analyzeImport([data], 'Arquivo');
  controls.discardReviewBtn.click();
  assert.equal(app.review, null);
  assert.equal(controls.integrationFlow.dataset.stage, 'ready');
  assert.equal(controls.filePreview.classList.contains('hidden'), false);
  assert.equal(controls.resultsSection.classList.contains('hidden'), true);
  assert.equal(controls.processFileBtn.classList.contains('hidden'), false);
});

test('falha no histórico não transforma sucesso da API em erro ou nova gravação', async () => {
  const calls = responses([page([]), page([]), new Response(null, { status: 201 })]);
  await app.analyzeImport([data], 'Arquivo');
  storage.set = () => { throw new Error('Quota excedida'); };
  await app.confirmReview();
  assert.deepEqual(calls, ['GET', 'GET', 'POST']);
  assert.equal(app.state.processingResults[0].status, 'success');
});

test('preview com linha inválida impede envio do lote inteiro', async () => {
  app.state.fileData = [{ sub_finalizadora_key: 1, codigo_bandeira: 1, codigo_administradora: '108', tipo_tef_key: 1, tipo_cartao: 'Débito' }, { sub_finalizadora_key: 'errado' }];
  await app.showFilePreview();
  app.setBusy(false);
  assert.equal(app.fileHasErrors, true);
  assert.equal(controls.processFileBtn.disabled, true);
  const calls = responses([]);
  await app.processFileData();
  assert.deepEqual(calls, []);
});

test('novo upload inválido descarta dados antigos e restaura os controles', async t => {
  t.mock.method(console, 'error', () => {});
  app.state.fileData = [data];
  processor.processFile = async () => { throw new Error('Arquivo inválido'); };
  await app.handleFileUpload({ target: { files: [{ name: 'invalid.xlsx' }] } });
  assert.equal(app.state.fileData.length, 0);
  assert.equal(app.review, null);
  assert.equal(controls.processFileBtn.disabled, true);
  assert.equal(app.busy, false);
});

test('erros do ERP são exibidos como texto e relatório evita fórmulas', async () => {
  responses([Response.json({ detail: '<img src=x onerror=alert(1)>' }, { status: 400 })]);
  await app.analyzeImport([data], 'Manual');
  assert.equal(controls.reviewBody.querySelector('img'), null);
  assert.match(controls.reviewBody.textContent, /<img/);
  app.state.processingResults = [{ subFinalizadoraKey: 1, status: 'error', message: '=DANGEROUS()' }];
  assert.match(app.generateReportCSV(), /'=DANGEROUS/);
});

test('formulário manual analisa sem gravar e valida os campos antes da consulta', async () => {
  controls.manualTipoTef.value = data.tipoTef;
  controls.manualCodigoBandeira.value = data.codigoBandeira;
  controls.manualTipoCartao.value = data.tipoCartao;
  controls.manualCodigoAdministradora.value = data.codigoAdministradora;
  controls.manualSubFinalizadoraKey.value = data.subFinalizadoraKey;
  const calls = responses([page([])]);
  await app.handleManualSubmit({ preventDefault() {} });
  assert.deepEqual(calls, ['GET']);
  assert.equal(app.review.source, 'Manual');
  controls.manualCodigoAdministradora.value = '1234';
  controls.manualCodigoAdministradora.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await app.handleManualSubmit({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.match(controls.manualResultMessage.textContent, /1 a 3 caracteres/);
});

test('CSV sem cabeçalho respeita a ordem documentada e inteiros não são truncados', () => {
  assert.deepEqual(processor.convertRowToJson([5026, '108', 12, 1, 'Cartão de Crédito']), data);
  assert.equal(processor.parseStrictInt('12.5'), null);
  assert.equal(processor.parseStrictInt('9007199254740993'), null);
  assert.equal(processor.mapTipoCartao('Cartão de Crédito Parcelado'), 'CARTAO_PARCELADO');
});

test('arquivo com todas as linhas inválidas mantém os erros visíveis', async () => {
  app.state.fileData = [{ sub_finalizadora_key: 'inválido' }];
  await app.showFilePreview();
  app.setBusy(false);
  assert.equal(controls.filePreview.classList.contains('hidden'), false);
  assert.equal(controls.processFileBtn.disabled, true);
  assert.match(controls.previewBody.textContent, /Erro/);
});

test('conflito mostra os IDs e destinos dos candidatos e mantém envio bloqueado', async () => {
  const calls = responses([page([existing, { ...existing, mapaSubfinalizadoraTefKey: 78, subFinalizadoraKey: 601 }])]);
  await app.analyzeImport([data], 'Arquivo');
  const row = controls.reviewBody.firstElementChild;
  assert.equal(row.children[2].textContent, '77, 78');
  assert.match(row.textContent, /Mapa 77/);
  assert.match(row.textContent, /Mapa 78/);
  assert.match(row.textContent, /601 → 5026/);
  assert.match(row.textContent, /dados idênticos/);
  assert.equal(controls.confirmReviewBtn.disabled, true);
  await app.confirmReview();
  assert.deepEqual(calls, ['GET']);
});

test('mesmo destino e origens diferentes mantêm duas linhas de resultado e histórico', async () => {
  const other = { ...data, codigoAdministradora: '099' };
  const calls = responses([page([]), page([]), new Response(null, { status: 201 }), new Response(null, { status: 201 })]);
  await app.analyzeImport([data, other], 'Arquivo');
  assert.equal(controls.confirmReviewBtn.disabled, false);
  assert.equal(controls.reviewBody.children.length, 2);
  await app.confirmReview();
  assert.deepEqual(calls, ['GET', 'GET', 'POST', 'POST']);
  assert.equal(controls.resultsBody.children.length, 2);
  assert.ok([...controls.resultsBody.children].every(row => row.dataset.status === 'success'));
  assert.equal(app.state.processingResults.length, 2);
  assert.equal(app.state.history.length, 2);
});

test('cancelamento mantém separados os resultados de duas origens para o mesmo destino', async () => {
  const other = { ...data, codigoAdministradora: '099' };
  const calls = responses([page([]), page([]), new Response(null, { status: 201 })], options => {
    if (options.method === 'POST') controls.discardReviewBtn.click();
  });
  await app.analyzeImport([data, other], 'Arquivo');
  await app.confirmReview();
  assert.deepEqual(calls, ['GET', 'GET', 'POST']);
  assert.deepEqual([...controls.resultsBody.children].map(row => row.dataset.status), ['success', 'cancelled']);
  assert.equal(app.state.processingResults.length, 2);
});

test('origens de um mesmo destino ficam identificadas na tela e no CSV', async () => {
  const other = { ...data, codigoAdministradora: '=1' };
  responses([page([]), page([]), new Response(null, { status: 201 }), new Response(null, { status: 201 })]);
  await app.analyzeImport([data, other], 'Arquivo');
  await app.confirmReview();
  assert.match(controls.resultsBody.children[0].textContent, /Administradora 108/);
  assert.match(controls.resultsBody.children[1].textContent, /Administradora =1/);
  const csv = app.generateReportCSV();
  assert.match(csv, /Tipo TEF,Administradora,Bandeira,Tipo cartão/);
  assert.match(csv, /"SITEF","108","12","CARTAO_CREDITO"/);
  assert.match(csv, /"SITEF","'=1","12","CARTAO_CREDITO"/);
});

test('revisão identifica as duas origens antes de confirmar atualizações para o mesmo destino', async () => {
  const other = { ...data, codigoAdministradora: '099' };
  const calls = responses([page([
    { ...existing, subFinalizadoraKey: 601 },
    { ...other, subFinalizadoraKey: 601, mapaSubfinalizadoraTefKey: 78 },
  ])]);
  await app.analyzeImport([data, other], 'Arquivo');
  const [first, second] = [...controls.reviewBody.children];
  assert.match(first.textContent, /108/);
  assert.match(second.textContent, /099/);
  for (const row of [first, second]) {
    assert.match(row.textContent, /SITEF/);
    assert.match(row.textContent, /12/);
    assert.match(row.textContent, /CARTAO_CREDITO/);
    assert.match(row.textContent, /601 → 5026/);
  }
  assert.equal(first.children[2].textContent, '77');
  assert.equal(second.children[2].textContent, '78');
  assert.equal(controls.confirmReviewBtn.disabled, false);
  assert.deepEqual(calls, ['GET']);
});

test('origem relevante inválida é exibida como bloqueio e impede qualquer escrita do lote', async () => {
  const calls = responses([page([{ ...existing, subFinalizadoraKey: null }])]);
  await app.analyzeImport([data, { ...data, codigoBandeira: 13 }], 'Arquivo');
  assert.match(controls.reviewBody.textContent, /mapa 77/);
  assert.equal(controls.confirmReviewBtn.disabled, true);
  await app.confirmReview();
  assert.deepEqual(calls, ['GET']);
});
