"""Execute upstream inference in isolated subprocesses and publish real artifacts."""
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
UPSTREAM = ROOT/'vendor'/'badminton-pipeline-repro'


def weight_ready(path):
    path=Path(path)
    return path.is_file() and path.stat().st_size > 100000


def runtime_status():
    packages={m:importlib.util.find_spec(m) is not None for m in
              ('torch','torchvision','cv2','ultralytics','numpy','scipy','matplotlib','parse','pycocotools','lap')}
    weights={name:weight_ready(UPSTREAM/'weights'/name) for name in ('TrackNet_best.pt','yolov8s-pose.pt')}
    return {'packages':packages,'weights':weights,'ffmpeg':bool(shutil.which('ffmpeg')),
            'ready':all(packages.values()) and all(weights.values()) and bool(shutil.which('ffmpeg')),
            'python':sys.version.split()[0],
            'sources':[{'name':'badminton-pipeline-repro','url':'https://github.com/ychenfen/badminton-pipeline-repro'},
                       {'name':'Badminton_Analytics_Project','url':'https://github.com/muhammadyasin79/Badminton_Analytics_Project'}]}


def validate_court(points, width, height):
    if len(points)!=4 or any(len(p)!=2 for p in points):
        raise ValueError('请按左上、右上、右下、左下顺序标记四角。')
    p=[[float(x),float(y)] for x,y in points]
    if any(not math.isfinite(v) for xy in p for v in xy):
        raise ValueError('标定点必须是有效数字。')
    if any(x<0 or y<0 or x>width or y>height for x,y in p):
        raise ValueError('标定点超出视频画面。')
    cross=[]
    for i in range(4):
        a,b,c=p[i],p[(i+1)%4],p[(i+2)%4]
        cross.append((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]))
    area=sum(p[i][0]*p[(i+1)%4][1]-p[(i+1)%4][0]*p[i][1] for i in range(4))/2
    if min(cross)<=0 or area<width*height*.005 or p[0][1]+p[1][1]>=p[2][1]+p[3][1]:
        raise ValueError('四角需构成顺时针凸四边形，且远端在上。请重新标定。')
    return p


def probe_video(path, preview_path):
    import cv2
    cap=cv2.VideoCapture(str(path))
    try:
        fps=float(cap.get(cv2.CAP_PROP_FPS));frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        ok,frame=cap.read()
        if not ok or not math.isfinite(fps) or fps<=0 or frames<=0:
            raise ValueError('无法读取有效视频，请使用固定机位的 MP4/MOV 文件。')
        h,w=frame.shape[:2]
        if w<64 or h<64 or not cv2.imwrite(str(preview_path),frame):
            raise ValueError('视频尺寸过小或预览生成失败。')
        return {'width':w,'height':h,'fps':fps,'frames':frames,'duration_s':frames/fps}
    finally:
        cap.release()


def run_command(args, log_path, env=None):
    with open(log_path,'a',encoding='utf-8') as log:
        log.write('\n$ '+' '.join(str(v) for v in args)+'\n');log.flush()
        result=subprocess.run([str(v) for v in args],stdout=log,stderr=subprocess.STDOUT,
                              cwd=ROOT,env=env,timeout=24*60*60)
    if result.returncode:
        raise RuntimeError(f'分析步骤退出（代码 {result.returncode}），请查看运行日志。')


def execute(session, run_dir, options, update):
    run_dir=Path(run_dir);run_dir.mkdir(parents=True,exist_ok=True)
    log=run_dir/'run.log'
    env=os.environ.copy()
    env.update({'PYTHONUNBUFFERED':'1','TRACKNET_VIS_THRESH':str(options['threshold']),
                'YOLO_CONFIG_DIR':str(ROOT/'data'/'.yolo'),'MPLCONFIGDIR':str(ROOT/'data'/'.matplotlib'),
                'OMP_NUM_THREADS':'4','OPENBLAS_NUM_THREADS':'4'})
    python=sys.executable
    source=run_dir.parent.parent/session['source_file']
    points=session['calibration']
    input_video=run_dir/'input.mp4'
    update('running','准备视频')
    args=['ffmpeg','-hide_banner','-loglevel','error','-y','-i',source]
    if options['seconds']>0: args+=['-t',str(options['seconds'])]
    # Preserve frame geometry and timestamps; enforce CFR for frame-based inference.
    args+=['-map','0:v:0','-map','0:a?','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2',
           '-r',str(session['video']['fps']),'-c:v','libx264','-preset','veryfast','-crf','20',
           '-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',input_video]
    run_command(args,log,env)
    overlay_input=input_video
    ball_csv=None
    if options['shuttle']:
        update('running','羽毛球轨迹识别')
        track_dir=run_dir/'shuttle';track_dir.mkdir()
        run_command([python,UPSTREAM/'scripts/tracknet_runtime/predict.py',
                     '--video_file',input_video,'--tracknet_file',UPSTREAM/'weights/TrackNet_best.pt',
                     '--save_dir',track_dir,'--output_video','--device','cpu','--large_video',
                     '--batch_size','2','--eval_mode','nonoverlap'],log,env)
        overlay_input=track_dir/'input.mp4';ball_csv=track_dir/'input_ball.csv'
        if not overlay_input.is_file() or not ball_csv.is_file():
            raise RuntimeError('TrackNet 未生成预期视频与轨迹，详情见日志。')
    update('running','球员识别与球场轨迹')
    device=options['device']
    if device=='auto':
        import torch
        device='mps' if torch.backends.mps.is_available() else ('0' if torch.cuda.is_available() else 'cpu')
    raw_overlay=run_dir/'overlay_raw.mp4'
    track_csv=run_dir/'players.csv'
    args=[python,UPSTREAM/'scripts/overlay/overlay_player_analytics.py',
          '--video_path',overlay_input,'--output_path',raw_overlay,
          '--track_csv',track_csv,'--yolo_model',UPSTREAM/'weights/yolov8s-pose.pt',
          '--court_points',','.join(str(v) for xy in points for v in xy),
          '--no_select_court_points','--no_draw_ball_on_minimap','--hide_stats',
          '--far_half_expand','1.0','--device',device,'--imgsz','640']
    # Shuttle is rendered only in camera space. A flying shuttle cannot be mapped
    # onto the ground plane using a single homography.
    if ball_csv: args+=['--ball_csv',ball_csv]
    run_command(args,log,env)
    update('running','空间统计与图表')
    from analysis import generate_report
    report=generate_report(track_csv,run_dir)
    update('running','导出浏览器兼容视频')
    final_video=run_dir/'analysis.mp4'
    run_command(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',raw_overlay,'-i',input_video,
                 '-map','0:v:0','-map','1:a?','-c:v','libx264','-preset','veryfast','-crf','20',
                 '-pix_fmt','yuv420p','-c:a','aac','-shortest','-movflags','+faststart',final_video],log,env)
    metadata={'session_id':session['id'],'calibration':points,'options':options,
              'coordinate_system':'full court: 6.1 m × 13.4 m; origin at far-left baseline corner',
              'sources':runtime_status()['sources'],'methodology':report['methodology']}
    (run_dir/'manifest.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
    raw_overlay.unlink(missing_ok=True)
    return report
