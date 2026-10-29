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
  assert.equal(calls[0].target.searchParams.has('subFinalizadoraKey'), false);
  assert.equal(calls[0].target.searchParams.get('codigoBandeira'), '12');
  assert.equal(calls[0].target.searchParams.get('tipoCartao'), data.tipoCartao);
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
  const old = { ...existing, subFinalizadoraKey: 99 };
  const { api, calls } = mock([page([old]), page([old]), new Response(null, { status: 204 })]);
  const plan = await api.plan('tenant', 'dummy', data);
  assert.deepEqual(plan.differences, ['subFinalizadoraKey']);
  assert.equal(await api.execute('tenant', 'dummy', plan), 'update');
  assert.equal(calls[2].method, 'PUT');
  assert.ok(calls[2].target.pathname.endsWith('/77'));
  assert.deepEqual(JSON.parse(calls[2].body), data);
});

test('outra bandeira é outra origem e não altera mapa do mesmo destino', async () => {
  const { api, calls } = mock([page([{ ...existing, codigoBandeira: 1 }])]);
  assert.equal((await api.plan('tenant', 'dummy', data)).action, 'create');
  assert.equal(calls.length, 1);
});

test('mais de um candidato bloqueia atualização mesmo se um for idêntico', async () => {
  const { api } = mock([page([existing, { ...existing, mapaSubfinalizadoraTefKey: 78 }])]);
  await assert.rejects(api.plan('tenant', 'dummy', data), /Mais de um/);
});

test('consulta todas as páginas e encontra candidato conflitante na segunda', async () => {
  const { api, calls } = mock([{ items: [existing], pagination: { totalPages: 2 } }, { items: [{ ...existing, mapaSubfinalizadoraTefKey: 78 }], pagination: { totalPages: 2 } }]);
  await assert.rejects(api.plan('tenant', 'dummy', data), /Mais de um/);
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
    [[existing], [existing]],
    [{ content: [], totalPages: 3 }], [{ content: [existing], totalPages: 0 }],
    [{ content: [existing], totalPages: 2 }, { content: [], totalPages: 1 }],
    [page([{ ...existing, mapaSubfinalizadoraTefKey: 2147483648 }])],
    [page([{ ...existing, codigoAdministradora: null }])],
  ];
  for (const responses of invalidResponses) {
    const { api, calls } = mock(responses);
    await assert.rejects(api.plan('tenant', 'dummy', data));
    assert.ok(calls.every(call => call.method === 'GET'));
  }
});

test('mudança entre revisão e execução bloqueia a gravação', async () => {
  const previous = { ...existing, subFinalizadoraKey: 99 };
  const { api, calls } = mock([page([previous]), page([{ ...previous, subFinalizadoraKey: 100 }])]);
  const plan = await api.plan('tenant', 'dummy', data);
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
  await assert.rejects(api.plan('tenant', 'dummy', data), e => e.status === 403);
  assert.equal(calls.length, 1);
});

