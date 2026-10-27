"""Court-coordinate analytics adapted from Badminton_Analytics_Project, cells 18–19.

MIT: Copyright (c) 2026 muhammadyasin79. See THIRD_PARTY.md.
Use calibrated metres rather than sample min/max normalization; never fill gaps.
"""
import csv
import json
import math
from pathlib import Path

import numpy as np

ZONE_NAMES = ['Front L', 'Front R', 'Mid L', 'Mid R', 'Back L', 'Back R']
COLORS = {'near': '#38ddca', 'far': '#ffb657'}


def assign_zone(x, y):
    # Adapted from upstream notebook cell 19: normalized local half-court.
    row = 0 if y < 1/3 else 1 if y < 2/3 else 2
    col = 0 if x < .5 else 1
    return row * 2 + col


def convex_hull(points):
    points = sorted(set(map(tuple, points)))
    if len(points) < 3:
        return points
    def cross(o, a, b):
        return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lower, upper = [], []
    for p in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1]+upper[:-1]


def observed_track(rows, player, width=6.1, length=13.4):
    source = sorted((r for r in rows if r['player'] == player), key=lambda r: int(r['frame']))
    valid = []
    for row in source:
        try:
            frame, t, x, y = int(row['frame']), float(row['time_s']), float(row['x_m']), float(row['y_m'])
            if int(row['observed']) == 1 and all(math.isfinite(v) for v in (t, x, y)) and 0 <= x <= width and 0 <= y <= length:
                valid.append((frame, t, x, y))
        except (ValueError, TypeError, KeyError):
            continue
    return len(source), np.asarray(valid, dtype=float).reshape(-1, 4)


def motion_pairs(track, speed_limit=8):
    dt = np.diff(track[:, 1])
    distance = np.linalg.norm(np.diff(track[:, 2:4], axis=0), axis=1)
    speed = np.divide(distance, dt, out=np.zeros_like(distance), where=dt > 0)
    accepted = (np.diff(track[:, 0]) == 1) & (dt > 0) & (dt <= .2) & (speed <= speed_limit)
    return dt, distance, speed, accepted


