# Public Lands Tracker

The maintained tracker is a static Leaflet application at https://garrettgcraig.com/wilderness. This repository owns its UI, JavaScript, boundary files and deployment. No R process, Shiny hosting, database or build step is required for visitors.

## Local development

From this repository root, run `python3 -m http.server 8000`, then open http://localhost:8000/wilderness.html. Run `node --test tests/lands-data.test.cjs tests/lands-sync.test.mjs` and `node --check assets/js/lands-tracker.js` before publishing. The static server does not run the sync function; `node tests/lands-dev-server.mjs` serves the site with an in-memory sync API at http://localhost:8788/wilderness.html.

The page loads `assets/css/lands-tracker.css`, `assets/js/lands-tracker.js` and the pure CSV helpers in `assets/js/lands-data.js`. Leaflet 1.9.4 and its license are vendored under `assets/vendor/leaflet`, so a third-party script CDN outage does not prevent startup.

## Basemaps

The Street default uses https://tile.openstreetmap.org with visible OpenStreetMap attribution. Topo and Satellite retain the existing Esri services. Change the `baseLayers` configuration in `lands-tracker.js` to change providers. CARTO's unauthenticated endpoint now returns API-key notices, so it is no longer used.

OpenStreetMap tiles are best-effort and subject to https://operations.osmfoundation.org/policies/tiles/. Keep normal browser caching and referrers. Do not add prefetching, bulk downloads or offline tile caches. If traffic grows, use a contracted provider or self-hosted tiles. Repeated tile errors show a notice directing visitors to another basemap; boundaries and visits remain usable.

## Visit storage and backups

Visits are always kept in the visitor's browser under the existing `lands_visited_wilderness`, `lands_visited_nps` and `lands_visited_national_forest` localStorage keys. If browser storage fails, the page explicitly asks the visitor to export before closing.

### Server sync

"Sync across devices" in the sidebar keeps visits on the server so they survive cleared browser data and show up on other devices. Turning it on makes a random 26-character sync code (130 bits) in the browser; there are no accounts. The code is the only credential, so anyone holding it can read and change that visit list. "Copy link for another device" copies `/wilderness#sync=<code>`; the code sits in the URL fragment, which browsers never send to servers or put in referrers.

- Server: `netlify/functions/lands-sync.mjs` at `/api/lands-sync`, logic in `netlify/lib/lands-sync.mjs`. Lists live in the `lands-visits` Netlify Blobs store under SHA-256 of the code, so the store never holds codes. A list is `{ visits: { wilderness: [...], nps: [...], national_forest: [...] }, updated }`.
- Clients send changes as operations (`{ type, key, on }`), and the server applies them with an ETag compare-and-set, so two devices editing at once both keep their changes.
- Client: `assets/js/lands-sync.js`. Unsent operations queue in localStorage (`lands_sync_pending`) and send when the server is reachable, so the tracker works offline. On load, and when the tab becomes visible again, the server copy replaces the browser copy, with queued changes reapplied on top. Joining an existing code adds this browser's visits to it.
- Limits: 10,000 keys per layer per code, keys up to 200 characters, 1 MB requests, and 10 new codes per IP per day (`lands-visits-limits` store).
- To recover a list after losing every device, there is no lookup by person; keep the code or a CSV export. A list can be read in the Netlify UI (Blobs > `lands-visits`) if needed.

CSV export stays available as an offline backup and for moving visits without sync.

CSV export includes the layer type, persistent key and descriptive columns. Export includes saved keys absent from loaded boundaries, so a partial data outage does not silently strip backups. Import merges with existing visits, reports added/already-saved/unmatched rows, rejects malformed CSV, and is unavailable until all boundary layers load. It supports old Shiny `name`/`wid` exports, old static exports and current exports, including quoted multiline fields and UTF-8 BOMs.

`lands-wid-names.js` maps IDs from the legacy Shiny GeoJSON to names. Old `wilderness_visited_wids` browser storage is migrated once, retaining the original backup. Clear visits explicitly removes the old migration source so cleared visits do not reappear. Boundaries absent from the current snapshot cannot be mapped into the current tracker; unmatched CSV rows are reported.

NPS polygons sharing a unit code are one tracked unit: all constituent boundaries update together and their acreage is summed. Existing NPS code keys remain valid. Wilderness and forest keys retain their existing names.

## Boundary refresh

R is retained as a preparation tool in `data/build_layers.R`, using `sf`, `dplyr` and `esri2sf`. From `data/`, run `Rscript build_layers.R`. The script skips existing GeoJSON files; archive a file before regenerating its layer. Review changes in names, codes, geometry and totals before committing. Counts reflect the bundled snapshot, not a promise of real-time nationwide coverage.

## Publishing and recovery

Publish through this website's existing deployment from `main`; the public route remains `/wilderness`. The old `garrettgcraig/wilderness-tracker` repository is a legacy reference and directs visitors here. Revert the repair commit to roll back UI changes; visit keys have not changed. Keep CSV backups before clearing or refreshing browser storage.
