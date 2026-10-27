import csv
import json
import tempfile
import unittest
from pathlib import Path


class ResearchApiTests(unittest.TestCase):
    def setUp(self):
        import app as application
        from fastapi.testclient import TestClient
        self.application=application
        self.temp=tempfile.TemporaryDirectory()
        self.previous=application.SESSIONS
        application.SESSIONS=Path(self.temp.name)/'sessions'
        self.client=TestClient(application.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None,None,None)
        self.application.SESSIONS=self.previous
        self.temp.cleanup()

    def record(self, number, speed=1, example=False):
        from analysis import summarize
        sid=f'{number:032x}';run_id='a'*32
        folder=self.application.SESSIONS/sid/'runs'/run_id
        folder.mkdir(parents=True)
        rows=[dict(frame=i,time_s=i/10,player='near',x_m=1+speed*i/10,y_m=9,observed=1) for i in range(11)]
        with (folder/'players.csv').open('w',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=rows[0]);writer.writeheader();writer.writerows(rows)
        (folder.parent.parent/'source.mp4').write_bytes(b'test-recording-'+sid.encode())
        (folder/'summary.json').write_text(json.dumps(summarize(rows)))
        (folder/'manifest.json').write_text(json.dumps({'calibration':[[20,20],[120,20],[120,120],[20,120]],'options':{'seconds':1}}))
        self.application.save_session({'id':sid,'run_id':run_id,'status':'completed','title':'Test fixture',
                                      'original_filename':'fixture.mp4','source_file':'source.mp4','is_example':example,'near_name':'Athlete',
                                      'far_name':'Other','video':{'duration_s':1.1},'created_at':'2026-01-01T00:00:00Z'})
        return sid

    def test_statistics_uses_saved_run_and_exports_finite_provenance(self):
        sid=self.record(1)
        response=self.client.get(f'/api/sessions/{sid}/statistics?player=near')
        self.assertEqual(response.status_code,200,response.text)
        data=response.json()
        self.assertEqual(data['source']['run_id'],'a'*32)
        self.assertEqual(data['source']['session_id'],sid)
        self.assertEqual(data['source_frames'],11)
        self.assertAlmostEqual(data['mean_speed_mps'],1)
        self.assertEqual(self.client.get(f'/api/sessions/{sid}/statistics?player=far').status_code,400)
        self.assertEqual(self.client.get(f'/api/sessions/{sid}/statistics?player=anything').status_code,422)

    def test_manual_outcomes_validate_counts_and_feed_study_comparisons(self):
        a=self.record(20,1);b=self.record(21,2)
        endpoint=lambda sid:f'/api/sessions/{sid}/evaluation'
        body={'task':'Back court targets','attempts':20,'successes':10,'start_s':0,'end_s':1,'review_time_s':25}
        self.assertEqual(self.client.put(endpoint(a),json={**body,'successes':21}).status_code,400)
        self.assertEqual(self.client.put(endpoint(a),json={**body,'end_s':2}).status_code,400)
        response=self.client.put(endpoint(a),json=body)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['annotation_source'],'manual')
        self.assertEqual(response.json()['success_rate'],.5)
        self.client.put(endpoint(b),json={**body,'successes':15,'review_time_s':18})
        selections=[{'session_id':a,'group':'A','pair':'one'},{'session_id':b,'group':'B','pair':'one'}]
        response=self.client.post('/api/research/compare',json={'metric':'success_rate','design':'paired','selections':selections})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['difference'],25)
        self.assertEqual(response.json()['unit'],'%')
        response=self.client.get(f'/api/sessions/{a}/statistics?player=near')
        self.assertEqual(response.json()['evaluation']['attempts'],20)

    def test_comparison_rejects_duplicate_units_and_public_samples(self):
        sid=self.record(2);other=self.record(3);demo=self.record(4,example=True)
        row=lambda key,group:{'session_id':key,'group':group,'player':'near'}
        for rows in [[row(sid,'A'),row(sid,'B')],[row(sid,'A'),row(other,'B')],[row(sid,'A'),row(demo,'B')]]:
            response=self.client.post('/api/research/compare',json={'metric':'mean_speed_mps','design':'independent','selections':rows})
            self.assertEqual(response.status_code,400,response.text)

    def test_same_source_with_different_analyses_cannot_be_counted_twice(self):
        a=self.record(30,1);b=self.record(31,2)
        first=self.application.SESSIONS/a/'source.mp4';second=self.application.SESSIONS/b/'source.mp4'
        first.write_bytes(b'same-test-recording');second.write_bytes(first.read_bytes())
        self.application.update_session(a,source_file='source.mp4')
        self.application.update_session(b,source_file='source.mp4')
        selections=[{'session_id':a,'group':'A'},{'session_id':b,'group':'B'}]
        response=self.client.post('/api/research/compare',json={'metric':'mean_speed_mps','design':'independent','selections':selections})
        self.assertEqual(response.status_code,400,response.text)

    def test_paired_rows_are_matched_by_pair_id_and_return_raw_units(self):
        a=self.record(10,1);b=self.record(11,2);c=self.record(12,1.5);d=self.record(13,2.8)
        rows=[{'session_id':key,'group':group,'player':'near','pair':pair}
              for key,group,pair in [(a,'A','one'),(d,'B','two'),(b,'B','one'),(c,'A','two')]]
        response=self.client.post('/api/research/compare',json={'metric':'mean_speed_mps','design':'paired','selections':rows})
        self.assertEqual(response.status_code,200,response.text)
        data=response.json()
        self.assertEqual(data['n_a'],2)
        self.assertAlmostEqual(data['difference'],1.15)
        self.assertEqual(len(data['records']),4)
        self.assertEqual(data['unit'],'m/s')
        rows[-1]['pair']='unmatched'
        response=self.client.post('/api/research/compare',json={'metric':'mean_speed_mps','design':'paired','selections':rows})
        self.assertEqual(response.status_code,400)
        self.assertEqual(self.client.post('/api/research/compare',json={'metric':'fake','selections':rows}).status_code,422)
