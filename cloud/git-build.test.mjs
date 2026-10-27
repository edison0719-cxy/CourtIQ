import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gitBuild} from './git-build.mjs';
const base=JSON.parse(await readFile('wrangler.jsonc','utf8'));
const env={COURTIQ_PUBLIC_ORIGIN:'https://courtiq.my-account.workers.dev',COURTIQ_ACCESS_TEAM_DOMAIN:'https://my-team.cloudflareaccess.com',COURTIQ_ACCESS_AUD:'b'.repeat(64),COURTIQ_D1_DATABASE_ID:'12345678-1234-1234-1234-123456789abc',COURTIQ_INTERNAL_SECRET:'deployment-test-secret-at-least-32-characters'};
test('Git builds separate runtime secrets from tracked configuration',()=>{
  const prepared=gitBuild(base,env);
  assert.equal(prepared.config.workers_dev,true);
  assert.equal(prepared.config.d1_databases[0].database_id,env.COURTIQ_D1_DATABASE_ID);
  assert.equal(prepared.secrets.INTERNAL_SECRET,env.COURTIQ_INTERNAL_SECRET);
  assert.equal(JSON.stringify(prepared.config).includes(env.COURTIQ_INTERNAL_SECRET),false);
});
test('Git builds fail before deployment when required settings are missing',()=>{
  for(const key of Object.keys(env))assert.throws(()=>gitBuild(base,{...env,[key]:''}),undefined,key);
  assert.throws(()=>gitBuild(base,{...env,COURTIQ_INTERNAL_SECRET:'short'}));
});
