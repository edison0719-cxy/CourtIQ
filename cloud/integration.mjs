/* Real end-to-end validation: Workers + D1 + R2 -> local native Python -> actual model. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,readFile,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';
import {Miniflare,createFetchMock} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
const {upload}=createRequire(import.meta.url)('../static/upload.js');
const port=()=>new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const [workerPort,runnerPort]=await Promise.all([port(),port()]);
const origin=`http://127.0.0.1:${workerPort}`,runnerOrigin=`http://127.0.0.1:${runnerPort}`;
const issuer='https://courtiq-test.cloudflareaccess.com',secret='integration-only-key-at-least-32-bytes';
const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='integration';jwk.alg='RS256';jwk.use='sig';
const jwt=await new SignJWT({email:'integration@example.org'}).setSubject('integration-user').setIssuer(issuer).setAudience('integration').setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuedAt().setExpirationTime('1h').sign(privateKey);
const scratch=await mkdtemp(join(tmpdir(),'courtiq-native-'));let mf,child,runnerLog='';
async function startRunner(){
  child=spawn(process.env.COURTIQ_TEST_PYTHON||resolve('.venv/bin/python'),['-m','uvicorn','cloud_runner:app','--host','127.0.0.1','--port',String(runnerPort),'--no-access-log'],{env:{...process.env,INTERNAL_SECRET:secret,PUBLIC_ORIGIN:origin,COURTIQ_RUNNER_DATA:join(scratch,'runner'),MAX_JOB_SECONDS:'300',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'}});
  child.stderr.on('data',b=>{runnerLog+=b.toString();});child.stdout.on('data',b=>{runnerLog+=b.toString();});
  for(let i=0;i<100;i++){try{if((await fetch(runnerOrigin+'/health')).ok)return;}catch{}await delay(100);}
  throw new Error('Python runner failed to start: '+runnerLog);
}
async function processRun(executable,args,extra={}){
  return new Promise((resolve,reject)=>{
    const c=spawn(executable,args,{env:{...process.env,NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost',...extra}});let output='';
    c.stdout.on('data',b=>output+=b);c.stderr.on('data',b=>output+=b);c.on('error',reject);c.on('exit',code=>code===0?resolve(output):reject(new Error(output)));
  });
}
async function seedModel(bucket,name){
  const source=await open('vendor/badminton-pipeline-repro/weights/'+name,'r');
  try{
    const size=(await source.stat()).size,upload=await bucket.createMultipartUpload('models/'+name),parts=[];
    for(let offset=0;offset<size;offset+=8*1024*1024){const bytes=Buffer.alloc(Math.min(8*1024*1024,size-offset));await source.read(bytes,0,bytes.length,offset);parts.push(await upload.uploadPart(parts.length+1,bytes));}
    await upload.complete(parts);
  }finally{await source.close();}
}
async function stopRunner(){if(child){const c=child;child=null;c.kill('SIGTERM');await new Promise(r=>c.once('exit',r));}}
async function request(path,init={}){
  const r=await mf.dispatchFetch(origin+path,{...init,headers:{'Cf-Access-Jwt-Assertion':jwt,...init.headers}});
  if(r.status>=400)throw new Error(`${path}: ${r.status}: ${await r.text()}`);return r;
}
const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
try{
  const bundle=join(scratch,'worker.mjs');await build({entryPoints:['cloud/test-worker.js'],bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],outfile:bundle});
  const mock=createFetchMock();mock.get(issuer).intercept({path:'/cdn-cgi/access/certs'}).reply(200,{keys:[jwk]}).persist();mock.enableNetConnect();
  mf=new Miniflare({modules:true,modulesRoot:scratch,scriptPath:bundle,compatibilityDate:'2026-08-01',host:'127.0.0.1',port:workerPort,
    bindings:{ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'integration',INTERNAL_SECRET:secret,PUBLIC_ORIGIN:origin,TEST_RUNNER_ORIGIN:runnerOrigin,MAX_JOB_SECONDS:'300'},
    d1Databases:['DB'],r2Buckets:['BUCKET'],queueProducers:{JOBS:'test-native'},durableObjects:{ANALYZER:'LocalContainer'},fetchMock:mock,
    serviceBindings:{ASSETS:async request=>{const p=new URL(request.url).pathname;const name=p==='/'?'index.html':p.slice(1);if(!/^[a-zA-Z0-9_.-]+$/.test(name))return new Response(null,{status:404});try{return new Response(await readFile(join('static',name)),{headers:{'Content-Type':name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'}});}catch{return new Response(null,{status:404});}}},
  });
  const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');await db.exec((await readFile('cloud/migrations/0001.sql','utf8')).replace(/\n/g,' '));
  await startRunner();
  assert.equal((await fetch(runnerOrigin+'/runtime')).status,401);
  const largeVideo=join(scratch,'large-video.mp4');
  await processRun('ffmpeg',['-hide_banner','-loglevel','error','-stream_loop','4','-i','vendor/badminton-pipeline-repro/short.mp4','-c','copy',largeVideo]);
  const file=new File([await readFile(largeVideo)],'training.mp4',{lastModified:1});
  assert.ok(file.size>8*1024*1024,'Exercise at least two genuine R2 upload parts.');
  let first=true;
  await assert.rejects(()=>upload(file,{title:'Native integration',venue:'Test court'},{transport:async(path,options)=>{
    const r=await request(path,options);if(first&&path.includes('/parts/')){first=false;throw new DOMException('test interruption','AbortError');}return r;
  }}),{name:'AbortError'});
  const s=await upload(file,{title:'Native integration',venue:'Test court'},{transport:request});
  assert.ok(s.video.frames>100);assert.match(s.source_sha256,/^[a-f0-9]{64}$/);
  const preview=await request(`/api/sessions/${s.id}/files/preview.jpg`);assert.equal(preview.headers.get('Content-Type'),'image/jpeg');
  console.log('PASS: interrupted upload resumes through actual R2 multipart, native probe and preview');
  // Documented reference calibration for this upstream test sample only.
  const points=[[352,342],[628,343],[944,527],[52,532]];
  await request(`/api/sessions/${s.id}/calibration`,json('PUT',{points}));
  await seedModel(bucket,'yolov8s-pose.pt');
  if(process.env.COURTIQ_TEST_SHUTTLE)await seedModel(bucket,'TrackNet_best.pt');
  const run=await (await request(`/api/sessions/${s.id}/run`,json('POST',{seconds:1,device:'cpu',threshold:.15,shuttle:!!process.env.COURTIQ_TEST_SHUTTLE}))).json();
  const job={owner:'integration-user',id:s.id,run_id:run.run_id};
  await request('/__test/poll',json('POST',job));
  await request('/__test/poll',json('POST',job));
  let completed=false;
  for(let i=0;i<180;i++){
    if(await bucket.head(`sessions/integration-user/${s.id}/runs/${run.run_id}/completion.json`)){completed=true;break;}
    await delay(1000);
  }
  if(!completed){await request('/__test/poll',json('POST',job));const failed=await (await request(`/api/sessions/${s.id}`)).json();throw new Error('Inference did not complete: '+JSON.stringify(failed)+'\n'+runnerLog);}
  // Lose every in-memory job state before D1 observes completion.
  await stopRunner();await startRunner();
  await request('/__test/poll',json('POST',job));
  const ready=await (await request(`/api/sessions/${s.id}`)).json();assert.equal(ready.status,'completed');assert.equal(ready.task_restarts,1);
  const results=await (await request(`/api/sessions/${s.id}/results`)).json();assert.ok(results.analysis_duration_s>0);
  const stats=await (await request(`/api/sessions/${s.id}/statistics?player=near`)).json();assert.equal(stats.source.run_id,run.run_id);
  const range=await request(`/api/sessions/${s.id}/files/analysis.mp4`,{headers:{Range:'bytes=0-31'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,32);
  await request(`/api/sessions/${s.id}/evaluation`,json('PUT',{player:'near',task:'Target drill',attempts:10,successes:8,start_s:0,end_s:1}));
  if(process.env.COURTIQ_TEST_SHUTTLE){const ball=await bucket.head(`sessions/integration-user/${s.id}/runs/${run.run_id}/shuttle/input_ball.csv`);assert.ok(ball&&ball.size>50);console.log('PASS: real CPU TrackNet shuttle inference and durable ball trajectory CSV');}
  console.log('PASS: real CPU YOLO analysis, R2 publication, duplicate polling, lost-process recovery, research, manual evaluation and video ranges');
  // Exercise the private internal multipart path with an output larger than one chunk.
  const cap=await new SignJWT({owner:'integration-user',sid:s.id,run:run.run_id,source:s.source_file,reads:['analysis.mp4'],writes:['analysis.mp4']}).setProtectedHeader({alg:'HS256'}).setIssuer('courtiq').setAudience('storage').setExpirationTime('5m').sign(new TextEncoder().encode(secret));
  const stale=await mf.dispatchFetch(origin+'/internal/storage/analysis.mp4',{method:'PUT',headers:{Authorization:'Bearer '+cap},body:'must not overwrite completed results'});assert.equal(stale.status,409);
  console.log('PASS: completed run write capabilities are fenced');
  const transportId='4'.repeat(32),transportRun='5'.repeat(32);
  const transportSession={id:transportId,run_id:transportRun,status:'running'};
  await db.prepare('INSERT INTO sessions (id,owner,status,run_id,metadata,updated_at) VALUES (?,?,?,?,?,?)').bind(transportId,'integration-user','running',transportRun,JSON.stringify(transportSession),Date.now()).run();
  const writeCap=await new SignJWT({owner:'integration-user',sid:transportId,run:transportRun,source:'source.mp4',reads:['analysis.mp4'],writes:['analysis.mp4']}).setProtectedHeader({alg:'HS256'}).setIssuer('courtiq').setAudience('storage').setExpirationTime('5m').sign(new TextEncoder().encode(secret));
  const python=process.env.COURTIQ_TEST_PYTHON||resolve('.venv/bin/python');
  await processRun(python,['-c',"import os; from cloud_runner import Storage; Storage({'origin':os.environ['TEST_ORIGIN'],'token':os.environ['TEST_CAP']},allowed_origin=os.environ['TEST_ORIGIN']).upload('analysis.mp4',os.environ['TEST_FILE'])"],{TEST_ORIGIN:origin,TEST_CAP:writeCap,TEST_FILE:largeVideo});
  const published=await bucket.get(`sessions/integration-user/${transportId}/runs/${transportRun}/analysis.mp4`);
  assert.equal(published.size,file.size);assert.deepEqual(Buffer.from(await published.arrayBuffer()),Buffer.from(await readFile(largeVideo)));
  await db.prepare('DELETE FROM sessions WHERE id=?').bind(transportId).run();
  const modelCap=await new SignJWT({models:true,reads:['yolov8s-pose.pt'],writes:[]}).setProtectedHeader({alg:'HS256'}).setIssuer('courtiq').setAudience('storage').setExpirationTime('5m').sign(new TextEncoder().encode(secret));
  await processRun(python,['-c',"import os; from cloud_runner import Storage,ensure_model; ensure_model('yolov8s-pose.pt',Storage({'origin':os.environ['TEST_ORIGIN'],'token':os.environ['TEST_CAP']},allowed_origin=os.environ['TEST_ORIGIN']),directory=os.environ['TEST_MODELS'])"],{TEST_ORIGIN:origin,TEST_CAP:modelCap,TEST_MODELS:join(scratch,'verified-models')});
  console.log('PASS: native multipart output publication preserves all bytes; scoped model download verifies SHA-256');
  if(process.env.COURTIQ_BROWSER_QA){
    // Seed the genuine second model so the UI shows a ready environment without a fake status API.
    if(!process.env.COURTIQ_TEST_SHUTTLE)await seedModel(bucket,'TrackNet_best.pt');
    const {chromium}=createRequire(import.meta.url)('/Users/zhengyongxiong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
    const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000},extraHTTPHeaders:{'Cf-Access-Jwt-Assertion':jwt}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#account-email')?.textContent==='integration@example.org');
    await page.click('#lang-en');await page.click('[data-page="research"]');await page.waitForTimeout(300);
    assert.equal(await page.locator('#research-source').textContent(),'Private training record');
    assert.match(await page.locator('.rail-bottom').textContent(),/Private cloud workspace/);
    assert.equal(await page.locator('#device').inputValue(),'cpu');assert.equal(await page.locator('#device').isDisabled(),true);
    await page.screenshot({path:join(process.env.COURTIQ_BROWSER_QA,'cloud-desktop.png'),fullPage:false});
    await page.setViewportSize({width:390,height:844});await page.click('#lang-zh');await page.screenshot({path:join(process.env.COURTIQ_BROWSER_QA,'cloud-mobile.png'),fullPage:false});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);await browser.close();console.log('PASS: authenticated cloud UI, English/Chinese, CPU controls, desktop/mobile, no console errors');
  }
}catch(error){console.error(runnerLog.slice(-14000));throw error;}finally{await stopRunner();if(mf)await mf.dispose();await rm(scratch,{recursive:true,force:true});}
