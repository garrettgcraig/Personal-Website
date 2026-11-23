/* Sync for the public lands tracker: keeps visits on the site's server under a private sync code.
 * The browser copy (localStorage) stays as a cache and works offline. Changes queue as small
 * operations and are sent when the server can be reached, so nothing is lost while offline.
 * Server side: netlify/functions/lands-sync.mjs. */
(function (root) {
	'use strict';
	var ENDPOINT = '/api/lands-sync';
	var CODE_KEY = 'lands_sync_code';
	var PENDING_KEY = 'lands_sync_pending';
	var ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

	function normalizeCode(raw) {
		var code = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
		return /^[a-z2-7]{26}$/.test(code) ? code : null;
	}
	function formatCode(code) { return code.match(/.{1,5}/g).join('-').replace(/-(.)$/, '$1'); }
	function newCode() {
		var bytes = new Uint8Array(26), out = '';
		crypto.getRandomValues(bytes);
		for (var i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] & 31];
		return out;
	}
	// Apply ops ({ type, key, on }) to a { type: [keys] } object, returning a new object.
	function applyOps(visits, ops, types) {
		var out = {};
		types.forEach(function (t) {
			var set = new Set((visits && visits[t]) || []);
			ops.forEach(function (op) { if (op.type === t) { if (op.on) set.add(op.key); else set.delete(op.key); } });
			out[t] = Array.from(set);
		});
		return out;
	}
	// Ops that add everything in `local` missing from `server` (used when joining an existing code).
	function missingOps(local, server, types) {
		var ops = [];
		types.forEach(function (t) {
			var have = new Set((server && server[t]) || []);
			((local && local[t]) || []).forEach(function (key) { if (!have.has(key)) ops.push({ type: t, key: key, on: true }); });
		});
		return ops;
	}

	function read(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
	function write(key, value) {
		try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (_) {}
	}

	// opts: { types, getVisits() -> { type: [keys] }, setVisits(visits), onChange(state) }
	function create(opts) {
		var code = normalizeCode(read(CODE_KEY));
		var pending = [];
		try { pending = JSON.parse(read(PENDING_KEY) || '[]'); if (!Array.isArray(pending)) pending = []; } catch (_) { pending = []; }
		var timer = null, busy = false, again = false;
		var state = { code: code, status: code ? 'Connecting to your sync code…' : '', error: false, lastSync: null };

		function emit(status, error) {
			state.code = code; state.status = status; state.error = !!error;
			opts.onChange(state);
		}
		function savePending() { write(PENDING_KEY, pending.length ? JSON.stringify(pending) : null); }
		function savedText() {
			return 'Synced at ' + new Date(state.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '. Your visits are saved on the server.';
		}
		function call(method, body) {
			return fetch(ENDPOINT, {
				method: method,
				headers: Object.assign({ Authorization: 'Bearer ' + code }, body ? { 'Content-Type': 'application/json' } : {}),
				body: body ? JSON.stringify(body) : undefined,
				cache: 'no-store'
			}).then(function (r) {
				return r.json().catch(function () { return {}; }).then(function (json) { return { status: r.status, json: json }; });
			});
		}
		function offline() {
			emit('Could not reach the server. Changes are kept in this browser and will sync when it is back.', true);
		}
		function adopt(serverVisits) {
			// Server copy plus anything still waiting to be sent.
			opts.setVisits(applyOps(serverVisits, pending, opts.types));
		}

		function flush() {
			if (!code || !pending.length) return Promise.resolve();
			if (busy) { again = true; return Promise.resolve(); }
			busy = true;
			var sending = pending.slice();
			var sentCode = code;
			return call('POST', { ops: sending }).then(function (res) {
				if (sentCode !== code) return;
				if (res.status === 200) {
					pending = pending.slice(sending.length); savePending();
					state.lastSync = Date.now();
					adopt(res.json.visits);
					emit(pending.length ? 'Saving…' : savedText());
				} else if (res.status >= 400 && res.status < 500 && res.status !== 409 && res.status !== 429) {
					// The server refused these changes outright; drop them so they do not block later ones.
					pending = pending.slice(sending.length); savePending();
					emit('Sync failed: ' + (res.json.error || 'error ' + res.status) + ' Export a CSV to keep a copy.', true);
				} else {
					emit('Sync is having trouble (' + (res.json.error || 'error ' + res.status) + '). Changes are kept in this browser and will retry.', true);
				}
			}, offline).then(function () {
				busy = false;
				if (again) { again = false; return flush(); }
			});
		}
		function schedule() {
			clearTimeout(timer);
			timer = setTimeout(flush, 800);
		}
		function queue(ops) {
			if (!code || !ops.length) return;
			pending = pending.concat(ops); savePending();
			emit('Saving…');
			schedule();
		}

		// Read the server copy. If the code has nothing saved yet, send everything in this browser.
		function pull() {
			if (!code) return Promise.resolve();
			var sentCode = code;
			return call('GET').then(function (res) {
				if (sentCode !== code) return;
				if (res.status === 200) {
					state.lastSync = Date.now();
					adopt(res.json.visits);
					if (pending.length) return flush();
					emit(savedText());
				} else if (res.status === 404) {
					pending = missingOps(opts.getVisits(), null, opts.types).concat(pending); savePending();
					if (!pending.length) { emit('Sync is on. Visits you mark will be saved on the server.'); return; }
					return flush();
				} else {
					emit('Sync is having trouble (' + (res.json.error || 'error ' + res.status) + '). Your visits are still in this browser.', true);
				}
			}, offline);
		}

		return {
			state: state,
			formatCode: formatCode,
			linked: function () { return !!code; },
			record: function (type, key, on) { queue([{ type: type, key: String(key), on: !!on }]); },
			recordMany: queue,
			// Start syncing with a fresh code and upload everything in this browser.
			start: function () {
				code = newCode(); write(CODE_KEY, code);
				pending = missingOps(opts.getVisits(), null, opts.types); savePending();
				emit(pending.length ? 'Saving your visits to the server…' : 'Sync is on. Visits you mark will be saved on the server.');
				return flush();
			},
			// Join an existing code from another device. Visits in this browser are added to it.
			join: function (raw) {
				var next = normalizeCode(raw);
				if (!next) { emit('That does not look like a sync code. It has 26 letters and numbers.', true); return Promise.resolve(false); }
				var prevCode = code;
				code = next;
				emit('Checking that code…');
				return call('GET').then(function (res) {
					if (res.status !== 200) {
						code = prevCode;
						emit(res.status === 404 ? 'No visits are saved under that code. Check it and try again.' : 'Could not check that code (' + (res.json.error || 'error ' + res.status) + ').', true);
						return false;
					}
					write(CODE_KEY, code);
					pending = missingOps(opts.getVisits(), res.json.visits, opts.types); savePending();
					state.lastSync = Date.now();
					adopt(res.json.visits);
					if (pending.length) flush(); else emit(savedText());
					return true;
				}, function () { code = prevCode; offline(); return false; });
			},
			stop: function () {
				clearTimeout(timer);
				code = null; pending = [];
				write(CODE_KEY, null); savePending();
				emit('Sync is off in this browser. Your visits stay here and on the server under the old code.');
			},
			pull: pull,
			flush: flush
		};
	}

	var api = { create: create, normalizeCode: normalizeCode, formatCode: formatCode, applyOps: applyOps, missingOps: missingOps };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.LandsSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
