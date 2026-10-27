/* Cloudflare Workers Builds entry point: configuration from build variables, no local Docker setup. */
import {readFile,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {configuration} from './configure.mjs';
export function gitBuild(base,env){
  const keys=['COURTIQ_PUBLIC_ORIGIN','COURTIQ_ACCESS_TEAM_DOMAIN','COURTIQ_ACCESS_AUD','COURTIQ_D1_DATABASE_ID','COURTIQ_INTERNAL_SECRET'];
  for(const key of keys)if(typeof env[key]!=='string'||!env[key].trim())throw new Error(`Set ${key} in Cloudflare Settings > Builds > Variables and secrets before deploying.`);
  if(env.COURTIQ_INTERNAL_SECRET.length<32)throw new Error('COURTIQ_INTERNAL_SECRET must have at least 32 characters.');
  const config=configuration(base,{origin:env.COURTIQ_PUBLIC_ORIGIN.trim(),'team-domain':env.COURTIQ_ACCESS_TEAM_DOMAIN.trim(),aud:env.COURTIQ_ACCESS_AUD.trim(),'db-id':env.COURTIQ_D1_DATABASE_ID.trim()});
  return {config,secrets:{INTERNAL_SECRET:env.COURTIQ_INTERNAL_SECRET}};
}
if(resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){
  const secretFile='.dev.vars.build.json';let secretCreated=false;
  try{
    const prepared=gitBuild(JSON.parse(await readFile('wrangler.jsonc','utf8')),process.env);
    await writeFile('wrangler.build.jsonc',JSON.stringify(prepared.config,null,2)+'\n');
    await writeFile(secretFile,JSON.stringify(prepared.secrets),{mode:0o600,flag:'wx'});secretCreated=true;
    if(!process.argv.includes('--dry-run')){
      const migration=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply',prepared.config.d1_databases[0].database_name,'--remote','--config','wrangler.build.jsonc'],{stdio:'inherit'});
      if(migration.error)throw migration.error;
      if(migration.status!==0)throw new Error('D1 migrations failed; deployment was stopped.');
    }
    const args=['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.build.jsonc','--secrets-file',secretFile];
    if(process.argv.includes('--dry-run'))args.push('--dry-run','--containers-rollout=none');
    const result=spawnSync(process.execPath,args,{stdio:'inherit'});
    if(result.error)throw result.error;
    process.exitCode=result.status??1;
  }catch(error){console.error(error.message);process.exitCode=1;}
  finally{if(secretCreated)await rm(secretFile,{force:true});}
}
