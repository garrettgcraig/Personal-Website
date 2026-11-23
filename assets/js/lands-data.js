/* Pure data helpers shared by the tracker and regression tests. */
(function (root) {
  'use strict';
  function parseCSV(text) {
    var rows = [], row = [], value = '', quoted = false, closed = false;
    text = text.replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; }
        else if (ch === '"') { quoted = false; closed = true; }
        else value += ch;
      } else if (ch === ',' || ch === '\n' || ch === '\r') {
        row.push(value); value = ''; closed = false;
        if (ch !== ',') {
          if (row.some(function (v) { return v.trim(); })) rows.push(row);
          row = [];
          if (ch === '\r' && text[i + 1] === '\n') i++;
        }
      } else if (ch === '"' && !value && !closed) quoted = true;
      else {
        if (closed || ch === '"') throw new Error('Invalid CSV quoting. Export a new CSV and try again.');
        value += ch;
      }
    }
    if (quoted) throw new Error('An unfinished quoted field was found in the CSV.');
    row.push(value);
    if (row.some(function (v) { return v.trim(); })) rows.push(row);
    return rows;
  }
  function csvCell(value) {
    return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  }
  function nameKey(data, name) {
    var keys = Object.keys(data);
    var matches = keys.filter(function (key) {
      return data[key].name.toLowerCase() === name.toLowerCase() ||
        (data[key].names || []).some(function (n) { return n.toLowerCase() === name.toLowerCase(); });
    });
    return matches.length === 1 ? matches[0] : null;
  }
  function matchImport(rows, data, widNames) {
    if (rows.length < 2) throw new Error('CSV has no visit rows.');
    var header = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    if (!['key', 'name', 'code', 'wid'].some(function (h) { return header.includes(h); })) {
      throw new Error('CSV needs a key, name, code, or wid column.');
    }
    var matches = [], unmatched = 0;
    rows.slice(1).forEach(function (row) {
      function cell(h) { return (row[header.indexOf(h)] || '').trim(); }
      var type = cell('type'), candidates = [];
      // Explicit unknown types must never be guessed into a different layer.
      var types = type ? (Object.hasOwn(data, type) ? [type] : []) : Object.keys(data);
      types.forEach(function (lt) {
        var features = data[lt], key = cell('key'), code = cell('code');
        if (!Object.hasOwn(features, key)) key = '';
        if (!key && lt === 'nps' && Object.hasOwn(features, code)) key = code;
        if (!key && lt === 'wilderness' && cell('wid')) {
          var name = widNames[String(Number(cell('wid')))];
          if (name) key = nameKey(features, name);
        }
        if (!key && cell('name')) key = nameKey(features, cell('name'));
        if (key) candidates.push({ type: lt, key: key });
      });
      if (candidates.length === 1) matches.push(candidates[0]);
      else unmatched++;
    });
    return { matches: matches, unmatched: unmatched };
  }
  // Containment (data/lands-containment.json): units that sit wholly inside other units.
  // up[type][key] lists every unit containing it (already transitive); down is the reverse.
  function containmentIndex(json) {
    var up = Object.create(null), down = Object.create(null);
    var contained = (json && json.contained) || {};
    Object.keys(contained).forEach(function (type) {
      Object.keys(contained[type]).forEach(function (key) {
        (contained[type][key] || []).forEach(function (pair) {
          var ct = String(pair[0]), ck = String(pair[1]);
          (up[type] = up[type] || Object.create(null));
          (up[type][key] = up[type][key] || []).push({ type: ct, key: ck });
          (down[ct] = down[ct] || Object.create(null));
          (down[ct][ck] = down[ct][ck] || []).push({ type: type, key: key });
        });
      });
    });
    return { up: up, down: down };
  }
  function has(visited, unit) { return !!(visited[unit.type] && visited[unit.type].has(unit.key)); }
  function unitId(unit) { return unit.type + '\u0000' + unit.key; }
  // Containers of the given units that are not visited yet. `exists(unit)` filters out
  // units missing from the loaded boundaries.
  function containersToAdd(index, visited, units, exists) {
    var seen = Object.create(null), out = [];
    units.forEach(function (unit) {
      ((index.up[unit.type] || {})[unit.key] || []).forEach(function (c) {
        var id = unitId(c);
        if (seen[id] || has(visited, c) || (exists && !exists(c))) return;
        seen[id] = true; out.push(c);
      });
    });
    return out;
  }
  // After `unit` is unmarked: its visited containers that no other visited unit still sits inside.
  function containersToOffer(index, visited, unit) {
    var self = unitId(unit);
    return ((index.up[unit.type] || {})[unit.key] || []).filter(function (c) {
      if (!has(visited, c)) return false;
      return !((index.down[c.type] || {})[c.key] || []).some(function (inner) {
        return unitId(inner) !== self && has(visited, inner);
      });
    });
  }
  var api = { parseCSV: parseCSV, csvCell: csvCell, nameKey: nameKey, matchImport: matchImport,
    containmentIndex: containmentIndex, containersToAdd: containersToAdd, containersToOffer: containersToOffer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LandsData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
