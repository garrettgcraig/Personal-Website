#!/usr/bin/env python3
"""Generate the public sitemap, AI guide, and readable trail-journal Markdown.
Run after adding pages: python scripts/build_search_discovery.py
Use --check in CI to require committed artifacts to match the site's content.
"""
import argparse
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://garrettgcraig.com'
NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'


def page_url(path):
    relative = path.relative_to(ROOT).as_posix()
    if relative == 'index.html':
        return ORIGIN + '/'
    if relative.endswith('/index.html'):
        return ORIGIN + '/' + relative[:-10]
    return ORIGIN + '/' + relative[:-5]


def build_outputs():
    pages = []
    for path in sorted(ROOT.rglob('*.html')):
        relative = path.relative_to(ROOT).as_posix()
        if relative.startswith(('.', 'assets/', 'work/')):
            continue
        if path.name == 'index-demo.html' or re.fullmatch(r'google[0-9a-f]+\.html', path.name):
            continue
        text = path.read_text(encoding='utf-8')
        if re.search(r'<meta\b[^>]*name=["\']robots["\'][^>]*content=["\'][^"\']*noindex', text, re.I):
            continue
        pages.append(page_url(path))
    ET.register_namespace('', NS)
    sitemap = ET.Element('{' + NS + '}urlset')
    for url in sorted(set(pages), key=lambda url: (url != ORIGIN + '/', url)):
        child = ET.SubElement(sitemap, '{' + NS + '}url')
        ET.SubElement(child, '{' + NS + '}loc').text = url
    ET.indent(sitemap, space='  ')
    outputs = {'sitemap.xml': '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(sitemap, encoding='unicode') + '\n'}
    entries = json.loads((ROOT / 'data/trail-log.json').read_text())['entries']
    for entry in entries:
        source = next(path for path in (ROOT / 'trail-log/entries').glob('*.md') if not path.name.startswith('_') and re.sub(r'^\d{4}-\d{2}(?:-\d{2})?-', '', path.stem) == entry['slug'])
        body = source.read_text().split('---', 2)[2].strip()
        # Interactive maps belong to the HTML journal; keep the narrative readable here.
        body = re.sub(r'^\[\[(?:map|daymap|observations):.*?\]\]\s*$', '', body, flags=re.M)
        body = re.sub(r'\[\[photo:([^|\]]+)(?:\|([^\]]+))?\]\]', lambda m: '![' + (m[2] or '') + '](' + ORIGIN + '/' + m[1].strip() + ')', body)
        body = re.sub(r'\[\[gallery:([^\]]+)\]\]', lambda m: '\n'.join('![](' + ORIGIN + '/' + p.strip() + ')' for p in m[1].split('|')), body)
        body = re.sub(r'\[\[inat:(\d+)\|([^\]]+)\]\]', lambda m: '[' + m[2] + '](https://www.inaturalist.org/observations/' + m[1] + ')', body)
        body = re.sub(r'\n{3,}', '\n\n', body)
        filename = 'trail-' + entry['slug'] + '.md'
        outputs[filename] = '# ' + entry['title'] + '\n\n' + entry['date'] + ' · ' + entry['location'] + '\n\n[Read the journal with daily maps](' + ORIGIN + '/trail-' + entry['slug'] + ')\n\n' + body.strip() + '\n'
    guide = '''# Garrett G. Craig

> Garrett Craig's personal website: environmental science and conservation research, nature photography, trail journals, and tools for exploring the natural world.

The links below lead to the site's public pages. Trail journals also have plain Markdown versions; use the HTML pages for interactive maps and photographs.

## About

- [Garrett G. Craig](https://garrettgcraig.com/): Biography, interests, photography, research, and contact.

## Research

- [Research](https://garrettgcraig.com/research): Current and past work in conservation, climate, and ecological restoration.
- [Amazonian climate impacts](https://garrettgcraig.com/project-amazon-climate): Projected climate impacts in Indigenous Peoples' and Local Communities' territories.
- [Fossorial animal colonization](https://garrettgcraig.com/project-fossorial): Burrowing animals and ecological restoration.
- [Herpetofauna and restoration](https://garrettgcraig.com/project-herpetofauna): Reptile and amphibian responses to restoration.
- [Greenhouse gas emissions and eTRM](https://garrettgcraig.com/project-ghg-etrm): Standardizing emissions-savings calculations.

## Photography

- [Photography](https://garrettgcraig.com/photography): Nature photography galleries.
- [Wildlife](https://garrettgcraig.com/photography-wildlife): Wildlife photographs.
- [Landscapes](https://garrettgcraig.com/photography-landscapes): Landscape photographs.
- [Flora](https://garrettgcraig.com/photography-flora): Plant photographs.
- [Macro](https://garrettgcraig.com/photography-macro): Close-up photographs.

## Tools and projects

- [Projects](https://garrettgcraig.com/projects): Environmental data tools and applications.
- [Public lands tracker](https://garrettgcraig.com/wilderness): Interactive map of wilderness areas, national parks, and national forests, with visited-land tracking.
- [SeedFinder](https://garrettgcraig.com/seedfinder/): A map for exploring which plants may have collectible seed nearby.
- [KnowKi](https://garrettgcraig.com/knowki/): An app for learning local species by sight, with support information.
- [Santa Barbara wildlife crossings](https://garrettgcraig.com/wildlife-crossings/): Wildlife crossing priorities along Santa Barbara County's state highways.

## Trail journals

- [Trail log](https://garrettgcraig.com/trail-log): Backpacking and hiking journals.
'''
    for entry in entries:
        guide += '- [' + entry['title'] + '](' + ORIGIN + '/trail-' + entry['slug'] + '.md): ' + entry['summary'] + '\n'
    guide += '\n## Optional\n\n- [Sitemap](https://garrettgcraig.com/sitemap.xml): Complete list of public website pages.\n- [KnowKi field guides](https://garrettgcraig.com/knowki/field-guides): Species field-guide information.\n- [KnowKi privacy policy](https://garrettgcraig.com/knowki/privacy): Privacy information for KnowKi.\n'
    outputs['llms.txt'] = guide
    # Preserve manually maintained headers; add canonical URLs for Markdown copies.
    headers = (ROOT / '_headers').read_text().split('# BEGIN GENERATED TRAIL MARKDOWN HEADERS')[0].rstrip()
    headers += '\n\n# BEGIN GENERATED TRAIL MARKDOWN HEADERS\n'
    for entry in entries:
        headers += '/trail-' + entry['slug'] + '.md\n  Link: <' + ORIGIN + '/trail-' + entry['slug'] + '>; rel="canonical"\n\n'
    headers += '# END GENERATED TRAIL MARKDOWN HEADERS\n'
    outputs['_headers'] = headers
    return outputs


def build(check=False):
    stale = []
    for name, content in build_outputs().items():
        path = ROOT / name
        if check:
            if not path.exists() or path.read_text() != content:
                stale.append(name)
        else:
            path.write_text(content, encoding='utf-8')
    if stale:
        raise SystemExit('Search discovery files need rebuilding: ' + ', '.join(stale) + '\nRun python scripts/build_search_discovery.py')
    print('Search discovery files ' + ('are current.' if check else 'built.'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    build(parser.parse_args().check)
