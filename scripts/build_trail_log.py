#!/usr/bin/env python3
"""
build_trail_log.py — Static site generator for the "Trail Log" section.

Reads Markdown trail-log entries (with YAML frontmatter + custom directives),
converts each into a static HTML page at the repo root, and regenerates the
JSON manifest the index page reads.

DEPENDENCIES:
    pip install markdown pyyaml

USAGE (run from anywhere; paths resolve relative to the repo root):
    python scripts/build_trail_log.py

INPUTS:
    trail-log/entries/*.md   (files starting with "_" are ignored, e.g. _template.md)

OUTPUTS:
    trail-<slug>.html        (one per entry, at repo root)
    data/trail-log.json      (manifest, sorted newest date first)

CUSTOM DIRECTIVE SYNTAX (see trail-log/entries/_template.md for examples):
    Block-level (each on its own line, blank line before & after):
        [[map:trail-log/gpx/day1.gpx]]
        [[photo:path/img.jpg|Optional caption]]
        [[gallery:a.jpg|b.jpg|c.jpg]]
    Inline (may appear mid-sentence):
        [[inat:123456|Pacific Chorus Frog]]

LEAFLET CHOICE (documented per contract):
    We ALWAYS emit trail-map.js on every generated entry page (harmless if the
    entry has no maps). We only emit the Leaflet CSS/JS (leaflet.css,
    leaflet.js, leaflet-gpx) when the entry actually contains a [[map:...]]
    directive, to keep map-free entries lean.
"""

import json
import os
import re
import sys
from datetime import date, datetime

try:
    import markdown
    import yaml
except ImportError as exc:  # pragma: no cover - guidance for the user
    sys.stderr.write(
        "Missing dependency: %s\nInstall with: pip install markdown pyyaml\n" % exc
    )
    sys.exit(1)


# --------------------------------------------------------------------------
# Path setup — resolve everything relative to the repo root (parent of scripts/)
# so the script works regardless of the current working directory.
# --------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
ENTRIES_DIR = os.path.join(REPO_ROOT, "trail-log", "entries")
DATA_DIR = os.path.join(REPO_ROOT, "data")
MANIFEST_PATH = os.path.join(DATA_DIR, "trail-log.json")


# --------------------------------------------------------------------------
# Shared markup copied VERBATIM from research.html (per the shared contract).
# --------------------------------------------------------------------------

# Dark-mode toggle button (inline SVGs copied exactly from research.html).
DARK_MODE_TOGGLE = '''\t\t<!-- Dark mode toggle -->
\t\t<button id="dark-mode-toggle" aria-label="Switch to dark mode">
\t\t\t<span class="dm-toggle-moon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"/></svg></span>
\t\t\t<span class="dm-toggle-sun"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z"/></svg></span>
\t\t</button>'''

# Shared footer block (exact text from the contract).
FOOTER = '''\t\t\t<footer class="wrapper style1 align-center">
\t\t\t\t<div class="inner">
\t\t\t\t\t<ul class="icons">
\t\t\t\t\t\t<li><a href="https://www.instagram.com/gorths.gorp/" class="icon brands style2 fa-instagram"><span class="label">Instagram</span></a></li>
\t\t\t\t\t\t<li><a href="https://www.linkedin.com/in/garrettgcraig/" class="icon brands style2 fa-linkedin-in"><span class="label">LinkedIn</span></a></li>
\t\t\t\t\t\t<li><a href="https://github.com/garrettgcraig" class="icon brands style2 fa-github"><span class="label">GitHub</span></a></li>
\t\t\t\t\t\t<li><a href="mailto:garrettgcraig@gmail.com" class="icon style2 fa-envelope"><span class="label">Email</span></a></li>
\t\t\t\t\t</ul>
\t\t\t\t\t<p>&copy; Garrett Craig. All rights reserved.</p>
\t\t\t\t</div>
\t\t\t</footer>'''

