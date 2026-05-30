// trail-map.js — Trail Log maps.
// For each .trail-map[data-gpx] element this builds a Leaflet map with a
// hybrid satellite/topo basemap (toggleable), overlays the GPX track WITHOUT
// joining disjoint track segments, renders an elevation profile beneath the
// map, and (if data-inat is set) plots matching iNaturalist observations.
// No-ops gracefully if Leaflet / leaflet-gpx aren't present.
(function () {
	document.addEventListener('DOMContentLoaded', function () {
		var maps = document.querySelectorAll('.trail-map[data-gpx]');
		if (!maps.length) return;
		if (typeof L === 'undefined' || typeof L.GPX === 'undefined') return;
		maps.forEach(setupMap);
	});

	var TRACK_COLOR = '#47D3E5';

	// Marker color by iNaturalist iconic taxon.
	var ICONIC_COLORS = {
		Plantae: '#3fa34d', Fungi: '#c879c8', Animalia: '#888888',
		Mollusca: '#a06a3c', Arachnida: '#b23b3b', Insecta: '#e08a1e',
		Aves: '#2f7fd1', Mammalia: '#8b5a2b', Reptilia: '#7b4fb0',
		Amphibia: '#2aa198', Actinopterygii: '#1f8fa3'
	};

	function setupMap(el) {
		// --- Basemaps -------------------------------------------------------
		// USGS National Map: imagery with topographic labels baked in (named
		// peaks, creeks, springs, trail camps) — the default "hybrid" view.
		var usgsImageryTopo = L.tileLayer(
			'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
			{ maxNativeZoom: 16, maxZoom: 19, attribution: 'USGS The National Map' });
		var usgsTopo = L.tileLayer(
			'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
			{ maxNativeZoom: 16, maxZoom: 19, attribution: 'USGS The National Map' });

		// Plain satellite (Esri imagery + place/road labels) as an alternative.
		var esriSat = L.tileLayer(
			'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
			{ maxZoom: 19, attribution: 'Imagery &copy; Esri' });
		var esriPlaces = L.tileLayer(
			'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
			{ maxZoom: 19 });
		var satPlain = L.layerGroup([esriSat, esriPlaces]);

		var map = L.map(el, { layers: [usgsImageryTopo] });

		var baseLayers = {
			'Satellite + Topo labels': usgsImageryTopo,
			'Satellite': satPlain,
			'Topographic': usgsTopo
		};
		var overlays = {};

		// --- GPX track (disjoint segments left disconnected) ----------------
		new L.GPX(el.dataset.gpx, {
			async: true,
			gpx_options: { joinTrackSegments: false },
			polyline_options: { color: TRACK_COLOR, weight: 4, opacity: 0.95 },
			// Suppress leaflet-gpx's default start/end/waypoint markers.
			marker_options: { startIconUrl: '', endIconUrl: '', shadowUrl: '', wptIconUrls: {} }
		}).on('loaded', function (e) {
			map.fitBounds(e.target.getBounds(), { padding: [20, 20] });
		}).addTo(map);

		// --- Elevation profile (parsed independently from the GPX) ----------
		buildElevation(el);

		// --- iNaturalist observations overlay -------------------------------
		if (el.dataset.inat) {
			loadObservations(el.dataset.inat, function (layer, count) {
				if (!count) return;
				layer.addTo(map);
				overlays['iNaturalist (' + count + ')'] = layer;
				L.control.layers(baseLayers, overlays, { collapsed: true }).addTo(map);
			}, function () {
				L.control.layers(baseLayers, overlays, { collapsed: true }).addTo(map);
			});
		} else {
			L.control.layers(baseLayers, overlays, { collapsed: true }).addTo(map);
		}
	}

	// ----------------------------------------------------------------------
	// Elevation profile
	// ----------------------------------------------------------------------
	function buildElevation(mapEl) {
		var container = document.createElement('div');
		container.className = 'trail-elevation';
		container.innerHTML = '<div class="trail-elev-stats"></div>' +
			'<svg class="trail-elev-svg" viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true"></svg>';
		mapEl.parentNode.insertBefore(container, mapEl.nextSibling);

		fetchText(mapEl.dataset.gpx, function (xml) {
			var segs = parseTrackSegments(xml);
			if (!segs.length) { container.style.display = 'none'; return; }
			renderElevation(container, segs);
		}, function () { container.style.display = 'none'; });
	}

	function parseTrackSegments(xmlText) {
		var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
		var segNodes = doc.getElementsByTagName('trkseg');
		var segs = [];
		for (var i = 0; i < segNodes.length; i++) {
			var pts = segNodes[i].getElementsByTagName('trkpt');
			var seg = [];
			for (var j = 0; j < pts.length; j++) {
				var lat = parseFloat(pts[j].getAttribute('lat'));
				var lon = parseFloat(pts[j].getAttribute('lon'));
				var eleNode = pts[j].getElementsByTagName('ele')[0];
				var ele = eleNode ? parseFloat(eleNode.textContent) : null;
				if (!isNaN(lat) && !isNaN(lon)) seg.push({ lat: lat, lon: lon, ele: ele });
			}
			if (seg.length) segs.push(seg);
		}
		return segs;
	}

	function haversine(a, b) {
		var R = 6371000, toRad = Math.PI / 180;
		var dLat = (b.lat - a.lat) * toRad, dLon = (b.lon - a.lon) * toRad;
		var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) *
			Math.sin(dLon / 2) * Math.sin(dLon / 2);
		return 2 * R * Math.asin(Math.sqrt(s));
	}

	function renderElevation(container, segs) {
		var M2FT = 3.28084, M2MI = 1 / 1609.34;
		var pts = [];            // {d: miles, e: feet}
		var distM = 0, gainM = 0;
		segs.forEach(function (seg) {
			for (var i = 0; i < seg.length; i++) {
				if (i > 0) {
					distM += haversine(seg[i - 1], seg[i]); // no inter-segment jump
					if (seg[i].ele != null && seg[i - 1].ele != null) {
						var dz = seg[i].ele - seg[i - 1].ele;
						if (dz > 0) gainM += dz;
					}
				}
				if (seg[i].ele != null) pts.push({ d: distM * M2MI, e: seg[i].ele * M2FT });
			}
		});
		if (pts.length < 2) { container.style.display = 'none'; return; }

		var emin = Infinity, emax = -Infinity, dmax = pts[pts.length - 1].d;
		pts.forEach(function (p) { if (p.e < emin) emin = p.e; if (p.e > emax) emax = p.e; });
		var pad = (emax - emin) * 0.1 || 10;
		var lo = emin - pad, hi = emax + pad;

		var W = 1000, H = 200;
		function sx(d) { return dmax ? (d / dmax) * W : 0; }
		function sy(e) { return H - ((e - lo) / (hi - lo)) * H; }

		var line = '';
		pts.forEach(function (p, i) { line += (i ? 'L' : 'M') + sx(p.d).toFixed(1) + ',' + sy(p.e).toFixed(1) + ' '; });
		var area = 'M0,' + H + ' ' + line.replace(/^M/, 'L') + 'L' + W + ',' + H + ' Z';

		var svg = container.querySelector('.trail-elev-svg');
		svg.innerHTML =
			'<path d="' + area + '" fill="' + TRACK_COLOR + '" fill-opacity="0.18" stroke="none" />' +
			'<path d="' + line + '" fill="none" stroke="' + TRACK_COLOR + '" stroke-width="3" vector-effect="non-scaling-stroke" />';

		var mi = dmax.toFixed(1);
		var gainFt = Math.round(gainM * M2FT).toLocaleString();
		var hiFt = Math.round(emax).toLocaleString();
		container.querySelector('.trail-elev-stats').innerHTML =
			'<span>' + mi + ' mi</span><span>&#9650; ' + gainFt + ' ft gain</span>' +
			'<span>high ' + hiFt + ' ft</span>';
	}

	// ----------------------------------------------------------------------
	// iNaturalist observations
	// ----------------------------------------------------------------------
	function loadObservations(url, onReady, onFail) {
		fetchText(url, function (txt) {
			var data;
			try { data = JSON.parse(txt); } catch (err) { onFail(); return; }
			var obs = (data && data.observations) || [];

			// Cluster + spiderfy overlapping pins when markercluster is present;
			// fall back to a plain layer group otherwise.
			var layer = (typeof L.markerClusterGroup === 'function')
				? L.markerClusterGroup({
					showCoverageOnHover: false,
					spiderfyOnMaxZoom: true,
					spiderfyDistanceMultiplier: 1.6,
					maxClusterRadius: 40
				})
				: L.layerGroup();

			var count = 0;
			obs.forEach(function (o) {
				if (typeof o.lat !== 'number' || typeof o.lng !== 'number') return;
				var color = ICONIC_COLORS[o.iconic] || '#888888';
				var m = L.marker([o.lat, o.lng], { icon: dotIcon(color) });
				m.bindPopup(popupHtml(o), { maxWidth: 240 });
				layer.addLayer(m);
				count++;
			});
			onReady(layer, count);
		}, onFail);
	}

	function dotIcon(color) {
		return L.divIcon({
			className: 'inat-dot',
			html: '<span style="background:' + color + '"></span>',
			iconSize: [16, 16],
			iconAnchor: [8, 8],
			popupAnchor: [0, -8]
		});
	}

	function popupHtml(o) {
		var title = o.common
			? esc(o.common) + '<br><em>' + esc(o.name || '') + '</em>'
			: '<em>' + esc(o.name || 'Unknown') + '</em>';
		var img = o.photo
			? '<img src="' + esc(o.photo) + '" alt="" style="width:100%;border-radius:4px;margin-bottom:.4rem;" loading="lazy" />'
			: '';
		return '<div class="trail-inat-popup">' + img +
			'<strong>' + title + '</strong><br>' +
			'<a href="' + esc(o.url) + '" target="_blank" rel="noopener">View on iNaturalist &rarr;</a></div>';
	}

	// ----------------------------------------------------------------------
	// Utilities
	// ----------------------------------------------------------------------
	function fetchText(url, onOk, onErr) {
		fetch(url, { cache: 'no-store' })
			.then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
			.then(onOk)
			.catch(function () { if (onErr) onErr(); });
	}

	function esc(s) {
		return String(s == null ? '' : s)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;')
			.replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
})();
