const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createReader,positionAt,heatColor}=require('../static/published.js');
const root=path.resolve(__dirname,'..');

test('heat colors distinguish zero data, low density and peak density',()=>{
 assert.equal(heatColor(0,10),null);
 assert.equal(heatColor(NaN,10),null);
 assert.deepEqual(heatColor(10,10),[230,53,66]);
 const low=heatColor(1,10);assert(low[2]>low[0]);
 assert.deepEqual(heatColor(20,10),heatColor(10,10));
});

function reader(){return createReader(async url=>{
 const file=path.join(root,'published',url.replace('/results/',''));
 try{return {ok:true,json:async()=>JSON.parse(await fs.readFile(file,'utf8'))};}
 catch{return {ok:false};}
});}

test('published research and chart data come from the same genuine run',async()=>{
 const data=reader(),session=(await data.list()).find(s=>s.is_example);
 const result=await data.results(session.id);
 const manifest=await data.manifest(session.id);
 for(const player of ['near','far']){
  const report=await data.statistics(session.id,player);
  assert.equal(report.source.run_id,session.run_id);
  assert.equal(report.source.trajectory_sha256,manifest.trajectory_sha256);
  assert.equal(report.distance_m,result.players[player].distance_m);
  assert.equal(report.evaluation,null);
 }
 assert.equal(session.is_example,true,'Do not relabel the current upstream example as student data');
 assert.equal(typeof data.run,'undefined');
});

test('missing publications and private file names fail explicitly',async()=>{
 const data=reader();await assert.rejects(data.session('a'.repeat(32)),/未找到/);
 await assert.rejects(createReader(async()=>({ok:false})).list(),/不可用/);
 assert.throws(()=>data.file('../secret','summary.json'));
 assert.throws(()=>data.file('a'.repeat(32),'source.mp4'));
 assert.throws(()=>data.file('a'.repeat(32),'run.log'));
});

test('replay never shows a future detection or fills a missing interval',()=>{
 const points=[[0,0,1,2],[1,.05,2,3],[12,.6,3,4]];
 assert.equal(positionAt(points,-.01),null);
 assert.deepEqual(positionAt(points,.06),points[1]);
 assert.equal(positionAt(points,.3),null);
 assert.deepEqual(positionAt(points,.6),points[2]);
});

test('the sample animation is a downloadable, provenance-linked published artifact',async()=>{
 const data=reader(),session=(await data.list()).find(s=>s.is_example);
 assert.ok(session.animation,'Publish the actual sample animation');
 assert.equal(data.file(session.id,session.animation.file),`/results/${session.id}/trajectory.mp4`);
 assert.equal(session.animation.run_id,session.run_id);
 const manifest=await data.manifest(session.id);
 assert.equal(session.animation.trajectory_sha256,manifest.trajectory_sha256);
});

test('the actual original clip and analyzed overlay retain their distinct durations and source identity',async()=>{
 const data=reader(),session=(await data.list()).find(s=>s.is_example);
 assert.ok(session.videos?.original,'Publish the real original video');
 assert.ok(session.videos?.analysis,'Publish the completed overlay');
 const manifest=await data.manifest(session.id);
 assert.equal(session.videos.original.duration_s,30);
 assert.equal(session.videos.analysis.duration_s,5);
 assert.equal(session.videos.original.sha256,manifest.source_sha256);
 for(const [kind,video] of Object.entries(session.videos)){
  assert.equal(video.run_id,session.run_id);
  assert.equal(video.source_sha256,manifest.source_sha256);
  assert.equal(data.file(session.id,video.file),`/results/${session.id}/${kind}.mp4`);
 }
});

