import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class ReviewApiTests(unittest.TestCase):
    def test_review_round_trip_and_stale_run_protection(self):
        import app as module
        from fastapi.testclient import TestClient
        root=Path(__file__).resolve().parents[1]
        public=root/'published/82f114c3d19f47fb83252268c05efa0c'
        sid,run_id='a'*32,'b'*32
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp);folder=base/'sessions'/sid;run=folder/'runs'/run_id;run.mkdir(parents=True)
            session=json.loads((public/'session.json').read_text())
            session.update(id=sid,run_id=run_id,source_file='source.mp4')
            (folder/'session.json').write_text(json.dumps(session))
            for name in ('summary.json','manifest.json','players.csv'):shutil.copyfile(public/name,run/name)
            with patch.object(module,'DATA',base),patch.object(module,'SESSIONS',base/'sessions'),TestClient(module.app) as client:
                decisions=[{'frame':0,'kind':'start'},{'frame':5,'kind':'serve','player':'near'},
                           {'frame':20,'kind':'hit','player':'far'},{'frame':40,'kind':'end'}]
                payload={'run_id':run_id,'decisions':decisions}
                response=client.put(f'/api/sessions/{sid}/events',json=payload)
                self.assertEqual(response.status_code,200,response.text)
                rally=response.json()['rallies'][0]
                self.assertEqual(rally['confirmed_shots'],2)
                self.assertAlmostEqual(rally['mean_interval_s'],15/21)
                restored=client.get(f'/api/sessions/{sid}/results').json()['shuttle']
                self.assertEqual(restored['rallies'],response.json()['rallies'])
                self.assertEqual(client.put(f'/api/sessions/{sid}/events',json={**payload,'run_id':'c'*32}).status_code,409)
                self.assertEqual(client.put(f'/api/sessions/{sid}/events',json={'run_id':run_id,'decisions':[{'frame':105,'kind':'hit'}]}).status_code,400)
                self.assertEqual(client.get(f'/api/sessions/{sid}/results').json()['shuttle']['rallies'],restored['rallies'])


if __name__=='__main__':unittest.main()
