# Search and AI discovery

- `sitemap.xml`: public HTML pages, using the site's preferred clean URLs. Excludes the template/demo and Google's verification file. No guessed modification dates.
- `robots.txt`: allows public crawling and advertises the sitemap to search engines, including Google. This is the standard filename; `robots.md` is not a crawler convention.
- `llms.txt`: a concise public directory for AI readers, following the proposed llms.txt Markdown format. It is an additional discovery aid, not a guarantee of indexing or AI usage.
- `trail-*.md`: readable copies of trail journals, linked from llms.txt and each journal's HTML head. Maps remain on the HTML pages. HTTP canonical headers identify the HTML versions as preferred for search.
- `_headers`: advertises llms.txt with `rel="describedby"`, sets discovery-file content types, and preserves KnowKi's existing Universal Links configuration.

Run `python scripts/build_search_discovery.py` after adding public HTML pages. The normal trail-log build also updates discovery files. The `Check search discovery` workflow rejects stale generated files. Only the standard Python library is required by the discovery builder.

For Google Search Console, sign in to the account that owns the `https://garrettgcraig.com/` or domain property, open Sitemaps, and submit `sitemap.xml`. Use URL Inspection to check important pages. The existing Google verification HTML file is preserved.

References:
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/crawling/docs/robots-txt/create-robots-txt
- https://llmstxt.org/
