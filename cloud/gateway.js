import { identity, capability, storageIdentity, HttpError } from './auth.js';
const CHUNK=8*1024*1024, MAX_UPLOAD=4*1024**3, BUSY=['queued','running'];
const RUN_FILES=['analysis.mp4','players.csv','analytics.png','summary.json','manifest.json','run.log','shuttle/input_ball.csv','completion.json'];
const MIME={mp4:'video/mp4',mov:'video/quicktime',m4v:'video/mp4',webm:'video/webm',avi:'video/x-msvideo',mkv:'video/x-matroska',jpg:'image/jpeg',png:'image/png',json:'application/json',csv:'text/csv; charset=utf-8',log:'text/plain; charset=utf-8'};
const uuid=()=>crypto.randomUUID().replaceAll('-','');
const now=()=>new Date().toISOString();
const ownerKey=owner=>encodeURIComponent(owner);
const prefix=(owner,sid)=>`sessions/${ownerKey(owner)}/${sid}/`;
const contentType=name=>MIME[name.split('.').pop()]||'application/octet-stream';
const ok=(body,status=200)=>Response.json(body,{status});
function requireValue(value,status,message){if(!value)throw new HttpError(status,message);}
function validId(id){requireValue(/^[a-f0-9]{32}$/.test(id||''),404,'找不到训练记录。');return id;}
async function bytes(request,max){
  requireValue(Number(request.headers.get('content-length')||0)<=max,413,'Request is too large.');
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;requireValue(size<=max,413,'Request is too large.');chunks.push(value);}}
  catch(error){await reader.cancel();throw error;}
  const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}return body;
}
async function json(request,max=64*1024){
  const body=await bytes(request,max);
  try{return JSON.parse(new TextDecoder().decode(body));}catch{throw new HttpError(400,'Invalid JSON.');}
}
async function digest(buffer){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function row(env,owner,id){
  validId(id);const record=await env.DB.prepare('SELECT * FROM sessions WHERE id=? AND owner=?').bind(id,owner).first();
  requireValue(record,404,'找不到训练记录。');return record;
}
async function session(env,owner,id){return JSON.parse((await row(env,owner,id)).metadata);}
async function mutate(env,owner,id,change){
  for(let i=0;i<6;i++){
    const record=await row(env,owner,id),s=JSON.parse(record.metadata);await change(s);s.updated_at=now();
    const changed=await env.DB.prepare('UPDATE sessions SET metadata=?,status=?,run_id=?,updated_at=?,version=version+1 WHERE id=? AND owner=? AND version=?')
      .bind(JSON.stringify(s),s.status,s.run_id,Date.now(),id,owner,record.version).run();
    if(changed.meta.changes)return s;
  }
  throw new HttpError(409,'训练记录已更新，请重试。');
}
function engine(env,name){requireValue(env.ANALYZER,503,'Analysis container binding is not configured.');return env.ANALYZER.get(env.ANALYZER.idFromName(name));}
async function compute(env,operation,payload){
  const response=await engine(env,'utility').fetch('http://container/operation',{method:'POST',headers:{'Content-Type':'application/json','X-CourtIQ-Secret':env.INTERNAL_SECRET},body:JSON.stringify({operation,...payload})});
  if(!response.ok){let body;try{body=await response.json();}catch{}throw new HttpError(response.status<500?response.status:503,typeof body?.detail==='string'?body.detail:'Analysis service is temporarily unavailable.');}
  return response.json();
}
async function transfer(env,owner,s,reads,writes=[],runId=null){
  requireValue(/^https:\/\//.test(env.PUBLIC_ORIGIN||'') || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.PUBLIC_ORIGIN||''),503,'Set the exact PUBLIC_ORIGIN.');
  return {origin:env.PUBLIC_ORIGIN,token:await capability(env,{owner,sid:s.id,run:runId,source:s.source_file,reads,writes})};
}
async function internalStorage(request,env,path){
  const c=await storageIdentity(request,env),name=decodeURIComponent(path.slice('/internal/storage/'.length));
  if(c.models){
    requireValue(['TrackNet_best.pt','yolov8s-pose.pt'].includes(name)&&c.reads?.includes(name)&&['GET','HEAD'].includes(request.method),403,'Invalid model capability.');
    return objectResponse(request,env,'models/'+name);
  }
  validId(c.sid);requireValue(typeof c.owner==='string',403,'Invalid capability owner.');
  const allowedRead=[c.source,'preview.jpg',...RUN_FILES];
  requireValue(allowedRead.includes(name),404,'File not found.');
  const writing=!['GET','HEAD'].includes(request.method);
  requireValue((writing?c.writes:c.reads)?.includes(name),403,'File capability does not allow this operation.');
  requireValue(writing || ['GET','HEAD'].includes(request.method),405,'Method not allowed.');
  if(c.run){
    validId(c.run);const current=await session(env,c.owner,c.sid);
    requireValue(current.run_id===c.run && (writing?BUSY.includes(current.status):true),409,'This analysis run is no longer current.');
  }
  const base=prefix(c.owner,c.sid),key=base+(name===c.source||name==='preview.jpg'?name:`runs/${c.run}/${name}`);
  if(writing){
    const params=new URL(request.url).searchParams,action=params.get('action'),uploadId=params.get('upload_id');
    if(request.method==='POST'&&action==='create'){
      const upload=await env.BUCKET.createMultipartUpload(key,{httpMetadata:{contentType:contentType(name)}});return ok({upload_id:upload.uploadId});
    }
    if(uploadId){
      const upload=env.BUCKET.resumeMultipartUpload(key,uploadId);
      if(request.method==='DELETE'){await upload.abort();return new Response(null,{status:204});}
      if(request.method==='POST'&&action==='complete'){
        const body=await json(request),parts=body.parts;
        requireValue(Array.isArray(parts)&&parts.length>0&&parts.length<=10000&&parts.every((p,i)=>p.partNumber===i+1&&typeof p.etag==='string'),400,'Invalid multipart manifest.');
        await upload.complete(parts);return new Response(null,{status:204});
      }
      if(request.method==='PUT'){
        const partNumber=Number(params.get('part'));requireValue(Number.isInteger(partNumber)&&partNumber>0&&partNumber<=10000,400,'Invalid part.');
        const part=await upload.uploadPart(partNumber,await bytes(request,CHUNK));return ok(part);
      }
    }
    requireValue(request.method==='PUT'&&!uploadId,405,'Invalid storage operation.');
    await env.BUCKET.put(key,await bytes(request,CHUNK),{httpMetadata:{contentType:contentType(name)}});return new Response(null,{status:204});
  }
  return objectResponse(request,env,key);
}
async function objectResponse(request,env,key){
  const head=await env.BUCKET.head(key);requireValue(head,404,'文件尚未生成。');
  const headers=new Headers({'Content-Type':head.httpMetadata?.contentType||contentType(key),'Accept-Ranges':'bytes','ETag':head.httpEtag,'Cache-Control':'private, no-store','Content-Disposition':'inline'});
  let range;
  const value=request.headers.get('range');
  if(value){
    const m=/^bytes=(\d*)-(\d*)$/.exec(value);
    if(!m || (!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${head.size}`}});
    const start=m[1]?Number(m[1]):Math.max(0,head.size-Number(m[2]));
    const end=m[1]?(m[2]?Math.min(Number(m[2]),head.size-1):head.size-1):head.size-1;
    if(start> end || start>=head.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${head.size}`}});
    range={offset:start,length:end-start+1};headers.set('Content-Range',`bytes ${start}-${end}/${head.size}`);
  }
  headers.set('Content-Length',String(range?.length??head.size));
  if(request.method==='HEAD')return new Response(null,{status:range?206:200,headers});
  const object=await env.BUCKET.get(key,range?{range}:{});requireValue(object,404,'文件尚未生成。');
  return new Response(object.body,{status:range?206:200,headers});
}
async function uploadRow(env,owner,id){validId(id);const u=await env.DB.prepare('SELECT * FROM uploads WHERE id=? AND owner=?').bind(id,owner).first();requireValue(u && u.expires_at>Date.now(),404,'Upload expired. Select the video again.');return u;}
async function uploadInfo(env,u){
  const {results}=await env.DB.prepare('SELECT number,etag,size,sha256 FROM upload_parts WHERE upload_id=? ORDER BY number').bind(u.id).all();
  return {id:u.id,session_id:u.session_id,chunk_size:CHUNK,parts:results,state:u.state,expires_at:u.expires_at};
}
function metadata(body){
  const filename=String(body.filename||'').split(/[\\/]/).pop(),ext=filename.split('.').pop().toLowerCase();
  requireValue(['mp4','mov','m4v','avi','mkv','webm'].includes(ext),400,'请选择 MP4、MOV、M4V、AVI、MKV 或 WebM 视频。');
  requireValue(Number.isSafeInteger(body.size)&&body.size>0&&body.size<=MAX_UPLOAD,413,'视频不能超过 4 GB，请先截取训练片段。');
  requireValue(/^[a-f0-9]{64}$/.test(body.fingerprint||''),400,'A file fingerprint is required.');
  const str=(k,n)=>String(body[k]||'').trim().slice(0,n);
  return {title:str('title',100)||filename.replace(/\.[^.]+$/,'').slice(0,100),venue:str('venue',100),near_name:str('near_name',60)||'近端球员',far_name:str('far_name',60)||'远端球员',original_filename:filename.slice(0,255),source_file:'source.'+ext};
}
async function startUpload(env,owner,body){
  const meta=metadata(body);
  const existing=await env.DB.prepare('SELECT * FROM uploads WHERE owner=? AND fingerprint=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1').bind(owner,body.fingerprint,Date.now()).first();
  if(existing && existing.size===body.size){
    await env.DB.prepare('UPDATE uploads SET metadata=? WHERE id=? AND owner=?').bind(JSON.stringify(meta),existing.id,owner).run();
    return ok(await uploadInfo(env,existing),201);
  }
  const id=uuid(),sid=uuid(),key=prefix(owner,sid)+meta.source_file;
  const multipart=await env.BUCKET.createMultipartUpload(key,{httpMetadata:{contentType:contentType(key)}});
  await env.DB.prepare('INSERT INTO uploads (id,owner,session_id,object_key,multipart_id,fingerprint,size,metadata,expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id,owner,sid,key,multipart.uploadId,body.fingerprint,body.size,JSON.stringify(meta),Date.now()+24*3600*1000).run();
  return ok(await uploadInfo(env,await uploadRow(env,owner,id)),201);
}
async function removeUpload(env,u,removeSource=false){
  if(u.state==='uploading'){try{await env.BUCKET.resumeMultipartUpload(u.object_key,u.multipart_id).abort();}catch{}}
  if(removeSource)await env.BUCKET.delete([u.object_key,prefix(u.owner,u.session_id)+'preview.jpg']);
  await env.DB.batch([env.DB.prepare('DELETE FROM upload_parts WHERE upload_id=?').bind(u.id),env.DB.prepare('DELETE FROM uploads WHERE id=?').bind(u.id)]);
}
async function finishUpload(env,owner,u){
  // Completion is retryable after a disconnected client or a cold-start failure.
  if(u.state==='uploading'){
    const {parts}=await uploadInfo(env,u),count=Math.ceil(u.size/CHUNK);
    requireValue(parts.length===count && parts.every((p,i)=>p.number===i+1&&p.size===Math.min(CHUNK,u.size-i*CHUNK)),400,'The upload is incomplete. Resume the missing parts.');
    const head=await env.BUCKET.head(u.object_key);
    if(!head)await env.BUCKET.resumeMultipartUpload(u.object_key,u.multipart_id).complete(parts.map(({number,etag})=>({partNumber:number,etag})));
    await env.DB.prepare("UPDATE uploads SET state='uploaded' WHERE id=? AND owner=?").bind(u.id,owner).run();
  }
  const stored=await env.DB.prepare('SELECT metadata FROM sessions WHERE id=? AND owner=?').bind(u.session_id,owner).first();
  if(stored)return ok(JSON.parse(stored.metadata));
  const meta=JSON.parse(u.metadata),s={...meta,id:u.session_id,created_at:now(),updated_at:now(),status:'draft',stage:'等待球场标定',calibration:null,error:null,run_id:null,is_example:!!meta.is_example,notes:''};
  const info=await compute(env,'probe',{session:s,transfer:await transfer(env,owner,s,[s.source_file],['preview.jpg'])});
  s.video=info.video;s.source_sha256=info.source_sha256;
  await env.DB.prepare('INSERT OR IGNORE INTO sessions (id,owner,status,metadata,updated_at) VALUES (?,?,?,?,?)').bind(s.id,owner,s.status,JSON.stringify(s),Date.now()).run();
  return ok(await session(env,owner,s.id));
}
async function uploads(request,env,owner,path){
  if(path==='/api/uploads'&&request.method==='POST')return startUpload(env,owner,await json(request));
  const m=/^\/api\/uploads\/([a-f0-9]{32})(?:\/(complete|parts\/(\d+)))?$/.exec(path);requireValue(m,404,'Not found.');
  const u=await uploadRow(env,owner,m[1]);
  if(!m[2]&&request.method==='GET')return ok(await uploadInfo(env,u));
  if(!m[2]&&request.method==='DELETE'){
    const exists=await env.DB.prepare('SELECT id FROM sessions WHERE id=? AND owner=?').bind(u.session_id,owner).first();
    await removeUpload(env,u,!exists);return new Response(null,{status:204});
  }
  if(m[2]==='complete'&&request.method==='POST')return finishUpload(env,owner,u);
  if(m[3]&&request.method==='PUT'){
    requireValue(u.state==='uploading',409,'Upload is already complete.');
    const number=Number(m[3]);requireValue(Number.isSafeInteger(number)&&number>=1&&number<=Math.ceil(u.size/CHUNK),400,'Invalid part number.');
    const size=Math.min(CHUNK,u.size-(number-1)*CHUNK);
    requireValue(Number(request.headers.get('content-length')||size)===size,400,'Unexpected part size.');
    const payload=await bytes(request,CHUNK);requireValue(payload.byteLength===size,400,'Unexpected part size.');
    const sha256=await digest(payload);
    const old=await env.DB.prepare('SELECT etag,sha256 FROM upload_parts WHERE upload_id=? AND number=?').bind(u.id,number).first();
    if(old?.sha256===sha256)return ok({number,etag:old.etag,sha256});
    const part=await env.BUCKET.resumeMultipartUpload(u.object_key,u.multipart_id).uploadPart(number,payload);
    await env.DB.prepare('INSERT INTO upload_parts (upload_id,number,etag,size,sha256) VALUES (?,?,?,?,?) ON CONFLICT(upload_id,number) DO UPDATE SET etag=excluded.etag,size=excluded.size,sha256=excluded.sha256').bind(u.id,number,part.etag,size,sha256).run();
    return ok({number,etag:part.etag,sha256});
  }
  throw new HttpError(405,'Method not allowed.');
}
async function runSession(request,env,owner,id){
  const current=await session(env,owner,id);
  requireValue(!BUSY.includes(current.status),409,'这段视频正在分析，请勿重复启动。');
  requireValue(current.calibration,400,'请先完成并保存球场四角标定。');
  const options=await compute(env,'options',{body:await json(request)});
  const maxSeconds=Number(env.MAX_ANALYSIS_SECONDS||300);
  requireValue((options.seconds||current.video.duration_s)<=maxSeconds,400,`Cloud analysis is limited to ${maxSeconds} seconds per run. Select a shorter segment.`);
  options.device='cpu';
  const needed=['yolov8s-pose.pt',...(options.shuttle?['TrackNet_best.pt']:[])];
  for(const name of needed)requireValue(await env.BUCKET.head('models/'+name),503,'运行依赖或模型尚未就绪，请查看系统状态。');
  const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE status IN ('queued','running')").first();
  requireValue(pending.n<20,429,'The analysis queue is full. Try again after a run completes.');
  const runId=uuid();
  const s=await mutate(env,owner,id,s=>{
    requireValue(!BUSY.includes(s.status),409,'这段视频正在分析，请勿重复启动。');
    requireValue(JSON.stringify(s.calibration)===JSON.stringify(current.calibration),409,'训练记录已更新，请重试。');
    Object.assign(s,{run_id:runId,status:'queued',stage:'等待分析',error:null,completed_at:null,options,task_started_at:Date.now(),task_restarts:0});
  });
  // If send fails, D1 retains queued state; cron retries it rather than losing the job.
  try{await env.JOBS.send({owner,id,run_id:runId});}catch{ return ok(s,202); }
  return ok(s,202);
}
async function cloudStatus(env,user){
  const modelNames=['TrackNet_best.pt','yolov8s-pose.pt'];
  const models=await Promise.all(modelNames.map(name=>env.BUCKET.head('models/'+name)));
  let runtime;try{const response=await engine(env,'utility').fetch('http://container/runtime',{headers:{'X-CourtIQ-Secret':env.INTERNAL_SECRET}});if(response.ok)runtime=await response.json();}catch{}
  const weights=Object.fromEntries(modelNames.map((name,i)=>[name,!!models[i]]));
  return {...(runtime||{packages:{container:false},ffmpeg:false,python:'—',sources:[{name:'badminton-pipeline-repro',url:'https://github.com/ychenfen/badminton-pipeline-repro'},{name:'Badminton_Analytics_Project',url:'https://github.com/muhammadyasin79/Badminton_Analytics_Project'}]}),weights,
    ready:!!runtime?.ffmpeg&&Object.values(runtime?.packages||{}).every(Boolean)&&Object.values(weights).every(Boolean),
    deployment:'cloud',user:{email:user.email},max_analysis_seconds:Number(env.MAX_ANALYSIS_SECONDS||300),
    example_available:!!await env.BUCKET.head('examples/upstream-short.mp4')};
}
async function route(request,env,user,url){
  const path=url.pathname,owner=user.id,method=request.method;
  if(path==='/api/status'&&method==='GET')return ok(await cloudStatus(env,user));
  if(path==='/api/me'&&method==='GET')return ok({email:user.email,deployment:'cloud'});
  if(path.startsWith('/api/uploads'))return uploads(request,env,owner,path);
  if(path==='/api/sessions'&&method==='GET'){
    const {results}=await env.DB.prepare('SELECT metadata FROM sessions WHERE owner=? ORDER BY updated_at DESC').bind(owner).all();return ok(results.map(r=>JSON.parse(r.metadata)));
  }
  if(path==='/api/example'&&method==='POST'){
    const source=await env.BUCKET.get('examples/upstream-short.mp4');requireValue(source,400,'上游真实样本尚未下载。');
    const body={filename:'upstream-short.mp4',size:source.size,fingerprint:uuid()+uuid(),title:'上游比赛样本 · 流程验证',venue:'上游公开样本'};
    const meta={...metadata(body),is_example:true},sid=uuid(),id=uuid(),key=prefix(owner,sid)+meta.source_file;
    await env.BUCKET.put(key,source.body,{httpMetadata:{contentType:'video/mp4'}});
    await env.DB.prepare('INSERT INTO uploads (id,owner,session_id,object_key,multipart_id,fingerprint,size,metadata,state,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id,owner,sid,key,'',body.fingerprint,body.size,JSON.stringify(meta),'uploaded',Date.now()+24*3600*1000).run();
    return finishUpload(env,owner,await uploadRow(env,owner,id));
  }
  if(path==='/api/research/compare'&&method==='POST'){
    const body=await json(request);requireValue(Array.isArray(body.selections)&&body.selections.length>=2&&body.selections.length<=100,400,'Select between 2 and 100 sessions.');
    const records=[];
    for(const selection of body.selections){const s=await session(env,owner,selection.session_id);requireValue(s.status==='completed',400,'请先完成所选视频的分析。');records.push({session:s,transfer:await transfer(env,owner,s,['players.csv','summary.json','manifest.json'],[],s.run_id)});}
    return ok(await compute(env,'compare',{body,records}));
  }
  const m=/^\/api\/sessions\/([a-f0-9]{32})(?:\/(.+))?$/.exec(path);
  if(m){
    const id=m[1],action=m[2],s=await session(env,owner,id);
    if(!action&&method==='GET')return ok(s);
    if(action==='run'&&method==='POST')return runSession(request,env,owner,id);
    if(action==='notes'&&method==='PUT'){
      const body=await json(request);requireValue(typeof body.notes==='string'&&body.notes.length<=20000,400,'Notes must be no more than 20,000 characters.');return ok(await mutate(env,owner,id,s=>{s.notes=body.notes;}));
    }
    if(action==='calibration'&&method==='PUT'){
      requireValue(!BUSY.includes(s.status),409,'请等待当前分析完成后修改标定。');
      const points=await compute(env,'calibration',{session:s,body:await json(request)});
      return ok(await mutate(env,owner,id,current=>{
        requireValue(!BUSY.includes(current.status),409,'请等待当前分析完成后修改标定。');
        if(JSON.stringify(points)!==JSON.stringify(current.calibration))Object.assign(current,{status:'draft',run_id:null,error:null,completed_at:null});
        Object.assign(current,{calibration:points,stage:'标定已保存，可以开始分析'});
      }));
    }
    if(action==='evaluation'&&method==='PUT'){
      const result=await compute(env,'evaluation',{session:s,body:await json(request)});
      await mutate(env,owner,id,s=>{s.evaluations={...s.evaluations,[result.player]:result};});return ok(result);
    }
    if(action==='statistics'&&method==='GET'){
      requireValue(s.status==='completed'&&s.run_id,400,'请先完成所选视频的分析。');
      return ok(await compute(env,'statistics',{session:s,player:url.searchParams.get('player')||'near',transfer:await transfer(env,owner,s,['players.csv','summary.json','manifest.json'],[],s.run_id)}));
    }
    if(action==='results'&&method==='GET'){
      requireValue(s.status==='completed'&&s.run_id,404,'尚无已完成的分析结果。');
      const object=await env.BUCKET.get(prefix(owner,id)+`runs/${s.run_id}/summary.json`);requireValue(object,404,'文件尚未生成。');return ok(await object.json());
    }
    if(action==='log'&&method==='GET'){
      const object=s.run_id&&await env.BUCKET.get(prefix(owner,id)+`runs/${s.run_id}/run.log`);
      return ok({text:object?(await object.text()).slice(-18000):'分析启动后，这里会显示真实运行日志。'});
    }
    if(action?.startsWith('files/')&&['GET','HEAD'].includes(method)){
      const name=decodeURIComponent(action.slice(6));let key;
      if([s.source_file,'preview.jpg'].includes(name))key=prefix(owner,id)+name;
      else if(RUN_FILES.includes(name)&&s.run_id&&(s.status==='completed'||name==='run.log'))key=prefix(owner,id)+`runs/${s.run_id}/${name}`;
      requireValue(key,404,'文件不存在。');return objectResponse(request,env,key);
    }
  }
  if(path.startsWith('/api/'))throw new HttpError(404,'Not found.');
  requireValue(env.ASSETS,404,'Not found.');return env.ASSETS.fetch(request);
}
function secure(response){
  const result=new Response(response.body,response);result.headers.set('Cache-Control','private, no-store');
  result.headers.set('X-Content-Type-Options','nosniff');result.headers.set('Referrer-Policy','same-origin');
  result.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  return result;
}
export default {
  async fetch(request,env){
    try{
      const url=new URL(request.url);
      if(url.pathname.startsWith('/internal/storage/'))return secure(await internalStorage(request,env,url.pathname));
      const user=await identity(request,env);
      if(!['GET','HEAD','OPTIONS'].includes(request.method)){
        const origin=request.headers.get('origin');requireValue(!origin||origin===url.origin,403,'Only same-origin requests are accepted.');
        requireValue(request.headers.get('sec-fetch-site')!=='cross-site',403,'Only same-origin requests are accepted.');
      }
      return secure(await route(request,env,user,url));
    }catch(error){
      if(!(error instanceof HttpError))console.error('CourtIQ request failed',error.name,error.message);
      return secure(ok({detail:error instanceof HttpError?error.message:'Service temporarily unavailable. Retry shortly.'},error.status||500));
    }
  },
  async queue(batch,env){for(const message of batch.messages){try{await pollJob(env,message.body);message.ack();}catch{message.retry({delaySeconds:30});}}},
  async scheduled(_event,env){await recover(env);}
};

async function releaseSlot(env,runId){await env.DB.prepare('DELETE FROM compute_slot WHERE run_id=?').bind(runId).run();}
async function retire(env,runId){
  // Reclaim the VM before admitting another run; stop is idempotent when already stopped.
  await engine(env,'run-'+runId).stop('SIGKILL');await releaseSlot(env,runId);
}
async function committed(env,owner,s){
  const base=prefix(owner,s.id)+`runs/${s.run_id}/`,object=await env.BUCKET.get(base+'completion.json');
  if(!object)return false;
  const marker=await object.json();
  if(marker.run_id!==s.run_id||marker.session_id!==s.id||marker.status!=='completed')return false;
  const names=['players.csv','summary.json','manifest.json','analysis.mp4','analytics.png'];
  const heads=await Promise.all(names.map(name=>env.BUCKET.head(base+name)));
  return heads.every((head,i)=>head&&head.size===marker.files?.[names[i]]?.size);
}
export async function pollJob(env,job){
  const {owner,id,run_id:runId}=job;
  const s=await session(env,owner,id);
  if(s.run_id!==runId||!BUSY.includes(s.status)){await retire(env,runId);return;}
  // The final marker is written only after all artifacts. It survives losing JOBS in RAM.
  if(await committed(env,owner,s)){
    await mutate(env,owner,id,current=>{if(current.run_id===runId&&BUSY.includes(current.status))Object.assign(current,{status:'completed',stage:'分析完成',error:null,completed_at:now()});});
    await retire(env,runId);return;
  }
  const limit=Number(env.MAX_JOB_SECONDS||7200)*1000;
  if(Date.now()-s.task_started_at>limit){
    await mutate(env,owner,id,current=>{if(current.run_id===runId&&BUSY.includes(current.status))Object.assign(current,{status:'failed',stage:'分析超时',error:'Analysis exceeded the cloud time limit. Use a shorter clip.'});});
    await retire(env,runId);return;
  }
  // One inference slot plus one utility container. Waiting jobs never allocate a VM.
  const lease=await env.DB.prepare('INSERT INTO compute_slot (id,run_id,expires_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,expires_at=excluded.expires_at WHERE compute_slot.expires_at<? OR compute_slot.run_id=excluded.run_id')
    .bind(runId,s.task_started_at+limit+300000,Date.now()).run();
  if(!lease.meta.changes){await env.JOBS.send(job,{delaySeconds:60});return;}
  const response=await engine(env,'run-'+runId).fetch('http://container/jobs/'+runId,{method:'POST',headers:{'Content-Type':'application/json','X-CourtIQ-Secret':env.INTERNAL_SECRET},body:JSON.stringify({session:s,allow_start:s.task_restarts<3,transfer:await transfer(env,owner,s,[s.source_file],RUN_FILES,runId),models:await capability(env,{models:true,reads:['TrackNet_best.pt','yolov8s-pose.pt'],writes:[]})})});
  requireValue(response.ok,503,'Container unavailable.');
  const state=await response.json();
  requireValue(['running','completed','failed'].includes(state.status),503,'Invalid container state.');
  if(state.started&&s.task_restarts>=3){
    await engine(env,'run-'+runId).destroy();
    await mutate(env,owner,id,current=>{if(current.run_id===runId&&BUSY.includes(current.status))Object.assign(current,{status:'failed',stage:'分析失败',error:'The container restarted repeatedly. Retry a shorter clip.'});});
    await releaseSlot(env,runId);return;
  }
  if(state.status==='completed')requireValue(await committed(env,owner,s),503,'Artifacts are not yet durable.');
  const result=await mutate(env,owner,id,current=>{
    if(current.run_id!==runId||!BUSY.includes(current.status))return;
    if(state.started)current.task_restarts=(current.task_restarts||0)+1;
    Object.assign(current,{status:state.status,stage:state.stage,error:state.error||null});
    if(state.status==='completed')current.completed_at=now();
  });
  if(state.log)await env.BUCKET.put(prefix(owner,id)+`runs/${runId}/run.log`,state.log,{httpMetadata:{contentType:contentType('run.log')}});
  if(BUSY.includes(result.status))await env.JOBS.send(job,{delaySeconds:30});else await retire(env,runId);
}
export async function recover(env){
  const {results}=await env.DB.prepare("SELECT id,owner,run_id FROM sessions WHERE status IN ('queued','running') AND updated_at<? LIMIT 100").bind(Date.now()-120000).all();
  for(const job of results)await env.JOBS.send(job);
  const expired=await env.DB.prepare('SELECT * FROM uploads WHERE expires_at<? LIMIT 100').bind(Date.now()).all();
  for(const u of expired.results){const exists=await env.DB.prepare('SELECT id FROM sessions WHERE id=?').bind(u.session_id).first();await removeUpload(env,u,!exists);}
}
