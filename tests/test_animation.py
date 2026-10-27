import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from render_animation import observed_position, observed_segments, render_animation

ROOT = Path(__file__).resolve().parents[1]


class AnimationTests(unittest.TestCase):
    def test_trails_break_at_missing_source_frames_even_when_the_time_gap_is_short(self):
        track = [[0, 0, 1, 2], [2, .1, 1.3, 2], [3, .15, 1.5, 2], [4, .3, 1.6, 2]]
        self.assertEqual(list(observed_segments(track, .2)), [(track[1], track[2])])

    def test_missing_and_future_detections_are_not_rendered_as_current_positions(self):
        track = [[0, 0, 1, 2], [1, .05, 2, 3], [12, .6, 3, 4]]
        self.assertIsNone(observed_position(track, -.01, .05))
        self.assertEqual(observed_position(track, .06, .05), [1, .05, 2, 3])
        self.assertIsNone(observed_position(track, .3, .05))
        self.assertEqual(observed_position(track, .6, .05), [12, .6, 3, 4])

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg tools required')
    def test_real_published_run_renders_to_browser_compatible_video(self):
        catalog = json.loads((ROOT / 'published/catalog.json').read_text())
        session = next(s for s in catalog['sessions'] if s['is_example'])
        folder = ROOT / 'published' / session['id']
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp)
            result = render_animation(folder, target)
            info = json.loads(subprocess.check_output([
                'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json',
                str(target / result['file'])]))
            stream = info['streams'][0]
            self.assertEqual(stream['codec_name'], 'h264')
            self.assertEqual(stream['pix_fmt'], 'yuv420p')
            self.assertEqual((stream['width'], stream['height']), (1280, 720))
            self.assertAlmostEqual(float(info['format']['duration']), 5., places=2)
            self.assertEqual(result['run_id'], session['run_id'])
            self.assertTrue((target / result['poster']).is_file())
            self.assertLess((target / result['file']).stat().st_size, 25 * 1024 * 1024)


if __name__ == '__main__':
    unittest.main()