test('conflito no POST não dispara PUT automático', async () => {
  const { api, calls } = mock([page([]), page([]), Response.json({ detail: 'Já cadastrado' }, { status: 409 })]);
  const plan = await api.plan('tenant', 'dummy', data);
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

test('zeros à esquerda da administradora distinguem origens e são preservados', async () => {
  const { api } = mock([page([{ ...existing, codigoAdministradora: '008' }])]);
  const plan = await api.plan('tenant', 'dummy', { ...data, codigoAdministradora: '8' });
  assert.equal(plan.action, 'create');
  assert.equal(plan.existing, null);
  assert.equal(plan.data.codigoAdministradora, '8');
});

test('lote misto é conciliado e uma segunda importação não grava novamente', async () => {
  const payloads = Array.from({ length: 31 }, (_, index) => ({ ...data, codigoBandeira: 12 + index, subFinalizadoraKey: 5000 + index }));
  const records = new Map(payloads.slice(0, 20).map((value, index) => [value.subFinalizadoraKey, { ...value, subFinalizadoraKey: index < 10 ? value.subFinalizadoraKey : 8000 + index, mapaSubfinalizadoraTefKey: 100 + index }]));
  const writes = [];
  let reads = 0;
  const api = new MappingApi('https://proxy.example', async (url, options) => {
    const target = new URL(new URL(url).searchParams.get('url'));
    if (options.method === 'GET') {
      reads++;
      assert.equal(target.searchParams.has('subFinalizadoraKey'), false);
      return Response.json(page([...records.values()]));
    }
    const payload = JSON.parse(options.body);
    const id = options.method === 'PUT' ? Number(target.pathname.split('/').at(-1)) : 200 + writes.length;
    if (options.method === 'PUT') assert.equal(id, records.get(payload.subFinalizadoraKey).mapaSubfinalizadoraTefKey);
    records.set(payload.subFinalizadoraKey, { ...payload, mapaSubfinalizadoraTefKey: id });
    writes.push(options.method);
    return new Response(null, { status: 204 });
  });
  const plans = (await api.planBatch('tenant', 'dummy', payloads)).map(entry => entry.plan);
  assert.equal(reads, 1);
  assert.equal(writes.length, 0);
  assert.equal(plans.filter(plan => plan.action === 'unchanged').length, 10);
  assert.equal(plans.filter(plan => plan.action === 'update').length, 10);
  assert.equal(plans.filter(plan => plan.action === 'create').length, 11);
  await api.executeBatch('tenant', 'dummy', plans);
  assert.equal(reads, 2);
  assert.equal(writes.filter(method => method === 'PUT').length, 10);
  assert.equal(writes.filter(method => method === 'POST').length, 11);
  const repeated = await api.planBatch('tenant', 'dummy', payloads);
  const results = await api.executeBatch('tenant', 'dummy', repeated.map(entry => entry.plan));
  assert.ok(results.every(result => result.action === 'unchanged'));
  assert.equal(reads, 4);
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
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target.searchParams.get('pageSize'), '1000');
});

test('envelope data com página incorreta bloqueia envio', async () => {
  const { api } = mock([{ currentPage: 1, pageSize: 100, data: [] }]);
  await assert.rejects(api.plan('beta', 'dummy', data), /página diferente/);
});

test('paginação usa o tamanho efetivo do ERP e inclui mapas das páginas seguintes', async () => {
  const second = { ...existing, mapaSubfinalizadoraTefKey: 78, codigoBandeira: 13, subFinalizadoraKey: 5027 };
  const third = { ...existing, mapaSubfinalizadoraTefKey: 79, codigoBandeira: 14, subFinalizadoraKey: 5028 };
  const { api, calls } = mock([
    { currentPage: 0, pageSize: 2, data: [existing, second] },
    { currentPage: 1, pageSize: 2, data: [third] },
  ]);
  const entries = await api.planBatch('beta', 'dummy', [data, { ...data, codigoBandeira: 14, subFinalizadoraKey: 5028 }]);
  assert.deepEqual(entries.map(entry => entry.plan.id), [77, 79]);
  assert.equal(calls.length, 2);
});

test('mudança no último item bloqueia o lote inteiro antes da primeira escrita', async () => {
  const second = { ...data, codigoBandeira: 99, subFinalizadoraKey: 999 };
  const { api, calls } = mock([page([]), page([{ ...second, mapaSubfinalizadoraTefKey: 78 }])]);
  const entries = await api.planBatch('beta', 'dummy', [data, second]);
  await assert.rejects(api.executeBatch('beta', 'dummy', entries.map(entry => entry.plan)), /999 mudou desde/);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET']);
});

test('ambiguidade em inventário compartilhado identifica somente a subfinalizadora afetada', async () => {
  const { api } = mock([page([existing, { ...existing, mapaSubfinalizadoraTefKey: 78 }])]);
  const entries = await api.planBatch('beta', 'dummy', [data, { ...data, codigoBandeira: 99, subFinalizadoraKey: 999 }]);
  assert.match(entries[0].error, /Mais de um/);
  assert.equal(entries[1].plan.action, 'create');
});

for (const cancel of [false, true]) test(`gravações têm no máximo quatro requisições simultâneas; cancelamento=${cancel}`, async () => {
  const payloads = Array.from({ length: 8 }, (_, i) => ({ ...data, codigoBandeira: 12 + i, subFinalizadoraKey: 9000 + i }));
  const pending = [];
  let active = 0, maximum = 0, writes = 0, cancelled = false;
  const completed = [];
  const api = new MappingApi('https://proxy.example', async (_, options) => {
    if (options.method === 'GET') return Response.json(page([]));
    writes++;
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => pending.push(resolve));
    active--;
    return new Response(null, { status: 204 });
  });
  const entries = await api.planBatch('beta', 'dummy', payloads);
  const run = api.executeBatch('beta', 'dummy', entries.map(entry => entry.plan), {
    isCancelled: () => cancelled,
    onResult: result => completed.push(result),
  });
  await new Promise(setImmediate);
  assert.equal(writes, 4);
  assert.equal(active, 4);
  cancelled = cancel;
  pending.splice(0).reverse().forEach(resolve => resolve());
  await new Promise(setImmediate);
  if (!cancel) {
    assert.equal(writes, 8);
    pending.splice(0).forEach(resolve => resolve());
  }
  const results = await run;
  assert.equal(maximum, 4);
  assert.equal(writes, cancel ? 4 : 8);
  assert.equal(completed.length, writes);
  assert.deepEqual(results.map(result => result.subFinalizadoraKey), payloads.slice(0, writes).map(item => item.subFinalizadoraKey));
});

