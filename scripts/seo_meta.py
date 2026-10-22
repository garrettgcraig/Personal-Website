#!/usr/bin/env python3
"""Shared <head> SEO tags: meta description, canonical, Open Graph, Twitter.
Hand-authored pages carry the block between the SEO markers; run this
script to (re)write it. build_trail_log.py imports seo_block() for entries.
"""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://garrettgcraig.com'
DEFAULT_IMAGE = ORIGIN + '/images/og-card.jpg'
START, END = '<!-- SEO -->', '<!-- /SEO -->'

PAGES = {
    'index.html': ('Garrett G. Craig: conservation scientist and builder of tools for nature',
                   'Maps, models, and apps for biodiversity, restoration, and climate resilience, plus photography and trail notes from Garrett G. Craig.'),
    'projects.html': ('Projects', 'Apps and maps for nature: KnowKi, SeedFinder, Santa Barbara Wildlife Crossings, the Public Lands Tracker, and the iNat Rarity Explorer.'),
    'research.html': ('Research', 'Research on conservation planning, climate risk, restoration ecology, and climate policy, from the Amazon to UC Santa Barbara.'),
    'project-amazon-climate.html': ('Climate Hazards in Amazonian IPLC Territories', "Master's capstone for Conservation International mapping wildfire, heat, flooding, and water stress across Indigenous Peoples' and local communities' territories in the Amazon."),
    'project-fossorial.html': ('Wildlife Use of Artificial Refuges', 'Camera-trap analysis of how wildlife used rubble refuges, logs, and boulders at a regraded UC Santa Barbara restoration site.'),
    'project-herpetofauna.html': ('Herpetofauna Response to Restoration', 'Long-term coverboard data on reptiles and amphibians at a UC Santa Barbara restoration site after grading.'),
    'project-ghg-etrm.html': ('GHG Savings Tool for CARB', 'An Excel-based tool for the California Air Resources Board to estimate greenhouse gas savings from the projects it funds.'),
    'photography.html': ('Photography', 'Wildlife, landscape, flora, and macro photography by Garrett G. Craig.'),
    'photography-wildlife.html': ('Wildlife Photography', 'Birds, mammals, reptiles, amphibians, and everything in between, photographed by Garrett G. Craig.'),
    'photography-landscapes.html': ('Landscape Photography', 'Mountains, coastlines, forests, and wide open spaces, photographed by Garrett G. Craig.'),
    'photography-flora.html': ('Flora Photography', 'Plants, trees, and fungi in their natural habitats, photographed by Garrett G. Craig.'),
    'photography-macro.html': ('Macro Photography', 'Small wonders of the natural world up close, photographed by Garrett G. Craig.'),
    'trail-log.html': ('Trail Log', 'Field notes, maps, and photos from backpacking trips in the Sierra Nevada, the Central Coast, and beyond.'),
    'wilderness.html': ('Public Lands Tracker', "Track your visits to 1,350+ U.S. wilderness areas, national parks, and national forests on an interactive map."),
    'brand.html': ('Brand Guide', 'The brand guide for garrettgcraig.com: palette, type, mark, components, chart colors, voice, and photo style.'),
}


def page_url(relative):
    if relative == 'index.html':
        return ORIGIN + '/'
    return ORIGIN + '/' + relative[:-5]


def seo_block(title, description, url, image=DEFAULT_IMAGE, indent='\t\t'):
    esc = lambda s: html.escape(s, quote=True)
    tags = [
        START,
        '<meta name="description" content="%s" />' % esc(description),
        '<link rel="canonical" href="%s" />' % esc(url),
        '<meta property="og:type" content="website" />',
        '<meta property="og:site_name" content="Garrett G. Craig" />',
        '<meta property="og:title" content="%s" />' % esc(title),
        '<meta property="og:description" content="%s" />' % esc(description),
        '<meta property="og:url" content="%s" />' % esc(url),
        '<meta property="og:image" content="%s" />' % esc(image),
        '<meta name="twitter:card" content="summary_large_image" />',
        END,
    ]
    return '\n'.join(indent + t for t in tags)


def apply(relative, title, description):
    path = ROOT / relative
    raw = path.read_bytes().decode('utf-8')
    newline = '\r\n' if '\r\n' in raw else '\n'
    text = raw.replace('\r\n', '\n')
    block = seo_block(title, description, page_url(relative))
    if START in text:
        text = re.sub(r'[ \t]*' + re.escape(START) + r'.*?' + re.escape(END), block, text, flags=re.S)
    else:
        # Drop any hand-written description so the block is the only one.
        text = re.sub(r'[ \t]*<meta name="description"[^>]*>\n', '', text)
        text = re.sub(r'(<meta name="viewport"[^>]*>\n)', lambda m: m.group(1) + block + '\n', text, count=1)
    path.write_bytes(text.replace('\n', newline).encode('utf-8'))


if __name__ == '__main__':
    for relative, (title, description) in PAGES.items():
        apply(relative, title, description)
