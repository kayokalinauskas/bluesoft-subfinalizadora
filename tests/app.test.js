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
  const old = { ...existing, codigoAdministradora: '099' };
  const calls = responses([page([old]), page([old]), new Response(null, { status: 204 })]);
  await app.analyzeImport([data], 'Manual');
  assert.deepEqual(calls, ['GET']);
  assert.equal(controls.confirmReviewBtn.disabled, false);
  assert.match(controls.reviewBody.textContent, /Atualizar/);
  assert.match(controls.reviewBody.textContent, /77/);
  assert.match(controls.reviewBody.textContent, /099 → 108/);
  await app.confirmReview();
  assert.deepEqual(calls, ['GET', 'GET', 'PUT']);
  assert.match(controls.manualResultMessage.textContent, /1 sucesso/);
  assert.equal(app.state.history[0].success, true);
  assert.equal(controls.confirmReviewBtn.disabled, true);
});

test('lote compartilha consultas e mostra todas as subfinalizadoras afetadas', async () => {
  const other = { ...data, subFinalizadoraKey: 999 };
  const old = { ...existing, codigoAdministradora: '099' };
  const calls = responses([page([old]), page([old]), new Response(null, { status: 204 }), new Response(null, { status: 201 })]);
  await app.analyzeImport([data, other], 'Arquivo');
  assert.deepEqual(calls, ['GET']);
  assert.equal(document.getElementById('importMode'), null);
  assert.equal(controls.reviewBody.children.length, 2);
  assert.match(controls.reviewBody.textContent, /5026Atualizar/);
  assert.match(controls.reviewBody.textContent, /999Criar/);
  assert.match(controls.reviewBody.textContent, /099 → 108/);
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
  await app.analyzeImport([data, { ...data, subFinalizadoraKey: 999 }], 'Arquivo');
  assert.equal(controls.confirmReviewBtn.disabled, true);
  assert.match(controls.reviewBody.textContent, /Sem permissão/);
  await app.confirmReview();
  assert.deepEqual(calls, ['GET']);
});

test('subfinalizadoras repetidas no lote são bloqueadas antes da consulta', async () => {
  const calls = responses([]);
  await app.analyzeImport([data, { ...data, codigoBandeira: 99 }], 'Arquivo');
  assert.deepEqual(calls, []);
  assert.equal(app.review, null);
  assert.match(messages.join(' '), /repetidas/);
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
  const second = { ...data, subFinalizadoraKey: 999 };
  const calls = responses([page([]), page([]), new Response(null, { status: 201 })], options => {
    if (options.method === 'POST') controls.discardReviewBtn.click();
  });
  await app.analyzeImport([data, second], 'Arquivo');
  await app.confirmReview();
  assert.deepEqual(calls, ['GET', 'GET', 'POST']);
  assert.equal(app.state.processingResults.length, 1);
  assert.match(controls.reviewSummary.textContent, /1 cancelado/);
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