# Standard script block (order copied from research.html).
SCRIPT_BLOCK = '''\t\t\t<script src="assets/js/jquery.min.js"></script>
\t\t\t<script src="assets/js/jquery.scrollex.min.js"></script>
\t\t\t<script src="assets/js/jquery.scrolly.min.js"></script>
\t\t\t<script src="assets/js/browser.min.js"></script>
\t\t\t<script src="assets/js/breakpoints.min.js"></script>
\t\t\t<script src="assets/js/util.js"></script>'''

# Bump to cache-bust the locally-served assets we edit (trail-map.js / trail-log.css).
ASSET_VERSION = "6"

# Leaflet head <link>s — only emitted when the entry has a map.
# Includes Leaflet core + markercluster (used to spiderfy overlapping iNat pins).
LEAFLET_CSS = (
    '\t\t<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />\n'
    '\t\t<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />\n'
    '\t\t<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />'
)

# Leaflet JS — emitted right before main.js. The leaflet-gpx CDN URL used:
LEAFLET_JS = '''\t\t\t<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
\t\t\t<script src="https://cdn.jsdelivr.net/npm/leaflet-gpx@1.7.0/gpx.min.js"></script>
\t\t\t<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
\t\t\t<script src="assets/js/trail-map.js?v=%s"></script>''' % ASSET_VERSION

# trail-map.js only (always included on entry pages).
TRAIL_MAP_JS = '\t\t\t<script src="assets/js/trail-map.js?v=%s"></script>' % ASSET_VERSION


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def html_escape(text):
    """Escape a string for safe use inside an HTML attribute or text node."""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def slugify(name):
    """Derive a URL slug from a markdown filename.

    Strips a leading ISO-ish date prefix (e.g. "2025-08-" or "2025-08-15-"),
    lowercases, and hyphenates non-alphanumeric runs.
    """
    base = os.path.splitext(os.path.basename(name))[0]
    # Strip a leading date prefix like 2025-08-15- or 2025-08-
    base = re.sub(r"^\d{4}-\d{2}(?:-\d{2})?-", "", base)
    base = base.lower()
    base = re.sub(r"[^a-z0-9]+", "-", base)
    return base.strip("-")


def format_date(value):
    """Format a date (string or date object) human-readably, e.g. 'August 15, 2025'."""
    if isinstance(value, (datetime, date)):
        dt = value
    else:
        dt = datetime.strptime(str(value).strip(), "%Y-%m-%d").date()
    # %-d is platform-specific; strip leading zero manually for portability.
    return "%s %d, %d" % (dt.strftime("%B"), dt.day, dt.year)


def iso_date(value):
    """Return an ISO 'YYYY-MM-DD' string from a date object or string."""
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    return str(value).strip()


def parse_frontmatter(raw):
    """Split a markdown file into (frontmatter dict, body string).

    Frontmatter is a YAML block delimited by '---' lines at the very top.
    """
    if not raw.startswith("---"):
        raise ValueError("Entry is missing the leading '---' frontmatter block.")
    # Match the first frontmatter block: ---\n ... \n---\n
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", raw, re.DOTALL)
    if not match:
        raise ValueError("Could not parse frontmatter (no closing '---').")
    meta = yaml.safe_load(match.group(1)) or {}
    body = match.group(2)
    return meta, body


# --------------------------------------------------------------------------
# Custom directive preprocessing.
#
# We convert directives to raw HTML BEFORE handing the body to the markdown
# library. Block directives are surrounded by blank lines so the markdown
# package treats them as block-level raw HTML and leaves them untouched.
# The inline [[inat:...]] directive is converted to an inline <a>.
# --------------------------------------------------------------------------

# Block directives must be on their own line. re.MULTILINE so ^...$ work per line.
MAP_RE = re.compile(r"^[ \t]*\[\[map:([^\]]+)\]\][ \t]*$", re.MULTILINE)
PHOTO_RE = re.compile(r"^[ \t]*\[\[photo:([^\]]+)\]\][ \t]*$", re.MULTILINE)
GALLERY_RE = re.compile(r"^[ \t]*\[\[gallery:([^\]]+)\]\][ \t]*$", re.MULTILINE)
# Inline directive can appear anywhere.
INAT_RE = re.compile(r"\[\[inat:(\d+)\|([^\]]+)\]\]")


