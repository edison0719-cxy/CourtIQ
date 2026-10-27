import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, createFetchMock } from 'miniflare';
import { build } from 'esbuild';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey); jwk.kid = 'test-key'; jwk.alg = 'RS256'; jwk.use = 'sig';
const issuer = 'https://courtiq-test.cloudflareaccess.com';
async function token(sub='student-a', claims={}) {
  return new SignJWT({ email:sub+'@example.org', ...claims }).setProtectedHeader({alg:'RS256',kid:jwk.kid})
    .setSubject(sub).setIssuer(claims.iss??issuer).setAudience(claims.aud??'test-aud').setIssuedAt().setExpirationTime(claims.exp ?? '1h').sign(privateKey);
}
const scratch = await mkdtemp(join(tmpdir(),'courtiq-cloud-'));
const bundle = join(scratch,'gateway.mjs');
// A real Workers runtime, D1 SQLite and R2 multipart implementation. No production fake APIs.
await build({entryPoints:['cloud/test-worker.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers'],outfile:bundle});
const fetchMock = createFetchMock(); fetchMock.disableNetConnect();
fetchMock.get(issuer).intercept({path:'/cdn-cgi/access/certs'}).reply(200,{keys:[jwk]}).persist();
const mf = new Miniflare({modules:true,modulesRoot:scratch,scriptPath:bundle,compatibilityDate:'2026-08-01',
  bindings:{ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:'test-aud',INTERNAL_SECRET:'test-only-secret-at-least-32-bytes-long',PUBLIC_ORIGIN:'https://courtiq.example.org'},
  d1Databases:['DB'],r2Buckets:['BUCKET'],durableObjects:{ANALYZER:'LocalContainer'},fetchMock,
  queueProducers:{JOBS:'courtiq-test-jobs'},
});
const db = await mf.getD1Database('DB'), bucket=await mf.getR2Bucket('BUCKET');
await db.exec((await readFile('cloud/migrations/0001.sql','utf8')).replace(/\n/g,' '));
async function call(path, sub='student-a', init={}) {
  return mf.dispatchFetch('https://courtiq.example.org'+path,{...init,headers:{'Cf-Access-Jwt-Assertion':await token(sub),'Content-Type':'application/json',...init.headers}});
}
const post=body=>({method:'POST',body:JSON.stringify(body)});
try {
  await test('forged identity headers cannot open the private library', async()=>{
    const r=await mf.dispatchFetch('https://courtiq.example.org/api/sessions',{headers:{'Cf-Access-Authenticated-User-Email':'student-a@example.org'}});
    assert.equal(r.status,401);
  });
  await test('wrongly signed and expired JWTs are rejected',async()=>{
    const other=await generateKeyPair('RS256');
    const bad=await new SignJWT({email:'x@example.org'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('x').setIssuer(issuer).setAudience('test-aud').setExpirationTime('1h').sign(other.privateKey);
    for(const value of [bad,await token('a',{exp:1}),await token('a',{iss:'https://wrong.cloudflareaccess.com'}),await token('a',{aud:'wrong-audience'})]){
      const r=await mf.dispatchFetch('https://courtiq.example.org/api/sessions',{headers:{'Cf-Access-Jwt-Assertion':value}});
      assert.equal(r.status,401);
    }
  });
  await test('multipart import resumes only inside the same owner library',async()=>{
    const body={filename:'training.mp4',size:10,fingerprint:'a'.repeat(64),title:'Footwork'};
    const a=await call('/api/uploads','student-a',post(body));assert.equal(a.status,201);
    const upload=await a.json();assert.equal(upload.chunk_size,8*1024*1024);
    const resumed=await (await call('/api/uploads','student-a',post(body))).json();assert.equal(resumed.id,upload.id);
    const b=await (await call('/api/uploads','student-b',post(body))).json();assert.notEqual(b.id,upload.id);
    assert.equal((await call('/api/uploads/'+upload.id,'student-b')).status,404);
    const part=await call(`/api/uploads/${upload.id}/parts/1`,'student-a',{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(10)});
    assert.equal(part.status,200);
    const state=await (await call('/api/uploads/'+upload.id)).json();assert.equal(state.parts.length,1);
    assert.equal((await call(`/api/uploads/${upload.id}/parts/2`,'student-a',{method:'PUT',body:new Uint8Array(1)})).status,400);
    assert.equal((await call('/api/uploads/'+upload.id,'student-a',{method:'DELETE'})).status,204);
    assert.equal((await call('/api/uploads/'+upload.id)).status,404);
  });
  await test('private artifacts support byte ranges and never cross account boundaries',async()=>{
    const id='1'.repeat(32), session={id,title:'Real upload',source_file:'source.mp4',run_id:null,status:'draft',created_at:'2026-10-28T00:00:00Z',updated_at:'2026-10-28T00:00:00Z'};
    await db.prepare('INSERT INTO sessions (id,owner,status,metadata,updated_at) VALUES (?,?,?,?,?)').bind(id,'student-a','draft',JSON.stringify(session),session.updated_at).run();
    await bucket.put(`sessions/student-a/${id}/source.mp4`,'0123456789',{httpMetadata:{contentType:'video/mp4'}});
    assert.equal((await call(`/api/sessions/${id}/files/source.mp4`,'student-b')).status,404);
    const r=await call(`/api/sessions/${id}/files/source.mp4`,'student-a',{headers:{Range:'bytes=2-5'}});
    assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),'bytes 2-5/10');assert.equal(await r.text(),'2345');
    assert.equal((await (await call('/api/sessions','student-b')).json()).length,0);
    assert.equal((await call(`/api/sessions/${id}/files/manifest.json`)).status,404);
    const bad=await call(`/api/sessions/${id}/notes`,'student-a',{method:'PUT',headers:{Origin:'https://evil.example'},body:JSON.stringify({notes:'changed'})});assert.equal(bad.status,403);
    const saved=await call(`/api/sessions/${id}/notes`,'student-a',{method:'PUT',body:JSON.stringify({notes:'coach feedback'})});assert.equal((await saved.json()).notes,'coach feedback');
  });
  await test('a durable completion marker prevents re-running inference after a process restart',async()=>{
    const id='2'.repeat(32),run='3'.repeat(32),s={id,status:'running',run_id:run,source_file:'source.mp4',task_started_at:Date.now(),task_restarts:3,created_at:new Date().toISOString()};
    await db.prepare('INSERT INTO sessions (id,owner,status,run_id,metadata,updated_at) VALUES (?,?,?,?,?,?)').bind(id,'student-a','running',run,JSON.stringify(s),Date.now()).run();
    const base=`sessions/student-a/${id}/runs/${run}/`;
    for(const name of ['players.csv','summary.json','manifest.json','analysis.mp4','analytics.png'])await bucket.put(base+name,'verified test publication');
    await bucket.put(base+'completion.json',JSON.stringify({run_id:run,session_id:id,status:'completed',files:Object.fromEntries(['players.csv','summary.json','manifest.json','analysis.mp4','analytics.png'].map(name=>[name,{size:25}]))}));
    const r=await mf.dispatchFetch('http://localhost/__test/poll',post({owner:'student-a',id,run_id:run}));assert.equal(r.status,200);
    const saved=await (await call('/api/sessions/'+id)).json();assert.equal(saved.status,'completed');assert.equal(saved.task_restarts,3);
    const reclaimed=await (await mf.dispatchFetch('http://localhost/__test/stopped?name=run-'+run)).json();assert.equal(reclaimed.stopped,true);
  });
  await test('duplicate completion polls preserve the terminal result without starting a container',async()=>{
    const id='2'.repeat(32),run='3'.repeat(32);
    for(let i=0;i<2;i++)assert.equal((await mf.dispatchFetch('http://localhost/__test/poll',post({owner:'student-a',id,run_id:run}))).status,200);
    const saved=await (await call('/api/sessions/'+id)).json();assert.equal(saved.status,'completed');assert.equal(saved.task_restarts,3);
  });
  await test('pending jobs cannot allocate a container while another run owns the admission slot',async()=>{
    const id='6'.repeat(32),run='7'.repeat(32),other='8'.repeat(32);
    const s={id,run_id:run,status:'queued',task_started_at:Date.now(),task_restarts:0};
    await db.prepare('INSERT INTO sessions (id,owner,status,run_id,metadata,updated_at) VALUES (?,?,?,?,?,?)').bind(id,'student-a','queued',run,JSON.stringify(s),Date.now()).run();
    await db.prepare('INSERT INTO compute_slot (id,run_id,expires_at) VALUES (1,?,?)').bind(other,Date.now()+60000).run();
    const response=await mf.dispatchFetch('http://localhost/__test/poll',post({owner:'student-a',id,run_id:run}));assert.equal(response.status,200);
    assert.equal((await (await call('/api/sessions/'+id)).json()).status,'queued');
    assert.equal((await db.prepare('SELECT run_id FROM compute_slot').first()).run_id,other);
    await db.prepare('DELETE FROM compute_slot').run();
  });
  await test('a capability for an obsolete run cannot write objects into R2',async()=>{
    const id='1'.repeat(32),run='e'.repeat(32);
    const cap=await new SignJWT({owner:'student-a',sid:id,run,source:'source.mp4',reads:[],writes:['analysis.mp4']}).setProtectedHeader({alg:'HS256'}).setIssuer('courtiq').setAudience('storage').setExpirationTime('1h').sign(new TextEncoder().encode('test-only-secret-at-least-32-bytes-long'));
    const r=await mf.dispatchFetch('http://localhost/internal/storage/analysis.mp4',{method:'PUT',headers:{Authorization:'Bearer '+cap},body:'obsolete output'});assert.equal(r.status,409);
    assert.equal(await bucket.head(`sessions/student-a/${id}/runs/${run}/analysis.mp4`),null);
  });
  await test('the scheduled watchdog removes abandoned uploads without deleting imported sessions',async()=>{
    const u=await (await call('/api/uploads','student-a',post({filename:'unfinished.mp4',size:12,fingerprint:'b'.repeat(64)}))).json();
    await db.prepare('UPDATE uploads SET expires_at=? WHERE id=?').bind(Date.now()-1,u.id).run();
    const r=await mf.dispatchFetch('http://localhost/__test/recover',{method:'POST'});assert.equal(r.status,200);
    assert.equal((await call('/api/uploads/'+u.id)).status,404);assert.equal((await call('/api/sessions/'+'1'.repeat(32))).status,200);
  });
} finally {await mf.dispose();await rm(scratch,{recursive:true,force:true});}
