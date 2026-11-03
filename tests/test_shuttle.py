import json
import unittest
from pathlib import Path

from shuttle import analyze_shuttle, apply_review, session_shuttle


class ShuttleTests(unittest.TestCase):
    def test_missing_detection_is_not_a_zero_hit_measurement(self):
        report = analyze_shuttle(None, 30, 30, 960, 540)
        self.assertEqual(report['status'], 'not_run')
        self.assertEqual(report['trajectory'], [])
        empty = analyze_shuttle([{'Frame': 0, 'Visibility': 0, 'X': 0, 'Y': 0}], 30, 30, 960, 540)
        self.assertEqual(empty['status'], 'no_detections')
        self.assertEqual(empty['events'], [])

    def test_frame_and_image_normalization_survive_fps_and_resolution_changes(self):
        counts = []
        for fps, scale in [(30, 1), (60, 2)]:
            rows = [{'Frame': f, 'Visibility': 1, 'X': (200+80*f/fps)*scale,
                     'Y': (100+120*abs(f/fps-.5))*scale} for f in range(fps)]
            report = analyze_shuttle(rows, fps, fps, 960*scale, 540*scale)
            self.assertTrue(report['events'])
            self.assertAlmostEqual(report['events'][0]['time_s'], .5, delta=.08)
            self.assertEqual(report['events'][0]['status'], 'candidate')
            counts.append(len(report['events']))
        self.assertEqual(counts[0], counts[1])

    def test_missing_frames_do_not_create_an_interpolated_hit(self):
        rows = [{'Frame': f, 'Visibility': 1, 'X': 200+f*2, 'Y': abs(f-15)*5+100}
                for f in range(30) if not 10 <= f <= 20]
        report = analyze_shuttle(rows, 30, 30, 960, 540)
        self.assertEqual(report['events'], [])
        self.assertEqual(len(report['trajectory']), 19)

    def test_short_manually_confirmed_rally_does_not_need_two_players(self):
        report = analyze_shuttle(None, 30, 300, 960, 540)
        reviewed = apply_review(report, [
            {'frame': 30, 'kind': 'start', 'status': 'confirmed', 'player': None},
            {'frame': 35, 'kind': 'serve', 'status': 'confirmed', 'player': 'near'},
            {'frame': 60, 'kind': 'end', 'status': 'confirmed', 'player': None}])
        self.assertEqual(len(reviewed['rallies']), 1)
        self.assertEqual(reviewed['rallies'][0]['confirmed_shots'], 1)
        self.assertAlmostEqual(reviewed['rallies'][0]['duration_s'], 1)
        self.assertIsNone(reviewed['rallies'][0]['mean_interval_s'])
        self.assertEqual(report['events'], [], 'Review must not mutate detector output')

    def test_invalid_or_unpaired_boundaries_cannot_be_published_as_rallies(self):
        report = analyze_shuttle(None, 30, 300, 960, 540)
        for items in [[{'frame': 300, 'kind': 'hit', 'status': 'confirmed'}],
                      [{'frame': 20, 'kind': 'end', 'status': 'confirmed'}],
                      [{'frame': 10, 'kind': 'start', 'status': 'confirmed'},
                       {'frame': 20, 'kind': 'start', 'status': 'confirmed'}]]:
            with self.assertRaises(ValueError): apply_review(report, items)
        self.assertEqual(apply_review(report, [{'frame': 10, 'kind': 'start', 'status': 'confirmed'}])['rallies'], [])

    def test_one_contact_cannot_be_counted_as_both_hit_and_serve(self):
        report=analyze_shuttle(None,30,300,960,540)
        with self.assertRaises(ValueError):
            apply_review(report,[{'frame':30,'kind':kind,'status':'confirmed'} for kind in ('hit','serve')])

    def test_real_completed_sample_preserves_csv_identity(self):
        root = Path(__file__).resolve().parents[1]
        sid = '82f114c3d19f47fb83252268c05efa0c'
        folder = root/'data/sessions'/sid
        if not folder.exists(): self.skipTest('Local genuine inference artifacts not installed')
        session = json.loads((folder/'session.json').read_text())
        run = folder/'runs'/'299705b4e6534031b86ee0d50080a9a4'
        report = session_shuttle(run, session, json.loads((run/'summary.json').read_text()))
        self.assertEqual(report['valid_observations'], 102)
        self.assertEqual(len(report['trajectory']), 102)
        self.assertEqual(len(report['source']['csv_sha256']), 64)


if __name__ == '__main__': unittest.main()
