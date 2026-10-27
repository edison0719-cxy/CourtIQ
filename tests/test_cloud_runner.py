import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from fastapi.testclient import TestClient

class CloudRunnerTest(unittest.TestCase):
    def test_private_runner_rejects_missing_or_wrong_secret(self):
        import cloud_runner
        with TestClient(cloud_runner.app) as client:
            self.assertEqual(client.get('/runtime').status_code,401)
            self.assertEqual(client.post('/operation',json={'operation':'options'},headers={'X-CourtIQ-Secret':'wrong'}).status_code,401)

    def test_probe_and_shared_manual_evaluation_use_real_inputs(self):
        import cloud_runner
        from app import TrainingEvaluation
        from services import make_evaluation
        from pipeline import UPSTREAM,probe_video
        with tempfile.TemporaryDirectory() as temp:
            preview=Path(temp)/'preview.jpg'
            video=probe_video(UPSTREAM/'short.mp4',preview)
            self.assertGreater(video['frames'],100)
            self.assertGreater(preview.stat().st_size,1000)
        e=make_evaluation({'video':{'duration_s':30}},TrainingEvaluation(task='Rear court',attempts=10,successes=8,end_s=20))
        self.assertEqual(e['success_rate'],.8)
        self.assertLess(e['ci95'][0],.8)
        self.assertGreater(e['ci95'][1],.8)

    def test_model_download_hash_is_verified_before_replacing_file(self):
        import cloud_runner
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'model.pt'
            path.write_bytes(b'previous verified contents')
            class Transfer:
                def download(self,name,target):target.write_bytes(b'tampered contents')
            with self.assertRaisesRegex(ValueError,'checksum'):
                cloud_runner.ensure_model('model.pt',Transfer(),directory=Path(temp),expected={'model.pt':hashlib.sha256(b'expected').hexdigest()})
            self.assertEqual(path.read_bytes(),b'previous verified contents')
            self.assertFalse(path.with_suffix('.download').exists())

    def test_transfer_rejects_untrusted_origin_and_path_traversal(self):
        from cloud_runner import Storage
        with self.assertRaises(ValueError):Storage({'origin':'https://attacker.example','token':'x'},allowed_origin='https://courtiq.example.org')
        storage=Storage({'origin':'https://courtiq.example.org','token':'x'},allowed_origin='https://courtiq.example.org')
        for name in ('../secret','/etc/passwd','shuttle/../../token','https://evil.example'):
            with self.assertRaises(ValueError):storage.url(name)

    def test_active_preview_or_statistics_request_keeps_utility_container_alive(self):
        import cloud_runner
        import os
        import threading
        from concurrent.futures import ThreadPoolExecutor
        from unittest.mock import patch
        entered=threading.Event();release=threading.Event()
        original=cloud_runner.validate_court
        def slow(*args):
            entered.set();release.wait(5);return original(*args)
        secret='test-only-runner-secret-32-characters-long'
        with patch.dict(os.environ,{'INTERNAL_SECRET':secret}),patch('cloud_runner.validate_court',side_effect=slow),TestClient(cloud_runner.app) as client:
            headers={'X-CourtIQ-Secret':secret}
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(client.post,'/operation',headers=headers,json={'operation':'calibration','session':{'video':{'width':100,'height':100}},'body':{'points':[[0,0],[100,0],[100,100],[0,100]]}})
                try:
                    self.assertTrue(entered.wait(3))
                    self.assertTrue(client.get('/activity',headers=headers).json()['running'])
                finally:release.set()
                self.assertEqual(future.result(timeout=3).status_code,200)
            self.assertFalse(client.get('/activity',headers=headers).json()['running'])

    def test_unwritable_job_directory_becomes_failed_instead_of_staying_running(self):
        import cloud_runner
        import os
        from unittest.mock import patch
        run='a'*32
        with tempfile.TemporaryDirectory() as temp:
            blocker=Path(temp)/'not-a-directory';blocker.write_text('occupied')
            body={'session':{'id':'b'*32},'transfer':{'origin':'https://courtiq.example.org','token':'test'}}
            with patch.object(cloud_runner,'DATA',blocker),patch.dict(os.environ,{'PUBLIC_ORIGIN':'https://courtiq.example.org'}):
                cloud_runner.JOBS[run]={'status':'running','stage':'准备视频','error':None}
                try:
                    cloud_runner.run_job(run,body)
                    self.assertEqual(cloud_runner.JOBS[run]['status'],'failed')
                    self.assertTrue(cloud_runner.JOBS[run]['error'])
                finally:cloud_runner.JOBS.pop(run,None)
