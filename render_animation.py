"""Render published detector coordinates as an H.264 court animation, without source footage."""
import hashlib
import json
import math
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE, FPS = (1280, 720), 30
COLORS = {'near': '#079f8d', 'far': '#2468eb'}


def observed_position(track, time, max_age):
    position = None
    for point in track:
        if point[1] > time:
            break
        position = point
    return position if position is not None and time - position[1] <= max_age else None


def observed_segments(track, time):
    previous = None
    for point in track:
        if point[1] > time:
            break
        if point[1] < time - 1.2:
            continue
        if previous and point[0] == previous[0] + 1:
            dt = point[1] - previous[1]
            if 0 < dt <= .2 and math.hypot(point[2] - previous[2], point[3] - previous[3]) / dt <= 8:
                yield previous, point
        previous = point


@lru_cache(maxsize=12)
def font(size):
    for name in ('/System/Library/Fonts/Helvetica.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if Path(name).is_file():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default(size=size)


def background(summary, is_example):
    image = Image.new('RGB', SIZE, '#f1f8fc')
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((28, 26, 1252, 694), 24, fill='white', outline='#dceaf3', width=2)
    draw.text((62, 52), 'CourtIQ', font=font(36), fill='#173b56')
    draw.text((64, 102), 'MOVEMENT IN MOTION', font=font(15), fill='#597c95')
    draw.rounded_rectangle((986, 58, 1215, 96), 18, fill='#e7f7ef')
    draw.text((1003, 69), 'PUBLIC SAMPLE' if is_example else 'PUBLISHED TRAINING', font=font(15), fill='#087d68')
    draw.text((64, 157), 'OBSERVED PLAYER TRAJECTORIES', font=font(20), fill='#173b56')
    width, length = summary['court']['width_m'], summary['court']['length_m']
    ox, oy, cw, ch = 78, 232, 826, 826 * width / length
    draw.rounded_rectangle((58, 207, 925, 640), 16, fill='#f0faf6')
    for x in range(1, int(width * 2)):
        px = oy + x / 2 / width * ch
        draw.line((ox, px, ox + cw, px), fill='#d8ece4')
    for y in range(1, int(length * 2)):
        py = ox + y / 2 / length * cw
        draw.line((py, oy, py, oy + ch), fill='#d8ece4')
    draw.rectangle((ox, oy, ox + cw, oy + ch), outline='#3ca58c', width=3)
    for y in (length / 2, length / 2 - 1.98, length / 2 + 1.98):
        px = ox + y / length * cw
        draw.line((px, oy, px, oy + ch), fill='#42a38f', width=2)
    for x in (.46, width - .46):
        py = oy + x / width * ch
        draw.line((ox, py, ox + cw, py), fill='#42a38f', width=2)
    for y1, y2 in ((0, length / 2 - 1.98), (length / 2 + 1.98, length)):
        draw.line((ox + y1 / length * cw, oy + ch / 2, ox + y2 / length * cw, oy + ch / 2), fill='#42a38f', width=2)
    draw.text((250, 620), 'FAR COURT', font=font(13), fill='#50796f')
    draw.text((676, 620), 'NEAR COURT', font=font(13), fill='#50796f')
    draw.text((966, 158), 'CLIP SUMMARY', font=font(16), fill='#597c95')
    for index, (name, player) in enumerate(summary['players'].items()):
        top = 215 + index * 210
        draw.rounded_rectangle((954, top, 1218, top + 187), 14, fill='#f5f9fd', outline='#e0ebf5')
        draw.ellipse((972, top + 20, 983, top + 31), fill=COLORS[name])
        draw.text((996, top + 17), 'NEAR PLAYER' if name == 'near' else 'FAR PLAYER', font=font(16), fill='#173b56')
        draw.text((974, top + 56), f'{player["distance_m"]:.2f} m', font=font(30), fill=COLORS[name])
        draw.text((974, top + 95), f'Observed distance / {summary["analysis_duration_s"]:.1f} s clip', font=font(13), fill='#638299')
        draw.text((974, top + 124), f'Detections: {player["observation_rate"] * 100:.1f}%', font=font(15), fill='#355b75')
    draw.text((64, 665), 'DETECTOR OBSERVATIONS  /  GAPS REMAIN MISSING', font=font(12), fill='#638299')
    return image


def animation_frame(base, summary, time, source_fps):
    image = base.copy()
    draw = ImageDraw.Draw(image)
    width, length = summary['court']['width_m'], summary['court']['length_m']
    xy = lambda x, y: (78 + y / length * 826, 232 + (width - x) / length * 826)
    for index, (name, player) in enumerate(summary['players'].items()):
        color = COLORS[name]
        for previous, point in observed_segments(player['trajectory'], time):
            draw.line((*xy(previous[2], previous[3]), *xy(point[2], point[3])), fill=color, width=3)
        point = observed_position(player['trajectory'], time, 1 / source_fps + .001)
        status = 'NO OBSERVATION'
        if point:
            x, y = xy(point[2], point[3])
            draw.ellipse((x - 15, y - 15, x + 15, y + 15), fill='white', outline=color, width=2)
            draw.ellipse((x - 9, y - 9, x + 9, y + 9), fill=color)
            status = f'x {point[2]:.2f}   y {point[3]:.2f} m'
        draw.text((974, 370 + index * 210), status, font=font(13), fill=color if point else '#8297a6')
    duration = summary['analysis_duration_s']
    draw.rounded_rectangle((64, 137, 1216, 141), 2, fill='#e6eff5')
    if time > 0:
        draw.rounded_rectangle((64, 137, 64 + 1152 * min(time / duration, 1), 141), 2, fill='#10a997')
    draw.text((1070, 665), f'{time:04.2f} / {duration:04.2f} s', font=font(14), fill='#355b75')
    return image


def render_animation(folder, target):
    session = json.loads((folder / 'session.json').read_text(encoding='utf-8'))
    summary = json.loads((folder / 'summary.json').read_text(encoding='utf-8'))
    duration, source_fps = summary['analysis_duration_s'], session['video']['fps']
    if not 0 < duration <= 600 or not math.isfinite(source_fps) or source_fps <= 0:
        raise ValueError('Animation requires a finite positive duration and source frame rate.')
    executable = shutil.which('ffmpeg')
    if not executable:
        raise ValueError('FFmpeg is required to render an animation locally.')
    target.mkdir(parents=True, exist_ok=True)
    output, temporary = target / 'trajectory.mp4', target / 'trajectory.tmp.mp4'
    base = background(summary, session.get('is_example', False))
    process = subprocess.Popen([executable, '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                                '-s', '1280x720', '-r', str(FPS), '-i', '-', '-an', '-c:v', 'libx264',
                                '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p',
                                '-movflags', '+faststart', str(temporary)], stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for frame in range(math.ceil(duration * FPS)):
            process.stdin.write(animation_frame(base, summary, frame / FPS, source_fps).tobytes())
        process.stdin.close()
        error = process.stderr.read().decode(errors='replace')
        if process.wait() != 0:
            raise ValueError(f'Animation encoding failed: {error[:500]}')
        if temporary.stat().st_size > 25 * 1024 * 1024:
            raise ValueError('Animation exceeds the static hosting 25 MiB file limit; select a shorter clip.')
        temporary.replace(output)
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stderr.close()
        if not process.stdin.closed:
            process.stdin.close()
        temporary.unlink(missing_ok=True)
    poster = target / 'animation-poster.jpg'
    tracks = [player['trajectory'] for player in summary['players'].values()]
    shared = set.intersection(*(set(point[0] for point in track) for track in tracks))
    poster_time = min(2.5, duration / 2)
    if shared:
        middle = sorted(shared)[len(shared) // 2]
        poster_time = next(point[1] for point in tracks[0] if point[0] == middle)
    animation_frame(base, summary, poster_time, source_fps).save(poster, quality=90)
    digest = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
    return {'file': output.name, 'poster': poster.name, 'sha256': digest(output), 'poster_sha256': digest(poster),
            'trajectory_sha256': digest(folder / 'players.csv'), 'run_id': session['run_id'],
            'width': SIZE[0], 'height': SIZE[1], 'fps': FPS, 'duration_s': math.ceil(duration * FPS) / FPS}
