# Public Lands Tracker

The maintained tracker is a static Leaflet application at https://garrettgcraig.com/wilderness. This repository owns its UI, JavaScript, boundary files and deployment. No R process, Shiny hosting, database or build step is required for visitors.

## Local development

From this repository root, run `python3 -m http.server 8000`, then open http://localhost:8000/wilderness.html. Run `node --test tests/lands-data.test.cjs` and `node --check assets/js/lands-tracker.js` before publishing.

The page loads `assets/css/lands-tracker.css`, `assets/js/lands-tracker.js` and the pure CSV helpers in `assets/js/lands-data.js`. Leaflet 1.9.4 and its license are vendored under `assets/vendor/leaflet`, so a third-party script CDN outage does not prevent startup.

## Basemaps

The Street default uses https://tile.openstreetmap.org with visible OpenStreetMap attribution. Topo and Satellite retain the existing Esri services. Change the `baseLayers` configuration in `lands-tracker.js` to change providers. CARTO's unauthenticated endpoint now returns API-key notices, so it is no longer used.

OpenStreetMap tiles are best-effort and subject to https://operations.osmfoundation.org/policies/tiles/. Keep normal browser caching and referrers. Do not add prefetching, bulk downloads or offline tile caches. If traffic grows, use a contracted provider or self-hosted tiles. Repeated tile errors show a notice directing visitors to another basemap; boundaries and visits remain usable.

## Visit storage and backups

Visits stay in the visitor's browser under the existing `lands_visited_wilderness`, `lands_visited_nps` and `lands_visited_national_forest` localStorage keys. They are not sent to a server and do not sync across devices. If browser storage fails, the page explicitly asks the visitor to export before closing. Clearing browser/site data removes local visits.

CSV export includes the layer type, persistent key and descriptive columns. Export includes saved keys absent from loaded boundaries, so a partial data outage does not silently strip backups. Import merges with existing visits, reports added/already-saved/unmatched rows, rejects malformed CSV, and is unavailable until all boundary layers load. It supports old Shiny `name`/`wid` exports, old static exports and current exports, including quoted multiline fields and UTF-8 BOMs.

`lands-wid-names.js` maps IDs from the legacy Shiny GeoJSON to names. Old `wilderness_visited_wids` browser storage is migrated once, retaining the original backup. Clear visits explicitly removes the old migration source so cleared visits do not reappear. Boundaries absent from the current snapshot cannot be mapped into the current tracker; unmatched CSV rows are reported.

NPS polygons sharing a unit code are one tracked unit: all constituent boundaries update together and their acreage is summed. Existing NPS code keys remain valid. Wilderness and forest keys retain their existing names.

## Boundary refresh

R is retained as a preparation tool in `data/build_layers.R`, using `sf`, `dplyr` and `esri2sf`. From `data/`, run `Rscript build_layers.R`. The script skips existing GeoJSON files; archive a file before regenerating its layer. Review changes in names, codes, geometry and totals before committing. Counts reflect the bundled snapshot, not a promise of real-time nationwide coverage.

## Publishing and recovery

Publish through this website's existing deployment from `main`; the public route remains `/wilderness`. The old `garrettgcraig/wilderness-tracker` repository is a legacy reference and directs visitors here. Revert the repair commit to roll back UI changes; visit keys have not changed. Keep CSV backups before clearing or refreshing browser storage.
