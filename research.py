"""Reproducible statistics on observed trajectories; no new tracking model.

Time-block bootstrap estimates sampling variation conditional on observed motion.
Calibration perturbations are assumption-driven sensitivity experiments, not CIs.
"""
import math

import numpy as np
from scipy import stats

from analysis import motion_pairs, observed_track, summarize

SEED = 20261026
RESAMPLES = 2000
CALIBRATION_DRAWS = 200
METRICS = {'mean_speed_mps': 'm/s', 'distance_per_minute': 'm/min',
           'observation_rate': '%', 'hull_area_m2': 'm²', 'success_rate': '%', 'review_time_s': 's'}


def block_interval(blocks, seed=SEED):
    values = np.array([[b['distance_m'], b['observed_s']] for b in blocks if b['observed_s'] > 0], dtype=float)
    n = len(values)
    report = {'blocks': n, 'estimate': None, 'ci95': None, 'resamples': RESAMPLES, 'seed': seed}
    if not n:
        return report
    report['estimate'] = float(values[:, 0].sum() / values[:, 1].sum())
    if n < 2:
        return report
    rng = np.random.default_rng(seed)
    distribution = []
    # Cap each index matrix at about 2 MB, even for a long video.
    batch = max(1, min(200, 250000 // n))
    for start in range(0, RESAMPLES, batch):
        indices = rng.integers(0, n, size=(min(batch, RESAMPLES-start), n))
        totals = values[indices].sum(axis=1)
        distribution.extend(totals[:, 0] / totals[:, 1])
    report['ci95'] = np.quantile(distribution, [.025, .975]).tolist()
    return report


def calibration_sensitivity(positions, corners, player='near', width=6.1, length=13.4):
    import cv2
    positions = np.asarray(positions, dtype=float).reshape(-1, 2)
    if not len(positions):
        return []
    # Evenly sample positions only for this sensitivity experiment, never for motion statistics.
    positions = positions[np.linspace(0, len(positions)-1, min(2500, len(positions)), dtype=int)]
    source = np.asarray(corners, dtype=np.float32)
    if source.shape != (4, 2) or not np.isfinite(source).all() or not cv2.isContourConvex(source):
        raise ValueError('球场标定无效，无法运行敏感性实验。')
    destination = np.array([[0,0],[width,0],[width,length],[0,length]], dtype=np.float32)
    original = cv2.getPerspectiveTransform(source, destination)
    try:
        inverse = np.linalg.inv(original)
    except np.linalg.LinAlgError as exc:
        raise ValueError('球场标定无效，无法运行敏感性实验。') from exc
    pixels = cv2.perspectiveTransform(positions.reshape(-1,1,2), inverse)
    def zones(points):
        local_y = ((points[:,1]-length/2) if player == 'near' else (length/2-points[:,1])) / (length/2)
        labels = np.minimum(2, np.maximum(0, np.floor(local_y*3))).astype(int)*2 + (points[:,0] >= width/2)
        outside = (points[:,0]<0)|(points[:,0]>width)|(points[:,1]<0)|(points[:,1]>length)
        labels[outside] = -1
        return labels
    baseline = zones(positions)
    rows = []
    for sigma in (0, 1, 2, 5):
        rng = np.random.default_rng(SEED)
        displacement, changed = [], []
        for _ in range(CALIBRATION_DRAWS):
            perturbed = (source + rng.normal(0, sigma, source.shape)).astype(np.float32)
            if not cv2.isContourConvex(perturbed):
                continue
            transform = cv2.getPerspectiveTransform(perturbed, destination)
            mapped = cv2.perspectiveTransform(pixels, transform).reshape(-1,2)
            if not np.isfinite(mapped).all():
                continue
            displacement.append(np.linalg.norm(mapped-positions, axis=1))
            changed.append(float(np.mean(zones(mapped) != baseline)))
        distances = np.concatenate(displacement) if displacement else np.array([])
        rows.append({'sigma_px':sigma, 'draws':len(changed), 'sampled_positions':len(positions),
                     'mean_displacement_m':float(distances.mean()) if len(distances) else None,
                     'displacement_p95_m':float(np.quantile(distances,.95)) if len(distances) else None,
                     'zone_change_rate':float(np.mean(changed)) if changed else None})
    return rows


def session_statistics(rows, player, calibration=None, width=6.1, length=13.4):
    rows = list(rows)
    source_count, track = observed_track(rows, player, width, length)
    if not len(track):
        raise ValueError('所选球员没有有效观测。')
    summary = summarize(rows, width, length)
    p = summary['players'][player]
    dt, distance, speed, accepted = motion_pairs(track)
    valid_speed = speed[accepted]
    bins = np.linspace(0, 8, 17)
    hist, _ = np.histogram(valid_speed, bins=bins)
    probabilities = np.array(p['zones'], dtype=float) / p['valid_observations']
    probabilities = probabilities[probabilities > 0]
    entropy = float(-np.sum(probabilities*np.log2(probabilities)))
    bootstrap = []
    for seconds in (.5, 1, 2):
        # Assign each whole accepted pair by midpoint. Missing pairs never become motion.
        indices = np.floor(((track[1:,1]+track[:-1,1])/2-track[0,1])/seconds).astype(int)
        block_distance = np.bincount(indices[accepted], weights=distance[accepted])
        block_duration = np.bincount(indices[accepted], weights=dt[accepted])
        blocks = [{'start_s':float(track[0,1]+index*seconds),
                   'distance_m':float(block_distance[index]), 'observed_s':float(block_duration[index])}
                  for index in np.flatnonzero(block_duration > 0)]
        bootstrap.append({'block_seconds':seconds, **block_interval(blocks)})
    sensitivity = []
    for limit in (6, 8, 10):
        delta_t, movement, _, keep = motion_pairs(track, limit)
        observed_s = float(delta_t[keep].sum())
        sensitivity.append({'speed_limit_mps':limit, 'distance_m':float(movement[keep].sum()),
                            'mean_speed_mps':float(movement[keep].sum()/observed_s) if observed_s else None,
                            'motion_pairs':int(keep.sum())})
    flags = []
    if summary['analysis_duration_s'] < 30:
        flags.append('short_clip')
    if p['observation_rate'] < .8:
        flags.append('incomplete_observation')
    if not accepted.any():
        flags.append('no_motion_pairs')
    return {'schema_version':1, 'player':player, 'seed':SEED,
            'analysis_duration_s':summary['analysis_duration_s'],
            'valid_observations':len(track), 'source_frames':source_count,
            'observation_rate':p['observation_rate'], 'motion_pairs':int(accepted.sum()),
            'distance_m':p['distance_m'], 'observed_motion_s':float(dt[accepted].sum()),
            'mean_speed_mps':p['mean_speed_mps'], 'hull_area_m2':p['hull_area_m2'],
            'speed_quantiles':{key:float(np.quantile(valid_speed,q)) if len(valid_speed) else None
                               for key,q in [('p25',.25),('p50',.5),('p75',.75),('p90',.9),('p95',.95)]},
            'zone_entropy_bits':entropy, 'normalized_zone_entropy':entropy/math.log2(6),
            'position_covariance_m2':p['covariance'],
            'histogram':{'edges':bins.tolist(),'counts':hist.tolist()},
            'block_bootstrap':bootstrap, 'threshold_sensitivity':sensitivity,
            'calibration_sensitivity':calibration_sensitivity(track[:,2:4],calibration,player,width,length) if calibration else [],
            'flags':flags,
            'method':{'motion_speed_limit_mps':8, 'max_pair_gap_s':.2,
                      'bootstrap':'non-overlapping time-block percentile bootstrap of sum(distance)/sum(observed time)',
                      'bootstrap_assumption':'Blocks approximate independent, similarly distributed motion segments. Check block-size sensitivity; missing motion is not recovered.',
                      'calibration':'Independent N(0,sigma_px²) corner-coordinate perturbations; conditional on fixed detections. Sensitivity scenarios, not measured errors or confidence intervals.',
                      'entropy':'Shannon entropy of six empirical half-court zones, in bits; not a performance score.',
                      'references':['https://www.stat.cmu.edu/~cshalizi/uADA/16/lectures/26.pdf',
                                    'https://docs.opencv.org/4.x/da/d54/group__imgproc__transform.html']}}


def compare_values(a, b, design):
    a, b = np.asarray(a,dtype=float), np.asarray(b,dtype=float)
    if design not in {'independent','paired'} or not np.isfinite(a).all() or not np.isfinite(b).all():
        raise ValueError('比较数据或设计无效。')
    if design == 'paired' and len(a) != len(b):
        raise ValueError('配对样本必须一一对应。')
    mean_a, mean_b = float(a.mean()) if len(a) else None, float(b.mean()) if len(b) else None
    report = {'design':design, 'n_a':len(a), 'n_b':len(b), 'mean_a':mean_a, 'mean_b':mean_b,
              'difference':mean_b-mean_a if len(a) and len(b) else None,
              'ci95':None, 'p_value':None, 'effect':None,
              'effect_name':'paired_dz' if design == 'paired' else 'cliffs_delta', 'flags':[]}
    if not len(a) or not len(b):
        report['flags'].append('insufficient_groups')
        return report
    if design == 'independent':
        report['effect'] = float(np.sign(b[:,None]-a).mean())
    if min(len(a),len(b)) < 5:
        report['flags'].append('small_sample')
    if min(len(a),len(b)) < 2:
        return report
    if design == 'paired':
        difference = b-a
        spread = float(np.std(difference,ddof=1))
        if spread > 1e-12:
            report['effect'] = float(difference.mean()/spread)
        variance = spread**2
        test = stats.ttest_rel(b,a) if variance > 1e-24 else None
    else:
        variance = float(np.var(a,ddof=1)/len(a)+np.var(b,ddof=1)/len(b))
        test = stats.ttest_ind(b,a,equal_var=False) if variance > 1e-24 else None
    if test is None:
        report['flags'].append('constant_data')
        return report
    interval = test.confidence_interval(confidence_level=.95)
    if all(math.isfinite(v) for v in (interval.low,interval.high,test.pvalue)):
        report.update(ci95=[float(interval.low),float(interval.high)], p_value=float(test.pvalue))
    return report


def outcome_statistics(successes, attempts):
    if not isinstance(attempts,int) or not isinstance(successes,int) or attempts < 1 or not 0 <= successes <= attempts:
        raise ValueError('成功次数必须在 0 与尝试次数之间。')
    probability = successes/attempts
    z = float(stats.norm.ppf(.975))
    denominator = 1 + z*z/attempts
    center = (probability + z*z/(2*attempts)) / denominator
    half = z*math.sqrt(probability*(1-probability)/attempts + z*z/(4*attempts*attempts)) / denominator
    return {'success_rate':probability,'ci95':[max(0.,center-half),min(1.,center+half)],
            'interval_method':'Wilson score interval; assumes binomial trials. Repeated correlated attempts require a suitable clustered design.'}