test('static build publishes data only and rejects private/stale files',async()=>{
 const {buildSite}=await import('../build-site.mjs');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'courtiq-publication-'));
 try{
  for(const name of ['published','static','THIRD_PARTY.md','UPSTREAM_VERSIONS.json'])await fs.cp(path.join(root,name),path.join(temp,name),{recursive:true});
  const out=await buildSite(temp);
  const html=await fs.readFile(path.join(out,'index.html'),'utf8');
  assert.match(html,/data-mode="showcase"/);assert.doesNotMatch(html,/src="\/upload\.js/);
  assert.equal((await fs.readdir(out)).includes('data'),false);
  const [session]=await reader().list();
  await fs.writeFile(path.join(temp,'published',session.id,'private-note.txt'),'private');
  await assert.rejects(buildSite(temp),/allowlist/);
  await fs.unlink(path.join(temp,'published',session.id,'private-note.txt'));
  const chart=path.join(temp,'published',session.id,'analytics.png');
  const original=await fs.readFile(chart);
  await fs.unlink(chart);await fs.mkdir(chart);await fs.writeFile(path.join(chart,'private.mp4'),'private');
  await assert.rejects(buildSite(temp),/regular file/);
  await fs.rm(chart,{recursive:true});
  const privatePath=path.join(temp,'private.png');await fs.writeFile(privatePath,original);
  await fs.symlink(privatePath,chart);await assert.rejects(buildSite(temp),/regular file/);
  await fs.unlink(chart);await fs.writeFile(chart,original);
  const animation=path.join(temp,'published',session.id,'trajectory.mp4');
  const video=await fs.readFile(animation);await fs.appendFile(animation,'corruption');
  await assert.rejects(buildSite(temp),/Animation.*fingerprint/);
  await fs.writeFile(animation,video);
  const originalVideo=path.join(temp,'published',session.id,'original.mp4');
  const originalBytes=await fs.readFile(originalVideo);await fs.appendFile(originalVideo,'corruption');
  await assert.rejects(buildSite(temp),/Match video asset fingerprint/);
  await fs.writeFile(originalVideo,originalBytes);
  await fs.appendFile(path.join(temp,'published',session.id,'players.csv'),'\n');
  await assert.rejects(buildSite(temp),/provenance/);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('static deployment has no analysis compute, storage or authentication bindings',async()=>{
 const config=JSON.parse(await fs.readFile(path.join(root,'wrangler.site.jsonc'),'utf8'));
 for(const key of ['containers','r2_buckets','d1_databases','queues','durable_objects','vars'])assert.equal(config[key],undefined);
 assert.equal(config.workers_dev,true);
 const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
 assert.match(pkg.scripts['cloud:deploy:git'],/wrangler.site.jsonc/);
});

test('published shuttle predictions are tied to their exact source CSV and video',async()=>{
 const {buildSite}=await import('../build-site.mjs');
 const catalog=JSON.parse(await fs.readFile(path.join(root,'published/catalog.json')));
 const record=catalog.sessions.find(s=>s.shuttle&&!s.is_example);
 assert.ok(record,'Publish actual supplementary inference rather than a placeholder');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'courtiq-shuttle-provenance-'));
 try{
  for(const name of ['published','static','THIRD_PARTY.md','UPSTREAM_VERSIONS.json'])await fs.cp(path.join(root,name),path.join(temp,name),{recursive:true});
  await buildSite(temp);
  const csv=path.join(temp,'published',record.id,'shuttle.csv');
  const bytes=await fs.readFile(csv);await fs.appendFile(csv,'corruption');
  await assert.rejects(buildSite(temp),/Shuttle source fingerprint/);
  await fs.writeFile(csv,bytes);
  const file=path.join(temp,'published',record.id,'manifest.json');
  const manifest=JSON.parse(await fs.readFile(file));manifest.shuttle.inference.input_sha256='0'.repeat(64);
  await fs.writeFile(file,JSON.stringify(manifest));
  await assert.rejects(buildSite(temp),/another video/);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('a run with only one observed player does not require an invented second report',async()=>{
 const {buildSite}=await import('../build-site.mjs');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'courtiq-single-player-'));
 try{
  for(const name of ['published','static','THIRD_PARTY.md','UPSTREAM_VERSIONS.json'])await fs.cp(path.join(root,name),path.join(temp,name),{recursive:true});
  const catalogPath=path.join(temp,'published/catalog.json');
  const catalog=JSON.parse(await fs.readFile(catalogPath));const record=catalog.sessions.find(s=>s.is_example);
  const folder=path.join(temp,'published',record.id);
  delete record.animation;
  await fs.unlink(path.join(folder,'trajectory.mp4'));await fs.unlink(path.join(folder,'animation-poster.jpg'));
  record.players=['near'];await fs.writeFile(catalogPath,JSON.stringify(catalog));
  await fs.writeFile(path.join(folder,'session.json'),JSON.stringify(record));
  const summary=JSON.parse(await fs.readFile(path.join(folder,'summary.json')));delete summary.players.far;
  await fs.writeFile(path.join(folder,'summary.json'),JSON.stringify(summary));
  await fs.unlink(path.join(folder,'statistics-far.json'));
  await buildSite(temp);
  const names=await fs.readdir(path.join(temp,'dist/results',record.id));
  assert.equal(names.includes('statistics-far.json'),false);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
