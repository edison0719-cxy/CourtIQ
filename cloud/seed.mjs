import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const remote=process.argv.includes('--remote'),local=process.argv.includes('--local');
if(remote&&local)throw new Error('Choose either --remote or --local.');
const configPath=remote?'wrangler.local.jsonc':'wrangler.jsonc';
const cfg=JSON.parse(await readFile(configPath,'utf8'));
const bucket=cfg.r2_buckets.find(b=>b.binding==='BUCKET').bucket_name;
const hashes=JSON.parse(await readFile('UPSTREAM_VERSIONS.json','utf8')).weights_sha256;
const items=Object.entries(hashes).map(([name,sha256])=>({name:'models/'+name,file:'vendor/badminton-pipeline-repro/weights/'+name,sha256,type:'application/octet-stream'}));
if(process.argv.includes('--example'))items.push({name:'examples/upstream-short.mp4',file:'vendor/badminton-pipeline-repro/short.mp4',type:'video/mp4'});
for(const item of items){
  await access(item.file);
  if(item.sha256){const hash=createHash('sha256');for await(const chunk of createReadStream(item.file))hash.update(chunk);if(hash.digest('hex')!==item.sha256)throw new Error('Model checksum mismatch: '+item.file);}
  console.log((remote?'REMOTE upload':local?'LOCAL upload':'Validated (dry run)')+': '+bucket+'/'+item.name);
  if(remote||local){
    const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','r2','object','put',bucket+'/'+item.name,'--file',item.file,'--content-type',item.type,remote?'--remote':'--local','--config',configPath],{stdio:'inherit'});
    if(result.status!==0)throw new Error('R2 upload failed: '+item.name);
  }
}
if(!remote&&!local)console.log('Nothing uploaded. Add --remote after creating resources, or --local for Wrangler development.');
