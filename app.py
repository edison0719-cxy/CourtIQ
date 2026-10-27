"""CourtIQ local workstation. Bind to loopback; no cloud upload or account required."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
import hashlib
import os
from pathlib import Path
import re
import shutil
import threading
import uuid
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from pipeline import ROOT, UPSTREAM, execute, probe_video, runtime_status, validate_court

DATA=Path(os.environ.get('COURTIQ_DATA_DIR',ROOT/'data')).resolve()
SESSIONS=DATA/'sessions'
LOCK=threading.RLock()
EXECUTOR=ThreadPoolExecutor(max_workers=1)
BUSY={'queued','running'}
MAX_UPLOAD=4*1024**3


def now():return datetime.now(timezone.utc).isoformat()


def directory(sid):
    if not re.fullmatch(r'[a-f0-9]{32}',sid):raise HTTPException(404,'找不到训练记录。')
    path=SESSIONS/sid
    if not (path/'session.json').is_file():raise HTTPException(404,'找不到训练记录。')
    return path


def read_session(sid):
    with LOCK:return json.loads((directory(sid)/'session.json').read_text(encoding='utf-8'))


def save_session(session):
    with LOCK:
        path=SESSIONS/session['id'];path.mkdir(parents=True,exist_ok=True)
        temp=path/'session.json.tmp'
        temp.write_text(json.dumps(session,ensure_ascii=False,allow_nan=False),encoding='utf-8')
        temp.replace(path/'session.json')


def update_session(sid,**fields):
    with LOCK:
        session=read_session(sid);session.update(fields);session['updated_at']=now();save_session(session)
        return session


@asynccontextmanager
async def lifespan(app):
    SESSIONS.mkdir(parents=True,exist_ok=True)
    # A process restart cannot truthfully resume an interrupted inference.
    for f in SESSIONS.glob('*/session.json'):
        s=json.loads(f.read_text(encoding='utf-8'))
        if s['status'] in BUSY:update_session(s['id'],status='failed',stage='运行中断',error='服务已重启，请重新运行分析。')
    yield


app=FastAPI(title='CourtIQ 羽域',lifespan=lifespan)


@app.middleware('http')
async def local_origin(request:Request,call_next):
    origin=request.headers.get('origin')
    if request.method not in {'GET','HEAD','OPTIONS'} and origin:
        from urllib.parse import urlsplit
        if urlsplit(origin).netloc!=request.headers.get('host'):
            return JSONResponse({'detail':'仅接受本地工作台提交。'},status_code=403)
    return await call_next(request)


@app.get('/api/status')
def status():return runtime_status()


@app.get('/api/sessions')
def sessions():
    SESSIONS.mkdir(parents=True,exist_ok=True)
    with LOCK:
        return sorted([json.loads(p.read_text(encoding='utf-8')) for p in SESSIONS.glob('*/session.json')],
                      key=lambda x:x['created_at'],reverse=True)


def file_sha256(path):
    with path.open('rb') as file:return hashlib.file_digest(file,'sha256').hexdigest()


def finish_import(path,sid,filename,title,venue,near,far,is_example=False,source_sha256=None):
    metadata=probe_video(path,path.parent/'preview.jpg')
    s={'id':sid,'title':title.strip()[:100] or Path(filename).stem[:100],
       'venue':venue.strip()[:100],'near_name':near.strip()[:60] or '近端球员',
       'far_name':far.strip()[:60] or '远端球员','original_filename':filename,
       'source_file':path.name,'video':metadata,'calibration':None,
       'created_at':now(),'updated_at':now(),'status':'draft','stage':'等待球场标定',
       'error':None,'run_id':None,'is_example':is_example,'notes':'',
       'source_sha256':source_sha256 or file_sha256(path)}
    save_session(s)
    return s


@app.post('/api/sessions')
async def upload(video:UploadFile=File(...),title:str=Form(''),venue:str=Form(''),
                 near_name:str=Form(''),far_name:str=Form('')):
    filename=Path(video.filename or 'video.mp4').name
    ext=Path(filename).suffix.lower()
    if ext not in {'.mp4','.mov','.m4v','.avi','.mkv','.webm'}:
        raise HTTPException(400,'请选择 MP4、MOV、M4V、AVI、MKV 或 WebM 视频。')
    sid=uuid.uuid4().hex;folder=SESSIONS/sid;folder.mkdir(parents=True)
    path=folder/f'source{ext}';size=0;source_hash=hashlib.sha256()
    try:
        with path.open('wb') as f:
            while chunk:=await video.read(1024*1024):
                size+=len(chunk)
                if size>MAX_UPLOAD:raise HTTPException(413,'视频不能超过 4 GB，请先截取训练片段。')
                f.write(chunk);source_hash.update(chunk)
        return finish_import(path,sid,filename,title,venue,near_name,far_name,source_sha256=source_hash.hexdigest())
    except (ValueError,RuntimeError) as e:
        shutil.rmtree(folder,ignore_errors=True)
        raise HTTPException(400,str(e)) from e
    except Exception:
        shutil.rmtree(folder,ignore_errors=True)
        raise
    finally:await video.close()


@app.post('/api/example')
def example():
    source=UPSTREAM/'short.mp4'
    if not source.is_file() or source.stat().st_size<10000:raise HTTPException(400,'上游真实样本尚未下载。')
    sid=uuid.uuid4().hex;folder=SESSIONS/sid;folder.mkdir(parents=True)
    path=folder/'source.mp4';shutil.copyfile(source,path)
    s=finish_import(path,sid,'upstream-short.mp4','上游比赛样本 · 流程验证','上游公开样本','近端球员','远端球员',True)
    # Every clip still requires visual confirmation; no guessed court calibration.
    return s


@app.get('/api/sessions/{sid}')
def get_session(sid:str):return read_session(sid)


class Calibration(BaseModel):
    points:list[list[float]]


@app.put('/api/sessions/{sid}/calibration')
def calibration(sid:str,body:Calibration):
    with LOCK:
        s=read_session(sid)
        if s['status'] in BUSY:raise HTTPException(409,'请等待当前分析完成后修改标定。')
        try:points=validate_court(body.points,s['video']['width'],s['video']['height'])
        except ValueError as e:raise HTTPException(400,str(e)) from e
        fields={'calibration':points,'stage':'标定已保存，可以开始分析'}
        if points!=s['calibration']:
            fields.update(status='draft',run_id=None,error=None,completed_at=None)
        return update_session(sid,**fields)


class Options(BaseModel):
    shuttle:bool=True
    seconds:int=Field(default=30,ge=0,le=7200)
    threshold:float=Field(default=.15,ge=.05,le=.9)
    device:str=Field(default='auto',pattern=r'^(auto|cpu|mps|0)$')


def work(sid,run_id,options):
    def update(status,stage):update_session(sid,status=status,stage=stage)
    try:
        session=read_session(sid)
        execute(session,directory(sid)/'runs'/run_id,options,update)
        update_session(sid,status='completed',stage='分析完成',error=None,completed_at=now())
    except Exception as e:
        update_session(sid,status='failed',stage='分析失败',error=str(e))
        with (directory(sid)/'runs'/run_id/'run.log').open('a',encoding='utf-8') as f:
            import traceback
            f.write('\n'+traceback.format_exc())


@app.post('/api/sessions/{sid}/run')
def run(sid:str,options:Options):
    with LOCK:
        s=read_session(sid)
        if s['status'] in BUSY:raise HTTPException(409,'这段视频正在分析，请勿重复启动。')
        if not s['calibration']:raise HTTPException(400,'请先完成并保存球场四角标定。')
        state=runtime_status()
        needed=['yolov8s-pose.pt']+(['TrackNet_best.pt'] if options.shuttle else [])
        if not all(state['weights'][n] for n in needed) or not all(state['packages'].values()) or not state['ffmpeg']:
            raise HTTPException(400,'运行依赖或模型尚未就绪，请查看系统状态。')
        run_id=uuid.uuid4().hex;(directory(sid)/'runs'/run_id).mkdir(parents=True)
        s=update_session(sid,run_id=run_id,status='queued',stage='等待分析',error=None,completed_at=None,options=options.model_dump())
        EXECUTOR.submit(work,sid,run_id,options.model_dump())
        return s


class Notes(BaseModel):
    notes:str=Field(max_length=20000)


@app.put('/api/sessions/{sid}/notes')
def notes(sid:str,body:Notes):return update_session(sid,notes=body.notes)


@app.get('/api/sessions/{sid}/results')
def results(sid:str):
    s=read_session(sid)
    if s['status']!='completed' or not s['run_id']:raise HTTPException(404,'尚无已完成的分析结果。')
    return json.loads((directory(sid)/'runs'/s['run_id']/'summary.json').read_text(encoding='utf-8'))


@app.get('/api/sessions/{sid}/log')
def logs(sid:str):
    s=read_session(sid)
    path=directory(sid)/'runs'/str(s['run_id'])/'run.log'
    if not path.is_file():return {'text':'分析启动后，这里会显示真实运行日志。'}
    with path.open('rb') as f:
        f.seek(max(0,path.stat().st_size-18000));text=f.read().decode('utf-8',errors='replace')
    return {'text':text}


@app.get('/api/sessions/{sid}/files/{name:path}')
def files(sid:str,name:str):
    s=read_session(sid);folder=directory(sid)
    if name in {'preview.jpg',s['source_file']}:path=folder/name
    elif name in {'analysis.mp4','players.csv','analytics.png','summary.json','manifest.json','run.log','shuttle/input_ball.csv'} and s['run_id']:
        path=folder/'runs'/s['run_id']/name
    else:raise HTTPException(404,'文件不存在。')
    if not path.is_file():raise HTTPException(404,'文件尚未生成。')
    # No user-supplied filesystem paths are used; FileResponse supports video range requests.
    return FileResponse(path,filename=path.name,content_disposition_type='inline')



def completed_artifacts(sid):
    session=read_session(sid)
    if session['status']!='completed' or not session.get('run_id'):
        raise HTTPException(400,'请先完成所选视频的分析。')
    folder=directory(sid)/'runs'/session['run_id']
    if not all((folder/name).is_file() for name in ('players.csv','summary.json','manifest.json')):
        raise HTTPException(404,'分析文件不完整，请重新运行分析。')
    return session,folder


@app.get('/api/sessions/{sid}/statistics')
def session_research(sid:str,player:Literal['near','far']='near'):
    from services import session_research_data
    session,folder=completed_artifacts(sid)
    return session_research_data(session,folder,player)


class TrainingEvaluation(BaseModel):
    player:Literal['near','far']='near'
    task:str=Field(min_length=1,max_length=200)
    attempts:int=Field(ge=1,le=100000)
    successes:int=Field(ge=0,le=100000)
    start_s:float=Field(default=0,ge=0)
    end_s:float=Field(gt=0)
    review_time_s:float|None=Field(default=None,ge=0,le=86400)


@app.put('/api/sessions/{sid}/evaluation')
def training_evaluation(sid:str,body:TrainingEvaluation):
    from services import make_evaluation
    with LOCK:
        session=read_session(sid)
        evaluation=make_evaluation(session,body)
        evaluations=session.get('evaluations',{});evaluations[body.player]=evaluation
        update_session(sid,evaluations=evaluations)
        return evaluation


class StudySelection(BaseModel):
    session_id:str=Field(pattern=r'^[a-f0-9]{32}$')
    player:Literal['near','far']='near'
    group:Literal['A','B']
    pair:str=Field(default='',max_length=60)


class StudyComparison(BaseModel):
    metric:Literal['mean_speed_mps','distance_per_minute','observation_rate','hull_area_m2','success_rate','review_time_s']='mean_speed_mps'
    design:Literal['independent','paired']='paired'
    selections:list[StudySelection]=Field(min_length=2,max_length=100)


@app.post('/api/research/compare')
def research_comparison(body:StudyComparison):
    from services import compare_training_records
    return compare_training_records(body,completed_artifacts)


app.mount('/',StaticFiles(directory=ROOT/'static',html=True),name='static')

if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=int(os.environ.get('COURTIQ_PORT','8765')))
