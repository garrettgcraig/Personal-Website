(function () {
	"use strict";

	// ── Layer configuration ──
	var LAYERS = {
		wilderness: {
			file: "data/wilderness.geojson",
			keyProp: "name",
			storageKey: "lands_visited_wilderness",
			colorUnvisited: "#4a7c59",
			colorVisited: "#a8d84e",
			dotColor: "#4a7c59",
			label: "Wilderness"
		},
		nps: {
			file: "data/nps.geojson",
			keyProp: "code",
			storageKey: "lands_visited_nps",
			colorUnvisited: "#8B4513",
			colorVisited: "#e8a735",
			dotColor: "#8B4513",
			label: "NPS"
		},
		national_forest: {
			file: "data/national_forests.geojson",
			keyProp: "name",
			storageKey: "lands_visited_national_forest",
			colorUnvisited: "#3565a0",
			colorVisited: "#5cb3e8",
			dotColor: "#3565a0",
			label: "Nat'l Forest"
		}
	};

	// ── State ──
	var visited = {};          // { layerType: Set of keys }
	var featureIndex = {};     // { layerType: { key: leafletLayer } }
	var featureData = {};      // { layerType: { key: { name, state, acres, ... } } }
	var geojsonLayers = {};    // { layerType: L.geoJSON layer group }
	var allSearchItems = [];   // unified search index
	var layerVisible = { wilderness: true, nps: true, national_forest: true };
	var sortCol = "name";
	var sortAsc = true;
var dataReady = false;
var loading = false;
var loadErrors = [];
var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function announce(message) { document.getElementById('action-status').textContent = message; }
function storageWarning(message) { document.getElementById('save-status').textContent = message; }
if (!window.L) {
 document.getElementById('data-status').textContent = 'The map library could not load. Reload this page to try again.';
 document.getElementById('btn-import').disabled = true;
 document.getElementById('btn-export').disabled = true;
 return;
}

	// ── Persistence: retain existing storage keys and legacy WID backup. ──
	function saveVisited(layerType) {
		var cfg = LAYERS[layerType];
		try {
			localStorage.setItem(cfg.storageKey, JSON.stringify(Array.from(visited[layerType])));
		} catch (_) { storageWarning("Browser saving is unavailable. Export a CSV before closing this page."); }
	}

	function loadVisited(layerType) {
		var cfg = LAYERS[layerType];
		visited[layerType] = new Set();
		try {
			var raw = localStorage.getItem(cfg.storageKey);
			if (raw) {
				var arr = JSON.parse(raw);
				if (Array.isArray(arr)) visited[layerType] = new Set(arr.map(String));
			}
		} catch (_) { storageWarning("Saved visits could not be read. Import your CSV backup; the stored copy has been retained."); }
	}

	function saveAllVisited() {
		Object.keys(LAYERS).forEach(function (lt) { saveVisited(lt); });
	}

	// ── Formatting ──
	function fmtNum(n) {
		if (n == null || isNaN(n)) return "\u2014";
		return Number(n).toLocaleString("en-US");
	}

	// ── Enabled layer types (based on checkbox state) ──
	function enabledTypes() {
		return Object.keys(LAYERS).filter(function (lt) { return layerVisible[lt]; });
	}

	// ── Stats ──
	function updateStats() {
		var types = enabledTypes();
		var totalCount = 0;
		var visitedCount = 0;
		var totalAcres = 0;

		types.forEach(function (lt) {
			var data = featureData[lt] || {};
			var keys = Object.keys(data);
			totalCount += keys.length;
			var vis = visited[lt] || new Set();
			vis.forEach(function (key) {
				if (data[key]) {
					visitedCount++;
					totalAcres += (data[key].acres || 0);
				}
			});
		});

		var pct = totalCount > 0 ? (100 * visitedCount / totalCount).toFixed(1) : "0.0";
		document.getElementById("stat-count").textContent = visitedCount;
		document.getElementById("stat-pct").textContent = pct + "%";
		document.getElementById("stat-total-label").textContent = "of " + fmtNum(totalCount);
		document.getElementById("stat-acres").textContent = fmtNum(totalAcres);
		document.getElementById("progress-bar").style.width = pct + "%";

		// Update per-layer counts
		Object.keys(LAYERS).forEach(function (lt) {
			var data = featureData[lt] || {};
			var total = Object.keys(data).length;
			var vis = visited[lt] || new Set();
			var count = 0;
			vis.forEach(function (key) { if (data[key]) count++; });
			var el = document.getElementById("count-" + lt);
			if (el) el.textContent = count + " / " + total;
		});
	}

	// ── Visited table ──
	function renderTable() {
		var tbody = document.getElementById("visited-tbody");
		var types = enabledTypes();
		var rows = [];

		types.forEach(function (lt) {
			var vis = visited[lt] || new Set();
			var data = featureData[lt] || {};
			vis.forEach(function (key) {
				var d = data[key];
				if (d) {
					rows.push({
						layerType: lt,
						key: key,
						name: d.name || "Unknown",
						state: d.state || d.region || "",
						acres: d.acres || 0,
						type: lt
					});
				}
			});
		});

		if (rows.length === 0) {
			tbody.innerHTML = '<tr><td colspan="4" class="empty-msg">Click areas on the map to start tracking.</td></tr>';
			return;
		}

		rows.sort(function (a, b) {
			var va = a[sortCol], vb = b[sortCol];
			if (sortCol === "acres") {
				va = va || 0; vb = vb || 0;
				return sortAsc ? va - vb : vb - va;
			}
			if (sortCol === "type") {
				va = (va || "").toLowerCase();
				vb = (vb || "").toLowerCase();
			} else {
				va = (va || "").toString().toLowerCase();
				vb = (vb || "").toString().toLowerCase();
			}
			if (va < vb) return sortAsc ? -1 : 1;
			if (va > vb) return sortAsc ? 1 : -1;
			return 0;
		});

		var html = "";
		rows.forEach(function (d) {
			var cfg = LAYERS[d.layerType];
			html += '<tr tabindex="0" aria-label="Zoom to ' + escAttr(d.name) + '" data-layer="' + d.layerType + '" data-key="' + escAttr(d.key) + '">'
				+ '<td><span class="type-dot" style="background:' + cfg.dotColor + ';" title="' + cfg.label + '"></span></td>'
				+ "<td>" + escHtml(d.name) + "</td>"
				+ "<td>" + escHtml(d.state) + "</td>"
				+ "<td>" + fmtNum(d.acres) + "</td>"
				+ "</tr>";
		});
		tbody.innerHTML = html;
	}

	function escHtml(s) {
		var div = document.createElement("div");
		div.appendChild(document.createTextNode(s));
		return div.innerHTML;
	}
	function escAttr(s) {
		return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	// ── Table sort headers ──
	document.querySelectorAll(".visited-table th[data-sort]").forEach(function (th) {
		th.addEventListener("click", function () {
			var col = th.getAttribute("data-sort");
			if (sortCol === col) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = true; }
			document.querySelectorAll(".visited-table th .sort-arrow").forEach(function (s) { s.textContent = ""; });
			th.querySelector(".sort-arrow").textContent = sortAsc ? " \u25B2" : " \u25BC";
			renderTable();
		});
	});

	document.querySelectorAll('.visited-table th[data-sort]').forEach(function (th) {
 th.tabIndex = 0;
 th.setAttribute('aria-label', 'Sort by ' + th.dataset.sort);
 th.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); } });
});
document.getElementById('visited-tbody').addEventListener('keydown', function (e) {
 if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-key]')) { e.preventDefault(); e.target.click(); }
});
// ── Table row click -> fly to feature ──
	document.getElementById("visited-tbody").addEventListener("click", function (e) {
		var row = e.target.closest("tr[data-key]");
		if (!row) return;
		var lt = row.getAttribute("data-layer");
		var key = row.getAttribute("data-key");
		var idx = featureIndex[lt];
		if (idx && idx[key]) {
			var layer = idx[key];
			if (layer.getBounds) {
				map.flyToBounds(layer.getBounds(), { maxZoom: 11, duration: reducedMotion ? 0 : 1 });
			} else if (layer.getLatLng) {
				map.flyTo(layer.getLatLng(), 11, { duration: reducedMotion ? 0 : 1 });
			}
		}
	});

	// ── Feature styling ──
	function styleFeature(layer, layerType, isVisited) {
		var cfg = LAYERS[layerType];
		layer.setStyle({
			fillColor:   isVisited ? cfg.colorVisited : cfg.colorUnvisited,
			fillOpacity: isVisited ? 0.6 : 0.3,
			color:       isVisited ? cfg.colorVisited : cfg.colorUnvisited,
			weight:      isVisited ? 1.8 : 1,
			opacity:     isVisited ? 0.9 : 0.6
		});
	}

	function getInitialStyle(layerType, isVisited) {
		var cfg = LAYERS[layerType];
		return {
			fillColor:   isVisited ? cfg.colorVisited : cfg.colorUnvisited,
			fillOpacity: isVisited ? 0.6 : 0.3,
			color:       isVisited ? cfg.colorVisited : cfg.colorUnvisited,
			weight:      isVisited ? 1.8 : 1,
			opacity:     isVisited ? 0.9 : 0.6
		};
	}

	// ── Toggle visit ──
	function toggleVisit(layerType, key) {
		key = String(key);
		var vis = visited[layerType];
		if (vis.has(key)) { vis.delete(key); } else { vis.add(key); }
		var idx = featureIndex[layerType];
		if (idx && idx[key]) styleFeature(idx[key], layerType, vis.has(key));
		saveVisited(layerType);
		announce(featureData[layerType][key].name + (vis.has(key) ? " marked visited." : " removed from visits."));
		updateStats();
		renderTable();
	}

	// ── Map setup ──
	var map = L.map("map", { zoomSnap: 0.5 }).setView([39.8, -98.5], 4);

	var baseLayers = {
		"Street": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }),
		"Topo":      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", { attribution: "Esri", maxZoom: 18 }),
		"Satellite": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Esri", maxZoom: 18 })
	};
	baseLayers["Street"].addTo(map);
