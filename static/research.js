/* Statistical workspace. Results always come from saved runs through the local API. */
(() => {
 let report=null, comparison=null, mode='single', reportRequest=0, studyRequest=0, calculating=false, comparing=false, sourceRequest=0, pendingKey='', settings={};
 try { const saved=JSON.parse(localStorage.getItem('courtiq.research')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))settings=saved; } catch {}
 settings.selections ||= {};
 const save=()=>{try{localStorage.setItem('courtiq.research',JSON.stringify(settings));}catch{}};
 const complete=()=>sessions.filter(s=>s.status==='completed');
 const training=()=>complete().filter(s=>!s.is_example);
 const nameFor=(s,p)=>{const value=s?.[p+'_name']|| (p==='near'?'近端球员':'远端球员');return ['近端球员','远端球员'].includes(value)?t(value):value;};
 const number=(value,digits=2)=>Number.isFinite(value)?value.toFixed(digits):'—';
 const scaled=value=>Number.isFinite(value)?value*100:null;
 const range=(value,digits=2)=>value?value.map(v=>number(v,digits)).join(' – '):'—';
 const value=(id,v,unit='',digits=2)=>$(id).innerHTML=`${number(v,digits)}${Number.isFinite(v)?`<small>${escapeHTML(unit)}</small>`:''}`;
 const showError=message=>{$('research-error').textContent=t(message);$('research-error').hidden=!message;};
 const flags={short_clip:'短片统计',incomplete_observation:'观测存在缺失',no_motion_pairs:'无有效运动样本',small_sample:'小样本',constant_data:'样本方差不足',insufficient_groups:'缺少比较组'};
 const table=(headings,rows)=>`<table class="city-table research-table"><thead><tr>${headings.map(h=>`<th>${t(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${escapeHTML(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 function buttons(){
  const ready=mode==='single'?!!report&&!calculating:!!comparison&&!comparing;
  $('research-export-csv').disabled=!ready;$('research-export-json').disabled=!ready;
  const groups=selected();
  $('study-run').disabled=comparing||!groups.some(s=>s.group==='A')||!groups.some(s=>s.group==='B');
 }
 function sources(){
  const records=complete(), previous=$('research-session').value;
  const selectedId=records.some(s=>s.id===previous)?previous:records.some(s=>s.id===session?.id)?session.id:records[0]?.id;
  $('research-session').innerHTML=records.map(s=>`<option value="${s.id}">${escapeHTML(sessionTitle(s))}</option>`).join('');
  if(selectedId)$('research-session').value=selectedId;
  const current=records.find(s=>s.id===selectedId);
  for(const option of $('research-player').options)option.disabled=showcase&&!!current&&!current.players.includes(option.value);
  if(showcase&&current&&!current.players.includes($('research-player').value))$('research-player').value=current.players[0];
  const key=current?`${current.id}:${current.run_id}:${$('research-player').value}`:'';
  if(report&&`${report.source.session_id}:${report.source.run_id}:${report.player}`!==key){report=null;$('research-results').hidden=true;}
  if(calculating&&pendingKey!==key){++reportRequest;calculating=false;pendingKey='';}
  if(!current){report=null;$('research-results').hidden=true;}
  for(const option of $('research-player').options)option.textContent=nameFor(current,option.value);
  $('research-source').textContent=current?t(current.is_example?'公开示例':'本地训练记录'):'';
  $('research-calculate').disabled=!current||calculating;
  $('research-empty').hidden=!!current;
  if(!current)$('research-results').hidden=true;
 }
 async function calculate(){
  const id=$('research-session').value,p=$('research-player').value;
  if(!id)return;
  const token=++reportRequest;pendingKey=`${id}:${complete().find(s=>s.id===id)?.run_id}:${p}`;report=null;calculating=true;showError('');$('research-results').hidden=true;sources();buttons();
  try {
   const data=await readStatistics(id,p);
   if(token!==reportRequest)return;
   report=data;populateEvaluation();renderSingle();
  }catch(e){if(token===reportRequest)showError(e.message);}
  finally{if(token===reportRequest){calculating=false;sources();buttons();}}
 }
 function renderSingle(){
  if(!report)return;
  const r=report;$('research-results').hidden=false;
  value('research-p50',r.speed_quantiles.p50,'m/s');value('research-p90',r.speed_quantiles.p90,'m/s');value('research-entropy',r.zone_entropy_bits,'bits');
  const standard=r.block_bootstrap.find(b=>b.block_seconds===1);
  $('research-mean-ci').innerHTML=`${range(standard?.ci95)}<small>m/s</small>`;
  $('research-scope').textContent=`${r.analysis_duration_s.toFixed(1)} s · ${t('有效观测')} ${r.valid_observations}/${r.source_frames} · ${t('均速')} ${number(r.mean_speed_mps)} m/s`;
  $('research-flags').textContent=r.flags.map(key=>t(flags[key])).join(' · ');
  $('research-speed-n').textContent=`n = ${r.motion_pairs}`;
  $('research-block-table').innerHTML=table(['块长','有效块数','均速','95% CI (m/s)'],r.block_bootstrap.map(b=>[`${b.block_seconds} s`,b.blocks,number(b.estimate),range(b.ci95)]));
  $('research-calibration-table').innerHTML=table(['四角 σ','平均位移','P95 位移','区域变化'],r.calibration_sensitivity.map(c=>[`${c.sigma_px} px`,`${number(scaled(c.mean_displacement_m),1)} cm`,`${number(scaled(c.displacement_p95_m),1)} cm`,`${number(scaled(c.zone_change_rate),1)}%`]));
  $('research-threshold-table').innerHTML=table(['速度上限','观测距离','平均速度','有效样本对'],r.threshold_sensitivity.map(s=>[`${s.speed_limit_mps} m/s`,`${number(s.distance_m)} m`,`${number(s.mean_speed_mps)} m/s`,s.motion_pairs]));
  renderEvaluation();requestAnimationFrame(draw);
 }
 function draw(){
  if(!report||mode!=='single'||page!=='research')return;
  const canvas=canvasContext('research-histogram');if(!canvas)return;
  const {ctx,w,h}=canvas, {counts,edges}=report.histogram;
  const left=40,right=w-16,top=20,bottom=h-30,max=Math.max(...counts,1);
  ctx.font='11px -apple-system,sans-serif';
  for(let i=0;i<=3;i++){
   const y=bottom-(bottom-top)*i/3;ctx.strokeStyle='#e2edf5';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle='#6a879e';ctx.textAlign='right';ctx.fillText(String(Math.round(max*i/3)),left-8,y+4);
  }
  const bar=(right-left)/counts.length;
  counts.forEach((count,i)=>{const height=count/max*(bottom-top);ctx.fillStyle=edges[i]>=report.speed_quantiles.p90?'#10a997':'#4b89ef';ctx.fillRect(left+i*bar+2,bottom-height,Math.max(1,bar-4),height);});
  for(const speed of [0,2,4,6,8]){ctx.fillStyle='#6a879e';ctx.textAlign='center';ctx.fillText(String(speed),left+speed/8*(right-left),h-10);}
  ctx.textAlign='right';ctx.fillText('m/s',right,12);
  if(Number.isFinite(report.speed_quantiles.p50)){
   const x=left+report.speed_quantiles.p50/8*(right-left);ctx.setLineDash([4,4]);ctx.strokeStyle='#153c63';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.setLineDash([]);ctx.textAlign='left';ctx.fillStyle='#355675';ctx.fillText(`P50 ${number(report.speed_quantiles.p50)}`,Math.min(x+6,right-72),12);
  }
 }
 function selected(){
  return training().flatMap(s=>{const choice=settings.selections[s.id];return choice&&['A','B'].includes(choice.group)?[{session_id:s.id,player:choice.player==='far'?'far':'near',group:choice.group,pair:String(choice.pair||'')}]:[];});
 }
 function invalidateStudy(){comparison=null;++studyRequest;comparing=false;$('study-results').hidden=true;showError('');buttons();}
 function comparisonIsCurrent(data){
  const records=training();
  return data.records.every(r=>{const current=records.find(s=>s.id===r.session_id);return current&&current.run_id===r.run_id&&(!r.evaluation||current.evaluations?.[r.player]?.updated_at===r.evaluation.updated_at);});
 }
 function renderStudy(){
  if(showcase)return;
  const records=training(),paired=$('study-design').value==='paired';
  if(comparison&&!comparisonIsCurrent(comparison))invalidateStudy();
  if(!records.length){
   $('study-records').innerHTML=`<div class="library-empty"><i data-icon="layers"></i><h3>${t('导入真实训练，建立比较组')}</h3><button class="button secondary" id="study-import">${t('导入训练')}</button></div>`;
   $('study-import').onclick=openImport;
  }else{
   $('study-records').innerHTML=`<div class="table-scroll"><table class="city-table study-table"><thead><tr>${['训练记录','分析球员','组别',...(paired?['配对编号']:[])].map(h=>`<th>${t(h)}</th>`).join('')}</tr></thead><tbody>${records.map(s=>{
    const choice=settings.selections[s.id]||{};
    return `<tr data-study-session="${s.id}"><td><strong>${escapeHTML(s.title)}</strong><small>${escapeHTML(s.venue||t('未填写场馆'))} · ${new Date(s.created_at).toLocaleDateString(locale())}</small>${['success_rate','review_time_s'].includes($('study-metric').value)&&s.evaluations?.[choice.player||'near']?.[$('study-metric').value]==null?`<button class="text-link outcome-link" data-add-outcome="${s.id}">${t('补充成绩')}</button>`:''}</td><td><select data-study-field="player" aria-label="${escapeHTML(t('分析球员')+' · '+s.title)}">${['near','far'].map(p=>`<option value="${p}" ${choice.player===p?'selected':''}>${escapeHTML(nameFor(s,p))}</option>`).join('')}</select></td><td><select data-study-field="group" aria-label="${escapeHTML(t('组别')+' · '+s.title)}">${[['','不纳入'],['A','A 组'],['B','B 组']].map(([key,label])=>`<option value="${key}" ${choice.group===key?'selected':''}>${t(label)}</option>`).join('')}</select></td>${paired?`<td><input data-study-field="pair" maxlength="60" value="${escapeHTML(choice.pair||'')}" placeholder="${t('例如：第 1 对')}" aria-label="${escapeHTML(t('配对编号')+' · '+s.title)}"></td>`:''}</tr>`;
   }).join('')}</tbody></table></div>`;
   $('study-records').querySelectorAll('[data-study-field]').forEach(input=>input.addEventListener(input.tagName==='INPUT'?'input':'change',()=>{
    const id=input.closest('[data-study-session]').dataset.studySession;
    settings.selections[id] ||= {};settings.selections[id][input.dataset.studyField]=input.value;save();invalidateStudy();
   }));
  }
  $('study-records').querySelectorAll('[data-add-outcome]').forEach(button=>button.onclick=async()=>{
   $('research-session').value=button.dataset.addOutcome;$('research-player').value=settings.selections[button.dataset.addOutcome]?.player||'near';setMode('single');await calculate();$('research-evaluation-panel').open=true;$('evaluation-task').focus();
  });
  icons($('study-records'));buttons();
 }
 async function compare(){
  const token=++studyRequest;comparing=true;comparison=null;$('study-results').hidden=true;showError('');buttons();
  try{
   const data=await api('/api/research/compare',jsonRequest('POST',{metric:$('study-metric').value,design:$('study-design').value,selections:selected()}));
   if(token!==studyRequest)return;
   if(!comparisonIsCurrent(data)){showError('训练记录已更新，请重新运行比较。');return;}
   comparison=data;renderComparison();
  }catch(e){if(token===studyRequest)showError(e.message);}
  finally{if(token===studyRequest){comparing=false;buttons();}}
 }
 function renderComparison(){
  if(!comparison)return;
  const c=comparison;$('study-results').hidden=false;
  $('study-n').textContent=`${c.n_a} / ${c.n_b}`;value('study-difference',c.difference,c.unit);$('study-ci').innerHTML=`${range(c.ci95)}<small>${escapeHTML(c.unit)}</small>`;
  $('study-effect-label').textContent=c.effect_name==='paired_dz'?'Cohen’s dz':'Cliff’s δ';value('study-effect',c.effect);
  $('study-summary').innerHTML=table(['组别','样本量','平均值'],[['A',c.n_a,`${number(c.mean_a)} ${c.unit}`],['B',c.n_b,`${number(c.mean_b)} ${c.unit}`]])+`<div class="study-inference"><span>p = ${number(c.p_value,4)}</span><span>${c.flags.map(key=>t(flags[key])).join(' · ')}</span></div>`;
 }
 function setMode(next){
  mode=next;$('research-single').hidden=next!=='single';$('research-cohort').hidden=next!=='cohort';
  document.querySelectorAll('[data-research-view]').forEach(button=>button.classList.toggle('active',button.dataset.researchView===next));
  showError('');buttons();requestAnimationFrame(draw);
 }
 function download(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const csvCell=value=>`"${String(typeof value==='string'&&/^[=+\-@\t\r]/.test(value)?"'"+value:value??'').replace(/"/g,'""')}"`;
 const csv=rows=>'\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
 function exportSingle(){
  if(!report)return;
  const r=report,source=[r.source.session_id,r.source.run_id,r.player];
  const rows=[['section','metric','value','unit','session_id','run_id','player']];
  const add=(section,key,v,unit)=>rows.push([section,key,v,unit,...source]);
  for(const [key,unit] of [['analysis_duration_s','s'],['valid_observations','frames'],['motion_pairs','pairs'],['observation_rate','ratio'],['distance_m','m'],['mean_speed_mps','m/s'],['zone_entropy_bits','bits']])add('summary',key,r[key],unit);
  for(const [key,v] of Object.entries(r.speed_quantiles))add('speed_quantile',key,v,'m/s');
  for(const block of r.block_bootstrap){add('bootstrap',`block_${block.block_seconds}s_n`,block.blocks,'blocks');add('bootstrap',`block_${block.block_seconds}s_ci_low`,block.ci95?.[0],'m/s');add('bootstrap',`block_${block.block_seconds}s_ci_high`,block.ci95?.[1],'m/s');}
  for(const row of r.calibration_sensitivity)for(const key of ['mean_displacement_m','displacement_p95_m','zone_change_rate'])add('calibration',`sigma_${row.sigma_px}px_${key}`,row[key],key.endsWith('_m')?'m':'ratio');
  for(const row of r.threshold_sensitivity)add('threshold',`limit_${row.speed_limit_mps}_distance`,row.distance_m,'m');
  if(r.evaluation){add('manual','attempts',r.evaluation.attempts,'attempts');add('manual','successes',r.evaluation.successes,'attempts');add('manual','success_rate',r.evaluation.success_rate,'ratio');add('manual','wilson_ci_low',r.evaluation.ci95[0],'ratio');add('manual','wilson_ci_high',r.evaluation.ci95[1],'ratio');add('manual','review_time_s',r.evaluation.review_time_s,'s');}
  download(`courtiq-statistics-${r.player}.csv`,csv(rows),'text/csv;charset=utf-8');
 }
 function populateEvaluation(){
  const e=report?.evaluation;
  for(const [field,key] of [['task','task'],['attempts','attempts'],['successes','successes'],['start','start_s'],['end','end_s'],['review','review_time_s']]){
   $('evaluation-'+field).value=e?.[key]??(field==='start'?0:field==='end'?Math.floor(report.analysis_duration_s*10)/10:'');
  }
 }
 function renderEvaluation(){
  const e=report?.evaluation;$('evaluation-result').hidden=!e;
  if(e)$('evaluation-result').innerHTML=`<strong>${number(e.success_rate*100,1)}%</strong><span>${e.successes}/${e.attempts} · Wilson 95% CI ${range(e.ci95.map(v=>v*100),1)}%</span>`;
 }
 $('evaluation-form').onsubmit=async event=>{
  event.preventDefault();if(!report)return;
  const id=report.source.session_id, p=report.player, source=report, button=$('evaluation-save');button.disabled=true;showError('');
  const body={player:p,task:$('evaluation-task').value,attempts:Number($('evaluation-attempts').value),successes:Number($('evaluation-successes').value),start_s:Number($('evaluation-start').value),end_s:Number($('evaluation-end').value),review_time_s:$('evaluation-review').value===''?null:Number($('evaluation-review').value)};
  try{
   const evaluation=await api(`/api/sessions/${id}/evaluation`,jsonRequest('PUT',body));
   if(report===source){report.evaluation=evaluation;renderEvaluation();}
   const record=sessions.find(s=>s.id===id);if(record){record.evaluations ||= {};record.evaluations[p]=evaluation;}
   invalidateStudy();renderStudy();toast('人工评估已保存');
  }catch(e){showError(e.message);}finally{button.disabled=false;}
 };
 function exportComparison(){
  if(!comparison)return;
  const c=comparison,rows=[['record_type','metric','group','pair','session_id','run_id','player','value','unit','analysis_seconds','observation_rate','task','evaluation_start_s','evaluation_end_s']];
  c.records.forEach(r=>rows.push(['training',c.metric,r.group,r.pair,r.session_id,r.run_id,r.player,r.value,c.unit,r.analysis_duration_s,r.observation_rate,r.evaluation?.task,r.evaluation?.start_s,r.evaluation?.end_s]));
  for(const [key,v] of [['mean_a',c.mean_a],['mean_b',c.mean_b],['difference',c.difference],['ci95_low',c.ci95?.[0]],['ci95_high',c.ci95?.[1]],['effect',c.effect],['p_value',c.p_value]])rows.push(['summary',c.metric,key,'','','','',v,['effect','p_value'].includes(key)?'':c.unit,'','','','','']);
  download('courtiq-study.csv',csv(rows),'text/csv;charset=utf-8');
 }
 $('research-export-csv').onclick=()=>mode==='single'?exportSingle():exportComparison();
 $('study-export').onclick=exportComparison;
 $('research-export-json').onclick=()=>{const data=mode==='single'?report:comparison;if(data)download('courtiq-research.json',JSON.stringify({...data,research_question:$('research-question').value},null,2),'application/json');};
 $('research-session').onchange=calculate;$('research-player').onchange=calculate;$('research-calculate').onclick=calculate;
 $('study-run').onclick=compare;
 for(const key of ['design','metric']){
  if(settings[key]&&Array.from($('study-'+key).options).some(o=>o.value===settings[key]))$('study-'+key).value=settings[key];
  $('study-'+key).onchange=()=>{settings[key]=$('study-'+key).value;save();invalidateStudy();renderStudy();};
 }
 $('research-question').value=settings.question??t('标定误差与时间相关性如何影响训练指标？');
 $('research-question').oninput=()=>{settings.question=$('research-question').value;save();};
 $('research-import').onclick=openImport;
 document.querySelectorAll('[data-research-view]').forEach(button=>button.onclick=()=>setMode(button.dataset.researchView));
 function sync(){
  ++sourceRequest;sources();renderStudy();if(!$('research-session').value)return;
  const current=complete().find(s=>s.id===$('research-session').value);
  if(report?.source.session_id===current.id&&report.source.run_id===current.run_id){renderSingle();buttons();}else if(!calculating)calculate();
 }
 window.CourtIQResearch={
  async enter(){const token=++sourceRequest;try{const records=await readSessions();if(token!==sourceRequest)return;sessions=records;renderRecent();sync();}catch(e){if(token===sourceRequest)showError(e.message);}},
  sync,
  translate(){sources();renderStudy();renderSingle();renderComparison();if(settings.question===undefined)$('research-question').value=t('标定误差与时间相关性如何影响训练指标？');buttons();},
  draw,
 };
})();
