"""Private CPU container: disposable files, durable inputs/results via scoped R2 gateway."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time
from urllib.parse import quote, urlsplit, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError

from fastapi import FastAPI, HTTPException, Request as WebRequest
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from app import Calibration, Options, TrainingEvaluation, StudyComparison
from pipeline import ROOT, UPSTREAM, execute, probe_video, runtime_status, validate_court
from services import file_sha256, make_evaluation, session_research_data, compare_training_records

FILES=('players.csv','summary.json','manifest.json','analysis.mp4','analytics.png','run.log','shuttle/input_ball.csv','completion.json')
MODELS=json.loads((ROOT/'UPSTREAM_VERSIONS.json').read_text())['weights_sha256']
DATA=Path(os.environ.get('COURTIQ_RUNNER_DATA','/tmp/courtiq-runner'))
LOCK=threading.RLock()
MODEL_LOCK=threading.Lock()
EXECUTOR=ThreadPoolExecutor(max_workers=1)
JOBS={}
ACTIVE_OPERATIONS={}
app=FastAPI(title='CourtIQ private analysis container')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        raise ValueError('Storage redirects are not allowed.')


class Storage:
    def __init__(self,config,allowed_origin=None):
        self.origin=config['origin'].rstrip('/')
        allowed_origin=allowed_origin or os.environ.get('PUBLIC_ORIGIN','')
        url=urlsplit(self.origin)
        if not allowed_origin or self.origin!=allowed_origin.rstrip('/') or url.path or url.query or url.fragment or url.username:
            raise ValueError('Untrusted storage origin.')
        if url.scheme!='https' and not (url.scheme=='http' and url.hostname in {'localhost','127.0.0.1'}):
            raise ValueError('Storage requires HTTPS.')
        self.token=config['token']
        self.opener=build_opener(NoRedirect())

    def url(self,name):
        if name not in (*FILES,'preview.jpg','TrackNet_best.pt','yolov8s-pose.pt') and not re.fullmatch(r'source\.(mp4|mov|m4v|avi|mkv|webm)',name):
            raise ValueError('Invalid storage object name.')
        return self.origin+'/internal/storage/'+quote(name,safe='/')

    def download(self,name,path):
        request=Request(self.url(name),headers={'Authorization':'Bearer '+self.token})
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        try:
            with self.opener.open(request,timeout=120) as response,path.open('wb') as target:
                shutil.copyfileobj(response,target,1024*1024)
        except HTTPError as exc:
            raise RuntimeError(f'Storage download failed ({exc.code}) for {name}. Check the internal Access bypass and configured origin.') from exc

    def send(self,name,method,data=None,query=None):
        url=self.url(name)+('?' + urlencode(query) if query else '')
        headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/octet-stream'}
        if data is not None:headers['Content-Length']=str(len(data))
        request=Request(url,data=data,method=method,headers=headers)
        with self.opener.open(request,timeout=300) as response:
            payload=response.read()
            return json.loads(payload) if payload else None

    def upload(self,name,path):
        path=Path(path);chunk_size=8*1024*1024
        if path.stat().st_size<=chunk_size:
            self.send(name,'PUT',path.read_bytes());return
        upload=self.send(name,'POST',query={'action':'create'})
        upload_id=upload['upload_id'];parts=[]
        try:
            with path.open('rb') as source:
                while chunk:=source.read(chunk_size):
                    part=self.send(name,'PUT',chunk,{'upload_id':upload_id,'part':len(parts)+1})
                    parts.append({'partNumber':part['partNumber'],'etag':part['etag']})
            self.send(name,'POST',json.dumps({'parts':parts}).encode(),{'upload_id':upload_id,'action':'complete'})
        except Exception:
            try:self.send(name,'DELETE',query={'upload_id':upload_id})
            except Exception:pass
            raise


def ensure_model(name,storage,directory=None,expected=None):
    directory=Path(directory or UPSTREAM/'weights');directory.mkdir(parents=True,exist_ok=True)
    expected=expected or MODELS
    if name not in expected:raise ValueError('Unknown model.')
    path=directory/name
    with MODEL_LOCK:
        if path.is_file() and file_sha256(path)==expected[name]:return
        temp=path.with_suffix('.download')
        try:
            storage.download(name,temp)
            if file_sha256(temp)!=expected[name]:raise ValueError('Model checksum mismatch: '+name)
            temp.replace(path)
        finally:temp.unlink(missing_ok=True)


@app.middleware('http')
async def authenticate(request:WebRequest,call_next):
    if request.url.path=='/health':return JSONResponse({'ok':True})
    expected=os.environ.get('INTERNAL_SECRET','')
    provided=request.headers.get('X-CourtIQ-Secret','')
    if len(expected)<32 or not hmac.compare_digest(expected,provided):
        return JSONResponse({'detail':'Unauthorized runner request.'},status_code=401)
    operation=object() if request.url.path=='/operation' else None
    if operation:
        with LOCK:ACTIVE_OPERATIONS[operation]=time.time()
    try:return await call_next(request)
    finally:
        if operation:
            with LOCK:ACTIVE_OPERATIONS.pop(operation,None)


@app.get('/activity')
def activity():
    limit=int(os.environ.get('MAX_JOB_SECONDS','7200'))
    with LOCK:return {'running':any(j['status']=='running' and time.time()-j['started_at']<limit for j in JOBS.values()) or any(time.time()-started<limit for started in ACTIVE_OPERATIONS.values())}


@app.get('/runtime')
def runtime():return runtime_status()


@contextmanager
def artifacts(session,transfer):
    with tempfile.TemporaryDirectory(prefix='courtiq-statistics-') as temp:
        folder=Path(temp);storage=Storage(transfer)
        for name in ('players.csv','summary.json','manifest.json'):storage.download(name,folder/name)
        yield folder


@app.post('/operation')
def operation(body:dict):
    try:
        op=body.get('operation');s=body.get('session',{})
        if op=='options':return Options.model_validate(body['body']).model_dump()
        if op=='calibration':return validate_court(Calibration.model_validate(body['body']).points,s['video']['width'],s['video']['height'])
        if op=='evaluation':return make_evaluation(s,TrainingEvaluation.model_validate(body['body']))
        if op=='probe':
            storage=Storage(body['transfer'])
            with tempfile.TemporaryDirectory(prefix='courtiq-probe-') as temp:
                source=Path(temp)/s['source_file'];storage.download(s['source_file'],source)
                preview=Path(temp)/'preview.jpg';video=probe_video(source,preview)
                storage.upload('preview.jpg',preview)
                return {'video':video,'source_sha256':file_sha256(source)}
        if op=='statistics':
            player=body.get('player','near')
            if player not in {'near','far'}:raise ValueError('Invalid player.')
            with artifacts(s,body['transfer']) as folder:return session_research_data(s,folder,player)
        if op=='compare':
            from contextlib import ExitStack
            selections=StudyComparison.model_validate(body['body'])
            with ExitStack() as stack:
                records={}
                for item in body['records']:
                    s=item['session'];folder=stack.enter_context(artifacts(s,item['transfer']))
                    records[s['id']]=(s,folder)
                return compare_training_records(selections,lambda sid:records[sid])
        raise HTTPException(404,'Unknown operation.')
    except ValidationError as exc:raise HTTPException(422,str(exc)) from exc
    except (ValueError,KeyError) as exc:raise HTTPException(400,str(exc)) from exc


def job_snapshot(run_id,started=False):
    with LOCK:
        state=JOBS[run_id].copy()
        log=state.pop('log_path',None)
        if log and Path(log).is_file():
            with Path(log).open('rb') as f:
                f.seek(max(0,Path(log).stat().st_size-18000));state['log']=f.read().decode('utf-8',errors='replace')
        return {**state,'started':started}


def run_job(run_id,body):
    folder=DATA/body['session']['id'];run=folder/'runs'/run_id
    log=run/'run.log';storage=None
    os.environ['COURTIQ_JOB_DEADLINE']=str(time.time()+int(os.environ.get('MAX_JOB_SECONDS','7200')))
    def update(status,stage):
        with LOCK:JOBS[run_id].update(status=status,stage=stage)
    try:
        run.mkdir(parents=True,exist_ok=True)
        with LOCK:JOBS[run_id]['log_path']=str(log)
        storage=Storage(body['transfer'])
        s=body['session'];options=Options.model_validate(s['options']).model_dump();options['device']='cpu'
        s['calibration']=validate_court(s['calibration'],s['video']['width'],s['video']['height'])
        storage.download(s['source_file'],folder/s['source_file'])
        if file_sha256(folder/s['source_file'])!=s['source_sha256']:raise ValueError('Source video checksum mismatch.')
        model_storage=Storage({**body['transfer'],'token':body['models']})
        for name in ['yolov8s-pose.pt']+(['TrackNet_best.pt'] if options['shuttle'] else []):ensure_model(name,model_storage)
        execute(s,run,options,update)
        manifest=json.loads((run/'manifest.json').read_text())
        manifest.update(run_id=run_id,source_sha256=s['source_sha256'],deployment='cloudflare-containers',model_sha256={k:MODELS[k] for k in MODELS if options['shuttle'] or k!='TrackNet_best.pt'})
        (run/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,allow_nan=False))
        update('running','正在保存分析结果')
        published={}
        for name in FILES:
            if (run/name).is_file():
                storage.upload(name,run/name)
                published[name]={'size':(run/name).stat().st_size,'sha256':file_sha256(run/name)}
        marker={'status':'completed','session_id':s['id'],'run_id':run_id,'source_sha256':s['source_sha256'],'files':published}
        (run/'completion.json').write_text(json.dumps(marker,allow_nan=False))
        storage.upload('completion.json',run/'completion.json')
        with LOCK:JOBS[run_id].update(status='completed',stage='分析完成',error=None)
    except Exception as exc:
        import traceback
        with LOCK:JOBS[run_id].update(status='failed',stage='分析失败',error=str(exc))
        try:
            with log.open('a') as f:f.write('\n'+traceback.format_exc())
            if storage:storage.upload('run.log',log)
        except Exception:pass
    finally:
        with LOCK:
            if log.is_file():JOBS[run_id]['log']=job_snapshot(run_id).get('log','')
            JOBS[run_id].pop('log_path',None)
        shutil.rmtree(folder,ignore_errors=True)


@app.post('/jobs/{run_id}')
def job(run_id:str,body:dict):
    if not re.fullmatch(r'[a-f0-9]{32}',run_id):raise HTTPException(400,'Invalid run ID.')
    with LOCK:
        if run_id in JOBS:return job_snapshot(run_id)
        s=body.get('session',{})
        if not re.fullmatch(r'[a-f0-9]{32}',s.get('id','')) or s.get('run_id')!=run_id:raise HTTPException(400,'Invalid session/run identity.')
        if JOBS:raise HTTPException(409,'One analysis run per container.')
        if not body.get('allow_start',True):
            return {'status':'failed','stage':'分析失败','error':'The container restarted repeatedly. Retry a shorter clip.','started':False}
        # Validate before starting the thread, so invalid capabilities cannot strand a task.
        Storage(body['transfer'])
        JOBS[run_id]={'status':'running','stage':'准备视频','error':None,'started_at':time.time()}
        EXECUTOR.submit(run_job,run_id,body)
        return job_snapshot(run_id,started=True)
