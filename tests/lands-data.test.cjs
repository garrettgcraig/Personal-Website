const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseCSV, csvCell, matchImport } = require('../assets/js/lands-data.js');
const scope = { window: {} };
vm.runInNewContext(fs.readFileSync('assets/js/lands-wid-names.js', 'utf8'), scope);
const widNames = scope.window.LANDS_WID_NAMES;
const data = {};
for (const [type, file, key] of [['wilderness', 'wilderness', 'name'], ['nps', 'nps', 'code'], ['national_forest', 'national_forests', 'name']]) {
  data[type] = Object.create(null);
  for (const f of JSON.parse(fs.readFileSync(`data/${file}.geojson`)).features) {
    const p = f.properties;
    const old = data[type][p[key]];
    data[type][p[key]] = { ...p, names: [...(old?.names || []), p.name] };
  }
}
test('CSV round trip preserves commas, quotes, CRLF, multiline and Unicode', () => {
  const rows = [['type', 'name'], ['wilderness', 'A, "B"\nC é'], ['nps', '普通']];
  assert.deepEqual(parseCSV('\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')), rows);
});
test('malformed input fails before changing visits', () => {
  assert.throws(() => parseCSV('name\n"unfinished'), /unfinished/);
  assert.throws(() => parseCSV('name\n"closed"junk'), /Invalid/);
  assert.throws(() => matchImport(parseCSV('foo\nbar'), data, widNames), /column/);
});
test('old Shiny CSV imports wilderness by WID, including WID-only files', () => {
  const result = matchImport(parseCSV('wid\n707'), data, widNames);
  assert.deepEqual(result.matches, [{ type: 'wilderness', key: 'Beaver Basin Wilderness' }]);
});
test('current CSVs match each layer and ignore unknown IDs/types', () => {
  const result = matchImport(parseCSV('type,key,name,code\nwilderness,Beaver Basin Wilderness,,\nnps,,,APIS\nnational_forest,,Modoc National Forest,\nnps,,,UNKNOWN\ninvalid,,Beaver Basin Wilderness,'), data, widNames);
  assert.equal(result.matches.length, 3);
  assert.equal(result.unmatched, 2);
});
test('shared park/preserve code matches either constituent name', () => {
  const result = matchImport(parseCSV('type,name\nnps,Denali National Park\nnps,Denali National Preserve'), data, widNames);
  assert.deepEqual(result.matches.map(r => r.key), ['DENA', 'DENA']);
});
test('name-only legacy exports and ambiguous names are handled conservatively', () => {
  assert.equal(matchImport(parseCSV('name\nBeaver Basin Wilderness'), data, widNames).matches.length, 1);
  const ambiguous = { wilderness: { a: {name:'Same'} }, national_forest: { b: {name:'Same'} } };
  assert.equal(matchImport(parseCSV('name\nSame'), ambiguous, {}).unmatched, 1);
});
