#!/usr/bin/env python3
"""Shared site chrome: brand stylesheets in <head> and the sticky nav.
Hand-authored pages carry marked blocks that this script (re)writes;
build_trail_log.py imports nav_html() for trail entries. Sub-apps
(knowki/, seedfinder/, wildlife-crossings/, wilderness.html) are left alone.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSS_START, CSS_END = '<!-- BRAND-CSS -->', '<!-- /BRAND-CSS -->'
NAV_START, NAV_END = '<!-- NAV -->', '<!-- /NAV -->'

LINKS = [
    ('projects.html', 'Projects'),
    ('research.html', 'Research'),
    ('trail-log.html', 'Trail Log'),
    ('photography.html', 'Photography'),
]

MARK = (
    '<svg viewBox="0 0 100 100" aria-hidden="true">'
    '<rect width="100" height="100" rx="22" fill="#1B2530"/>'
    '<path d="M71 33 A26 26 0 1 0 74 58" fill="none" stroke="#F6F6F2" stroke-width="8" stroke-linecap="round"/>'
    '<path d="M44 58 L54 45 L61 52 L66 47 L76 58" fill="none" stroke="#D3A43B" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
    '</svg>'
)

# Section each page belongs to, for aria-current.
SECTIONS = {
    'index.html': None,
    'projects.html': 'projects.html',
    'research.html': 'research.html',
    'project-amazon-climate.html': 'research.html',
    'project-fossorial.html': 'research.html',
    'project-herpetofauna.html': 'research.html',
    'project-ghg-etrm.html': 'research.html',
    'trail-log.html': 'trail-log.html',
    'day-hikes.html': 'trail-log.html',
    'photography.html': 'photography.html',
    'photography-wildlife.html': 'photography.html',
    'photography-landscapes.html': 'photography.html',
    'photography-flora.html': 'photography.html',
    'photography-macro.html': 'photography.html',
    'brand.html': None,  # unlisted: reachable by URL only
}


def css_links(indent='\t\t'):
    return '\n'.join(indent + line for line in [
        CSS_START,
        '<link rel="stylesheet" href="assets/css/brand.css" />',
        '<link rel="stylesheet" href="assets/css/site.css" />',
        CSS_END,
    ])


def nav_html(active=None, indent='\t\t'):
    items = []
    for href, label in LINKS:
        current = ' aria-current="page"' if href == active else ''
        items.append('<li><a href="%s"%s>%s</a></li>' % (href, current, label))
    lines = [
        NAV_START,
        '<nav class="site-nav" aria-label="Site">',
        '\t<a class="site-name" href="index.html">%sGarrett G. Craig</a>' % MARK,
        '\t<ul>' + ''.join(items) + '</ul>',
        '</nav>',
        NAV_END,
    ]
    return '\n'.join(indent + line for line in lines)


def replace_or_insert(text, start, end, block, anchor_re):
    if start in text:
        return re.sub(r'[ \t]*' + re.escape(start) + r'.*?' + re.escape(end), lambda m: block, text, flags=re.S)
    text, n = re.subn(anchor_re, lambda m: m.group(1) + block + '\n', text, count=1)
    assert n == 1, anchor_re
    return text


def apply(relative, active):
    path = ROOT / relative
    raw = path.read_bytes().decode('utf-8')
    newline = '\r\n' if '\r\n' in raw else '\n'
    text = raw.replace('\r\n', '\n')
    # After the last template stylesheet, so the brand layer wins.
    text = replace_or_insert(text, CSS_START, CSS_END, css_links(),
                             r'((?:[^\n]*<link rel="stylesheet" href="assets/css/(?:main|darkmode|trail-log)\.css[^"]*" />\n)+)')
    text = replace_or_insert(text, NAV_START, NAV_END, nav_html(active), r'(<body[^>]*>\n)')
    path.write_bytes(text.replace('\n', newline).encode('utf-8'))


if __name__ == '__main__':
    for relative, active in SECTIONS.items():
        apply(relative, active)
