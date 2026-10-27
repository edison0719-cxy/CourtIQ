/* Read genuine, precomputed publications. This module never calls the analysis API. */
(function(root) {
 'use strict';
 function createReader(fetchFile) {
  let catalog;
  const json=async path=>{
   const response=await fetchFile(path);
   if(!response.ok)throw new Error('发布数据不可用，请稍后重试。');
   return response.json();
  };
  const entry=async id=>{
   const data=await load();
   const record=data.sessions.find(s=>s.id===id);
   if(!record)throw new Error('未找到已发布记录。');
   return record;
  };
  const load=async()=>{
   if(!catalog){
    const data=await json('/results/catalog.json');
    if(data.schema_version!==1||!Array.isArray(data.sessions)||data.sessions.some(s=>!/^[a-f0-9]{32}$/.test(s.id)||s.status!=='completed'))throw new Error('发布数据格式无效。');
    catalog=data;
   }
   return catalog;
  };
  function file(id,name){
   if(!/^[a-f0-9]{32}$/.test(id)||!['session.json','summary.json','manifest.json','players.csv','analytics.png','preview.svg','statistics-near.json','statistics-far.json','trajectory.mp4','animation-poster.jpg'].includes(name))throw new Error('无效的数据文件。');
   return `/results/${id}/${name}`;
  }
  return {
   catalog:load, list:async()=>(await load()).sessions, session:entry, file,
   results:async id=>{await entry(id);return json(file(id,'summary.json'));},
   statistics:async(id,player)=>{const record=await entry(id);if(!record.players.includes(player))throw new Error('无效球员。');return json(file(id,`statistics-${player}.json`));},
   manifest:async id=>{await entry(id);return json(file(id,'manifest.json'));},
  };
 }
 // Select only actual observations, at or before the cursor. Never interpolate across a gap.
 function positionAt(trajectory,time,maxAge=.1){
  let position=null;
  for(const point of trajectory){if(point[1]>time)break;position=point;}
  return position&&time-position[1]<=maxAge?position:null;
 }
 const exported={createReader,positionAt};
 if(typeof module==='object'&&module.exports)module.exports=exported;
 else root.CourtIQPublished=exported;
})(typeof window==='object'?window:globalThis);