var tileErrors = {};
Object.keys(baseLayers).forEach(function (name) {
 var tiles = baseLayers[name];
 tileErrors[name] = 0;
 tiles.on('tileerror', function () {
  if (!map.hasLayer(tiles)) return;
  tileErrors[name]++;
  if (tileErrors[name] >= 3) {
   var status = document.getElementById('map-status');
   status.hidden = false;
   status.textContent = name + ' basemap is unavailable. Choose another basemap using Layers (top right). Your visits and boundaries are still available.';
  }
 });
});
map.on('baselayerchange', function () { document.getElementById('map-status').hidden = true; });
new ResizeObserver(function () { map.invalidateSize(); }).observe(document.getElementById('map'));
	L.control.layers(baseLayers, null, { collapsed: true }).addTo(map);

	// ── Load visited data from localStorage ──
	Object.keys(LAYERS).forEach(function (lt) {
		loadVisited(lt);
		featureIndex[lt] = {};
		featureData[lt] = {};
	});

	// ── Build tooltip ──
	function buildTooltip(props, layerType) {
		var html = '<div class="lands-tooltip">';
		html += '<strong>' + escHtml(props.name || "Unknown") + '</strong><br>';

		if (layerType === "wilderness") {
			html += escHtml(props.state || "") + ' \u00B7 ' + escHtml(props.agency || "") + '<br>';
			html += fmtNum(props.acres) + ' acres';
			if (props.designated) html += '<br>Designated ' + escHtml(String(props.designated));
		} else if (layerType === "nps") {
			html += escHtml(props.state || "");
			if (props.designation) html += ' \u00B7 ' + escHtml(props.designation);
			html += '<br>' + fmtNum(props.acres) + ' acres';
		} else if (layerType === "national_forest") {
			if (props.region) html += 'Region ' + escHtml(props.region) + '<br>';
			html += fmtNum(props.acres) + ' acres';
		}

		html += '</div>';
		return html;
	}

	// ── Load all GeoJSON in parallel ──
	function loadLayer(layerType) {
		var cfg = LAYERS[layerType];
		return fetch(cfg.file)
			.then(function (r) { if (!r.ok) throw new Error('Boundary request failed: ' + r.status); return r.json(); })
			.then(function (data) {
				if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid boundary data');
var layerIndex = Object.create(null), layerData = Object.create(null);
var geoLayer = L.geoJSON(data, {
					style: function (feature) {
						var key = String(feature.properties[cfg.keyProp]);
						var isV = visited[layerType].has(key);
						return getInitialStyle(layerType, isV);
					},
					onEachFeature: function (feature, layer) {
						var p = feature.properties;
						var key = String(p[cfg.keyProp]);

						if (!layerIndex[key]) layerIndex[key] = L.featureGroup();
layerIndex[key].addLayer(layer);
						var existing = layerData[key];
layerData[key] = {
							name: (existing ? existing.names.concat(p.name || "Unknown").join(" / ") : (p.name || "Unknown")),
 names: (existing ? existing.names : []).concat(p.name || "Unknown"),
							state: p.state || "",
							region: p.region || "",
							agency: p.agency || "",
							acres: (existing ? existing.acres : 0) + (Number(p.acres) || 0),
							designated: p.designated || "",
							code: p.code || "",
							designation: p.designation || "",
							type: layerType
						};

						var tip = buildTooltip(p, layerType);
						layer.bindTooltip(tip, { sticky: true, direction: "top", offset: [0, -8] });

						layer.on("mouseover", function () {
							layer.setStyle({ weight: 3, color: "#fff", fillOpacity: 0.65 });
							layer.bringToFront();
						});
						layer.on("mouseout", function () {
							styleFeature(layer, layerType, visited[layerType].has(key));
						});
						layer.on("click", function () {
							toggleVisit(layerType, key);
						});
					}
				});

				featureIndex[layerType] = layerIndex;
featureData[layerType] = layerData;
geojsonLayers[layerType] = geoLayer;
				if (layerVisible[layerType]) geoLayer.addTo(map);

				return layerType;
			});
	}

	function buildSearchIndex() {
 allSearchItems = [];
 Object.keys(LAYERS).forEach(function (lt) {
  Object.keys(featureData[lt]).forEach(function (key) {
   var d = featureData[lt][key];
   allSearchItems.push({ name: d.name, names: d.names, state: d.state || d.region || '', key: key, layerType: lt, dotColor: LAYERS[lt].dotColor });
  });
 });
 allSearchItems.sort(function (a, b) { return a.name.localeCompare(b.name); });
}
function migrateLegacyVisits() {
 try {
  var raw = localStorage.getItem('wilderness_visited_wids');
  if (!raw || !geojsonLayers.wilderness || localStorage.getItem('lands_legacy_wids_migrated') === '1') return;
  var ids = JSON.parse(raw);
  if (!Array.isArray(ids)) return;
  var changed = false;
  ids.forEach(function (id) {
   var name = window.LANDS_WID_NAMES[String(Number(id))];
   var key = name && LandsData.nameKey(featureData.wilderness, name);
   if (key && !visited.wilderness.has(key)) {
    visited.wilderness.add(key); styleFeature(featureIndex.wilderness[key], 'wilderness', true); changed = true;
   }
  });
  if (changed) {
   localStorage.setItem(LAYERS.wilderness.storageKey, JSON.stringify(Array.from(visited.wilderness)));
   announce('Restored visits from the earlier wilderness tracker.');
  }
  localStorage.setItem('lands_legacy_wids_migrated', '1');
  // Never remove the old backup, including IDs absent from current boundaries.
 } catch (_) { storageWarning('Legacy visits could not be read. Import a CSV backup to restore them.'); }
}
function loadMissingLayers() {
 if (loading) return;
 loading = true; dataReady = false;
 document.getElementById('btn-import').disabled = true;
 document.getElementById('btn-export').disabled = true;
 document.getElementById('retry-data').hidden = true;
 document.getElementById('data-status').textContent = 'Loading public lands…';
 var missing = Object.keys(LAYERS).filter(function (lt) { return !geojsonLayers[lt]; });
 Promise.allSettled(missing.map(loadLayer)).then(function (results) {
  loading = false; dataReady = true; loadErrors = [];
  results.forEach(function (result, i) {
   if (result.status === 'rejected') { loadErrors.push(LAYERS[missing[i]].label); console.error('Boundary load failed:', missing[i], result.reason); }
  });
  buildSearchIndex(); migrateLegacyVisits(); updateStats(); renderTable();
  document.getElementById('data-status').textContent = loadErrors.length ? 'Could not load ' + loadErrors.join(', ') + '. Other loaded layers still work. Retry to restore full search and totals.' : '';
  document.getElementById('retry-data').hidden = !loadErrors.length;
  document.getElementById('btn-import').disabled = !!loadErrors.length;
  document.getElementById('btn-export').disabled = false;
  map.invalidateSize();
 });
}
document.getElementById('retry-data').addEventListener('click', loadMissingLayers);
loadMissingLayers();

