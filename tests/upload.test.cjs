const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');

test('upload fingerprint changes with file content and remains stable for the same selection',async()=>{
  global.crypto=webcrypto;
  const {fingerprint}=require('../static/upload.js');
  const a=new File(['court training footage'],'training.mp4',{lastModified:7});
  const b=new File(['different video bytes!'],'training.mp4',{lastModified:7});
  assert.match(await fingerprint(a),/^[a-f0-9]{64}$/);
  assert.equal(await fingerprint(a),await fingerprint(a));
  assert.notEqual(await fingerprint(a),await fingerprint(b));
});
