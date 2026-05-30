---
# ── FRONTMATTER ──────────────────────────────────────────────────────────
# Fill in each field below. title/date/location/summary are REQUIRED.
title: Your Trail Title Here
date: 2025-08-15            # YYYY-MM-DD. Used for sorting (newest first) and shown formatted.
location: Trail Name, State # e.g. "John Muir Trail, CA"
summary: One-sentence teaser shown on the Trail Log index card.
cover: trail-log/photos/your-slug/cover.jpg   # card cover image (repo-root-relative)
tags: [backpacking, sierra]                    # list of short tags
---

<!--
  HOW THIS WORKS
  --------------
  1. Copy this file to trail-log/entries/ and rename it, e.g.
        2025-08-fresh-water-with-a-view.md
     A leading date (2025-08- or 2025-08-15-) is stripped from the slug.
  2. Drop photos under trail-log/photos/<slug>/ and GPX files under trail-log/gpx/.
  3. From the repo root, run:  python scripts/build_trail_log.py
     -> generates trail-<slug>.html and updates data/trail-log.json.

  Files whose name starts with "_" (like this template) are ignored by the build.

  DIRECTIVE SYNTAX
  ----------------
  Block directives must sit on their OWN line with a blank line before and after.
  All paths are repo-root-relative (entry pages live at the repo root).

    Day header:        ## Day 1: Trailhead to Lake     (becomes an <h2>)
    Gear/any link:     [text](https://example.com)     (standard Markdown link)
    Map (GPX track):   [[map:trail-log/gpx/day1.gpx]]
                       Hybrid satellite/topo map; disjoint track segments are
                       left disconnected; an elevation profile renders beneath.
    Map + iNat pins:   [[map:trail-log/gpx/day1.gpx|inat:data/inat-trip-day1.json]]
                       Optional: overlays iNaturalist observations (see
                       scripts/fetch_inat.py to generate the per-day JSON).
    Photo:             [[photo:trail-log/photos/slug/lake.jpg|Optional caption]]
                       (caption is optional; omit the "|caption" for no caption)
    Gallery:           [[gallery:img1.jpg|img2.jpg|img3.jpg]]
    iNaturalist link:  [[inat:123456|Species Name]]     (INLINE — use mid-sentence)
-->

## Day 1: Trailhead to First Camp

Write your trail narrative in normal Markdown. Mention gear with an affiliate
link like my [ultralight tent](https://example.com/tent). You can drop an
iNaturalist observation inline, like spotting a [[inat:123456|Pacific Chorus Frog]]
near the creek.

[[map:trail-log/gpx/day1.gpx]]

[[photo:trail-log/photos/your-slug/first-camp.jpg|Sunset at the first camp]]

## Day 2: First Camp to Summit

More narrative here. Wrap up the day, note mileage, elevation, conditions.

[[gallery:trail-log/photos/your-slug/a.jpg|trail-log/photos/your-slug/b.jpg|trail-log/photos/your-slug/c.jpg]]
