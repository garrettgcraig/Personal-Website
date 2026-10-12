import importlib.util
import json
from pathlib import Path
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('trail_builder', ROOT / 'scripts/build_trail_log.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class TrailLogTests(unittest.TestCase):
    def test_observation_maps_load_assets_without_claiming_gpx(self):
        html, has_map = builder.preprocess_directives('[[observations:data/inat-big-seki.json]]')
        self.assertTrue(has_map)
        self.assertIn('data-inat="data/inat-big-seki.json"', html)
        self.assertNotIn('data-gpx', html)
        self.assertIn('trail-observation-map', html)

    def test_gpx_directive_still_keeps_its_overlay(self):
        html, has_map = builder.preprocess_directives('[[map:track.gpx|inat:obs.json]]')
        self.assertTrue(has_map)
        self.assertIn('data-gpx="track.gpx"', html)
        self.assertIn('data-inat="obs.json"', html)

    def test_directive_attributes_escape_quotes(self):
        html, _ = builder.preprocess_directives('[[observations:file" onmouseover="bad]]')
        self.assertIn('&quot;', html)
        self.assertNotIn(' onmouseover="', html)

    def test_snapshot_dates_precision_and_counts_are_consistent(self):
        data = json.loads((ROOT / 'data/inat-big-seki.json').read_text())
        obs = data['observations']
        self.assertEqual(len(obs), 594)
        self.assertEqual(len(set(o['id'] for o in obs)), 594)
        self.assertEqual(len(data['days']), 15)
        self.assertEqual(sum(d['count'] for d in data['days']), 594)
        for o in obs:
            self.assertLessEqual(o['accuracy_m'], 500)
            self.assertTrue(36.4 < o['lat'] < 37.2 and -118.7 < o['lng'] < -118.3)
            self.assertEqual(o['day'], datetime.fromisoformat(o['time']).astimezone(ZoneInfo('America/Los_Angeles')).date().isoformat())
        for day in data['days']:
            group = [o for o in obs if o['day'] == day['date']]
            self.assertEqual(len(group), day['count'])
            self.assertEqual(group[0]['id'], day['first_id'])
            self.assertEqual(group[-1]['id'], day['last_id'])

if __name__ == '__main__':
    unittest.main()
