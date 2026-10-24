// trail-map.js — Trail Log maps.
// For each .trail-map[data-gpx] element this builds a Leaflet map with a
// hybrid satellite/topo basemap (toggleable), overlays the GPX track WITHOUT
// joining disjoint track segments, renders an elevation profile beneath the
// map, and (if data-inat is set) plots matching iNaturalist observations.
// Hovering the profile (or arrowing through it) marks that spot on the map
// with its mile and elevation; the day's start and end are marked on both.
// No-ops gracefully if Leaflet / leaflet-gpx aren't present.
(function () {
	document.addEventListener('DOMContentLoaded', function () {
		var maps = document.querySelectorAll('.trail-map[data-gpx], .trail-observation-map[data-inat], .trail-day-map[data-route]');
		if (!maps.length) return;
		if (typeof L === 'undefined') return;
		maps.forEach(function (el) {
 if (el.dataset.route) {
  if ('IntersectionObserver' in window) {
   var observer = new IntersectionObserver(function (entries) {
    if (entries.some(function (entry) { return entry.isIntersecting; })) { observer.disconnect(); setupDayMap(el); }
   }, { rootMargin: '300px' });
   observer.observe(el);
  } else setupDayMap(el);
 } else if (el.dataset.gpx && typeof L.GPX !== 'undefined') setupMap(el);
 else if (!el.dataset.gpx) setupObservationMap(el);
 });
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
		buildElevation(el, map);

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

 // Daily trail itinerary: shared downloads, maps initialized near the viewport.
 var jsonCache = {};
 function fetchJson(url) {
  if (!jsonCache[url]) jsonCache[url] = fetch(url).then(function (r) {
   if (!r.ok) throw new Error(r.status); return r.json();
  }).catch(function (error) { delete jsonCache[url]; throw error; });
  return jsonCache[url];
 }
 // Shared basemaps for the itinerary and observation maps. Satellite with named
 // peaks, creeks and camps (USGS) is the default; plain satellite, topo and street are alternatives.
 function basemaps() {
  var usgs = function (name) {
   return L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/' + name + '/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 16, maxZoom: 19, attribution: 'USGS The National Map' });
  };
  var esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
   { maxZoom: 19, attribution: 'Imagery &copy; Esri' });
  var esriPlaces = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
  var street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
   maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });
  var hybrid = usgs('USGSImageryTopo');
  return { initial: hybrid, choices: {
   'Satellite + trail names': hybrid,
   'Satellite + place names': L.layerGroup([esriSat, esriPlaces]),
   'Topographic': usgs('USGSTopo'),
   'Street': street
  } };
 }
 function setupDayMap(el) {
  var base = basemaps();
  var map = L.map(el, { layers: [base.initial], scrollWheelZoom: false }).setView([36.8, -118.5], 9);
  map.createPane('trail-stops').style.zIndex = '625';
  var layers = L.control.layers(base.choices, {}, { collapsed: true }).addTo(map);
  var status = document.createElement('p'); status.className = 'trail-map-status';
  status.setAttribute('role', 'status'); status.textContent = 'Loading trail map…'; el.after(status);
  function load() {
   status.textContent = 'Loading trail map…';
   Promise.allSettled([fetchJson(el.dataset.route), fetchJson(el.dataset.inat)]).then(function (results) {
    var bounds = L.latLngBounds([]), routeOK = false;
    if (results[0].status === 'fulfilled') {
     var feature = results[0].value.features.find(function (f) { return f.properties.day === el.dataset.day; });
     if (feature && feature.geometry.coordinates.length > 1) {
      routeOK = true;
      var route = L.geoJSON(feature, { style: { color: '#ffd23f', weight: 4, opacity: 0.95 } }).addTo(map);
      layers.addOverlay(route, 'Trail route'); bounds.extend(route.getBounds());
      map.attributionControl.addAttribution('Trails: <a href="https://www.nps.gov/seki/planyourvisit/park_atlas.htm">NPS / USFS</a>');
      var props = feature.properties;
      var start = L.circleMarker([props.start[1], props.start[0]], { pane: 'trail-stops', radius: 5, color: '#fff', weight: 2, fillColor: '#ffd23f', fillOpacity: 1 }).addTo(map);
      start.bindPopup('Start of day');
      var end = L.circleMarker([props.end[1], props.end[0]], { pane: 'trail-stops', radius: 8, color: '#fff', weight: 2, fillColor: '#9a5521', fillOpacity: 1 }).addTo(map);
      end.bindPopup(props.camp ? '<strong>Camp</strong><br>' + esc(props.camp) + (props.camp_uncertain ? '<br>If I remember right.' : '') : 'Back to Roads End');
     }
    }
    if (results[1].status === 'fulfilled') {
     var obs = results[1].value.observations.filter(function (o) { return o.day === el.dataset.day; });
     var nature = observationsLayer(obs, true); nature.layer.addTo(map); layers.addOverlay(nature.layer, 'Nature sightings');
     obs.forEach(function (o) { bounds.extend([o.lat, o.lng]); });
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
    if (routeOK && results[1].status === 'fulfilled') { status.remove(); }
    else {
     status.textContent = !routeOK ? 'The trail route could not load. ' : 'Nature sightings could not load. ';
     var retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Reload map';
     retry.addEventListener('click', function () { window.location.reload(); }); status.appendChild(retry);
    }
   });
  }
  load();
 }

 // Observation-only maps never manufacture tracks, distances or elevations.
 function setupObservationMap(el) {
  var base = basemaps();
  var map = L.map(el, { layers: [base.initial] }).setView([36.8, -118.5], 9);
  L.control.layers(base.choices, null, { collapsed: true }).addTo(map);
  var controls = document.createElement('div');
  controls.className = 'trail-observation-controls';
  var label = document.createElement('label'), select = document.createElement('select'), status = document.createElement('p');
  label.textContent = 'Show observations';
  label.appendChild(select); select.disabled = true;
  select.setAttribute('aria-label', 'Choose observation day');
  status.setAttribute('role', 'status'); status.textContent = 'Loading observations…';
  controls.appendChild(label); controls.appendChild(status); el.before(controls);
  var current;
  fetchText(el.dataset.inat, function (txt) {
   var data;
   try { data = JSON.parse(txt); } catch (_) { fail(); return; }
   var observations = data.observations || [];
   var days = data.days || [];
   function addOption(value, title) { var option = document.createElement('option'); option.value = value; option.textContent = title; select.appendChild(option); }
   addOption('', 'All days');
   days.forEach(function (day) { addOption(day.date, day.label); });
   function showDay() {
    var obs = observations.filter(function (o) { return !select.value || o.day === select.value; });
    if (current) map.removeLayer(current);
    current = observationsLayer(obs);
    current.layer.addTo(map);
    if (current.count) map.fitBounds(L.latLngBounds(obs.map(function (o) { return [o.lat, o.lng]; })), { padding: [24, 24], maxZoom: 14 });
    status.textContent = current.count + ' observation locations. Travel between pins is estimated; this is not a GPS track.';
    current = current.layer;
   }
   select.disabled = false;
   select.addEventListener('change', showDay); showDay();
  }, fail);
  function fail() { status.textContent = 'Observations could not load. Reload to try again; the daily notes below remain available.'; }
 }

	// ----------------------------------------------------------------------
	// Elevation profile
	// ----------------------------------------------------------------------
	function buildElevation(mapEl, map) {
		var container = document.createElement('div');
		container.className = 'trail-elevation';
		container.innerHTML = '<div class="trail-elev-stats"></div>' +
			'<div class="trail-elev-plot" tabindex="0" role="slider" aria-valuemin="0" ' +
			'aria-label="Elevation profile. Hover, or use the arrow keys, to see a spot on the map.">' +
			'<svg class="trail-elev-svg" viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true"></svg>' +
			'<span class="trail-elev-pin trail-elev-pin-start"></span><span class="trail-elev-pin trail-elev-pin-end"></span>' +
			'<span class="trail-elev-label trail-elev-label-start"></span><span class="trail-elev-label trail-elev-label-end"></span>' +
			'<span class="trail-elev-cursor" hidden><span class="trail-elev-dot"></span></span>' +
			'<span class="trail-elev-readout" hidden></span></div>';
		mapEl.parentNode.insertBefore(container, mapEl.nextSibling);

		fetchText(mapEl.dataset.gpx, function (xml) {
			var segs = parseTrackSegments(xml);
			if (!segs.length) { container.style.display = 'none'; return; }
			// dem_elevation.py marks tracks whose altitudes were swapped for USGS terrain data.
			renderElevation(container, segs, map, xml.indexOf('USGS 3DEP') !== -1);
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

	function renderElevation(container, segs, map, terrain) {
		var M2FT = 3.28084, M2MI = 1 / 1609.34;
		var pts = [];            // {d: miles, e: feet, lat, lon}
		var distM = 0, gainM = 0;
		segs.forEach(function (seg) {
			// Terrain elevations are smooth, so every rise counts. Raw GPS altitude
			// jitters by meters, so only count climbs past a 10 m swing.
			var ref = null;
			for (var i = 0; i < seg.length; i++) {
				if (i > 0) distM += haversine(seg[i - 1], seg[i]); // no inter-segment jump
				var e = seg[i].ele;
				if (e != null) {
					if (terrain) { if (ref != null && e > ref) gainM += e - ref; ref = e; }
					else if (ref == null || ref - e >= 10) ref = e;
					else if (e - ref >= 10) { gainM += e - ref; ref = e; }
					pts.push({ d: distM * M2MI, e: e * M2FT, lat: seg[i].lat, lon: seg[i].lon });
				}
			}
		});
		if (pts.length < 2) { container.style.display = 'none'; return; }

		var emin = Infinity, emax = -Infinity, dmax = pts[pts.length - 1].d;
		pts.forEach(function (p) { if (p.e < emin) emin = p.e; if (p.e > emax) emax = p.e; });
		var pad = (emax - emin) * 0.12 || 10;
		var lo = emin - pad, hi = emax + pad;

		var W = 1000, H = 200;
		function sx(d) { return dmax ? (d / dmax) * W : 0; }
		function sy(e) { return H - ((e - lo) / (hi - lo)) * H; }
		var pctX = function (d) { return (sx(d) / W * 100) + '%'; };
		var pctY = function (e) { return (sy(e) / H * 100) + '%'; };
		var ft = function (e) { return Math.round(e).toLocaleString() + ' ft'; };

		var line = '';
		pts.forEach(function (p, i) { line += (i ? 'L' : 'M') + sx(p.d).toFixed(1) + ',' + sy(p.e).toFixed(1) + ' '; });
		var area = 'M0,' + H + ' ' + line.replace(/^M/, 'L') + 'L' + W + ',' + H + ' Z';

		var svg = container.querySelector('.trail-elev-svg');
		svg.innerHTML =
			'<path d="' + area + '" fill="' + TRACK_COLOR + '" fill-opacity="0.18" stroke="none" />' +
			'<path d="' + line + '" fill="none" stroke="' + TRACK_COLOR + '" stroke-width="3" vector-effect="non-scaling-stroke" />';

		container.querySelector('.trail-elev-stats').innerHTML =
			'<span>' + dmax.toFixed(1) + ' mi</span><span>&#9650; ' + Math.round(gainM * M2FT).toLocaleString() + ' ft gain</span>' +
			'<span>high ' + ft(emax) + '</span><span>low ' + ft(emin) + '</span>';

		// Start and end, on the profile...
		var first = pts[0], last = pts[pts.length - 1];
		var plot = container.querySelector('.trail-elev-plot');
		var pinStart = plot.querySelector('.trail-elev-pin-start'), pinEnd = plot.querySelector('.trail-elev-pin-end');
		pinStart.style.left = '0%'; pinStart.style.top = pctY(first.e);
		pinEnd.style.left = '100%'; pinEnd.style.top = pctY(last.e);
		plot.querySelector('.trail-elev-label-start').textContent = 'Start ' + ft(first.e);
		plot.querySelector('.trail-elev-label-end').textContent = 'End ' + ft(last.e);

		// ...and on the map, once it has a view (the GPX may load after the profile).
		// A loop gets one marker.
		var loop = haversine(first, last) < 60;
		map.whenReady(function () {
		L.circleMarker([first.lat, first.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#5E6E3A', fillOpacity: 1 })
			.bindTooltip(loop ? 'Start &amp; end · ' + ft(first.e) : 'Start · ' + ft(first.e),
				{ permanent: true, direction: 'top', offset: [0, -8], className: 'trail-endpoint-tip' }).addTo(map);
		if (!loop) {
			L.circleMarker([last.lat, last.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#A65A3C', fillOpacity: 1 })
				.bindTooltip('End · ' + ft(last.e), { permanent: true, direction: 'top', offset: [0, -8], className: 'trail-endpoint-tip' }).addTo(map);
		}
		});

		// Hover / keyboard cursor, mirrored on the map.
		var cursor = plot.querySelector('.trail-elev-cursor'), dot = cursor.querySelector('.trail-elev-dot');
		var readout = plot.querySelector('.trail-elev-readout');
		var here = L.circleMarker([first.lat, first.lon], { radius: 7, color: '#1B2530', weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false })
			.bindTooltip('', { permanent: true, direction: 'right', offset: [10, 0], className: 'trail-here-tip' });
		var idx = 0;
		plot.setAttribute('aria-valuemax', dmax.toFixed(1));

		function nearest(d) {
			var a = 0, b = pts.length - 1;
			while (b - a > 1) { var m = (a + b) >> 1; if (pts[m].d < d) a = m; else b = m; }
			return (d - pts[a].d) <= (pts[b].d - d) ? a : b;
		}
		function show(i) {
			idx = Math.max(0, Math.min(pts.length - 1, i));
			var p = pts[idx], text = 'Mile ' + p.d.toFixed(1) + ' · ' + ft(p.e);
			cursor.hidden = false; readout.hidden = false;
			cursor.style.left = pctX(p.d); dot.style.top = pctY(p.e);
			readout.textContent = text;
			readout.style.left = pctX(p.d);
			readout.classList.toggle('flip', sx(p.d) > W * 0.75);
			here.setLatLng([p.lat, p.lon]).setTooltipContent(text);
			if (map._loaded && !map.hasLayer(here)) here.addTo(map);
			plot.setAttribute('aria-valuenow', p.d.toFixed(1));
			plot.setAttribute('aria-valuetext', text);
		}
		function hide() {
			cursor.hidden = true; readout.hidden = true;
			if (map.hasLayer(here)) map.removeLayer(here);
		}
		function fromEvent(evt) {
			var r = plot.getBoundingClientRect();
			return nearest(Math.max(0, Math.min(1, (evt.clientX - r.left) / r.width)) * dmax);
		}
		plot.addEventListener('pointermove', function (evt) { show(fromEvent(evt)); });
		plot.addEventListener('pointerdown', function (evt) { show(fromEvent(evt)); });
		plot.addEventListener('pointerleave', function (evt) { if (evt.pointerType === 'mouse') hide(); });
		plot.addEventListener('blur', hide);
		plot.addEventListener('keydown', function (evt) {
			// Arrow keys move about 1% of the day's distance.
			var move = function (dir) {
				if (cursor.hidden) return show(0);
				var j = nearest(pts[idx].d + dir * dmax / 100);
				show(j === idx ? idx + dir : j);
			};
			if (evt.key === 'ArrowRight') move(1);
			else if (evt.key === 'ArrowLeft') move(-1);
			else if (evt.key === 'Home') show(0);
			else if (evt.key === 'End') show(pts.length - 1);
			else if (evt.key === 'Escape') hide();
			else return;
			evt.preventDefault();
		});
	}

	// ----------------------------------------------------------------------
	// iNaturalist observations
	// ----------------------------------------------------------------------
	function loadObservations(url, onReady, onFail) {
		fetchText(url, function (txt) {
			var data;
			try { data = JSON.parse(txt); } catch (err) { onFail(); return; }
			var obs = (data && data.observations) || [];


   var ready = observationsLayer(obs);
   onReady(ready.layer, ready.count);
  }, onFail);
 }

 function observationsLayer(obs, compact) {
  var layer = (typeof L.markerClusterGroup === 'function')
   ? L.markerClusterGroup({ showCoverageOnHover: false, spiderfyOnMaxZoom: true, spiderfyDistanceMultiplier: 1.6, maxClusterRadius: 40 })
   : L.layerGroup();
  var count = 0;
  obs.forEach(function (o) {
   if (typeof o.lat !== 'number' || typeof o.lng !== 'number') return;
   var color = ICONIC_COLORS[o.iconic] || '#888888';
   var marker = L.marker([o.lat, o.lng], { icon: dotIcon(color) });
   marker.bindPopup(popupHtml(o, compact), { maxWidth: 240, keepInView: true, autoPanPaddingTopLeft: [20, 70], autoPanPaddingBottomRight: [20, 20] }); layer.addLayer(marker); count++;
  });
  return { layer: layer, count: count };
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

	function popupHtml(o, compact) {
		var title = o.common
			? esc(o.common) + '<br><em>' + esc(o.name || '') + '</em>'
			: '<em>' + esc(o.name || 'Unknown') + '</em>';
		var img = o.photo
			? '<img src="' + esc(o.photo) + '" alt="" class="trail-inat-photo" loading="lazy" />'
			: '';
		return '<div class="trail-inat-popup">' + img +
			'<strong>' + title + '</strong><br>' +
 (o.time ? '<span>' + esc(new Date(o.time).toLocaleString('en-US', {timeZone: 'America/Los_Angeles'})) + ' Pacific</span><br>' : '') +
 (!compact && o.accuracy_m != null ? '<span>Location uncertainty: ' + esc(o.accuracy_m) + ' m</span><br>' : '') +
 (o.attribution ? '<small>' + esc(o.attribution) + '</small><br>' : '') +
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