def _map_sub(match):
    # Body may be "gpx" or "gpx|inat:data/file.json" (optional iNat overlay).
    raw = match.group(1).strip()
    inat = ""
    if "|inat:" in raw:
        gpx_part, inat_part = raw.split("|inat:", 1)
        gpx = gpx_part.strip()
        inat = inat_part.strip()
    else:
        gpx = raw
    attrs = 'data-gpx="%s"' % html_escape(gpx)
    if inat:
        attrs += ' data-inat="%s"' % html_escape(inat)
    # Blank lines around the block ensure markdown treats it as raw HTML.
    return '\n<div class="trail-map" %s></div>\n' % attrs


def _photo_sub(match):
    parts = match.group(1).split("|", 1)
    src = parts[0].strip()
    caption = parts[1].strip() if len(parts) > 1 else ""
    if caption:
        return (
            '\n<figure class="trail-photo">'
            '<img src="%s" alt="%s" loading="lazy" />'
            "<figcaption>%s</figcaption></figure>\n"
            % (html_escape(src), html_escape(caption), html_escape(caption))
        )
    # No caption: empty alt, no <figcaption>.
    return (
        '\n<figure class="trail-photo">'
        '<img src="%s" alt="" loading="lazy" /></figure>\n' % html_escape(src)
    )


def _gallery_sub(match):
    srcs = [s.strip() for s in match.group(1).split("|") if s.strip()]
    imgs = "".join(
        '<img src="%s" loading="lazy" />' % html_escape(s) for s in srcs
    )
    return '\n<div class="trail-gallery">%s</div>\n' % imgs


def _inat_sub(match):
    obs_id = match.group(1).strip()
    label = match.group(2).strip()
    return (
        '<a href="https://www.inaturalist.org/observations/%s" '
        'target="_blank" rel="noopener">%s</a>'
        % (html_escape(obs_id), html_escape(label))
    )


def preprocess_directives(body):
    """Convert all custom directives to raw HTML. Returns (body, has_map)."""
    has_map = bool(MAP_RE.search(body))
    body = MAP_RE.sub(_map_sub, body)
    body = PHOTO_RE.sub(_photo_sub, body)
    body = GALLERY_RE.sub(_gallery_sub, body)
    body = INAT_RE.sub(_inat_sub, body)
    return body, has_map


# --------------------------------------------------------------------------
# Page assembly
# --------------------------------------------------------------------------

