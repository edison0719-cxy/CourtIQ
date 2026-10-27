import csv
import tempfile
import unittest
from pathlib import Path


class AnalysisTests(unittest.TestCase):
    def test_analysis_module_available(self):
        import importlib.util
        self.assertIsNotNone(importlib.util.find_spec('analysis'), 'The real trajectory analysis module is missing')

    def test_missing_observations_do_not_create_movement_or_transitions(self):
        from analysis import summarize
        rows = [dict(frame=i, time_s=i/10, player='near', x_m=x, y_m=9,
                     observed=observed) for i, x, observed in
                [(0, 1, 1), (1, 1.3, 1), (2, 4, 0), (3, 5, 1)]]
        result = summarize(rows, 6.1, 13.4)['players']['near']
        self.assertAlmostEqual(result['distance_m'], .3)
        self.assertEqual(result['valid_observations'], 3)
        self.assertEqual(result['missing_observations'], 1)
        self.assertEqual(result['valid_motion_pairs'], 1)

    def test_jump_is_rejected_instead_of_inflating_distance(self):
        from analysis import summarize
        rows = [dict(frame=i, time_s=i/30, player='near', x_m=x, y_m=9, observed=1)
                for i, x in enumerate([1, 1.1, 6])]
        result = summarize(rows, 6.1, 13.4)['players']['near']
        self.assertAlmostEqual(result['distance_m'], .1)
        self.assertEqual(result['rejected_motion_pairs'], 1)

    def test_empty_csv_cannot_generate_successful_analytics(self):
        from analysis import summarize
        with self.assertRaises(ValueError):
            summarize([], 6.1, 13.4)

    def test_collinear_points_have_zero_hull_area(self):
        from analysis import summarize
        rows = [dict(frame=i, time_s=i/10, player='far', x_m=i*.1+1, y_m=3, observed=1)
                for i in range(5)]
        self.assertEqual(summarize(rows, 6.1, 13.4)['players']['far']['hull_area_m2'], 0)

    def test_calibration_rejects_crossed_or_out_of_frame_points(self):
        from pipeline import validate_court
        for points in [[[0,0],[100,100],[100,0],[0,100]], [[0,0],[100,0],[100,100],[-1,100]]]:
            with self.assertRaises(ValueError):
                validate_court(points, 100, 100)
        self.assertEqual(len(validate_court([[10,10],[90,10],[90,90],[10,90]],100,100)), 4)


if __name__ == '__main__':
    unittest.main()
