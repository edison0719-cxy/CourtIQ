/* Original CourtIQ review UI. Detector candidates and manual decisions stay separate. */
(function(root){
 'use strict';
 root.CourtIQShuttle={create({translate:t,save,seek}){
  const video=document.getElementById('match-video'),stage=document.getElementById('video-stage');
  const canvas=document.createElement('canvas');canvas.id='shuttle-overlay';canvas.setAttribute('aria-hidden','true');stage.append(canvas);
  const panel=document.createElement('section');panel.id='shuttle-panel';panel.className='panel shuttle-panel';panel.hidden=true;
  panel.innerHTML=`<div class="panel-bar"><h2 data-i18n="球路与回合复盘">球路与回合复盘</h2><a class="text-link" id="shuttle-export" download hidden data-i18n="球迹 CSV">球迹 CSV</a><label class="shuttle-toggle"><input type="checkbox" id="shuttle-visible"/><span data-i18n="显示球迹">显示球迹</span></label><span class="small-tag" id="shuttle-status"></span></div>
   <div class="shuttle-body"><div class="shuttle-metrics" id="shuttle-metrics"></div>
   <div class="shuttle-editor" id="shuttle-editor"><select id="shuttle-kind" aria-label="事件类型" data-i18n-aria-label="事件类型"><option value="hit" data-i18n="击球">击球</option><option value="serve" data-i18n="发球">发球</option><option value="start" data-i18n="回合开始">回合开始</option><option value="end" data-i18n="回合结束">回合结束</option></select>
   <select id="shuttle-player" aria-label="事件球员" data-i18n-aria-label="事件球员"><option value="" data-i18n="未归属">未归属</option><option value="near" data-i18n="近端球员">近端球员</option><option value="far" data-i18n="远端球员">远端球员</option></select>
   <button class="button secondary" id="shuttle-prev" data-i18n="上一帧">上一帧</button><button class="button secondary" id="shuttle-next" data-i18n="下一帧">下一帧</button><button class="button secondary" id="shuttle-mark" data-i18n="标记当前画面">标记当前画面</button></div>
   <p id="shuttle-message" role="status" hidden></p><div class="shuttle-events" id="shuttle-events"></div><div id="shuttle-rallies"></div></div>`;
  document.getElementById('metrics').before(panel);
  const el=id=>document.getElementById(id),toggle=el('shuttle-visible');
  const labels={hit:'击球',serve:'发球',start:'回合开始',end:'回合结束',candidate:'待复核',confirmed:'已确认',rejected:'已排除'};
  let report=null,session=null,key='',decisions=[],editable=false,currentView='',saving=false,loop=false;
  const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
  function paint(){
   const status=report?.status||'not_run';
   el('shuttle-status').textContent=t({not_run:'未运行球追踪',no_detections:'未检测到球',sparse:'检测稀疏 · 待复核',detected:'检测点 · 待复核'}[status]);
   toggle.disabled=!report?.trajectory.length;
   el('shuttle-editor').hidden=!editable;
   el('shuttle-mark').disabled=saving||!report;
   const events=report?.events||[],rallies=report?.rallies||[];
   const metrics=el('shuttle-metrics');metrics.replaceChildren();
   for(const [label,value] of [['球检测覆盖率',status==='not_run'?'—':((report?.observation_rate||0)*100).toFixed(1)+'%'],['候选击球',status==='not_run'?'—':events.filter(e=>e.status==='candidate').length],['确认击球',events.filter(e=>e.status==='confirmed'&&['hit','serve'].includes(e.kind)).length],['确认回合',rallies.length]]){
    const box=document.createElement('div');box.append(text('span',t(label)),text('strong',value));metrics.append(box);
   }
   const list=el('shuttle-events');list.replaceChildren();
   if(!events.length)list.append(text('p',t('暂无击球事件')));
   for(const event of events){
    const row=document.createElement('div');row.className='shuttle-event';row.dataset.status=event.status;
    const jump=text('button',event.time_s.toFixed(2)+' s');jump.className='text-link';jump.onclick=()=>seek(event.time_s);
    row.append(jump,text('span',t(labels[event.kind])),text('span',t(event.player==='near'?'近端球员':event.player==='far'?'远端球员':'未归属')),text('span',t(labels[event.status])));
    if(editable){
     for(const [status,label] of [['confirmed','确认'],['rejected','排除']]){
      const button=text('button',t(label));button.className='text-link';button.disabled=saving||event.status===status;
      button.onclick=()=>persist({frame:event.frame,kind:event.kind,status,player:event.player});row.append(button);
     }
    }
    list.append(row);
   }
   const table=el('shuttle-rallies');table.replaceChildren();
   if(rallies.length){
    table.append(text('h3',t('已复核回合')));
    for(const [i,rally] of rallies.entries()){
     const row=document.createElement('div');row.className='shuttle-event';
     const jump=text('button',`${i+1} · ${(rally.start_frame/report.source.fps).toFixed(2)} s`);jump.className='text-link';jump.onclick=()=>seek(rally.start_frame/report.source.fps);
     row.append(jump,text('span',t('时长 {seconds} 秒',{seconds:rally.duration_s.toFixed(2)})),text('span',t('击球 {count} 次',{count:rally.confirmed_shots})),text('span',rally.mean_interval_s===null?'—':t('平均间隔 {seconds} 秒',{seconds:rally.mean_interval_s.toFixed(2)})));table.append(row);
    }
   }
  }
  async function persist(item){
   if(saving||!editable)return;
   const next=decisions.filter(e=>e.frame!==item.frame||e.kind!==item.kind).concat(item),requestKey=key;
   saving=true;el('shuttle-message').hidden=true;paint();
   try{
    const updated=await save({id:session.id,run_id:session.run_id,decisions:next});
    if(key!==requestKey)return;decisions=next;report=updated;
   }catch(e){if(key===requestKey){el('shuttle-message').textContent=t(e.message);el('shuttle-message').hidden=false;}}
   finally{saving=false;paint();draw();}
  }
  el('shuttle-mark').onclick=()=>{
   if(!report)return;
   if(!['original','analysis'].includes(currentView)){el('shuttle-message').textContent=t('请在原片或分析视频中标记。');el('shuttle-message').hidden=false;return;}
   video.pause();persist({frame:Math.min(report.source.frames-1,Math.max(0,Math.round(video.currentTime*report.source.fps))),kind:el('shuttle-kind').value,status:'confirmed',player:el('shuttle-player').value||null});
  };
  for(const [id,step] of [['shuttle-prev',-1],['shuttle-next',1]])el(id).onclick=()=>{
   if(!report)return;
   const frame=Math.min(report.source.frames-1,Math.max(0,Math.round(video.currentTime*report.source.fps)+step));seek(frame/report.source.fps);
  };
  function draw(){
   canvas.hidden=!toggle.checked||!report?.trajectory.length||!['original','analysis'].includes(currentView)||video.hidden;
   if(canvas.hidden)return;
   const w=video.clientWidth,h=video.clientHeight,dpr=devicePixelRatio||1;
   if(!w||!h)return;
   canvas.style.left=video.offsetLeft+'px';canvas.style.top=video.offsetTop+'px';canvas.style.width=w+'px';canvas.style.height=h+'px';
   if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
   const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
   const source=report.source,scale=Math.min(w/source.width,h/source.height),ox=(w-source.width*scale)/2,oy=(h-source.height*scale)/2,time=video.currentTime;
   const points=report.trajectory.filter(p=>p[1]<=time&&time-p[1]<=.35);
   ctx.lineWidth=2.5;ctx.strokeStyle='#ffdf42';ctx.beginPath();
   points.forEach((p,i)=>{const x=ox+p[2]*scale,y=oy+p[3]*scale,prev=points[i-1];if(prev&&p[0]===prev[0]+1)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
   const last=points.at(-1);
   if(last&&time-last[1]<=1.5/source.fps){ctx.beginPath();ctx.arc(ox+last[2]*scale,oy+last[3]*scale,5,0,Math.PI*2);ctx.fillStyle='#ffdf42';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#142e42';ctx.stroke();}
  }
  function animate(){draw();if(!video.paused&&!video.ended)requestAnimationFrame(animate);else loop=false;}
  video.addEventListener('play',()=>{if(!loop){loop=true;requestAnimationFrame(animate);}});
  for(const event of ['timeupdate','seeked','loadedmetadata','pause'])video.addEventListener(event,draw);
  window.addEventListener('resize',draw);toggle.onchange=draw;
  return {render(data,record,view,canEdit,rawURL){
   session=record;currentView=view;editable=canEdit;report=data;
   panel.hidden=!record;if(!record)return;
   el('shuttle-export').hidden=!rawURL;if(rawURL)el('shuttle-export').href=rawURL;
   const nextKey=record.id+'/'+record.run_id;
   if(key!==nextKey){key=nextKey;decisions=record.event_review?.decisions?.map(e=>({...e}))||[];toggle.checked=data?.status==='detected';el('shuttle-message').hidden=true;}
   paint();requestAnimationFrame(draw);
  }};
 }};
})(window);
