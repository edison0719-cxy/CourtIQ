import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {configuration} from './configure.mjs';
const base=JSON.parse(await readFile('wrangler.jsonc','utf8'));
const valid={origin:'https://court.example.org','team-domain':'https://test-team.cloudflareaccess.com',aud:'a'.repeat(64),'db-id':'12345678-1234-1234-1234-123456789abc'};
test('configuration binds the real custom origin without enabling a public workers.dev bypass',()=>{
  const cfg=configuration(base,valid);assert.equal(cfg.vars.PUBLIC_ORIGIN,'https://court.example.org');assert.equal(cfg.routes[0].pattern,'court.example.org');assert.equal(cfg.workers_dev,false);assert.equal(base.vars.PUBLIC_ORIGIN,'');
});
test('configuration rejects insecure origins, paths and missing identity/resource values',()=>{
  for(const origin of ['http://court.example.org','https://court.example.org/path','https://court.example.org/?x=1'])assert.throws(()=>configuration(base,{...valid,origin}));
  for(const key of ['aud','db-id','team-domain'])assert.throws(()=>configuration(base,{...valid,[key]:''}));
});