for (const change of [
  { tipoTef: 'POS' }, { codigoAdministradora: '099' },
  { codigoBandeira: 99 }, { tipoCartao: 'CARTAO_DEBITO' },
]) test(`mesmo destino com outra origem não bloqueia o mapa correto: ${JSON.stringify(change)}`, async () => {
  const other = { ...existing, ...change, mapaSubfinalizadoraTefKey: 78 };
  const { api } = mock([page([other, existing])]);
  const plan = await api.plan('tenant', 'dummy', data);
  assert.equal(plan.action, 'unchanged');
  assert.equal(plan.id, 77);
});

test('origem vinculada a outro destino é localizada entre páginas e atualizada por ID', async () => {
  const previous = { ...existing, subFinalizadoraKey: 601 };
  const first = { ...existing, codigoAdministradora: '099', mapaSubfinalizadoraTefKey: 78 };
  const inventory = [{ content: [first], totalPages: 2 }, { content: [previous], totalPages: 2 }];
  const { api, calls } = mock([...inventory, ...inventory, new Response(null, { status: 204 })]);
  const plan = await api.plan('tenant', 'dummy', data);
  assert.equal(plan.action, 'update');
  assert.equal(plan.id, 77);
  assert.equal(plan.existing.subFinalizadoraKey, 601);
  assert.deepEqual(plan.differences, ['subFinalizadoraKey']);
  assert.equal(await api.execute('tenant', 'dummy', plan), 'update');
  assert.equal(calls.at(-1).target.pathname.split('/').at(-1), '77');
  assert.equal(calls.at(-1).method, 'PUT');
  assert.ok(calls.every(call => !call.target.searchParams.has('subFinalizadoraKey')));
});

test('nenhuma origem correspondente cria mesmo quando o destino já tem outros mapas', async () => {
  const { api } = mock([page([{ ...existing, codigoAdministradora: '099' }, { ...existing, tipoTef: 'POS', mapaSubfinalizadoraTefKey: 78 }])]);
  assert.equal((await api.plan('tenant', 'dummy', data)).action, 'create');
});

test('ambiguidade da mesma origem preserva IDs, destinos e diferenças de todos os candidatos', async () => {
  const { api } = mock([page([existing, { ...existing, mapaSubfinalizadoraTefKey: 78, subFinalizadoraKey: 601 }])]);
  const [entry] = await api.planBatch('tenant', 'dummy', [data]);
  assert.match(entry.error, /mesma combinação/);
  assert.deepEqual(entry.candidates.map(candidate => candidate.id), [77, 78]);
  assert.deepEqual(entry.candidates.map(candidate => candidate.differences), [[], ['subFinalizadoraKey']]);
  assert.deepEqual(entry.candidates.map(candidate => candidate.data.subFinalizadoraKey), [5026, 601]);
});

test('duas origens com mesmo destino são aceitas no lote; origem repetida não faz GET', async () => {
  const other = { ...data, codigoAdministradora: '099' };
  const { api, calls } = mock([page([])]);
  const entries = await api.planBatch('tenant', 'dummy', [data, other]);
  assert.ok(entries.every(entry => entry.plan.action === 'create'));
  const before = calls.length;
  await assert.rejects(api.planBatch('tenant', 'dummy', [data, { ...data, subFinalizadoraKey: 601 }]), /origem repetidas/);
  assert.equal(calls.length, before);
});

test('origem duplicada surgida na reconsulta impede todas as gravações', async () => {
  const { api, calls } = mock([page([existing]), page([existing, { ...existing, mapaSubfinalizadoraTefKey: 78, subFinalizadoraKey: 601 }])]);
  const plan = await api.plan('tenant', 'dummy', data);
  await assert.rejects(api.execute('tenant', 'dummy', plan), /mudou desde/);
  assert.ok(calls.every(call => call.method === 'GET'));
});
