/* Resumable private R2 uploads. Source checksums are computed again by the server. */
(function(root){
  const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  async function fingerprint(file){
    const metadata=new TextEncoder().encode(JSON.stringify([file.name,file.size,file.lastModified]));
    const first=new Uint8Array(await file.slice(0,65536).arrayBuffer());
    const last=new Uint8Array(await file.slice(Math.max(0,file.size-65536)).arrayBuffer());
    const bytes=new Uint8Array(metadata.length+first.length+last.length);bytes.set(metadata);bytes.set(first,metadata.length);bytes.set(last,metadata.length+first.length);
    return hash(bytes);
  }
  async function request(path,options={},transport=fetch){
    const response=await transport(path,{credentials:'same-origin',...options});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(typeof body.detail==='string'?body.detail:'上传失败，请重试。');error.status=response.status;throw error;}
    return body;
  }
  function pause(ms,signal){return new Promise((resolve,reject)=>{
    const aborted=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',aborted);resolve();},ms);
    if(signal?.aborted)aborted();else signal?.addEventListener('abort',aborted,{once:true});
  });}
  async function upload(file,fields,{signal,onProgress=()=>{},onState=()=>{},transport=fetch}={}){
    if(!file||file.size<=0)throw new Error('请选择有效视频。');
    if(file.size>4*1024**3)throw new Error('视频不能超过 4 GB，请先截取训练片段。');
    onState('fingerprinting');
    const init=await request('/api/uploads',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,filename:file.name,size:file.size,fingerprint:await fingerprint(file)})},transport);
    const saved=new Map(init.parts.map(p=>[p.number,p]));
    let loaded=0;onState('uploading');
    for(let offset=0,number=1;offset<file.size;offset+=init.chunk_size,number++){
      signal?.throwIfAborted();
      const bytes=await file.slice(offset,offset+init.chunk_size).arrayBuffer();
      // Check every resumed chunk; equal name/size/mtime alone never permits skipping data.
      const sha256=await hash(bytes);
      if(saved.get(number)?.sha256!==sha256){
        for(let attempt=0;;attempt++){
          try{await request(`/api/uploads/${init.id}/parts/${number}`,{method:'PUT',signal,headers:{'Content-Type':'application/octet-stream'},body:bytes},transport);break;}
          catch(error){if(error.name==='AbortError'||attempt>=2||(error.status&&error.status<500))throw error;await pause(1000*2**attempt,signal);}
        }
      }
      loaded+=bytes.byteLength;onProgress(loaded,file.size);
    }
    onState('processing');
    return request(`/api/uploads/${init.id}/complete`,{method:'POST',signal},transport);
  }
  const api={upload,fingerprint};
  if(typeof module!=='undefined')module.exports=api;
  if(root)root.CourtIQUpload=api;
})(typeof window!=='undefined'?window:null);
