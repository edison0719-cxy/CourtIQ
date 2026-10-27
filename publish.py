"""Export one completed run, with separately selected animation and reviewed match videos."""
import argparse
import copy
import json
import re
import shutil
import tempfile
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + '\n', encoding='utf-8')


def public_session(session, title, venue):
    if not title.strip():
        raise ValueError('An explicit public title is required.')
    if session.get('status') != 'completed':
        raise ValueError('Only completed sessions can be published.')
    return {'id': session['id'], 'run_id': session['run_id'], 'title': title.strip(),
            'venue': venue.strip(), 'near_name': '近端球员', 'far_name': '远端球员',
            'created_at': session['created_at'], 'status': 'completed', 'stage': '分析完成',
            'is_example': bool(session.get('is_example')), 'video': copy.deepcopy(session['video']),
            'options': {'seconds': session['options']['seconds']},
            'calibration': copy.deepcopy(session.get('calibration'))}


def trajectory_preview(summary):
    # Generated from detector coordinates. No source video frames are redistributed.
    paths = []
    for player, color in [('near', '#10a997'), ('far', '#2468eb')]:
        previous = None
        commands = []
        for frame, time, x, y in summary['players'].get(player, {}).get('trajectory', []):
            command = 'L' if previous is not None and frame == previous[0] + 1 and 0 < time - previous[1] <= .2 else 'M'
            commands.append(f'{command}{20+y*30:.2f},{20+(6.1-x)*30:.2f}')
            previous = (frame, time)
        paths.append(f'<path d="{" ".join(commands)}" stroke="{color}" stroke-width="2" fill="none"/>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 442 223">'
            '<rect width="442" height="223" rx="12" fill="#f0faf7"/>'
            '<g fill="none" stroke="#91baaf"><path d="M20 20h402v183H20zM221 20v183M161.6 20v183M280.4 20v183M20 33.8h402M20 189.2h402"/></g>'
            + ''.join(paths) + '</svg>')


def export_session(folder, destination, title, venue):
    from services import file_sha256, session_research_data
    session = json.loads((folder / 'session.json').read_text(encoding='utf-8'))
    public = public_session(session, title, venue)
    for key in ('id', 'run_id'):
        if not re.fullmatch(r'[a-f0-9]{32}', public[key]):
            raise ValueError(f'Invalid {key}.')
    run = folder / 'runs' / session['run_id']
    summary = json.loads((run / 'summary.json').read_text(encoding='utf-8'))
    public['players'] = list(summary['players'])
    if not public['players'] or any(player not in ('near', 'far') for player in public['players']):
        raise ValueError('No valid observed players to publish.')
    original_manifest = json.loads((run / 'manifest.json').read_text(encoding='utf-8'))
    # Retain only scientific parameters, not arbitrary paths or logging metadata.
    manifest = {key: original_manifest[key] for key in ('calibration', 'options', 'coordinate_system', 'sources', 'methodology')}
    manifest.update(session_id=public['id'], run_id=public['run_id'],
                    trajectory_sha256=file_sha256(run / 'players.csv'),
                    source_sha256=file_sha256(folder / session.get('source_file', 'source.mp4')),
                    upstream=json.loads((ROOT / 'UPSTREAM_VERSIONS.json').read_text()))
    target = destination / public['id']
    target.mkdir(parents=True, exist_ok=True)
    write_json(target / 'session.json', public)
    write_json(target / 'summary.json', summary)
    write_json(target / 'manifest.json', manifest)
    for player in summary['players']:
        report = session_research_data({**public, 'evaluations': {}}, run, player)
        report['evaluation'] = None  # Manual assessments require separate publication review.
        report['source'].update(manifest=manifest, source_sha256=manifest['source_sha256'])
        write_json(target / f'statistics-{player}.json', report)
    for name in ('players.csv', 'analytics.png'):
        shutil.copyfile(run / name, target / name)
    (target / 'preview.svg').write_text(trajectory_preview(summary), encoding='utf-8')
    # No videos, frames, coach notes, names, credentials, weights or logs are copied.
    return public


