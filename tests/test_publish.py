import copy
import json
import tempfile
import os
import shutil
import unittest
from unittest.mock import patch
from pathlib import Path

from publish import public_session, export_session, publish_record

ROOT = Path(__file__).resolve().parents[1]


class PublicationTests(unittest.TestCase):
    def test_unavailable_encoder_keeps_the_previous_publication_intact(self):
        catalog = json.loads((ROOT / 'published/catalog.json').read_text())
        session = next(s for s in catalog['sessions'] if s['is_example'])
        published = ROOT / 'published' / session['id']
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            source = base / 'source'
            run = source / 'runs' / session['run_id']
            run.mkdir(parents=True)
            shutil.copyfile(published / 'session.json', source / 'session.json')
            shutil.copyfile(published / 'trajectory.mp4', source / 'source.mp4')
            for name in ('summary.json', 'manifest.json', 'players.csv', 'analytics.png'):
                shutil.copyfile(published / name, run / name)
            destination = base / 'published'
            shutil.copytree(ROOT / 'published', destination)
            before = {str(p.relative_to(destination)): p.read_bytes() for p in destination.rglob('*') if p.is_file()}
            with patch.dict(os.environ, {'PATH': ''}):
                with self.assertRaisesRegex(ValueError, 'FFmpeg'):
                    publish_record(source, destination, 'Replacement', '', animation=True)
            after = {str(p.relative_to(destination)): p.read_bytes() for p in destination.rglob('*') if p.is_file()}
            self.assertEqual(after, before)

    def test_public_metadata_is_an_allowlist(self):
        source = {'id': 'a' * 32, 'run_id': 'b' * 32, 'status': 'completed',
                  'is_example': False, 'created_at': '2026-10-26T00:00:00+00:00',
                  'video': {'fps': 21, 'duration_s': 30, 'width': 960, 'height': 544},
                  'options': {'seconds': 5}, 'notes': 'private coach note',
                  'near_name': 'Private child name', 'venue': 'Private school',
                  'original_filename': 'private-child.mp4', 'token': 'secret'}
        before = copy.deepcopy(source)
        public = public_session(source, 'Published training', 'Published venue')
        text = json.dumps(public)
        for private in ['Private', 'private', 'secret', 'token', 'notes', 'mp4']:
            self.assertNotIn(private, text)
        self.assertEqual(public['near_name'], '近端球员')
        self.assertEqual(source, before)

    def test_unfinished_sessions_cannot_be_published(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            (folder / 'session.json').write_text(json.dumps({'status': 'running'}))
            with self.assertRaisesRegex(ValueError, 'completed'):
                export_session(folder, folder / 'out', 'Training', '')

    def test_publication_requires_an_explicit_public_title(self):
        with self.assertRaises(ValueError):
            public_session({'status': 'completed'}, '', '')


if __name__ == '__main__':
    unittest.main()
