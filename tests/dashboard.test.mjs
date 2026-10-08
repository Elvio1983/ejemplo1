import assert from 'node:assert/strict';
import test from 'node:test';
import { BASIC_CSV, createDashboard, csvResponse, plain } from './helpers/dashboard.mjs';

test('normalizes a Google Sheets edit link and trims whitespace', async () => {
  const { api } = await createDashboard();
  assert.equal(api.normalizeUrl(' https://docs.google.com/spreadsheets/d/example-ID/edit '),
    'https://docs.google.com/spreadsheets/d/example-ID/export?format=csv');
});

test('keeps an existing CSV export and a direct CSV URL', async () => {
  const { api } = await createDashboard();
  for (const url of [
    'https://docs.google.com/spreadsheets/d/example-ID/export?format=csv',
    'https://example.test/grades.csv',
  ]) assert.equal(api.normalizeUrl(url), url);
});

for (const [name, input, expected] of [
  ['LF and final newline', 'Nombre,Nota\nAna,12\n', [['Nombre', 'Nota'], ['Ana', '12']]],
  ['CRLF', 'Nombre,Nota\r\nAna,12\r\n', [['Nombre', 'Nota'], ['Ana', '12']]],
  ['CR', 'Nombre,Nota\rAna,12', [['Nombre', 'Nota'], ['Ana', '12']]],
  ['quoted comma', 'Nombre,Nota\n"Perez, Ana",12', [['Nombre', 'Nota'], ['Perez, Ana', '12']]],
  ['escaped quotes', 'Nombre,Nota\n"Ana ""A""",12', [['Nombre', 'Nota'], ['Ana "A"', '12']]],
  ['quoted newline', 'Nombre,Nota\n"Ana\nPerez",12', [['Nombre', 'Nota'], ['Ana\nPerez', '12']]],
  ['empty last cell', 'Nombre,Nota\nAna,', [['Nombre', 'Nota'], ['Ana', '']]],
  ['blank rows and surrounding spaces', '\n Nombre , Nota \n,,\n Ana , 12 \n', [['Nombre', 'Nota'], ['Ana', '12']]],
  ['UTF-8 BOM', '\uFEFFNombre,Nota\nAna,12', [['Nombre', 'Nota'], ['Ana', '12']]],
  ['empty input', '', []],
]) {
  test(`parseCSV: ${name}`, async () => {
    const { api } = await createDashboard();
    assert.deepEqual(plain(api.parseCSV(input)), expected);
  });
}

test('detects name and grade columns regardless of column order', async () => {
  const { api } = await createDashboard();
  api.detectCols(['Calificación final', 'Código', 'Nombre completo']);
  assert.equal(api.ST.nota, 0);
  assert.equal(api.ST.nombre, 2);
});

test('uses the current column fallback for unknown headings', async () => {
  const { api } = await createDashboard();
  api.detectCols(['Alumno', 'Resultado']);
  assert.equal(api.ST.nota, 1);
  assert.equal(api.ST.nombre, 0);
});

test('converts ordinary decimal grades and rejects malformed numeric punctuation', async () => {
  const { api } = await createDashboard();
  for (const [input, expected] of [['12', 12], [' 12.5 ', 12.5], ['12,5', 12.5], [0, 0], ['--', null]]) {
    assert.equal(api.toNum(input), expected);
  }
});

test('median handles odd, even, empty and unsorted input without mutation', async () => {
  const { api } = await createDashboard();
  const values = [18, 10, 11];
  assert.equal(api.median(values), 11);
  assert.deepEqual(values, [18, 10, 11]);
  assert.equal(api.median([18, 10, 11, 13]), 12);
  assert.equal(api.median([]), 0);
  assert.equal(api.median([7]), 7);
});

test('filters at the exact passing boundary of 11', async () => {
  const { api, element } = await createDashboard();
  api.ST.rows = [['Ana', '10.99'], ['Bruno', '11'], ['Carla', '18'], ['Invalido', '--']];
  element('estado').value = 'aprobado';
  assert.deepEqual(plain(api.getRows().map(row => row.nota)), [18, 11]);
  element('estado').value = 'desaprobado';
  assert.deepEqual(plain(api.getRows().map(row => row.nota)), [10.99]);
});

test('sorts grades ascending and descending without changing source rows', async () => {
  const { api, element } = await createDashboard();
  const before = plain(api.ST.rows);
  element('orden').value = 'asc';
  assert.deepEqual(plain(api.getRows().map(row => row.nota)), [10, 11, 18]);
  element('orden').value = 'desc';
  assert.deepEqual(plain(api.getRows().map(row => row.nota)), [18, 11, 10]);
  assert.deepEqual(plain(api.ST.rows), before);
});

test('sorts names using the Spanish locale', async () => {
  const { api, element } = await createDashboard();
  api.ST.rows = [['Zoe', '13'], ['Bruno', '12'], ['Ana', '11']];
  element('orden').value = 'nombre';
  assert.deepEqual(plain(api.getRows().map(row => row[0])), ['Ana', 'Bruno', 'Zoe']);
});

test('search is trimmed, case insensitive and combines with status filtering', async () => {
  const { api, element } = await createDashboard();
  api.ST.rows = [['Ana Perez', '10'], ['Ana Ruiz', '18'], ['Bruno', '11']];
  element('buscar').value = ' ANA ';
  assert.equal(api.getRows().length, 2);
  element('estado').value = 'aprobado';
  assert.deepEqual(plain(api.getRows().map(row => row[0])), ['Ana Ruiz']);
  element('buscar').value = 'sin coincidencias';
  assert.equal(api.getRows().length, 0);
});