def summarize(rows, width=6.1, length=13.4):
    rows = list(rows)
    if not rows:
        raise ValueError('没有轨迹数据，无法生成统计。')
    players = {}
    for player in ('near', 'far'):
        source_count, a = observed_track(rows, player, width, length)
        if not len(a):
            continue
        missing = source_count - len(a)
        local_y = (a[:,3]-length/2)/(length/2) if player == 'near' else (length/2-a[:,3])/(length/2)
        zones = np.array([assign_zone(x/width, min(1,max(0,y))) for x,y in zip(a[:,2],local_y)])
        dt, distance, speed, accepted = motion_pairs(a)
        speed_plot = [[float(a[i+1,1]), float(speed[i]) if accepted[i] else None] for i in range(len(dt))]
        transitions = np.zeros((6,6), dtype=int)
        for i in np.flatnonzero(accepted):
            transitions[zones[i],zones[i+1]] += 1
        totals = transitions.sum(axis=1,keepdims=True)
        probs = np.divide(transitions,totals,out=np.zeros((6,6)),where=totals>0)
        hull = convex_hull(a[:,2:4])
        area = 0.0
        if len(hull) >= 3:
            p = np.array(hull)
            area = abs(float(np.dot(p[:,0],np.roll(p[:,1],-1))-np.dot(p[:,1],np.roll(p[:,0],-1))))/2
        mean = a[:,2:4].mean(axis=0)
        covariance = np.cov(a[:,2:4].T) if len(a)>1 else np.zeros((2,2))
        hist, _, _ = np.histogram2d(a[:,2],a[:,3],bins=(12,26),range=((0,width),(0,length)))
        players[player] = {
            'valid_observations':len(a), 'missing_observations':missing,
            'observation_rate':len(a)/source_count,
            'distance_m':float(distance[accepted].sum()),
            'valid_motion_pairs':int(accepted.sum()),
            'rejected_motion_pairs':int((~accepted).sum()),
            'mean_speed_mps':float(distance[accepted].sum()/dt[accepted].sum()) if accepted.any() else None,
            'max_speed_mps':float(speed[accepted].max()) if accepted.any() else None,
            'hull_area_m2':area, 'hull':hull,
            'mean_position':mean.tolist(), 'covariance':covariance.tolist(),
            'zones':np.bincount(zones,minlength=6).tolist(),
            'transition_counts':transitions.tolist(), 'transition_probabilities':probs.tolist(),
            'heatmap':hist.T.tolist(),
            'trajectory':[[int(v[0]),float(v[1]),float(v[2]),float(v[3])] for v in a[::max(1,len(a)//2000)]],
            'speed_series':speed_plot[::max(1,len(speed_plot)//2000)],
        }
    if not players:
        raise ValueError('没有可信的场内球员观测。请检查机位与四角标定。')
    times=sorted(set(float(r['time_s']) for r in rows))
    interval=float(np.median(np.diff(times))) if len(times)>1 else 0
    return {'court':{'width_m':width,'length_m':length},'players':players,
            'analysis_duration_s':times[-1]-times[0]+interval,
            'zone_names':ZONE_NAMES,
            'methodology':[
                'Only detector observations inside the calibrated court are used; optical-flow/held positions are excluded.',
                'Distance sums consecutive observations only. Gaps >0.2 s and speeds >8 m/s are excluded; the 8 m/s threshold is a quality filter, not a physiological finding.',
                'Zones are relative to each player half: Front is nearest the net. Left/right follow the camera view.',
                'Transition probabilities are empirical consecutive-frame frequencies including self-transitions; they depend on video frame rate.',
                'Hull is the convex envelope of observed positions, not instantaneous reachability or tactical control.',
                'Mean position and covariance describe the selected clip; they are not recovery or optimal-position estimates.',
                'Video perspective, ankle localization, occlusion and identity switches can bias all estimates. Manual review is required.',
            ]}


def generate_report(csv_path, output_dir, width=6.1, length=13.4):
    with open(csv_path, newline='', encoding='utf-8') as f:
        result = summarize(csv.DictReader(f), width, length)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True,exist_ok=True)
    (output_dir/'summary.json').write_text(json.dumps(result,ensure_ascii=False,allow_nan=False),encoding='utf-8')
    # Headless export; UI renders the same data interactively without a chart dependency.
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Ellipse
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':9,'text.color':'#d8e6ed',
                         'axes.labelcolor':'#8ea5b7','xtick.color':'#8ea5b7','ytick.color':'#8ea5b7',
                         'axes.edgecolor':'#284154','axes.facecolor':'#102332','figure.facecolor':'#081724'})
    fig, axs = plt.subplots(2,3,figsize=(15,9),layout='constrained')
    def court(ax):
        ax.set_xlim(0,width); ax.set_ylim(length,0); ax.set_aspect('equal')
        ax.plot([0,width,width,0,0],[0,0,length,length,0],color='#94adbb',lw=.8)
        ax.axhline(length/2,color='#94adbb',lw=.8)
        ax.axvline(width/2,color='#284154',lw=.6)
        ax.set_xlabel('Width (m)');ax.set_ylabel('Depth (m)')
    for ax in (axs[0,0],axs[0,1],axs[0,2]): court(ax)
    axs[0,0].set_title('Observed trajectories',color='#e9f3f7')
    axs[0,1].set_title('Observed convex hull',color='#e9f3f7')
    axs[0,2].set_title('Mean position / covariance',color='#e9f3f7')
    axs[1,0].set_title('Speed (filtered observed pairs)',color='#e9f3f7')
    axs[1,0].set_xlabel('Time (s)');axs[1,0].set_ylabel('m/s')
    axs[1,1].set_title('Half-court zone occupancy',color='#e9f3f7')
    for idx,(player,p) in enumerate(result['players'].items()):
        a=np.array(p['trajectory']);color=COLORS[player]
        axs[0,0].scatter(a[:,2],a[:,3],s=3,c=color,alpha=.45,label=player)
        hull=np.array(p['hull'])
        if len(hull)>=3: axs[0,1].fill(hull[:,0],hull[:,1],color=color,alpha=.25,label=player)
        mean=p['mean_position']; vals,vecs=np.linalg.eigh(p['covariance']); vals=np.maximum(vals,0)
        angle=np.degrees(np.arctan2(vecs[1,-1],vecs[0,-1]))
        axs[0,2].scatter(*mean,c=color,s=28,label=player)
        axs[0,2].add_patch(Ellipse(mean,2*np.sqrt(vals[-1]),2*np.sqrt(vals[0]),angle=angle,fill=False,edgecolor=color))
        series=p['speed_series']
        if series: axs[1,0].plot([v[0] for v in series],[v[1] if v[1] is not None else np.nan for v in series],color=color,lw=.8,label=player)
        counts=np.array(p['zones']);axs[1,1].bar(np.arange(6)+idx*.36,counts/counts.sum()*100,width=.34,color=color,label=player)
    axs[1,1].set_xticks(np.arange(6)+.18,ZONE_NAMES,rotation=30);axs[1,1].set_ylabel('Observed frames (%)')
    player=next(iter(result['players']))
    im=axs[1,2].imshow(result['players'][player]['transition_probabilities'],vmin=0,vmax=1,cmap='viridis')
    axs[1,2].set_title(f'{player} zone transitions (per frame)',color='#e9f3f7')
    axs[1,2].set_xticks(range(6),ZONE_NAMES,rotation=45);axs[1,2].set_yticks(range(6),ZONE_NAMES)
    fig.colorbar(im,ax=axs[1,2],shrink=.7)
    axs[0,0].legend();axs[1,0].legend();axs[1,1].legend()
    fig.suptitle('CourtIQ | Descriptive movement analysis',fontsize=17,color='white')
    fig.savefig(output_dir/'analytics.png',dpi=160)
    plt.close(fig)
    return result
