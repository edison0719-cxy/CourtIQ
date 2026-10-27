/* Static packaging uses Node's standard library. No Python, GPU models or account variables. */
import {cp, mkdir, readFile, readdir, rm, lstat, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export async function buildSite(root=path.dirname(fileURLToPath(import.meta.url))){
 const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
 if(!(await lstat(path.join(root,'published/catalog.json'))).isFile())throw new Error('Catalog must be a regular file.');
 const catalog=await readJSON(path.join(root,'published/catalog.json'));
 if(catalog.schema_version!==1||!catalog.sessions?.length)throw new Error('Publish at least one completed run before building.');
 const commonFiles=['session.json','summary.json','manifest.json','players.csv','analytics.png','preview.svg'];
 const seen=new Set();
 const names=await readdir(path.join(root,'published'));
 if(names.some(name=>name!=='catalog.json'&&!catalog.sessions.some(s=>s.id===name)))throw new Error('Unexpected file in public catalog.');
 // Validate all inputs before replacing the previous successful build.
 for(const record of catalog.sessions){
  if(!/^[a-f0-9]{32}$/.test(record.id)||seen.has(record.id)||record.status!=='completed')throw new Error('Invalid or duplicate published session.');
  seen.add(record.id);
  const folder=path.join(root,'published',record.id);
  if(!record.players?.length||new Set(record.players).size!==record.players.length||record.players.some(p=>!['near','far'].includes(p)))throw new Error('Invalid published player list.');
  const files=[...commonFiles,...record.players.map(p=>`statistics-${p}.json`)];
  if(!(await lstat(folder)).isDirectory())throw new Error('Publication directory must not be a symlink.');
  const names=await readdir(folder);
  if(names.some(name=>!files.includes(name))||files.some(name=>!names.includes(name)))throw new Error('Publication must contain only the explicit data-only file allowlist.');
  for(const name of files){
   const info=await lstat(path.join(folder,name));
   if(!info.isFile())throw new Error(`Publication asset must be a regular file: ${name}`);
   if(info.size>25*1024*1024)throw new Error(`Asset exceeds 25 MiB: ${name}`);
  }
  const metadata=await readJSON(path.join(folder,'session.json'));
  if(JSON.stringify(metadata)!==JSON.stringify(record))throw new Error('Catalog metadata differs from published session.');
  const manifest=await readJSON(path.join(folder,'manifest.json'));
  const csvHash=createHash('sha256').update(await readFile(path.join(folder,'players.csv'))).digest('hex');
  if(manifest.trajectory_sha256!==csvHash||manifest.run_id!==record.run_id)throw new Error('Published trajectory or run does not match its provenance.');
  const summary=await readJSON(path.join(folder,'summary.json'));
  if(Object.keys(summary.players).sort().join()!==[...record.players].sort().join())throw new Error('Published player list differs from the analysis.');
  for(const player of record.players){
   const report=await readJSON(path.join(folder,`statistics-${player}.json`));
   if(report.source.trajectory_sha256!==csvHash||report.source.run_id!==record.run_id||report.player!==player)throw new Error('Research report belongs to another run.');
  }
 }
 const out=path.join(root,'dist');
 await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
 for(const name of ['index.html','style.css','i18n.js','planning.js','published.js','app.js','research.js'])await cp(path.join(root,'static',name),path.join(out,name));
 const html=(await readFile(path.join(out,'index.html'),'utf8')).replace('<html lang="zh-CN">','<html lang="zh-CN" data-mode="showcase">').replace(/<script src="\/upload\.js[^>]*><\/script>/,'');
 await writeFile(path.join(out,'index.html'),html);
 await mkdir(path.join(out,'results'));
 await cp(path.join(root,'published/catalog.json'),path.join(out,'results/catalog.json'));
 for(const {id,players} of catalog.sessions){
  await mkdir(path.join(out,'results',id));
  const files=[...commonFiles,...players.map(p=>`statistics-${p}.json`)];
  for(const name of files)await cp(path.join(root,'published',id,name),path.join(out,'results',id,name));
 }
 await writeFile(path.join(out,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n/results/*\n  Cache-Control: public, max-age=0, must-revalidate\n');
 for(const name of ['THIRD_PARTY.md','UPSTREAM_VERSIONS.json'])await cp(path.join(root,name),path.join(out,name));
 console.log(`Static CourtIQ: ${catalog.sessions.length} published run(s); no API, videos, models, secrets or database bindings.`);
 return out;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildSite();
