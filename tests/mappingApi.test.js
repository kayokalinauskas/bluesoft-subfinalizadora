import test from 'node:test';
import assert from 'node:assert/strict';
import { MappingApi, ApiError } from '../src/services/mappingApi.js';
import { DataValidator } from '../src/processors/validator.js';

const data = { tipoTef: 'SITEF', codigoBandeira: 12, tipoCartao: 'CARTAO_CREDITO', codigoAdministradora: '108', subFinalizadoraKey: 5026 };
const existing = { ...data, mapaSubfinalizadoraTefKey: 77 };
const page = items => ({ content: items, totalPages: items.length ? 1 : 0 });
function mock(responses, timeout = 1000) {
  const calls = [];
  const api = new MappingApi('https://proxy.example/api/proxy', async (url, options) => {
    calls.push({ ...options, target: new URL(new URL(url).searchParams.get('url')) });
    assert.ok(responses.length, 'Não deve haver requisições extras');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response instanceof Response ? response : Response.json(response);
  }, timeout);
  return { api, calls };
}

test('planejar não grava; confirmar cria apenas após nova consulta', async () => {
  const { api, calls } = mock([page([]), page([]), new Response(null, { status: 201 })]);
  const plan = await api.plan('tenant', 'dummy', data);
  assert.equal(plan.action, 'create');
  assert.deepEqual(calls.map(c => c.method), ['GET']);
  assert.equal(calls[0].target.searchParams.get('subFinalizadoraKey'), '5026');
  assert.equal(calls[0].target.searchParams.get('currentPage'), '0');
  assert.equal(await api.execute('tenant', 'dummy', plan), 'create');
  assert.deepEqual(calls.map(c => c.method), ['GET', 'GET', 'POST']);
  assert.deepEqual(JSON.parse(calls[2].body), data);
});

test('mapa idêntico é preservado sem POST nem PUT', async () => {
  const { api, calls } = mock([page([existing]), page([existing])]);
  const plan = await api.plan('tenant', 'dummy', data);
  assert.equal(await api.execute('tenant', 'dummy', plan), 'unchanged');
  assert.deepEqual(calls.map(c => c.method), ['GET', 'GET']);
});

test('PUT usa a chave do mapa, nunca a chave da subfinalizadora', async () => {
  const old = { ...existing, codigoAdministradora: '099' };
  const { api, calls } = mock([page([old]), page([old]), new Response(null, { status: 204 })]);
  const plan = await api.plan('tenant', 'dummy', data, 'reconcile');
  assert.deepEqual(plan.differences, ['codigoAdministradora']);
  assert.equal(await api.execute('tenant', 'dummy', plan), 'update');
  assert.equal(calls[2].method, 'PUT');
  assert.ok(calls[2].target.pathname.endsWith('/77'));
  assert.deepEqual(JSON.parse(calls[2].body), data);
});

test('modo padrão não atualiza dados diferentes', async () => {
  const { api, calls } = mock([page([{ ...existing, codigoBandeira: 1 }])]);
  await assert.rejects(api.plan('tenant', 'dummy', data), /dados diferentes/);
  assert.equal(calls.length, 1);
});

test('mais de um candidato bloqueia atualização mesmo se um for idêntico', async () => {
  const { api } = mock([page([existing, { ...existing, mapaSubfinalizadoraTefKey: 78 }])]);
  await assert.rejects(api.plan('tenant', 'dummy', data, 'reconcile'), /Mais de um/);
});

test('consulta todas as páginas e encontra candidato conflitante na segunda', async () => {
  const { api, calls } = mock([{ items: [existing], pagination: { totalPages: 2 } }, { items: [{ ...existing, mapaSubfinalizadoraTefKey: 78 }], pagination: { totalPages: 2 } }]);
  await assert.rejects(api.plan('tenant', 'dummy', data, 'reconcile'), /Mais de um/);
  assert.equal(calls[1].target.searchParams.get('currentPage'), '1');
});

test('sem metadados, página curta não encerra consulta; segue até vazia', async () => {
  const { api, calls } = mock([[existing], []]);
  assert.equal((await api.plan('tenant', 'dummy', data)).action, 'unchanged');
  assert.equal(calls.length, 2);
});

