import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('timeline_resolver', ROOT / 'scripts/timeline_resolve_spotify.py')
resolver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolver)

SPOT_A = 'AAAAAAAAAAAAAAAAAAAAAA'
SPOT_B = 'BBBBBBBBBBBBBBBBBBBBBB'


def song(name, artist, year, track_id, collection='Album'):
    return {'kind': 'song', 'trackId': track_id, 'trackName': name, 'artistName': artist,
            'collectionName': collection, 'releaseDate': f'{year}-01-01T08:00:00Z'}


class FakeServices:
    """Answers iTunes and song.link calls from fixtures and records what was asked."""

    def __init__(self, itunes, odesli):
        self.itunes, self.odesli, self.calls = itunes, odesli, []

    def __call__(self, url, params):
        self.calls.append((url, params))
        if url == resolver.ITUNES_URL:
            return {'results': self.itunes.get(params['term'], [])}
        return self.odesli.get(params['id'], {})


def odesli(track_id, title):
    return {'linksByPlatform': {'spotify': {'url': f'https://open.spotify.com/track/{track_id}'}},
            'entitiesByUniqueId': {f'SPOTIFY_SONG::{track_id}': {'title': title}}}


class MatchingTests(unittest.TestCase):
    def test_prefers_studio_original_over_live_karaoke_and_reissues(self):
        results = [
            song('Bohemian Rhapsody (Live Aid)', 'Queen', 1985, 1),
            song('Bohemian Rhapsody', 'Karaoke Kings', 2010, 2, 'Karaoke Hits'),
            song('Bohemian Rhapsody', 'Queen', 2011, 3, 'Greatest Hits'),
            song('Bohemian Rhapsody', 'Queen', 1975, 4, 'A Night at the Opera'),
        ]
        self.assertEqual(resolver.pick_itunes(results, 'Bohemian Rhapsody', 'Queen')['trackId'], 4)

    def test_rejects_wrong_artist(self):
        self.assertIsNone(resolver.pick_itunes([song('Crazy', 'Gnarls Barkley', 2006, 1)], 'Crazy', 'Patsy Cline'))

    def test_matches_featured_credit_and_remaster_suffix(self):
        results = [song('Uptown Funk (feat. Bruno Mars)', 'Mark Ronson', 2014, 9)]
        self.assertEqual(resolver.pick_itunes(results, 'Uptown Funk', 'Mark Ronson')['trackId'], 9)
        self.assertEqual(resolver.normalize('Africa - 2017 Remaster'), 'africa')

    def test_odesli_title_check_blocks_bad_mappings(self):
        self.assertEqual(resolver.spotify_from_odesli(odesli(SPOT_A, 'Africa'), 'Africa', 'Toto'), SPOT_A)
        self.assertIsNone(resolver.spotify_from_odesli(odesli(SPOT_A, 'Rosanna'), 'Africa', 'Toto'))
        self.assertIsNone(resolver.spotify_from_odesli({}, 'Africa', 'Toto'))


class RunTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.songs = self.dir / 'songs.js'
        self.cache = self.dir / 'cache.json'
        self.report = self.dir / 'report.md'
        self.songs.write_text('// header\nexport const SONGS = [\n'
                              '["Africa","Toto",1982,null],\n'
                              '["Nowhere Song","Nobody",1990,null],\n'
                              f'["Hey Ya!","OutKast",2003,"{SPOT_B}"]\n];\n', encoding='utf-8')

    def run_resolver(self, services, **kw):
        clock = [0.0]

        def sleep(s):
            clock[0] += s

        return resolver.run(kw.get('limit'), kw.get('max_minutes', 300), kw.get('retry', False), fetch=services,
                            sleep=sleep, clock=lambda: clock[0], songs_path=self.songs,
                            cache_path=self.cache, report_path=self.report)

    def test_fills_ids_keeps_existing_and_writes_report(self):
        services = FakeServices({'Africa Toto': [song('Africa', 'Toto', 1981, 77)]}, {77: odesli(SPOT_A, 'Africa')})
        result = self.run_resolver(services)
        self.assertEqual(result, {'looked_up': 2, 'found': 1, 'have': 2, 'total': 3})
        _, rows = resolver.read_catalog(self.songs)
        self.assertEqual(rows[0][3], SPOT_A)
        self.assertIsNone(rows[1][3])
        self.assertEqual(rows[2][3], SPOT_B)
        self.assertTrue(self.songs.read_text().startswith('// header\nexport const SONGS = ['))
        report = self.report.read_text()
        self.assertIn('2 of 3 songs', report)
        self.assertIn('Africa, Toto: listed 1982, Apple 1981', report)
        self.assertIn('Nowhere Song, Nobody (1990): no-apple-match', report)

    def test_second_run_uses_cache_and_skips_known_misses(self):
        services = FakeServices({'Africa Toto': [song('Africa', 'Toto', 1982, 77)]}, {77: odesli(SPOT_A, 'Africa')})
        self.run_resolver(services)
        first = len(services.calls)
        self.run_resolver(services)
        self.assertEqual(len(services.calls), first)

    def test_spaces_out_song_link_calls(self):
        services = FakeServices({'Africa Toto': [song('Africa', 'Toto', 1982, 77)]}, {77: odesli(SPOT_A, 'Africa')})
        stamps = []
        clock = [0.0]

        def fetch(url, params):
            stamps.append((url, clock[0]))
            return services(url, params)

        resolver.run(None, 300, False, fetch=fetch, sleep=lambda s: clock.__setitem__(0, clock[0] + s),
                     clock=lambda: clock[0], songs_path=self.songs, cache_path=self.cache, report_path=self.report)
        itunes = [t for u, t in stamps if u == resolver.ITUNES_URL]
        self.assertTrue(all(b - a >= resolver.ITUNES_GAP for a, b in zip(itunes, itunes[1:])))

    def test_real_catalog_parses_and_has_no_duplicates(self):
        _, rows = resolver.read_catalog()
        keys = [resolver.key_for(t, a).lower() for t, a, _, _ in rows]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertTrue(all(1950 <= y <= 2026 for _, _, y, _ in rows))
        self.assertTrue(all(sp is None or len(sp) == 22 for *_, sp in rows))


if __name__ == '__main__':
    unittest.main()