// ── Layer toggle checkboxes ──
	document.querySelectorAll('.layer-toggle input[type="checkbox"]').forEach(function (cb) {
		cb.addEventListener("change", function () {
			var lt = this.getAttribute("data-layer");
			layerVisible[lt] = this.checked;
			var toggleLabel = this.closest('.layer-toggle');
			if (toggleLabel) {
				toggleLabel.classList.toggle('disabled', !this.checked);
			}
			var geoLayer = geojsonLayers[lt];
			if (!geoLayer) return;
			if (this.checked) {
				geoLayer.addTo(map);
			} else {
				map.removeLayer(geoLayer);
			}
			updateStats();
			renderTable();
		});
	});

	// ── Autocomplete ──
	var searchInput = document.getElementById("search-input");
	var acList = document.getElementById("ac-list");
	var acIdx = -1;
function closeSearch() { acList.style.display = 'none'; searchInput.setAttribute('aria-expanded', 'false'); searchInput.removeAttribute('aria-activedescendant'); }


	searchInput.addEventListener("input", function () {
		var q = this.value.trim().toLowerCase();
		acIdx = -1;
		if (q.length < 2) { closeSearch(); return; }
		var matches = allSearchItems.filter(function (d) {
			return layerVisible[d.layerType] && (d.names || [d.name]).some(function (name) { return name.toLowerCase().indexOf(q) !== -1; });
		}).slice(0, 30);
		if (matches.length === 0) { closeSearch(); return; }
		acList.innerHTML = matches.map(function (d, i) {
			return '<div class="ac-item" role="option" id="search-option-' + i + '" aria-selected="false" data-layer="' + d.layerType + '" data-key="' + escAttr(d.key) + '" data-idx="' + i + '">'
				+ '<span class="ac-dot" style="background:' + d.dotColor + ';"></span>'
				+ '<span class="ac-name">' + escHtml(d.name) + '</span>'
				+ '<span class="ac-state">' + escHtml(d.state) + '</span>'
				+ '</div>';
		}).join("");
		acList.style.display = "block";
 searchInput.setAttribute("aria-expanded", "true");
	});

	searchInput.addEventListener("keydown", function (e) {
		var items = acList.querySelectorAll(".ac-item");
		if (!items.length || acList.style.display === "none") return;
		if (e.key === "ArrowDown") { e.preventDefault(); acIdx = Math.min(acIdx + 1, items.length - 1); }
		else if (e.key === "ArrowUp") { e.preventDefault(); acIdx = Math.max(acIdx - 1, 0); }
		else if (e.key === "Enter") { e.preventDefault(); if (items[acIdx >= 0 ? acIdx : 0]) items[acIdx >= 0 ? acIdx : 0].click(); return; }
		else if (e.key === "Escape") { closeSearch(); return; }
		else return;
		items.forEach(function (el, i) { el.classList.toggle("active", i === acIdx); el.setAttribute("aria-selected", String(i === acIdx)); });
searchInput.setAttribute('aria-activedescendant', items[acIdx].id);
items[acIdx].scrollIntoView({ block: 'nearest' });
	});

	acList.addEventListener("click", function (e) {
		var item = e.target.closest(".ac-item");
		if (!item) return;
		var lt = item.getAttribute("data-layer");
		var key = item.getAttribute("data-key");
		searchInput.value = "";
		closeSearch();
		if (!visited[lt].has(key)) toggleVisit(lt, key);
		var idx = featureIndex[lt];
		if (idx && idx[key]) {
			var layer = idx[key];
			if (layer.getBounds) {
				map.flyToBounds(layer.getBounds(), { maxZoom: 11, duration: reducedMotion ? 0 : 1 });
			}
		}
	});

	document.addEventListener("click", function (e) {
		if (!e.target.closest(".search-wrap")) closeSearch();
	});

	// ── CSV backups: stable keys, quoted multiline fields, old Shiny imports. ──
