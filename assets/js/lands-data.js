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
  // up[type][key] lists a unit's nearest containers; all[type][key] adds containers of containers;
  // down is the reverse of all.
  function unitId(unit) { return unit.type + '\u0000' + unit.key; }
  function containmentIndex(json) {
    var up = Object.create(null), all = Object.create(null), down = Object.create(null);
    var contained = (json && json.contained) || {};
    var get = function (map, unit) { return (map[unit.type] && map[unit.type][unit.key]) || []; };
    var put = function (map, unit, value) {
      map[unit.type] = map[unit.type] || Object.create(null);
      (map[unit.type][unit.key] = map[unit.type][unit.key] || []).push(value);
    };
    Object.keys(contained).forEach(function (type) {
      Object.keys(contained[type]).forEach(function (key) {
        (contained[type][key] || []).forEach(function (pair) {
          put(up, { type: type, key: key }, { type: String(pair[0]), key: String(pair[1]) });
        });
      });
    });
    Object.keys(up).forEach(function (type) {
      Object.keys(up[type]).forEach(function (key) {
        var unit = { type: type, key: key }, seen = Object.create(null), stack = get(up, unit).slice();
        seen[unitId(unit)] = true;
        while (stack.length) {
          var c = stack.pop(), id = unitId(c);
          if (seen[id]) continue;
          seen[id] = true;
          put(all, unit, c); put(down, c, unit);
          stack.push.apply(stack, get(up, c));
        }
      });
    });
    return { up: up, all: all, down: down, get: get };
  }
  function has(visited, unit) { return !!(visited[unit.type] && visited[unit.type].has(unit.key)); }
  // What marking `units` implies. Walking up from each unit, a single nearest container is added
  // automatically (and the walk continues from it); several nearest containers stop the walk and
  // become a choice for the visitor. Units failing `exists` (absent from the loaded boundaries) are skipped.
  function planContainers(index, visited, units, exists) {
    var seen = Object.create(null), add = [], choices = [], asked = Object.create(null);
    units.forEach(function (unit) { seen[unitId(unit)] = true; });
    units.forEach(function (start) {
      var cur = start;
      while (cur) {
        var near = index.get(index.up, cur).filter(function (c) { return !exists || exists(c); });
        if (near.length === 1) {
          var c = near[0], id = unitId(c);
          if (seen[id]) break;
          seen[id] = true;
          if (!has(visited, c)) add.push(c);
          cur = c;
        } else {
          var options = near.filter(function (c) { return !has(visited, c) && !asked[unitId(c)]; });
          if (options.length) {
            options.forEach(function (c) { asked[unitId(c)] = true; });
            choices.push({ unit: cur, options: options });
          }
          cur = null;
        }
      }
    });
    return { add: add, choices: choices };
  }
  // After `unit` is unmarked: its visited containers that no other visited unit still sits inside.
  // Containers that are themselves on offer don't count as keeping each other.
  function containersToOffer(index, visited, unit) {
    var skip = Object.create(null);
    skip[unitId(unit)] = true;
    var candidates = index.get(index.all, unit).filter(function (c) { return has(visited, c); });
    candidates.forEach(function (c) { skip[unitId(c)] = true; });
    return candidates.filter(function (c) {
      return !index.get(index.down, c).some(function (inner) { return !skip[unitId(inner)] && has(visited, inner); });
    });
  }
  var api = { parseCSV: parseCSV, csvCell: csvCell, nameKey: nameKey, matchImport: matchImport,
    containmentIndex: containmentIndex, planContainers: planContainers, containersToOffer: containersToOffer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LandsData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
