import importlib.util
import math
import unittest


def track(speed=1, count=21):
    # Controlled trajectories are test fixtures, never application records.
    return [dict(frame=i, time_s=i/10, player='near', x_m=1+speed*i/10, y_m=9, observed=1)
            for i in range(count)]


class ResearchTests(unittest.TestCase):
    def test_statistical_research_module_available(self):
        self.assertIsNotNone(importlib.util.find_spec('research'), 'Research computation module is missing')

    def test_motion_filter_never_bridges_a_gap_and_matches_current_metrics(self):
        from research import session_statistics
        from analysis import summarize
        rows=track(count=11);rows[5]['observed']=0
        report=session_statistics(rows, 'near')
        self.assertAlmostEqual(report['distance_m'], .8)
        self.assertEqual(report['motion_pairs'], 8)
        self.assertEqual(report['distance_m'], summarize(rows)['players']['near']['distance_m'])
        self.assertAlmostEqual(report['mean_speed_mps'], 1)

    def test_known_constant_speed_quantiles_and_entropy(self):
        from research import session_statistics
        report=session_statistics(track(),'near')
        self.assertAlmostEqual(report['speed_quantiles']['p50'],1)
        self.assertAlmostEqual(report['speed_quantiles']['p90'],1)
        self.assertAlmostEqual(report['zone_entropy_bits'],0)
        self.assertEqual(report['valid_observations'],21)
        self.assertEqual(sum(report['histogram']['counts']),20)

    def test_block_interval_resamples_whole_blocks_reproducibly(self):
        from research import block_interval
        blocks=[{'distance_m':1.,'observed_s':1.}, {'distance_m':3.,'observed_s':1.}]
        report=block_interval(blocks)
        self.assertEqual(report['estimate'],2)
        self.assertEqual(report['ci95'],[1.,3.])
        self.assertEqual(report,block_interval(blocks))
        self.assertIsNone(block_interval(blocks[:1])['ci95'])
        self.assertIsNone(block_interval([])['estimate'])

    def test_threshold_sensitivity_excludes_abnormal_jumps(self):
        from research import session_statistics
        rows=[dict(frame=i,time_s=i/10,player='near',x_m=x,y_m=9,observed=1)
              for i,x in enumerate([1,1.1,1.8,2.7])]
        report=session_statistics(rows,'near')
        for row,want in zip(report['threshold_sensitivity'],[.1,.8,1.7]):
            self.assertAlmostEqual(row['distance_m'],want)

    def test_zero_calibration_noise_is_identity_and_noise_propagates(self):
        from research import calibration_sensitivity
        points=[[1,9],[2,10],[4,11]];corners=[[20,20],[120,20],[120,120],[20,120]]
        result=calibration_sensitivity(points,corners)
        self.assertLess(result[0]['mean_displacement_m'],1e-5)
        self.assertEqual(result[0]['zone_change_rate'],0)
        self.assertGreater(result[-1]['mean_displacement_m'],result[1]['mean_displacement_m'])
        self.assertEqual(result,calibration_sensitivity(points,corners))

    def test_welch_interval_and_rank_effect_use_session_units(self):
        from research import compare_values
        report=compare_values([1,2,3],[2,3,4], 'independent')
        self.assertEqual(report['difference'],1)
        self.assertAlmostEqual(report['ci95'][0],-1.2669579355,places=7)
        self.assertAlmostEqual(report['ci95'][1],3.2669579355,places=7)
        self.assertAlmostEqual(report['effect'],5/9)
        self.assertEqual(report['effect_name'],'cliffs_delta')
        self.assertEqual(report['n_a'],3)

    def test_paired_comparison_uses_within_pair_differences(self):
        from research import compare_values
        report=compare_values([1,2,3],[2,4,6], 'paired')
        self.assertEqual(report['difference'],2)
        self.assertAlmostEqual(report['ci95'][0],-.4841377117,places=7)
        self.assertAlmostEqual(report['effect'],2)
        self.assertEqual(report['effect_name'],'paired_dz')
        with self.assertRaises(ValueError):compare_values([1],[1,2],'paired')

    def test_small_degenerate_and_nonfinite_groups_do_not_invent_inference(self):
        from research import compare_values
        report=compare_values([1],[2],'independent')
        self.assertEqual(report['difference'],1)
        self.assertIsNone(report['ci95']);self.assertIsNone(report['p_value'])
        self.assertIn('small_sample',report['flags'])
        report=compare_values([1,1],[2,2],'paired')
        self.assertIsNone(report['ci95']);self.assertIsNone(report['effect'])
        with self.assertRaises(ValueError):compare_values([math.nan],[2],'independent')

    def test_success_rate_wilson_interval_uses_actual_attempt_counts(self):
        from research import outcome_statistics
        result=outcome_statistics(10,20)
        self.assertEqual(result['success_rate'],.5)
        self.assertAlmostEqual(result['ci95'][0],.2992980082,places=7)
        self.assertAlmostEqual(result['ci95'][1],.7007019918,places=7)
        self.assertGreater(outcome_statistics(0,20)['ci95'][1],0)
        with self.assertRaises(ValueError):outcome_statistics(21,20)
        with self.assertRaises(ValueError):outcome_statistics(0,0)

    def test_missing_players_and_all_unobserved_tracks_are_rejected(self):
        from research import session_statistics
        with self.assertRaises(ValueError):session_statistics(track(),'far')
        rows=track()
        for row in rows:row['observed']=0
        with self.assertRaises(ValueError):session_statistics(rows,'near')


if __name__=='__main__':unittest.main()
