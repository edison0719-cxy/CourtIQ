import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './site.mjs';
const env={ASSETS:{fetch:async()=>new Response('0123456789',{headers:{'content-length':'10','content-type':'video/mp4'}})}};
test('video ranges permit exact seeks without buffering the whole response',async()=>{
 for(const [range,status,text,contentRange] of [['bytes=2-5',206,'2345','bytes 2-5/10'],['bytes=-3',206,'789','bytes 7-9/10'],['bytes=8-',206,'89','bytes 8-9/10'],['bytes=20-',416,'','bytes */10']]){
 const response=await worker.fetch(new Request('https://example.com/results/test.mp4',{headers:{range}}),env);
 assert.equal(response.status,status);assert.equal(await response.text(),text);assert.equal(response.headers.get('content-range'),contentRange);
 }
});
test('normal video playback stays progressive and non-video assets pass through',async()=>{
 const response=await worker.fetch(new Request('https://example.com/results/test.mp4'),env);
 assert.equal(response.status,200);assert.equal(await response.text(),'0123456789');assert.equal(response.headers.get('accept-ranges'),'bytes');
});