test('renders KPIs and tables from the real startup load', async () => {
  const { api, element, requests, draws } = await createDashboard();
  assert.equal(requests.length, 1);
  assert.equal(api.ST.rows.length, 3);
  for (const [id, expected] of Object.entries({
    kTotal: 3, kProm: '13.00', kMed: '11.00', kMax: '18.00', kApr: '66.7%', kDes: '33.3%',
  })) assert.equal(element(id).textContent, expected);
  assert.match(element('top').innerHTML, /Carla/);
  assert.match(element('full').innerHTML, /Desaprobado/);
  assert.ok(draws.some(draw => draw.id === 'bar' && draw.method === 'fillRect'));
  assert.ok(draws.some(draw => draw.id === 'donut' && draw.method === 'arc'));
  assert.ok(draws.flatMap(draw => draw.args).filter(arg => typeof arg === 'number').every(Number.isFinite));
  assert.match(element('status').textContent, /Datos cargados correctamente \(3 filas\)/);
  assert.match(element('lastUpdate').textContent, /Última actualización: .+/);
});

test('empty filtered results render zero KPIs without NaN or Infinity', async () => {
  const { api, element } = await createDashboard();
  element('buscar').value = 'sin coincidencias';
  api.render();
  assert.equal(element('kTotal').textContent, 0);
  for (const id of ['kProm', 'kMed', 'kMax']) assert.equal(element(id).textContent, '0.00');
  for (const id of ['kApr', 'kDes']) assert.equal(element(id).textContent, '0.0%');
  assert.doesNotMatch(element('full').innerHTML, /NaN|Infinity|undefined/);
});

test('top table is limited to the 15 highest grades even with ascending detail order', async () => {
  const { api, element } = await createDashboard();
  api.ST.rows = Array.from({ length: 20 }, (_, i) => [`Alumno-${i + 1}`, String(i + 1)]);
  element('orden').value = 'asc';
  api.render();
  const body = element('top').innerHTML.split('<tbody>')[1];
  assert.equal((body.match(/<tr>/g) ?? []).length, 15);
  assert.match(body, /^<tr><td>1<\/td><td>Alumno-20<\/td>/);
  assert.doesNotMatch(body, /<td>Alumno-5<\/td>/);
});

test('control events update the dashboard and Cargar reloads the fixture', async () => {
  const { element, requests, windowEvents } = await createDashboard();
  element('buscar').value = 'Bruno';
  element('buscar').listeners.get('input')();
  assert.equal(element('kTotal').textContent, 1);
  element('estado').value = 'desaprobado';
  element('estado').listeners.get('change')();
  assert.equal(element('kTotal').textContent, 0);
  element('orden').listeners.get('change')();
  windowEvents.get('resize')();
  await element('loadBtn').listeners.get('click')();
  assert.equal(requests.length, 2);
});

test('loadData uses a normalized Sheets URL with a mocked response', async () => {
  const { api, element, requests } = await createDashboard();
  element('csvUrl').value = ' https://docs.google.com/spreadsheets/d/example-ID/edit ';
  await api.loadData();
  assert.equal(requests.at(-1)[0], 'https://docs.google.com/spreadsheets/d/example-ID/export?format=csv');
  assert.equal(element('csvUrl').value, requests.at(-1)[0]);
  assert.equal(api.ST.rows.length, 3);
});

test('HTTP failure reports status and preserves previously loaded rows', async () => {
  let fail = false;
  const { api, element } = await createDashboard({
    fetchImpl: async () => fail ? { ok: false, status: 403 } : csvResponse(BASIC_CSV),
  });
  fail = true;
  await api.loadData();
  assert.match(element('status').textContent, /Error al cargar: HTTP 403/);
  assert.equal(api.ST.rows.length, 3);
});

test('network failure is caught by the actual initial load', async () => {
  const { api, element } = await createDashboard({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.match(element('status').textContent, /Error al cargar: offline/);
  assert.equal(api.ST.rows.length, 0);
});

test('invalid CSV with fewer than two columns reports a useful error', async () => {
  const { api, element } = await createDashboard({ fetchImpl: async () => csvResponse('SoloColumna\nAna') });
  assert.match(element('status').textContent, /CSV inválido: faltan columnas/);
  assert.equal(api.ST.rows.length, 0);
});

// Executable regression specifications for defects already present in PR #2.
// node:test reports them as TODO; they do not make the initial CI red.
// Remove each todo option in the same change that fixes the production defect.
test('toNum should reject blank and non-numeric grades', { todo: 'PR #2: empty/invalid grades currently become zero' }, async () => {
  const { api } = await createDashboard();
  for (const value of ['', ' ', null, undefined, 'abc', '12abc']) assert.equal(api.toNum(value), null);
});

test('normalizeUrl should preserve the selected Sheets gid', { todo: 'PR #2: normalization drops gid' }, async () => {
  const { api } = await createDashboard();
  assert.equal(api.normalizeUrl('https://docs.google.com/spreadsheets/d/example-ID/edit#gid=42'),
    'https://docs.google.com/spreadsheets/d/example-ID/export?format=csv&gid=42');
});

test('parseCSV should reject unterminated quotes', { todo: 'PR #2: unmatched CSV quotes are accepted' }, async () => {
  const { api } = await createDashboard();
  assert.throws(() => api.parseCSV('Nombre,Nota\n"Ana,12'), /CSV|comilla|quote/i);
});

test('render should escape imported cell markup', { todo: 'PR #2: CSV is interpolated into innerHTML without escaping' }, async () => {
  const { api, element } = await createDashboard();
  api.ST.rows = [['<img src=x onerror=alert(1)>', '18']];
  api.render();
  for (const id of ['top', 'full']) {
    assert.doesNotMatch(element(id).innerHTML, /<img\b/i);
    assert.match(element(id).innerHTML, /&lt;img/);
  }
});
