import importlib
import io
import os
import tempfile
import unittest
from pathlib import Path


class AppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        os.environ['COURTIQ_DATA_DIR']=cls.temp.name

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_server_module_available(self):
        self.assertIsNotNone(importlib.util.find_spec('app'), 'Real local API has not been implemented')

    def test_invalid_video_is_rejected_and_leaves_no_session(self):
        from fastapi.testclient import TestClient
        from app import app
        with TestClient(app) as c:
            before=len(c.get('/api/sessions').json())
            r=c.post('/api/sessions', files={'video':('broken.mp4',b'not a video','video/mp4')})
            self.assertEqual(r.status_code,400)
            self.assertEqual(len(c.get('/api/sessions').json()),before)

    def test_upload_calibrate_and_artifact_path_protection(self):
        from fastapi.testclient import TestClient
        from app import app
        import cv2
        import numpy as np
        # A deterministic encoded frame is a unit-test fixture, never app demo data.
        path=Path(self.temp.name)/'fixture.mp4'
        out=cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'mp4v'),10,(128,128))
        for _ in range(4):out.write(np.zeros((128,128,3),dtype=np.uint8))
        out.release()
        with TestClient(app) as c:
            r=c.post('/api/sessions',files={'video':('test.mp4',path.read_bytes(),'video/mp4')})
            self.assertEqual(r.status_code,200,r.text)
            session=r.json();sid=session['id']
            self.assertEqual(session['status'],'draft')
            self.assertEqual(c.post(f'/api/sessions/{sid}/run',json={}).status_code,400)
            self.assertEqual(c.put(f'/api/sessions/{sid}/calibration',json={'points':[[10,10],[118,10],[118,118],[10,118]]}).status_code,200)
            self.assertEqual(c.get(f'/api/sessions/{sid}/files/preview.jpg').status_code,200)
            self.assertEqual(c.get(f'/api/sessions/{sid}/files/../../app.py').status_code,404)
            self.assertEqual(c.get('/api/sessions/not-an-id').status_code,404)

    def test_recalibration_invalidates_previous_results(self):
        from fastapi.testclient import TestClient
        from app import app, update_session
        with TestClient(app) as c:
            sid=c.post('/api/example').json()['id']
            update_session(sid,status='completed',run_id='previous-run',calibration=[[10,10],[118,10],[118,118],[10,118]])
            response=c.put(f'/api/sessions/{sid}/calibration',json={'points':[[12,12],[116,12],[116,116],[12,116]]})
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['status'],'draft')
            self.assertIsNone(response.json()['run_id'])
            self.assertEqual(c.get(f'/api/sessions/{sid}/results').status_code,404)


if __name__=='__main__':unittest.main()