test('consulta vazia com uma página declarada é aceita', async () => {
  const { api } = mock([{ content: [], totalPages: 1 }]);
  assert.equal((await api.plan('tenant', 'dummy', data)).action, 'create');
});

test('respostas inválidas nunca são interpretadas como ausência', async () => {
  const invalidResponses = [
    [{ unexpected: [] }], [null], [page([{ ...data }])],
    [[existing], [existing]], [page([{ ...existing, subFinalizadoraKey: 999 }])],
    [{ content: [], totalPages: 3 }], [{ content: [existing], totalPages: 0 }],
    [{ content: [existing], totalPages: 2 }, { content: [], totalPages: 1 }],
    [page([{ ...existing, mapaSubfinalizadoraTefKey: 2147483648 }])],
    [page([{ ...existing, codigoAdministradora: null }])],
  ];
  for (const responses of invalidResponses) {
    const { api, calls } = mock(responses);
    await assert.rejects(api.plan('tenant', 'dummy', data, 'reconcile'));
    assert.ok(calls.every(call => call.method === 'GET'));
  }
});

test('mudança entre revisão e execução bloqueia a gravação', async () => {
  const previous = { ...existing, codigoAdministradora: '099' };
  const { api, calls } = mock([page([previous]), page([{ ...previous, codigoAdministradora: '100' }])]);
  const plan = await api.plan('tenant', 'dummy', data, 'reconcile');
  await assert.rejects(api.execute('tenant', 'dummy', plan), /mudou desde/);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('novo mapa entre revisão e execução bloqueia POST', async () => {
  const { api, calls } = mock([page([]), page([existing])]);
  const plan = await api.plan('tenant', 'dummy', data);
  await assert.rejects(api.execute('tenant', 'dummy', plan), /mudou desde/);
  assert.equal(calls.length, 2);
});

test('erro Problem preserva detalhe, status e validações', async () => {
  const details = { detail: 'Registro já cadastrado', validations: { campo: 'inválido' } };
  const { api } = mock([Response.json(details, { status: 400 })]);
  await assert.rejects(api.request('tenant', 'dummy', 'POST', '', data), e => e instanceof ApiError && e.status === 400 && e.message === details.detail && e.details.validations.campo === 'inválido');
});

test('erros encapsulados pelo proxy antigo também preservam mensagem do ERP', async () => {
  for (const details of [{ message: 'Registro já cadastrado' }, JSON.stringify({ detail: 'Registro já cadastrado' }), 'Registro já cadastrado']) {
    const { api } = mock([Response.json({ error: 'Erro no proxy', details }, { status: 400 })]);
    await assert.rejects(api.request('tenant', 'dummy', 'POST', '', data), /já cadastrado/);
  }
});

test('falta de permissão de consulta não dispara gravações', async () => {
  const { api, calls } = mock([Response.json({}, { status: 403 })]);
  await assert.rejects(api.plan('tenant', 'dummy', data, 'reconcile'), e => e.status === 403);
  assert.equal(calls.length, 1);
});

test('conflito no POST não dispara PUT automático', async () => {
  const { api, calls } = mock([page([]), page([]), Response.json({ detail: 'Já cadastrado' }, { status: 409 })]);
  const plan = await api.plan('tenant', 'dummy', data, 'reconcile');
  await assert.rejects(api.execute('tenant', 'dummy', plan), e => e.status === 409);
  assert.deepEqual(calls.map(c => c.method), ['GET', 'GET', 'POST']);
});

test('payload inválido e tenant fora do formato são rejeitados antes da rede', async () => {
  const { api, calls } = mock([]);
  for (const change of [{ codigoBandeira: 1.5 }, { codigoBandeira: 100000000 }, { subFinalizadoraKey: Number.MAX_SAFE_INTEGER + 1 }, { codigoAdministradora: '1234' }, { tipoCartao: 'CARTAO_DESCONHECIDO' }]) {
    const invalid = { ...data, ...change };
    assert.equal(DataValidator.validateSubmissionData(invalid).isValid, false);
    await assert.rejects(api.plan('tenant', 'dummy', invalid));
  }
  await assert.rejects(api.plan('../other', 'dummy', data));
  assert.equal(calls.length, 0);
});

test('timeout sinaliza resultado desconhecido de escrita e não repete', async () => {
  let calls = 0;
  const api = new MappingApi('https://proxy.example', (_, { signal }) => new Promise((resolve, reject) => {
    calls++;
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }), 5);
  await assert.rejects(api.request('tenant', 'dummy', 'PUT', '/77', data), /resultado da gravação pode ser desconhecido/);
  assert.equal(calls, 1);
});

test('sucesso sem JSON não é transformado em falha de gravação', async () => {
  const { api } = mock([new Response('OK'), new Response(null, { status: 204 })]);
  assert.equal(await api.request('tenant', 'dummy', 'POST', '', data), 'OK');
  assert.equal(await api.request('tenant', 'dummy', 'PUT', '/77', data), null);
});

test('zeros à esquerda da administradora são preservados e identificados como diferença', async () => {
  const { api } = mock([page([{ ...existing, codigoAdministradora: '008' }])]);
  const plan = await api.plan('tenant', 'dummy', { ...data, codigoAdministradora: '8' }, 'reconcile');
  assert.deepEqual(plan.differences, ['codigoAdministradora']);
  assert.equal(plan.existing.codigoAdministradora, '008');
});

test('lote misto é conciliado e uma segunda importação não grava novamente', async () => {
  const payloads = Array.from({ length: 31 }, (_, index) => ({ ...data, subFinalizadoraKey: 5000 + index }));
  const records = new Map(payloads.slice(0, 20).map((value, index) => [value.subFinalizadoraKey, { ...value, codigoAdministradora: index < 10 ? value.codigoAdministradora : '099', mapaSubfinalizadoraTefKey: 100 + index }]));
  const writes = [];
  const api = new MappingApi('https://proxy.example', async (url, options) => {
    const target = new URL(new URL(url).searchParams.get('url'));
    if (options.method === 'GET') {
      const record = records.get(Number(target.searchParams.get('subFinalizadoraKey')));
      return Response.json(page(record ? [record] : []));
    }
    const payload = JSON.parse(options.body);
    const id = options.method === 'PUT' ? Number(target.pathname.split('/').at(-1)) : 200 + writes.length;
    if (options.method === 'PUT') assert.equal(id, records.get(payload.subFinalizadoraKey).mapaSubfinalizadoraTefKey);
    records.set(payload.subFinalizadoraKey, { ...payload, mapaSubfinalizadoraTefKey: id });
    writes.push(options.method);
    return new Response(null, { status: 204 });
  });
  const plans = [];
  for (const payload of payloads) plans.push(await api.plan('tenant', 'dummy', payload, 'reconcile'));
  assert.equal(writes.length, 0);
  assert.equal(plans.filter(plan => plan.action === 'unchanged').length, 10);
  assert.equal(plans.filter(plan => plan.action === 'update').length, 10);
  assert.equal(plans.filter(plan => plan.action === 'create').length, 11);
  for (const plan of plans) await api.execute('tenant', 'dummy', plan);
  assert.equal(writes.filter(method => method === 'PUT').length, 10);
  assert.equal(writes.filter(method => method === 'POST').length, 11);
  for (const payload of payloads) {
    const plan = await api.plan('tenant', 'dummy', payload, 'reconcile');
    assert.equal(await api.execute('tenant', 'dummy', plan), 'unchanged');
  }
  assert.equal(writes.length, 21);
});

test('envelope real do beta usa data/currentPage/pageSize e o nome SiTef', async () => {
  const record = { ...existing, tipoTef: 'SiTef', tipoTefKey: 1 };
  const { api, calls } = mock([
    { currentPage: 0, pageSize: 100, data: [record] },
    { currentPage: 1, pageSize: 100, data: [] },
  ]);
  const plan = await api.plan('beta', 'dummy', data);
  assert.equal(plan.action, 'unchanged');
  assert.equal(plan.existing.tipoTef, 'SITEF');
  assert.equal(calls.length, 2);
});

test('envelope data com página incorreta bloqueia envio', async () => {
  const { api } = mock([{ currentPage: 1, pageSize: 100, data: [] }]);
  await assert.rejects(api.plan('beta', 'dummy', data), /página diferente/);
});
