import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as XLSX from 'xlsx';

const source = (await readFile(new URL('../src/workers/excel.worker.js', import.meta.url), 'utf8')).replace('import * as XLSX from "xlsx";', '');
function parse(bytes) {
  let response;
  const self = { postMessage(value) { response = value; } };
  vm.runInNewContext(source, { XLSX, self, Uint8Array });
  self.onmessage({ data: bytes });
  return response;
}

test('worker lê XLSX e XLS com as colunas e códigos textuais preservados', () => {
  const rows = [{ sub_finalizadora_key: 5001, codigo_autorizadora: '008', codigo_bandeira: 20001, tipo_tef_key: 1, tipo_cartao: 'Cartão de Débito' }];
  for (const bookType of ['xlsx', 'biff8']) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'report');
    const response = parse(XLSX.write(book, { type: 'buffer', bookType }));
    assert.equal(response.ok, true);
    assert.deepEqual(response.data, rows);
  }
});

test('worker retorna erro estruturado quando não consegue interpretar o arquivo', () => {
  const response = parse(new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0]));
  assert.equal(response.ok, false);
  assert.match(response.error, /ZIP/);
});
