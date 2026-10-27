import copy
import json
import tempfile
import unittest
from pathlib import Path

from publish import public_session, export_session

ROOT = Path(__file__).resolve().parents[1]


class PublicationTests(unittest.TestCase):
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
