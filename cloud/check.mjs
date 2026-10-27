import {readFile,mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {configuration} from './configure.mjs';
const configured=process.argv.includes('--configured');
const folder=await mkdtemp(join(tmpdir(),'courtiq-build-'));
try{
  await build({entryPoints:['cloud/index.js'],bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],outfile:join(folder,'worker.mjs')});
  console.log('PASS: Worker, container class and authentication bundle compile.');
  const base=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  for(const binding of ['BUCKET','DB','JOBS','ANALYZER','ASSETS']){
    const text=JSON.stringify(base);if(!text.includes('"'+binding+'"'))throw new Error('Missing binding '+binding);
  }
  const configPath='wrangler.local.jsonc';
  let exists=true;try{await access(configPath);}catch{exists=false;}
  if(exists){
    const cfg=JSON.parse(await readFile(configPath,'utf8'));
    if(!Number.isInteger(Number(cfg.vars.MAX_JOB_SECONDS))||Number(cfg.vars.MAX_JOB_SECONDS)<60||Number(cfg.vars.MAX_JOB_SECONDS)>7200)throw new Error('MAX_JOB_SECONDS must be between 60 and 7200 (capability lifetime limit).');
    configuration(cfg,{origin:cfg.vars.PUBLIC_ORIGIN,'team-domain':cfg.vars.ACCESS_TEAM_DOMAIN,aud:cfg.vars.ACCESS_AUD,'db-id':cfg.d1_databases[0].database_id});
    if(!cfg.routes?.some(r=>r.pattern===new URL(cfg.vars.PUBLIC_ORIGIN).hostname&&r.custom_domain))throw new Error('Custom domain route is missing.');
    console.log('PASS: Local deployment configuration has valid domain, Access fields and D1 ID.');
  }else if(configured)throw new Error('Run cloud:configure with your real Cloudflare values first.');
  else console.log('PENDING: Cloudflare account values are intentionally unset. See CLOUD_DEPLOY.zh-CN.md.');
  const docker=spawnSync('docker',['info'],{stdio:'ignore'});
  if(docker.status===0)console.log('PASS: Docker daemon is available. Build with docker build --platform linux/amd64 -t courtiq .');
  else if(configured)throw new Error('Install/start Docker before deploying the container image.');
  else console.log('PENDING: Docker is unavailable; image build and production runtime are not verified.');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await rm(folder,{recursive:true,force:true});}
