/* CourtIQ: local-only UI. Every metric comes from an actual completed run. */
const $ = id => document.getElementById(id);
let language = 'zh';
try { language = localStorage.getItem('courtiq.language') === 'en' ? 'en' : 'zh'; } catch {}
const t = (key, values) => window.CourtIQI18n.translate(key, language, values);
const locale = () => language === 'en' ? 'en-US' : 'zh-CN';
const paths = {
 play:'m8 5 11 7-11 7Z', plus:'M12 5v14M5 12h14', layers:'m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
 shield:'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7Zm-4 9 3 3 5-6',
 video:'M3 5h12v14H3Zm12 5 6-4v12l-6-4', film:'M3 3h18v18H3ZM7 3v18M17 3v18M3 8h4m10 0h4M3 16h4m10 0h4',
 court:'M4 2h16v20H4ZM4 12h16M4 7h16M4 17h16M12 2v5m0 10v5',
 upload:'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6', download:'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',
 close:'M6 6l12 12M6 18 18 6', arrow:'M4 12h16m-6-6 6 6-6 6', chart:'M3 3v18h18M7 15l4-5 4 3 6-8',
 terminal:'M3 4h18v16H3Zm4 5 3 3-3 3m6 0h4',
 shuttle:'M6 18a4 4 0 1 0 5 1L21 7 9 2 6 14m3-12 3 10m3-7 1 6M7 14l5 4M5 19l3 2',
 target:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-7v4m0 14v4M1 12h4m14 0h4',
 motion:'M3 18h18M5 13l4-7 4 4 6-7M17 3h3v3M4 8h2M2 11h3M10 14l3 2 6-5',
 area:'M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5M7 7h10v10H7Z',
 gauge:'M5 18a9 9 0 1 1 14 0M12 5v2M5 10l2 1m12-1-2 1m-5 5 4-6M8 20h8',
 city:'M2 21h20M4 21V9h7v12m0-18h9v18M6 12h2m-2 4h2m6-10h3m-3 4h3m-3 4h3m-3 4h3',
 info:'M12 8h.01M11 12h1v5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
 notes:'M5 3h14v18H5ZM8 7h8M8 11h8M8 15h5'
};
function icons(root=document) { root.querySelectorAll('i[data-icon]').forEach(i=>i.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[i.dataset.icon]||paths.chart}"/></svg>`); }
icons();
const escapeHTML = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let session=null, sessions=[], result=null, runtime=null, points=[], page='workspace', view='original', map='heatmap', tab='distribution', resultKey='', toastTimer;
const busy = ()=>session&&['queued','running'].includes(session.status);
const fileURL=name=>`/api/sessions/${session.id}/files/${name}`;
const player=()=> $('player-select').value;
const playerName=p=>{
 if(!session)return '';
 const name=p==='near'?session.near_name:session.far_name;
 return name===(p==='near'?'近端球员':'远端球员')?t(name):name;
};
const playerData=()=>result?.players[player()];
const statusNames={draft:'待分析',queued:'排队中',running:'分析中',completed:'已完成',failed:'需处理'};
const sessionTitle = s => s.is_example ? t('示例比赛') : s.title;

function translateStatic() {
 document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
 document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
 for (const attr of ['placeholder', 'aria-label', 'title', 'alt']) {
  document.querySelectorAll(`[data-i18n-${attr}]`).forEach(el => el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`))));
 }
 $('lang-zh').setAttribute('aria-pressed', String(language === 'zh'));
 $('lang-en').setAttribute('aria-pressed', String(language === 'en'));
 $('dialog-lang-zh').setAttribute('aria-pressed', String(language === 'zh'));
 $('dialog-lang-en').setAttribute('aria-pressed', String(language === 'en'));
 if (runtime) $('runtime-pill').textContent=t(runtime.ready?'模型与环境就绪':'环境需要处理');
 $('breadcrumb').textContent=t({workspace:'训练工作台',archive:'训练档案',research:'统计研究',city:'城市体育规划',system:'系统与来源'}[page]);
 const file=$('video-file').files[0];
 if(file) $('file-label').textContent=file.name;
}

function setLanguage(next) {
 if (next === language) return;
 const settingsOpen=!!result&&!$('setup-controls').hidden;
 const originalLog=$('log-text').textContent;
 language=next;
 try { localStorage.setItem('courtiq.language', language); } catch {}
 translateStatic();renderRecent();renderArchive();renderCity();renderSystem();renderSession();renderVideoDetails();window.CourtIQResearch?.translate();
 if(session?.run_id) $('log-text').textContent=originalLog;
 Array.from($('player-select').options).forEach(o=>o.textContent=playerName(o.value)||t(o.value==='near'?'近端球员':'远端球员'));
 if(settingsOpen){$('court-results').hidden=true;$('setup-controls').hidden=false;$('inspector-title').textContent=t('分析设置');}
 // Re-render labels only: video source, time, form input and analysis state stay intact.
 requestAnimationFrame(drawCharts);
}
$('lang-zh').onclick=()=>setLanguage('zh');
$('lang-en').onclick=()=>setLanguage('en');
$('dialog-lang-zh').onclick=()=>setLanguage('zh');
$('dialog-lang-en').onclick=()=>setLanguage('en');

async function api(path,options={}) {
 const response=await fetch(path,options);
 const data=await response.json();
 if (!response.ok) throw new Error(typeof data.detail==='string'?data.detail:t('输入无效，请检查参数。'));
 return data;
}
function jsonRequest(method,body) { return {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}; }
function toast(text) { $('toast').textContent=t(text);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000); }
function error(text) { $('error-banner').textContent=t(text);$('error-banner').hidden=!text; }
function setPage(value) {
 if(!['workspace','archive','research','city','system'].includes(value))value='workspace';
 page=value;
 for (const name of ['workspace','archive','research','city','system']) $(name+'-page').hidden=name!==value;
 history.replaceState(null,'',value==='workspace'?location.pathname:'#'+value);
 document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page===value));
 $('breadcrumb').textContent=t({workspace:'训练工作台',archive:'训练档案',research:'统计研究',city:'城市体育规划',system:'系统与来源'}[value]);
 if (value==='research') window.CourtIQResearch?.enter();
 if (value==='archive') renderArchive();
 if (value==='city') renderCity();
 if (value==='system') renderSystem();
 if(value==='workspace') requestAnimationFrame(drawCharts);
}
document.querySelectorAll('.nav').forEach(n=>n.onclick=()=>setPage(n.dataset.page));
$('open-research').onclick=()=>setPage('research');
window.addEventListener('hashchange',()=>setPage(location.hash.slice(1)));

function renderRecent() {
 $('session-count').textContent=sessions.length;
 $('recent-sessions').innerHTML=sessions.length?sessions.slice(0,12).map(s=>`<button class="recent-item ${s.id===session?.id?'selected':''}" data-id="${s.id}"><strong>${escapeHTML(sessionTitle(s))}</strong><small><span>${new Date(s.created_at).toLocaleDateString(locale(),{month:'2-digit',day:'2-digit'})}</span> · <span>${t(statusNames[s.status])}</span></small></button>`).join(''):`<p class="muted">${t('还没有训练记录')}</p>`;
 $('recent-sessions').querySelectorAll('[data-id]').forEach(n=>n.onclick=()=>choose(n.dataset.id));
}
function renderArchive() {
 const filtered=window.CourtIQPlanning.filterSessions(sessions.map(s=>({...s,title:sessionTitle(s)})),{query:$('archive-search').value,status:$('archive-status').value});
 $('archive-match-count').textContent=t('{count} 条记录',{count:filtered.length});
 $('archive-list').innerHTML=filtered.length?filtered.map(s=>`<button class="archive-row" data-id="${s.id}"><img src="/api/sessions/${s.id}/files/preview.jpg" alt="${t('视频预览')}" loading="lazy"><span><strong>${escapeHTML(sessionTitle(s))}</strong><small>${escapeHTML(s.is_example?t('公开示例'):s.venue||t('未填写场馆'))}</small></span><span class="muted">${new Date(s.created_at).toLocaleDateString(locale())}</span><span class="small-tag state-${s.status}">${t(statusNames[s.status])}</span><i data-icon="arrow"></i></button>`).join(''):`<div class="library-empty"><i data-icon="${sessions.length?'search':'video'}"></i><h3>${t(sessions.length?'未找到匹配训练':'还没有训练记录')}</h3><button class="button secondary" id="library-empty-action">${t(sessions.length?'清除筛选':'导入视频')}</button></div>`;
 $('archive-list').querySelectorAll('[data-id]').forEach(n=>n.onclick=()=>choose(n.dataset.id));
 if($('library-empty-action'))$('library-empty-action').onclick=()=>{
  if(!sessions.length)return openImport();
  $('archive-search').value='';$('archive-status').value='all';renderArchive();$('archive-search').focus();
 };
 icons($('archive-list'));
}
$('archive-search').oninput=renderArchive;
$('archive-status').onchange=renderArchive;
async function refreshList() { sessions=await api('/api/sessions');renderRecent();if(page==='archive')renderArchive();if(page==='city')renderCity();if(page==='research')window.CourtIQResearch?.sync(); }

function renderCity() {
 const summary=window.CourtIQPlanning.summarizeVenues(sessions);
 for(const [id,value] of [['venue',summary.venueCount],['training',summary.trainingCount],['completed',summary.completedCount],['reviewed',summary.reviewedCount]]){
  $('city-'+id+'-count').textContent=value;
 }
 $('city-sample-note').textContent=t('已排除 {count} 条公开样本',{count:summary.excludedExamples});
 if(!summary.venues.length){
  $('city-venues').innerHTML=`<div class="venue-empty"><div class="empty-symbol"><i data-icon="court"></i></div><h3>${t('暂无场馆记录')}</h3><button class="button secondary" id="first-venue-import"><i data-icon="plus"></i>${t('导入训练')}</button></div>`;
  $('first-venue-import').onclick=openVenueImport;
 }else{
  const headings=['球馆名称','训练记录','完成分析','复盘记录','最近训练日期',''];
  $('city-venues').innerHTML=`<div class="table-scroll"><table class="city-table venue-table"><thead><tr>${headings.map(key=>`<th>${key?t(key):''}</th>`).join('')}</tr></thead><tbody>${summary.venues.map(v=>`<tr><td><strong>${escapeHTML(v.name||t('未归属球馆'))}</strong></td><td class="numeric">${v.trainingCount}</td><td class="numeric">${v.completedCount}</td><td class="numeric">${v.reviewedCount}</td><td>${v.latestAt?escapeHTML(new Date(v.latestAt).toLocaleDateString(locale())):'—'}</td><td><button class="text-link venue-open" data-session="${escapeHTML(v.latestId)}">${t('查看最近训练')} ↗</button></td></tr>`).join('')}</tbody></table></div>`;
  $('city-venues').querySelectorAll('[data-session]').forEach(button=>button.onclick=()=>choose(button.dataset.session));
 }
 icons($('city-venues'));
}
async function choose(id) {
 try {
  session=await api(`/api/sessions/${id}`);result=null;resultKey='';points=session.calibration?session.calibration.map(p=>[...p]):[];
  $('coach-notes').value=session.notes||'';setPage('workspace');view=session.calibration?'original':'calibration';
  $('player-select').innerHTML=`<option value="near">${escapeHTML(playerName('near'))}</option><option value="far">${escapeHTML(playerName('far'))}</option>`;
  if(session.options){$('duration').value=session.options.seconds;$('shuttle').checked=session.options.shuttle;$('threshold').value=session.options.threshold;$('device').value=session.options.device;}
  renderSession();await loadResults();await loadLog();renderRecent();
 } catch(e){error(e.message);}
}

function renderSession() {
 const s=session;
 $('session-title').textContent=t('训练分析工作台');
 $('session-state').textContent=t(s?statusNames[s.status]:'未导入');
 $('video-empty').hidden=!!s;
 $('video-description').textContent=s?sessionTitle(s):t('等待导入');
 $('video-source').hidden=!s;$('video-source').textContent=t(s?.is_example?'示例':'本地');
 $('video-details').disabled=!s;
 $('step-import').classList.toggle('done',!!s);
 $('step-calibrate').classList.toggle('done',!!s?.calibration);
 $('step-calibrate').classList.toggle('current',!!s&&!s.calibration);
 $('step-analyze').classList.toggle('current',busy());
 $('step-analyze').classList.toggle('done',s?.status==='completed');
 $('stage-text').textContent=t(s?.stage||'尚未启动分析');
 error(s?.error||'');renderPoints();renderVideo();renderResults();
}
function renderVideo() {
 const s=session;const video=$('match-video');
 $('calibration-stage').hidden=!s||view!=='calibration';video.hidden=!s||view==='calibration';
 document.querySelectorAll('#video-tabs button').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.disabled=b.dataset.view==='analysis'&&s?.status!=='completed';});
 if(!s)return;
 if(view==='calibration') {
  video.pause();const url=fileURL('preview.jpg');
  if(!$('preview-image').src.endsWith(url))$('preview-image').src=url;
  requestAnimationFrame(drawCalibration);
 } else {
  const url=fileURL(view==='analysis'?'analysis.mp4':s.source_file);
  if(!video.src.endsWith(url)) {video.src=url;video.poster=fileURL('preview.jpg');video.load();}
 }
}
document.querySelectorAll('#video-tabs button').forEach(b=>b.onclick=()=>{view=b.dataset.view;renderVideo();});
function renderPoints() {
 const names=['左上','右上','右下','左下'];
 $('point-count').textContent=`${points.length} / 4`;
 $('point-list').innerHTML=names.map((n,i)=>`<div class="point ${points[i]?'filled':''}"><b>${i+1}</b>${t(n)}<em>${points[i]?`${Math.round(points[i][0])}, ${Math.round(points[i][1])}`:t('待选择')}</em></div>`).join('');
 $('reset-points').disabled=!session||busy();$('save-points').disabled=points.length!==4||busy();
 const saved=!!session?.calibration&&JSON.stringify(points)===JSON.stringify(session.calibration);
 $('run-button').disabled=!session||busy()||!saved||!runtime?.ready;
 $('run-button').innerHTML=busy()?'<i data-icon="layers"></i>'+escapeHTML(t(session.stage)):'<i data-icon="play"></i>'+t(session?.status==='completed'?'重新分析':'开始分析');icons($('run-button'));
 const hint=!runtime?.ready?'环境未就绪':!session?'请先导入视频':!saved?'请保存球场标定':'';
 $('run-status').textContent=t(hint);$('run-status').hidden=!hint;
}
function canvasContext(id) {
 const canvas=$(id),rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
 if(rect.width<1||rect.height<1)return null;
 canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
 const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.font='12px -apple-system, sans-serif';
 return {canvas,ctx,w:rect.width,h:rect.height};
}
function drawCalibration() {
 if(!session||view!=='calibration')return;
 const c=canvasContext('calibration-canvas');if(!c)return;
 const {ctx,w,h}=c,scaled=points.map(p=>[p[0]/session.video.width*w,p[1]/session.video.height*h]);
 if(scaled.length>1){ctx.beginPath();ctx.moveTo(...scaled[0]);scaled.slice(1).forEach(p=>ctx.lineTo(...p));if(scaled.length===4)ctx.closePath();ctx.strokeStyle='#2468eb';ctx.lineWidth=2;ctx.stroke();if(scaled.length===4){ctx.fillStyle='#2468eb1a';ctx.fill();}}
 scaled.forEach((p,i)=>{ctx.beginPath();ctx.arc(...p,11,0,Math.PI*2);ctx.fillStyle='#2468eb';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 11px sans-serif';ctx.fillText(i+1,...p);});
}
$('preview-image').onload=drawCalibration;
$('calibration-canvas').onclick=e=>{
 if(!session||busy()||points.length>=4)return;
 const r=e.currentTarget.getBoundingClientRect();
 points.push([Math.round((e.clientX-r.left)/r.width*session.video.width),Math.round((e.clientY-r.top)/r.height*session.video.height)]);
 drawCalibration();renderPoints();
};
$('reset-points').onclick=()=>{points=[];view='calibration';renderVideo();renderPoints();};
$('save-points').onclick=async()=>{try{session=await api(`/api/sessions/${session.id}/calibration`,jsonRequest('PUT',{points}));if(session.status!=='completed'){result=null;resultKey='';}renderSession();await refreshList();toast('球场标定已保存');}catch(e){error(e.message);}};
$('run-button').onclick=async()=>{
 try {
  session=await api(`/api/sessions/${session.id}/run`,jsonRequest('POST',{seconds:Number($('duration').value),shuttle:$('shuttle').checked,device:$('device').value,threshold:Number($('threshold').value)}));
  result=null;resultKey='';$('log-panel').open=true;view='original';renderSession();await refreshList();
 }catch(e){error(e.message);}
};
$('adjust-button').onclick=()=>{$('court-results').hidden=true;$('setup-controls').hidden=false;$('inspector-title').textContent=t('分析设置');renderPoints();};

async function loadResults() {
 if(!session||session.status!=='completed')return;
 const key=session.id+session.run_id;if(key===resultKey)return;
 result=await api(`/api/sessions/${session.id}/results`);resultKey=key;
 const keys=Object.keys(result.players);if(!keys.includes(player()))$('player-select').value=keys[0];
 Array.from($('player-select').options).forEach(o=>o.disabled=!keys.includes(o.value));
 renderResults();
}
function renderResults() {
 $('setup-controls').hidden=!!result;$('court-results').hidden=!result;$('inspector-title').textContent=t(result?'球场空间分析':'分析设置');
 $('export-links').hidden=!result;
 if(result){$('export-csv').href=fileURL('players.csv');$('export-chart').href=fileURL('analytics.png');$('export-video').href=fileURL('analysis.mp4');}
 const p=playerData();
 if(result){$('video-description').textContent=`${sessionTitle(session)} · ${t('分析片段')} ${result.analysis_duration_s?.toFixed(1)||session.options.seconds} s`;}
 const metric=(id,value,unit='')=>$(id).innerHTML=value===undefined||value===null?'—':`${value}<small>${unit}</small>`;
 metric('metric-observation',p?(p.observation_rate*100).toFixed(1):null,'%');
 metric('metric-distance',p?p.distance_m.toFixed(1):null,'m');metric('metric-hull',p?p.hull_area_m2.toFixed(1):null,'m²');
 metric('metric-speed',p?.mean_speed_mps?.toFixed(2),'m/s');
 renderAnalytics();requestAnimationFrame(drawCourt);
}
$('player-select').onchange=renderResults;
document.querySelectorAll('#court-tabs button').forEach(b=>b.onclick=()=>{map=b.dataset.map;document.querySelectorAll('#court-tabs button').forEach(x=>x.classList.toggle('active',x===b));drawCourt();});

function drawCourt() {
 const p=playerData();if(!p)return;
 const c=canvasContext('court-canvas');if(!c)return;
 const {ctx,w,h}=c,width=result.court.width_m,length=result.court.length_m;
 // Rotate only the display: CSV coordinates and statistics remain unchanged.
 const scale=Math.min((w-68)/length,(h-66)/width),cw=length*scale,ch=width*scale,ox=(w-cw)/2+8,oy=(h-ch)/2-9;
 const xy=(x,y)=>[ox+y*scale,oy+(width-x)*scale];
 ctx.fillStyle='#f6fcfe';ctx.fillRect(ox-14,oy-14,cw+28,ch+28);
 ctx.strokeStyle='#e6f0f8';ctx.lineWidth=.6;
 for(let d=0;d<=length;d+=.5){ctx.beginPath();ctx.moveTo(ox+d*scale,oy-12);ctx.lineTo(ox+d*scale,oy+ch+12);ctx.stroke();}
 for(let d=0;d<=width;d+=.5){ctx.beginPath();ctx.moveTo(ox-12,oy+d*scale);ctx.lineTo(ox+cw+12,oy+d*scale);ctx.stroke();}
 if(map==='heatmap'){
  const values=p.heatmap,max=Math.max(...values.flat(),1);
  values.forEach((row,y)=>row.forEach((n,x)=>{if(n>0){const intensity=Math.sqrt(n/max);ctx.fillStyle=`rgba(${Math.round(192-176*intensity)},${Math.round(232-63*intensity)},${Math.round(131+20*intensity)},${.35+.6*intensity})`;ctx.fillRect(ox+y*cw/26,oy+(11-x)*ch/12,cw/26+.3,ch/12+.3);}}));
 }else if(map==='hull'&&p.hull.length>=3){ctx.beginPath();p.hull.forEach((a,i)=>i?ctx.lineTo(...xy(...a)):ctx.moveTo(...xy(...a)));ctx.closePath();ctx.fillStyle='#10a99724';ctx.fill();ctx.strokeStyle='#10a997';ctx.lineWidth=1.8;ctx.stroke();}
 else if(map==='trajectory'){
  ctx.strokeStyle=player()==='near'?'#10a997':'#2468eb';ctx.lineWidth=1.6;ctx.beginPath();
  p.trajectory.forEach((a,i)=>{const prev=p.trajectory[i-1];if(!prev||a[1]-prev[1]>.3)ctx.moveTo(...xy(a[2],a[3]));else ctx.lineTo(...xy(a[2],a[3]));});ctx.stroke();
 }
 ctx.strokeStyle='#119f92';ctx.lineWidth=1.4;ctx.strokeRect(ox,oy,cw,ch);
 const line=(x1,y1,x2,y2)=>{ctx.beginPath();ctx.moveTo(...xy(x1,y1));ctx.lineTo(...xy(x2,y2));ctx.stroke();};
 line(0,6.7,6.1,6.7);line(0,4.72,6.1,4.72);line(0,8.68,6.1,8.68);line(.46,0,.46,13.4);line(5.64,0,5.64,13.4);line(3.05,0,3.05,4.72);line(3.05,8.68,3.05,13.4);
 ctx.fillStyle='#607d96';ctx.font='11px -apple-system,sans-serif';ctx.textAlign='center';
 ctx.fillText(t('远端'),ox+cw*.25,oy-9);ctx.fillText(t('近端'),ox+cw*.75,oy-9);
 for(const depth of [0,6.7,13.4])ctx.fillText(depth,ox+depth*scale,oy+ch+20);
 ctx.fillText(t('长度 (m)'),ox+cw/2,oy+ch+40);
 ctx.textAlign='right';for(const widthValue of [0,3.05,6.1])ctx.fillText(String(widthValue),ox-9,oy+(width-widthValue)*scale+4);
 const currentTime=$('match-video').currentTime||0;
 const position=p.trajectory.reduce((best,a)=>Math.abs(a[1]-currentTime)<Math.abs(best[1]-currentTime)?a:best,p.trajectory[0]);
 if(position&&Math.abs(position[1]-currentTime)<.3){const [x,y]=xy(position[2],position[3]);ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle='#2468eb';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();}
 $('map-label').textContent=t({heatmap:'观测位置频率',trajectory:'观测移动轨迹',hull:'观测位置包络'}[map]);
}
$('match-video').ontimeupdate=drawCourt;

const descriptions={distribution:['半场区域分布','前 / 中 / 后场均以球员所在半场和球网为参照；左右沿画面方向。'],transitions:['区域转移概率','相邻有效视频帧的经验频率，包含原地停留；未观测到的转移显示为 0。'],speed:['移动速度曲线','仅计算连续检测位置；缺帧与超过 8 m/s 的跳点不连线。']};
document.querySelectorAll('#analytics-tabs button').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderAnalytics();});
function renderAnalytics(){
 document.querySelectorAll('#analytics-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 $('analytics-empty').hidden=!!result||tab==='notes';$('chart-content').hidden=!result||!descriptions[tab];
 $('quality-content').hidden=!result||tab!=='quality';$('notes-content').hidden=tab!=='notes';$('save-notes').disabled=!session;
 if(result&&descriptions[tab]){const [title,desc]=descriptions[tab];$('chart-title').textContent=t(title);$('chart-title').title=t(desc);$('chart-player').textContent=playerName(player());requestAnimationFrame(drawStats);}
 if(result&&tab==='quality'){
  const p=playerData();
  const limits=['米制坐标来自手工四角标定，跳跃、遮挡与 ID 切换均可能影响结果。','不把光流预测、位置保持或跨缺帧插值当作真实观测。','凸包描述已出现的位置；平均位置不等于最佳回位。','8 m/s 是异常过滤参数；距离受定位抖动影响，需回看视频核查。','统计只覆盖本次分析的片段，不自动判断失分原因或训练质量。'];
  $('quality-content').innerHTML=`<div class="quality-grid"><div><h3>${t('观测质量')} · ${escapeHTML(playerName(player()))}</h3>${[['有效观测',p.valid_observations],['缺失 / 场外观测',p.missing_observations],['有效速度样本',p.valid_motion_pairs],['排除的速度样本对',p.rejected_motion_pairs]].map(([k,v])=>`<div class="quality-value">${t(k)}<b>${v}</b></div>`).join('')}</div><div><details class="method-details"><summary>${t('方法与指标定义')}</summary><ul>${Object.values(descriptions).map(([,desc])=>`<li>${t(desc)}</li>`).join('')}${limits.map(text=>`<li>${t(text)}</li>`).join('')}</ul></details><a class="text-link" href="${fileURL('manifest.json')}" download>${t('下载运行参数与方法说明')} ↗</a></div></div>`;
 }
}
function drawStats(){
 const p=playerData();if(!p||!descriptions[tab])return;
 const c=canvasContext('stats-canvas');if(!c)return;
 const {ctx,w,h}=c;ctx.font='12px -apple-system,sans-serif';
 const labels=['前场左','前场右','中场左','中场右','后场左','后场右'].map(key=>t(key));
 if(tab==='distribution'){
  const left=40,top=12,bottom=h-30,cw=(w-left-12)/6,total=p.zones.reduce((a,b)=>a+b,0),max=Math.max(...p.zones.map(v=>v/total*100),10);
  for(let i=0;i<4;i++){const y=bottom-(bottom-top)*i/3;ctx.strokeStyle='#e2edf5';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-8,y);ctx.stroke();ctx.fillStyle='#648098';ctx.textAlign='right';ctx.fillText(`${Math.round(max*i/3)}%`,left-8,y+3);}
  p.zones.forEach((n,i)=>{const value=n/total*100,bh=value/max*(bottom-top);const gradient=ctx.createLinearGradient(0,bottom-bh,0,bottom);gradient.addColorStop(0,player()==='near'?'#12bba5':'#4687f3');gradient.addColorStop(1,player()==='near'?'#0ea892':'#2468eb');ctx.fillStyle=gradient;ctx.fillRect(left+i*cw+cw*.25,bottom-bh,cw*.5,bh);ctx.fillStyle='#173a55';ctx.textAlign='center';ctx.fillText(value.toFixed(1)+'%',left+(i+.5)*cw,Math.max(10,bottom-bh-8));ctx.fillStyle='#648098';ctx.fillText(labels[i],left+(i+.5)*cw,h-9);});
 }else if(tab==='transitions'){
  const size=Math.min((w-110)/6,(h-27)/6),ox=Math.max(67,(w-size*6)/2),oy=5;
  p.transition_probabilities.forEach((row,y)=>row.forEach((v,x)=>{ctx.fillStyle=`rgba(16,169,151,${.06+.85*v})`;ctx.fillRect(ox+x*size+1,oy+y*size+1,size-2,size-2);ctx.fillStyle=v>.4?'#fff':'#4d7288';ctx.textAlign='center';ctx.font='11px monospace';ctx.fillText(v.toFixed(2),ox+(x+.5)*size,oy+(y+.57)*size);}));
  ctx.fillStyle='#648098';ctx.font='11px sans-serif';for(let i=0;i<6;i++){ctx.textAlign='right';ctx.fillText(labels[i],ox-9,oy+(i+.57)*size);ctx.textAlign='center';ctx.fillText(labels[i],ox+(i+.5)*size,oy+size*6+16);}
 }else{
  const data=p.speed_series,valid=data.filter(a=>a[1]!==null),max=Math.max(...valid.map(a=>a[1]),1),end=Math.max(...data.map(a=>a[0]),1),left=40,top=12,bottom=h-25;
  for(let i=0;i<4;i++){const y=bottom-(bottom-top)*i/3;ctx.strokeStyle='#e2edf5';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-10,y);ctx.stroke();ctx.textAlign='right';ctx.fillStyle='#648098';ctx.fillText((max*i/3).toFixed(1),left-8,y+3);}
  ctx.textAlign='left';ctx.fillText('m/s',5,10);ctx.textAlign='right';ctx.fillText(end.toFixed(1)+' s',w-10,h-4);ctx.textAlign='left';ctx.fillText('0 s',left,h-4);
  ctx.strokeStyle=player()==='near'?'#10a997':'#2468eb';ctx.lineWidth=1.8;ctx.beginPath();let open=false;
  data.forEach(([t,v])=>{if(v===null){open=false;return;}const x=left+t/end*(w-left-10),y=bottom-v/max*(bottom-top);if(open)ctx.lineTo(x,y);else ctx.moveTo(x,y);open=true;});ctx.stroke();
 }
}
function drawCharts(){drawCalibration();drawCourt();drawStats();window.CourtIQResearch?.draw();}
window.addEventListener('resize',()=>requestAnimationFrame(drawCharts));
$('save-notes').onclick=async()=>{if(!session)return;try{session=await api(`/api/sessions/${session.id}/notes`,jsonRequest('PUT',{notes:$('coach-notes').value}));toast('训练记录已保存');}catch(e){error(e.message);}};

function openImport(){$('import-dialog').showModal();}
function openVenueImport(){openImport();document.querySelector('input[name="venue"]').focus();}
$('city-import').onclick=openVenueImport;
['import-button','rail-import','empty-import'].forEach(id=>$(id).onclick=openImport);
$('close-dialog').onclick=()=>$('import-dialog').close();
$('video-file').onchange=()=>$('file-label').textContent=$('video-file').files[0]?.name||t('选择比赛或训练录像');
$('upload-form').onsubmit=e=>{
 e.preventDefault();const form=e.currentTarget,button=$('upload-submit'),data=new FormData(form);button.disabled=true;
 const xhr=new XMLHttpRequest();xhr.open('POST','/api/sessions');
 xhr.upload.onprogress=e=>{if(e.lengthComputable){$('upload-message').hidden=false;$('upload-message').textContent=t('正在导入到本机：{percent}%',{percent:Math.round(e.loaded/e.total*100)});}};
 xhr.onerror=()=>{button.disabled=false;$('upload-message').hidden=false;$('upload-message').textContent=t('导入失败，请确认本地服务正在运行。');};
 xhr.onload=async()=>{button.disabled=false;let data;try{data=JSON.parse(xhr.responseText);}catch{$('upload-message').hidden=false;$('upload-message').textContent=t('服务器响应无效。');return;}
  if(xhr.status>=400){$('upload-message').hidden=false;$('upload-message').textContent=t(data.detail||'导入失败');return;}
  $('import-dialog').close();form.reset();$('file-label').textContent=t('选择比赛或训练录像');$('upload-message').textContent='';$('upload-message').hidden=true;await refreshList();await choose(data.id);toast('视频已导入，请标定球场四角');
 };xhr.send(data);
};
$('example-button').onclick=async()=>{const b=$('example-button');b.disabled=true;try{const s=await api('/api/example',{method:'POST'});await refreshList();await choose(s.id);toast('已载入上游真实样本，请确认球场标定');}catch(e){error(e.message);}finally{b.disabled=false;}};
async function loadLog(){if(!session)return;const data=await api(`/api/sessions/${session.id}/log`);$('log-text').textContent=t(data.text);}

function renderVideoDetails(){
 if(!session)return;
 const s=session;
 const details=[['训练名称',sessionTitle(s)],['来源',t(s.is_example?'上游公开样本':'本地训练记录')],['文件',s.original_filename],['场馆 / 场地',s.venue||'—'],['分辨率',`${s.video.width} × ${s.video.height}`],['帧率',`${s.video.fps.toFixed(1)} fps`],['原片时长',`${s.video.duration_s.toFixed(1)} s`]];
 if(result)details.push(['分析片段',`0 – ${result.analysis_duration_s?.toFixed(1)||s.options.seconds} s`]);
 $('video-details-list').innerHTML=details.map(([key,value])=>`<div><dt>${t(key)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')+(s.is_example?`<div class="source-detail"><dt>${t('公开示例')}</dt><dd>${t('上游公开样本，非学生视频')}<a class="text-link" href="https://github.com/ychenfen/badminton-pipeline-repro" target="_blank" rel="noreferrer">badminton-pipeline-repro ↗</a></dd></div>`:'');
}
$('video-details').onclick=()=>{renderVideoDetails();$('details-dialog').showModal();};
$('close-details').onclick=()=>$('details-dialog').close();
function renderSystem(){
 if(!runtime)return;
 const row=(name,ok)=>`<div class="dependency-row"><span>${escapeHTML(name)}</span><span class="${ok?'ok':'missing'}">${t(ok?'已就绪':'未就绪')}</span></div>`;
 $('system-content').innerHTML=`<section><h2>${t('运行环境')}<span class="muted">Python ${escapeHTML(runtime.python)}</span></h2>${Object.entries(runtime.packages).map(([k,v])=>row(k,v)).join('')}${row('FFmpeg',runtime.ffmpeg)}</section><section><h2>${t('预训练模型')}</h2>${Object.entries(runtime.weights).map(([k,v])=>row(k,v)).join('')}</section><section><h2>${t('开源来源')}</h2>${runtime.sources.map(s=>`<a class="source-link" href="${s.url}" target="_blank" rel="noreferrer">${s.name} ↗</a>`).join('')}<details class="method-details"><summary>${t('集成说明')}</summary><p class="helper">${t('主系统增加真实球员轨迹 CSV 导出；统计模块适配第二个项目的区域、凸包与位置分布方法。原始代码与许可保存在 vendor，变更及方法见 THIRD_PARTY.md。')}</p></details></section>`;
}
async function boot(){
 const initialPage=location.hash.slice(1);
 translateStatic();
 try{runtime=await api('/api/status');$('runtime-pill').textContent=t(runtime.ready?'模型与环境就绪':'环境需要处理');$('runtime-pill').classList.toggle('ready',runtime.ready);await refreshList();renderSession();if(sessions.length)await choose(sessions[0].id);if(initialPage)setPage(initialPage);}catch(e){error(t('本地服务暂不可用：')+t(e.message));}
}
setInterval(async()=>{
 if(!session||!busy())return;
 try{const id=session.id;const latest=await api(`/api/sessions/${id}`);if(session?.id!==id)return;session=latest;renderPoints();$('stage-text').textContent=t(latest.stage);$('session-state').textContent=t(statusNames[latest.status]);await loadLog();if(!busy()){renderSession();await loadResults();await refreshList();if(session.status==='completed')toast('分析完成，可以查看视频与统计图');}}catch(e){error(e.message);}
},2500);
boot();
