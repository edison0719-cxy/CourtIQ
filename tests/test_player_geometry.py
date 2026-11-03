import importlib.util
from pathlib import Path
import unittest

import numpy as np

SOURCE = Path(__file__).resolve().parents[1]/'vendor/badminton-pipeline-repro/scripts/overlay/overlay_player_analytics.py'
spec = importlib.util.spec_from_file_location('player_overlay', SOURCE)
overlay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlay)


class PlayerGeometryTests(unittest.TestCase):
    def test_perspective_net_does_not_use_average_image_height(self):
        # Far baseline width 200, near width 1000: physical midpoint is y=1000/3.
        quad = np.float32([[400,200],[600,200],[1000,1000],[0,1000]])
        net = overlay.court_net_line(quad)
        self.assertAlmostEqual(float(net[0][1]), 1000/3, places=3)
        self.assertAlmostEqual(float(net[1][1]), 1000/3, places=3)
        child = {'track_id': 1, 'foot': (500,500)}
        near, far = overlay.assign_players([child],None,None,side_line_y=lambda x: float(net[0][1]))
        self.assertEqual(near['track_id'], 1)
        self.assertIsNone(far)

    def test_slanted_net_is_evaluated_at_each_players_x(self):
        left = {'track_id':1,'foot':(100,440)}
        right = {'track_id':2,'foot':(900,440)}
        near, far = overlay.assign_players([left,right],None,None,side_line_y=lambda x:400+x*.1,side_band_px=0)
        self.assertEqual(near['track_id'],1)
        self.assertEqual(far['track_id'],2)

    def test_existing_horizontal_boundary_remains_supported(self):
        child={'track_id':1,'foot':(500,700)}
        near,far=overlay.assign_players([child],None,None,side_line_y=500)
        self.assertEqual(near['track_id'],1)
        self.assertIsNone(far)
