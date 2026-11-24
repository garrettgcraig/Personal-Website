const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseCSV, csvCell, matchImport, containmentIndex, planContainers, containersToOffer } = require('../assets/js/lands-data.js');
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
const containment = JSON.parse(fs.readFileSync('data/lands-containment.json'));
const index = containmentIndex(containment);
const sets = (obj) => Object.fromEntries(Object.entries(obj).map(([t, keys]) => [t, new Set(keys)]));
test('containment file only names units in the bundled boundaries', () => {
  for (const [type, units] of Object.entries(containment.contained)) {
    for (const [key, containers] of Object.entries(units)) {
      assert.ok(data[type][key], `${type} ${key} is missing`);
      assert.ok(containers.length > 0);
      for (const [ct, ck] of containers) {
        assert.ok(data[ct][ck], `${ct} ${ck} is missing`);
        assert.notEqual(ct, 'wilderness', 'a wilderness never contains another unit');
        assert.ok(!(ct === type && ck === key));
      }
    }
  }
});
test('known containments are present and neighbors are not', () => {
  const up = (type, key) => index.get(index.up, { type, key }).map(c => c.key).sort();
  assert.deepEqual(up('wilderness', 'Yosemite Wilderness'), ['YOSE']);
  assert.deepEqual(up('wilderness', 'San Rafael Wilderness'), ['Los Padres National Forest']);
  assert.deepEqual(up('wilderness', 'John Muir Wilderness'), ['Inyo National Forest', 'Sierra National Forest']);
  // Buckhorn borders Olympic National Park; simplified edges overlap it a little.
  assert.deepEqual(up('wilderness', 'Buckhorn Wilderness'), ['Olympic National Forest']);
  // Nearest container only: Lava Beds NM lies inside Modoc NF, so the wilderness lists just the monument.
  assert.deepEqual(up('wilderness', 'Lava Beds Wilderness'), ['LABE']);
});
test('a single container is marked, following containers of containers', () => {
  const visited = sets({ wilderness: [], nps: [], national_forest: [] });
  const plan = planContainers(index, visited, [{ type: 'wilderness', key: 'Lava Beds Wilderness' }]);
  assert.deepEqual(plan.add, [{ type: 'nps', key: 'LABE' }, { type: 'national_forest', key: 'Modoc National Forest' }]);
  assert.deepEqual(plan.choices, []);
  assert.deepEqual(planContainers(index, visited, [{ type: 'wilderness', key: 'San Rafael Wilderness' }], () => false), { add: [], choices: [] });
});
test('several containers become a choice, leaving out ones already visited', () => {
  const visited = sets({ wilderness: [], nps: [], national_forest: [] });
  const unit = { type: 'wilderness', key: 'John Muir Wilderness' };
  const plan = planContainers(index, visited, [unit]);
  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.choices.map(c => c.options.map(o => o.key).sort()), [['Inyo National Forest', 'Sierra National Forest']]);
  visited.national_forest.add('Inyo National Forest');
  assert.deepEqual(planContainers(index, visited, [unit]).choices[0].options, [{ type: 'national_forest', key: 'Sierra National Forest' }]);
  visited.national_forest.add('Sierra National Forest');
  assert.deepEqual(planContainers(index, visited, [unit]), { add: [], choices: [] });
});
test('unmarking offers containers unless another visited unit still sits inside them', () => {
  const visited = sets({ wilderness: ['Sespe Wilderness'], nps: ['LABE'], national_forest: ['Los Padres National Forest', 'Modoc National Forest'] });
  const unit = { type: 'wilderness', key: 'San Rafael Wilderness' };
  assert.deepEqual(containersToOffer(index, visited, unit), []);
  visited.wilderness.delete('Sespe Wilderness');
  assert.deepEqual(containersToOffer(index, visited, unit), [{ type: 'national_forest', key: 'Los Padres National Forest' }]);
  assert.deepEqual(containersToOffer(index, visited, { type: 'wilderness', key: 'Lava Beds Wilderness' }).map(c => c.key).sort(), ['LABE', 'Modoc National Forest']);
});