document.getElementById('btn-export').addEventListener('click', function () {
 var rows = [['type', 'key', 'name', 'state', 'acres', 'code', 'designation', 'agency', 'designated', 'region']];
 Object.keys(LAYERS).forEach(function (lt) {
  visited[lt].forEach(function (key) {
   var d = featureData[lt][key] || {};
   rows.push([lt, key, d.name || '', d.state, d.acres, d.code, d.designation, d.agency, d.designated, d.region]);
  });
 });
 if (rows.length === 1) { announce('No visits to export. Mark an area visited first.'); return; }
 var blob = new Blob([rows.map(function (row) { return row.map(LandsData.csvCell).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
 var url = URL.createObjectURL(blob), a = document.createElement('a');
 a.href = url; a.download = 'public_lands_visits_' + new Date().toISOString().slice(0, 10) + '.csv';
 document.body.appendChild(a); a.click(); a.remove();
 setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
 announce('Visit backup exported. Keep it to restore visits or move them to another browser.');
});
var importInput = document.getElementById('import-input');
document.getElementById('btn-import').addEventListener('click', function () { importInput.click(); });
importInput.addEventListener('change', async function () {
 var file = this.files[0]; this.value = '';
 if (!file) return;
 if (!dataReady || loadErrors.length) { announce('Wait for all layers to load before importing. Retry missing layers first.'); return; }
 if (file.size > 5 * 1024 * 1024) { announce('CSV is too large. Choose a visit backup smaller than 5 MB.'); return; }
 try {
  var result = LandsData.matchImport(LandsData.parseCSV(await file.text()), featureData, window.LANDS_WID_NAMES);
  var added = 0, existing = 0;
  result.matches.forEach(function (row) {
   if (visited[row.type].has(row.key)) { existing++; return; }
   visited[row.type].add(row.key); added++;
   styleFeature(featureIndex[row.type][row.key], row.type, true);
  });
  saveAllVisited(); updateStats(); renderTable();
  announce('Imported ' + added + ' new visits; ' + existing + ' already saved; ' + result.unmatched + ' unmatched rows. Existing visits were kept.');
 } catch (err) { announce('Import failed: ' + err.message); }
});

// ── Clear all ──
	document.getElementById("btn-clear").addEventListener("click", function (e) {
		e.preventDefault();
		var totalVisited = 0;
		Object.keys(LAYERS).forEach(function (lt) { totalVisited += visited[lt].size; });
		if (totalVisited === 0) return;
		if (!confirm("Clear all " + totalVisited + " visited areas across all layers?")) return;

		Object.keys(LAYERS).forEach(function (lt) {
			visited[lt].forEach(function (key) {
				if (featureIndex[lt][key]) styleFeature(featureIndex[lt][key], lt, false);
			});
			visited[lt].clear();
		});
 try { localStorage.removeItem("wilderness_visited_wids"); } catch (_) {}

		saveAllVisited();
		announce("All visits cleared. Import a CSV backup to restore them.");
		updateStats();
		renderTable();
	});

})();
