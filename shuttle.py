"""Camera-space shuttle predictions and explicitly reviewed events.

Independent implementation: no ground-plane projection, gap filling, score,
landing inference or unlicensed source code. Candidate events are not labels.
"""
import copy
import csv
import hashlib
import math
import json


def analyze_shuttle(rows, fps, frames, width, height):
    if not all(math.isfinite(float(v)) and v > 0 for v in (fps, frames, width, height)):
        raise ValueError('Invalid shuttle video geometry or timing.')
    trajectory, seen = [], set()
    if rows is not None:
        for row in rows:
            frame = float(row['Frame'])
            if not frame.is_integer() or not 0 <= frame < frames:
                continue
            frame = int(frame)
            if frame in seen: raise ValueError('Duplicate shuttle frame.')
            seen.add(frame)
            if float(row['Visibility']) != 1: continue
            x, y = float(row['X']), float(row['Y'])
            if not (math.isfinite(x) and math.isfinite(y) and 0 <= x < width and 0 <= y < height): continue
            trajectory.append([frame, frame/fps, x, y])
    trajectory.sort()
    points = {p[0]: p for p in trajectory}
    k, diagonal = max(1, round(fps*.08)), math.hypot(width, height)
    peaks = []
    for f, p in points.items():
        if not all(j in points for j in range(f-k, f+k+1)): continue
        a, b = points[f-k], points[f+k]
        before = [(p[i]-a[i])/(k/fps)/diagonal for i in (2, 3)]
        after = [(b[i]-p[i])/(k/fps)/diagonal for i in (2, 3)]
        u, v = math.hypot(*before), math.hypot(*after)
        change = math.hypot(*(after[i]-before[i] for i in (0, 1)))
        if min(u, v) < .02 or change < .15: continue
        cosine = sum(before[i]*after[i] for i in (0, 1))/(u*v)
        if cosine < math.cos(math.radians(45)): peaks.append((change, f))
    selected = []
    for score, f in sorted(peaks, reverse=True):
        if all(abs(f-j)/fps >= .18 for j in selected): selected.append(f)
    events = [{'frame': f, 'time_s': f/fps, 'kind': 'hit', 'player': None,
               'status': 'candidate', 'source': 'detector_candidate'} for f in sorted(selected)]
    coverage = len(trajectory)/frames
    status = 'not_run' if rows is None else ('no_detections' if not trajectory else ('sparse' if coverage < .2 else 'detected'))
    return {'schema_version': 1, 'status': status, 'valid_observations': len(trajectory),
            'observation_rate': coverage, 'trajectory': trajectory, 'events': events, 'rallies': [],
            'source': {'fps': fps, 'frames': frames, 'width': width, 'height': height, 'csv_sha256': None},
            'parameters': {'window_s': .08, 'min_interval_s': .18, 'turn_degrees': 45,
                           'velocity_change_diagonals_per_s': .15},
            'method': 'Unverified camera-space detector positions; no interpolation. Direction changes are hit candidates, not confirmed contacts. Rally statistics use manually confirmed boundaries and events only.'}


def apply_review(report, decisions):
    out = copy.deepcopy(report)
    out['rallies'] = []
    by_key = {(e['frame'], e['kind']): e for e in out['events']}
    seen = set()
    fps, frames = out['source']['fps'], out['source']['frames']
    for item in decisions:
        frame, kind, status, player = item['frame'], item['kind'], item['status'], item.get('player')
        if isinstance(frame, bool) or not isinstance(frame, int) or not 0 <= frame < frames:
            raise ValueError('事件帧必须位于分析片段内。')
        if kind not in ('hit', 'serve', 'start', 'end') or status not in ('confirmed', 'rejected') or player not in (None, 'near', 'far'):
            raise ValueError('无效的事件复核。')
        key = (frame, kind)
        if key in seen: raise ValueError('同一帧的事件不能重复。')
        seen.add(key)
        event = by_key.get(key, {'source': 'manual'})
        event.update(frame=frame, time_s=frame/fps, kind=kind, status=status, player=player)
        by_key[key] = event
    out['events'] = sorted(by_key.values(), key=lambda e: (e['frame'], e['kind']))
    shots = [e['frame'] for e in out['events'] if e['status']=='confirmed' and e['kind'] in ('hit','serve')]
    if len(shots)!=len(set(shots)):raise ValueError('同一帧的事件不能重复。')
    start = None
    for event in out['events']:
        if event['status'] != 'confirmed': continue
        if event['kind'] == 'start':
            if start is not None: raise ValueError('请先结束上一回合。')
            start = event['frame']
        elif event['kind'] == 'end':
            if start is None or event['frame'] <= start: raise ValueError('回合结束必须晚于开始。')
            hits = [e for e in out['events'] if e['status'] == 'confirmed' and e['kind'] in ('hit', 'serve') and start <= e['frame'] < event['frame']]
            intervals = [(b['frame']-a['frame'])/fps for a, b in zip(hits, hits[1:])]
            out['rallies'].append({'start_frame': start, 'end_frame': event['frame'],
                                   'duration_s': (event['frame']-start)/fps, 'confirmed_shots': len(hits),
                                   'mean_interval_s': sum(intervals)/len(intervals) if intervals else None,
                                   'source': 'manual_review'})
            start = None
    return out


def session_shuttle(run, session, summary):
    video = session['video']
    frames = max(1, round(summary['analysis_duration_s']*video['fps']))
    file = run/'shuttle/input_ball.csv'
    if file.is_file():
        with file.open(newline='', encoding='utf-8') as stream:
            report = analyze_shuttle(list(csv.DictReader(stream)), video['fps'], frames, video['width'], video['height'])
        report['source']['csv_sha256'] = hashlib.sha256(file.read_bytes()).hexdigest()
        inference = run/'shuttle/inference.json'
        if inference.is_file():
            data=json.loads(inference.read_text())
            report['source']['inference']={k:data[k] for k in ('origin','input_sha256','tracknet_sha256','threshold','eval_mode') if k in data}
    else:
        report = analyze_shuttle(None, video['fps'], frames, video['width'], video['height'])
    review = session.get('event_review', {})
    if review.get('run_id') == session.get('run_id'):
        report = apply_review(report, review['decisions'])
    return report