def export_match_videos(source, target, public):
    from services import file_sha256
    source_metadata = json.loads((source / 'session.json').read_text())
    original = source / source_metadata.get('source_file', 'source.mp4')
    source_hash = file_sha256(original)
    videos = {}
    for kind, file in [('original', original), ('analysis', source / 'runs' / public['run_id'] / 'analysis.mp4')]:
        if file.stat().st_size > 25 * 1024 * 1024:
            raise ValueError('Match video exceeds 25 MiB. Publish a shorter reviewed clip.')
        info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                                                  '-show_streams', '-show_format', '-of', 'json', str(file)]))
        stream = info['streams'][0]
        if stream['codec_name'] != 'h264' or stream['pix_fmt'] != 'yuv420p':
            raise ValueError('Publish browser-compatible H.264 / yuv420p match videos.')
        output, poster = target / f'{kind}.mp4', target / f'{kind}-poster.jpg'
        shutil.copyfile(file, output)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(output), '-frames:v', '1',
                        '-update', '1', str(poster)], check=True)
        videos[kind] = {'file': output.name, 'poster': poster.name, 'sha256': file_sha256(output),
                        'poster_sha256': file_sha256(poster), 'source_sha256': source_hash,
                        'run_id': public['run_id'], 'duration_s': float(info['format']['duration']),
                        'width': stream['width'], 'height': stream['height']}
    return videos


def publish_record(source, destination, title, venue, animation=False, videos=False):
    destination.mkdir(parents=True, exist_ok=True)
    catalog_file = destination / 'catalog.json'
    catalog = json.loads(catalog_file.read_text()) if catalog_file.exists() else {'schema_version': 1, 'sessions': []}
    # Prepare everything beside the destination. Encoding failure leaves the last publication intact.
    with tempfile.TemporaryDirectory(prefix='.courtiq-publish-', dir=destination.parent) as temp:
        staging = Path(temp)
        public = export_session(source, staging, title, venue)
        folder = staging / public['id']
        if animation:
            from render_animation import render_animation
            public['animation'] = render_animation(folder, folder)
        if videos:
            public['videos'] = export_match_videos(source, folder, public)
        write_json(folder / 'session.json', public)
        catalog['sessions'] = [public] + [s for s in catalog['sessions'] if s['id'] != public['id']]
        catalog['published_at'] = datetime.now(timezone.utc).isoformat()
        write_json(staging / 'catalog.json', catalog)
        target, backup = destination / public['id'], staging / 'previous'
        if target.exists():
            target.rename(backup)
        try:
            folder.rename(target)
            (staging / 'catalog.json').replace(catalog_file)
        except BaseException:
            if target.exists():
                shutil.rmtree(target)
            if backup.exists():
                backup.rename(target)
            raise
    return public


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('session_id', help='Completed local session ID')
    parser.add_argument('--title', required=True, help='Public title, reviewed for publication')
    parser.add_argument('--venue', default='', help='Optional public venue label')
    parser.add_argument('--confirm-public', action='store_true', help='Acknowledge that results will be public')
    parser.add_argument('--animation', action='store_true', help='Render a court animation from observed trajectories locally')
    parser.add_argument('--videos', action='store_true', help='Include reviewed original and completed analysis MP4s')
    args = parser.parse_args()
    if not args.confirm_public:
        parser.error('Results become public; review rights and metadata, then pass --confirm-public.')
    if not re.fullmatch(r'[a-f0-9]{32}', args.session_id):
        parser.error('Invalid session ID.')
    destination = ROOT / 'published'
    public = publish_record(ROOT / 'data' / 'sessions' / args.session_id, destination, args.title, args.venue, args.animation, args.videos)
    print(f'Published {public["id"]}, reviewed match videos: {bool(args.videos)}. Private notes and model files excluded.')


if __name__ == '__main__':
    main()
