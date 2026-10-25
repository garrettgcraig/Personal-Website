import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('chronosono_resolver', ROOT / 'scripts/chronosono_resolve_spotify.py')
resolver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolver)

SPOT_A = 'AAAAAAAAAAAAAAAAAAAAAA'
SPOT_B = 'BBBBBBBBBBBBBBBBBBBBBB'
SPOT_C = 'CCCCCCCCCCCCCCCCCCCCCC'


def binding(label, item, spotify, performer=None, date=None):
    b = {'label': {'value': label}, 'item': {'value': item}, 'spotify': {'value': spotify}}
    if performer:
        b['performerLabel'] = {'value': performer}
    if date:
        b['date'] = {'value': date}
    return b


class FakeWikidata:
    """Answers SPARQL queries from fixture bindings, filtered to the labels each query asks for."""

    def __init__(self, bindings):
        self.bindings, self.queries = bindings, []

    def __call__(self, query):
        self.queries.append(query)
        return {'results': {'bindings': [b for b in self.bindings if f'"{b["label"]["value"]}"@en' in query]}}


class MatchingTests(unittest.TestCase):
    def test_label_variants_cover_common_capitalizations(self):
        v = resolver.label_variants('bad guy')
        self.assertIn('bad guy', v)
        self.assertIn('Bad Guy', v)
        self.assertIn('Bad guy', v)
        self.assertIn('Espresso', resolver.label_variants('Espresso (Remix)'))

    def test_artist_matching_handles_the_and_features(self):
        self.assertTrue(resolver.artist_matches('The Beatles', ['Beatles']))
        self.assertTrue(resolver.artist_matches('Mark Ronson ft. Bruno Mars', ['Mark Ronson', 'Bruno Mars']))
        self.assertFalse(resolver.artist_matches('Patsy Cline', ['Gnarls Barkley']))

    def test_pick_requires_title_artist_and_valid_id_and_prefers_earliest(self):
        cands = [
            {'label': 'Crazy', 'spotify': SPOT_A, 'performers': ['Gnarls Barkley'], 'year': 2006},
            {'label': 'Crazy', 'spotify': SPOT_B, 'performers': ['Patsy Cline'], 'year': 1961},
            {'label': 'Crazy', 'spotify': SPOT_C, 'performers': ['Patsy Cline'], 'year': 1990},
            {'label': 'Crazy', 'spotify': 'short', 'performers': ['Patsy Cline'], 'year': 1950},
        ]
        self.assertEqual(resolver.pick(cands, 'Crazy', 'Patsy Cline')['spotify'], SPOT_B)
        self.assertIsNone(resolver.pick(cands, 'Crazy', 'Willie Nelson'))

    def test_parse_results_merges_performers_and_keeps_earliest_date(self):
        data = {'results': {'bindings': [
            binding('Uptown Funk', 'Q1', SPOT_A, 'Mark Ronson', '2014-11-10T00:00:00Z'),
            binding('Uptown Funk', 'Q1', SPOT_A, 'Bruno Mars', '2015-01-01T00:00:00Z'),
        ]}}
        c = resolver.parse_results(data)['Uptown Funk'][0]
        self.assertEqual(c['performers'], ['Mark Ronson', 'Bruno Mars'])
        self.assertEqual(c['year'], 2014)


class RunTests(unittest.TestCase):
    def setUp(self):
        d = Path(tempfile.mkdtemp())
        self.songs, self.cache, self.report = d / 'songs.js', d / 'cache.json', d / 'report.md'
        self.songs.write_text('// header\nexport const SONGS = [\n'
                              '["Espresso","Sabrina Carpenter",2024,null],\n'
                              '["Nowhere Song","Nobody",1990,null],\n'
                              f'["Hey Ya!","OutKast",2003,"{SPOT_B}"]\n];\n', encoding='utf-8')
        self.wd = FakeWikidata([
            binding('Espresso', 'Q1', SPOT_A, 'Sabrina Carpenter', '2024-04-11T00:00:00Z'),
            binding('Espresso', 'Q2', SPOT_C, 'Someone Else', '2001-01-01T00:00:00Z'),
        ])

    def run_resolver(self, **kw):
        return resolver.run(kw.get('limit'), kw.get('retry', False), fetch=self.wd, sleep=lambda s: None,
                            songs_path=self.songs, cache_path=self.cache, report_path=self.report)

    def test_fills_ids_keeps_existing_and_reports(self):
        self.assertEqual(self.run_resolver(), {'looked_up': 2, 'found': 1, 'have': 2, 'total': 3})
        _, rows = resolver.read_catalog(self.songs)
        self.assertEqual([r[3] for r in rows], [SPOT_A, None, SPOT_B])
        self.assertTrue(self.songs.read_text().startswith('// header\nexport const SONGS = ['))
        report = self.report.read_text()
        self.assertIn('2 of 3 songs', report)
        self.assertIn('Nowhere Song, Nobody (1990)', report)
        self.assertIn('wikidata 1', report)

    def test_second_run_skips_known_misses_unless_asked(self):
        self.run_resolver()
        n = len(self.wd.queries)
        self.run_resolver()
        self.assertEqual(len(self.wd.queries), n)
        self.run_resolver(retry=True)
        self.assertEqual(len(self.wd.queries), n + 1)

    def test_failed_query_marks_nothing_as_missed(self):
        self.wd.__call__ = None
        res = resolver.run(None, False, fetch=lambda q: (_ for _ in ()).throw(TimeoutError()), sleep=lambda s: None,
                           songs_path=self.songs, cache_path=self.cache, report_path=self.report)
        self.assertEqual(res['found'], 0)
        self.assertEqual(resolver.load_cache(self.cache), {})

    def test_real_catalog_parses_and_has_no_duplicates(self):
        _, rows = resolver.read_catalog()
        keys = [resolver.key_for(t, a).lower() for t, a, *_ in rows]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertTrue(all(1950 <= r[2] <= 2026 for r in rows))
        self.assertTrue(all(r[3] is None or resolver.SPOTIFY_ID.match(r[3]) for r in rows))
        genres = {"Pop", "Rock", "Hip-hop", "R&B & Soul", "Country", "Dance & Electronic", "Latin", "Folk & Singer-songwriter"}
        bad = [r[:2] for r in rows if len(r) < 5 or not 1 <= len(r[4]) <= 2 or not set(r[4]) <= genres]
        self.assertEqual(bad, [], "every song needs one or two known genres")


if __name__ == '__main__':
    unittest.main()
