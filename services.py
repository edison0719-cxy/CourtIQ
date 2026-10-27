"""Shared, real research calculations for local and Cloudflare execution."""
import csv
import hashlib
import json
import math
from datetime import datetime,timezone
from fastapi import HTTPException

def now():return datetime.now(timezone.utc).isoformat()

def file_sha256(path):
    with path.open('rb') as file:return hashlib.file_digest(file,'sha256').hexdigest()

def session_research_data(session,folder,player='near'):
    from research import session_statistics
    sid=session['id']
    manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
    summary=json.loads((folder/'summary.json').read_text(encoding='utf-8'))
    with (folder/'players.csv').open(newline='',encoding='utf-8') as f:
        try:
            report=session_statistics(csv.DictReader(f),player,manifest.get('calibration'),
                                      summary['court']['width_m'],summary['court']['length_m'])
        except ValueError as exc:
            raise HTTPException(400,str(exc)) from exc
    report['evaluation']=session.get('evaluations',{}).get(player)
    report['source']={'session_id':sid,'run_id':session['run_id'],'title':session['title'],
                      'is_example':session.get('is_example',False),'source_sha256':session.get('source_sha256'),
                      'player_name':session.get(player+'_name',player),
                      'trajectory_sha256':file_sha256(folder/'players.csv'),
                      'manifest':manifest}
    return report

def make_evaluation(session,body):
    from research import outcome_statistics
    if not body.task.strip():raise HTTPException(400,'请填写训练任务名称。')
    if not math.isfinite(body.end_s) or not 0 <= body.start_s < body.end_s <= session['video']['duration_s']:
        raise HTTPException(400,'记录区间必须位于原始视频范围内。')
    if body.review_time_s is not None and not math.isfinite(body.review_time_s):
        raise HTTPException(400,'复盘耗时必须是有效秒数。')
    try:statistics=outcome_statistics(body.successes,body.attempts)
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc
    evaluation={**body.model_dump(),'task':body.task.strip(),'annotation_source':'manual','updated_at':now(),**statistics}
    return evaluation

def compare_training_records(body,read_artifacts):
    from research import METRICS,compare_values
    records,seen_ids,seen_hashes,seen_sources=[],set(),set(),set()
    for selection in body.selections:
        if selection.session_id in seen_ids:
            raise HTTPException(400,'同一训练记录只能计入一次。')
        seen_ids.add(selection.session_id)
        session,folder=read_artifacts(selection.session_id)
        if session.get('is_example'):
            raise HTTPException(400,'组间研究请使用真实训练记录，公开示例不计入样本。')
        source_hash=session.get('source_sha256')
        if not source_hash:
            source=folder.parent.parent/session.get('source_file','source.mp4')
            if not source.is_file():raise HTTPException(400,'无法核验原始录像，请重新导入训练记录。')
            source_hash=file_sha256(source)
        if source_hash in seen_sources:
            raise HTTPException(400,'同一原始录像不能重复计入训练样本。')
        seen_sources.add(source_hash)
        digest=file_sha256(folder/'players.csv')
        if digest in seen_hashes:
            raise HTTPException(400,'检测到重复轨迹，不能作为独立训练重复计数。')
        seen_hashes.add(digest)
        summary=json.loads((folder/'summary.json').read_text(encoding='utf-8'))
        data=summary['players'].get(selection.player)
        if not data:
            raise HTTPException(400,'所选球员没有有效观测。')
        metric=body.metric
        evaluation=session.get('evaluations',{}).get(selection.player)
        if metric in {'success_rate','review_time_s'}:
            value=evaluation.get(metric) if evaluation else None
            if metric=='success_rate' and value is not None:value*=100
        elif metric=='distance_per_minute':
            value=data['distance_m']/summary['analysis_duration_s']*60 if summary['analysis_duration_s']>0 else None
        else:
            value=data.get(metric)
            if metric=='observation_rate' and value is not None:value*=100
        if value is None or not math.isfinite(value):
            raise HTTPException(400,'所选训练没有可用于比较的指标。')
        records.append({'session_id':session['id'],'run_id':session['run_id'],'title':session['title'],
                        'player':selection.player,'player_name':session.get(selection.player+'_name',''),
                        'group':selection.group,'pair':selection.pair.strip(),'value':value,
                        'analysis_duration_s':summary['analysis_duration_s'],
                        'observation_rate':data['observation_rate'],'trajectory_sha256':digest,'source_sha256':source_hash,
                        'evaluation':evaluation if metric in {'success_rate','review_time_s'} else None})
    if body.metric in {'success_rate','review_time_s'} and len({r['evaluation']['task'].strip().casefold() for r in records})>1:
        raise HTTPException(400,'专项指标比较需使用相同任务名称。')
    groups={key:[r for r in records if r['group']==key] for key in ('A','B')}
    if not all(groups.values()):raise HTTPException(400,'请分别选择 A 组和 B 组训练。')
    if body.design=='paired':
        pairs={}
        for record in records:
            if not record['pair']:raise HTTPException(400,'配对比较需要为每条训练填写配对编号。')
            pair=pairs.setdefault(record['pair'],{})
            if record['group'] in pair:raise HTTPException(400,'每个配对编号需要且只能包含一条 A 组和一条 B 组训练。')
            pair[record['group']]=record
        if any(set(pair)!= {'A','B'} for pair in pairs.values()):
            raise HTTPException(400,'每个配对编号需要且只能包含一条 A 组和一条 B 组训练。')
        groups={key:[pair[key] for _,pair in sorted(pairs.items())] for key in ('A','B')}
    report=compare_values([r['value'] for r in groups['A']],[r['value'] for r in groups['B']],body.design)
    if any(r['observation_rate']<.8 for r in records):report['flags'].append('incomplete_observation')
    report.update(schema_version=1,metric=body.metric,unit=METRICS[body.metric],records=records,
                  method={'difference':'B minus A; each unit is one selected player in one training recording.',
                          'interval':'Paired t interval of within-pair differences' if body.design=='paired' else 'Welch unequal-variance t interval',
                          'assumptions':'Independent pairs or recordings; representative sampling and comparable tasks. Repeated frames are not samples. Observational comparisons do not establish intervention effects.',
                          'effect':'Mean paired difference divided by its sample SD' if body.design=='paired' else 'P(B>A)-P(B<A), Cliff delta',
                          'p_value':'Two-sided, unadjusted; exploratory when inspecting multiple outcomes.',
                          'reference':'https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_rel.html' if body.design=='paired' else 'https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_ind.html'})
    return report
