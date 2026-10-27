import {readFile,writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export function configuration(base,args){
  const origin=new URL(args.origin||'http://invalid');
  if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.port)throw new Error('--origin must be the exact HTTPS custom-domain origin.');
  const team=(args['team-domain']||'').replace(/\/$/,'');
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team))throw new Error('--team-domain must be your https://TEAM.cloudflareaccess.com URL.');
  if(!/^[a-f0-9]{64}$/.test(args.aud||''))throw new Error('--aud must be the Access application AUD tag.');
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(args['db-id']||''))throw new Error('--db-id must be the actual D1 database UUID.');
  const cfg=structuredClone(base);
  Object.assign(cfg.vars,{PUBLIC_ORIGIN:origin.origin,ACCESS_TEAM_DOMAIN:team,ACCESS_AUD:args.aud});
  cfg.d1_databases[0].database_id=args['db-id'];cfg.routes=[{pattern:origin.hostname,custom_domain:true}];
  return cfg;
}
if(resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{origin:{type:'string'},'team-domain':{type:'string'},aud:{type:'string'},'db-id':{type:'string'}}});
    const config=configuration(JSON.parse(await readFile('wrangler.jsonc','utf8')),values);
    await writeFile('wrangler.local.jsonc',JSON.stringify(config,null,2)+'\n');
    console.log('Wrote ignored wrangler.local.jsonc. No resources created and no deployment performed.');
  }catch(error){console.error(error.message);console.error('Usage: npm run cloud:configure -- --origin https://YOUR_DOMAIN --team-domain https://YOUR_TEAM.cloudflareaccess.com --aud YOUR_AUD --db-id YOUR_D1_UUID');process.exitCode=1;}
}