def build_page(meta, body_html, has_map):
    """Assemble the full HTML document string for an entry."""
    title = html_escape(meta["title"])
    meta_line = "%s &middot; %s" % (
        html_escape(format_date(meta["date"])),
        html_escape(meta["location"]),
    )

    # Conditionally include the Leaflet stylesheet in <head>.
    leaflet_css_line = ("\n" + LEAFLET_CSS) if has_map else ""

    head = (
        "<!DOCTYPE HTML>\n"
        "<html>\n"
        "\t<head>\n"
        "\t\t<title>%s - Trail Log - Garrett G. Craig</title>\n"
        '\t\t<meta charset="utf-8" />\n'
        '\t\t<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />\n'
        '\t\t<link rel="stylesheet" href="assets/css/main.css" />\n'
        '\t\t<link rel="stylesheet" href="assets/css/darkmode.css" />\n'
        '\t\t<link rel="stylesheet" href="assets/css/trail-log.css?v=' + ASSET_VERSION + '" />%s\n'
        '\t\t<link rel="icon" type="image/svg+xml" href="favicon.svg" />\n'
        '\t\t<noscript><link rel="stylesheet" href="assets/css/noscript.css" /></noscript>\n'
        '\t\t<script src="assets/js/darkmode.js"></script>\n'
        "\t</head>\n"
    ) % (title, leaflet_css_line)

    # Scripts: standard block, then (if map) leaflet+gpx+trail-map, else
    # just trail-map.js, then main.js last.
    if has_map:
        scripts = SCRIPT_BLOCK + "\n" + LEAFLET_JS + "\n" + '\t\t\t<script src="assets/js/main.js"></script>'
    else:
        scripts = SCRIPT_BLOCK + "\n" + TRAIL_MAP_JS + "\n" + '\t\t\t<script src="assets/js/main.js"></script>'

    page = (
        head
        + '\t<body class="is-preload">\n\n'
        + DARK_MODE_TOGGLE
        + "\n\n"
        + '\t\t<div id="wrapper" class="divided">\n\n'
        + '\t\t\t<section class="wrapper style1">\n'
        + '\t\t\t\t<div class="inner">\n'
        + '\t\t\t\t\t<header class="trail-entry-header">\n'
        + "\t\t\t\t\t\t<h1>%s</h1>\n" % title
        + '\t\t\t\t\t\t<p class="trail-meta">%s</p>\n' % meta_line
        + "\t\t\t\t\t</header>\n"
        + '\t\t\t\t\t<article class="trail-entry">\n'
        + body_html
        + "\n\t\t\t\t\t</article>\n"
        + '\t\t\t\t\t<ul class="actions" style="margin-top:3rem;">\n'
        + '\t\t\t\t\t\t<li><a href="trail-log.html" class="button">&larr; Back to Trail Log</a></li>\n'
        + "\t\t\t\t\t</ul>\n"
        + "\t\t\t\t</div>\n"
        + "\t\t\t</section>\n\n"
        + FOOTER
        + "\n\n"
        + "\t\t</div>\n\n"
        + scripts
        + "\n\n"
        + "\t</body>\n"
        + "</html>\n"
    )
    return page


# --------------------------------------------------------------------------
# Main build
# --------------------------------------------------------------------------

def build():
    if not os.path.isdir(ENTRIES_DIR):
        sys.stderr.write("Entries directory not found: %s\n" % ENTRIES_DIR)
        sys.exit(1)

    md = markdown.Markdown(extensions=["extra", "sane_lists"])

    entries = []
    files = sorted(
        f
        for f in os.listdir(ENTRIES_DIR)
        if f.endswith(".md") and not f.startswith("_")
    )

    for fname in files:
        path = os.path.join(ENTRIES_DIR, fname)
        with open(path, "r", encoding="utf-8") as fh:
            raw = fh.read()

        try:
            meta, body = parse_frontmatter(raw)
        except ValueError as exc:
            sys.stderr.write("Skipping %s: %s\n" % (fname, exc))
            continue

        # Required frontmatter keys.
        for key in ("title", "date", "location", "summary"):
            if key not in meta:
                sys.stderr.write(
                    "Skipping %s: missing required frontmatter '%s'\n" % (fname, key)
                )
                meta = None
                break
        if meta is None:
            continue

        slug = slugify(fname)
        body, has_map = preprocess_directives(body)

        md.reset()
        body_html = md.convert(body)

        page = build_page(meta, body_html, has_map)
        out_name = "trail-%s.html" % slug
        out_path = os.path.join(REPO_ROOT, out_name)
        with open(out_path, "w", encoding="utf-8") as out:
            out.write(page)

        entries.append(
            {
                "slug": slug,
                "title": meta["title"],
                "date": iso_date(meta["date"]),
                "location": meta["location"],
                "summary": meta["summary"],
                "cover": meta.get("cover", ""),
                "tags": meta.get("tags", []) or [],
                "url": out_name,
            }
        )
        print("  built %-45s -> %s" % (fname, out_name))

    # Sort newest date first.
    entries.sort(key=lambda e: e["date"], reverse=True)

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(MANIFEST_PATH, "w", encoding="utf-8") as fh:
        json.dump({"entries": entries}, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(
        "\nTrail Log build complete: %d entr%s -> %s"
        % (len(entries), "y" if len(entries) == 1 else "ies",
           os.path.relpath(MANIFEST_PATH, REPO_ROOT))
    )


if __name__ == "__main__":
    build()
