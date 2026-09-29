import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

DEPLOY = Path(__file__).resolve().parents[1]
SHA = 'a' * 40
SERVER = 'https://production.example.invalid'
FAKE = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
with open(os.environ['CALL_LOG'], 'a') as f: f.write(json.dumps([Path(sys.argv[0]).name]+args)+'\\n')
if 'config' in args:
 print(os.environ['TEST_SERVER'])
if 'wait' in args and os.environ.get('FAIL_MIGRATION'):
 sys.exit(42)
if 'wait' in args and os.environ.get('FAIL_DRAIN') and any('api-drain' in a for a in args):
 sys.exit(44)
if 'rollout' in args and os.environ.get('FAIL_ROLLOUT'):
 sys.exit(43)
'''


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env = dict(os.environ, CALL_LOG=str(self.root/'calls'), TEST_SERVER=SERVER)
        self.env['PATH'] = str(self.root)+os.pathsep+os.environ['PATH']
        for name in ['kubectl', 'curl']:
            p=self.root/name
            p.write_text(FAKE)
            p.chmod(0o755)

    def release(self, **env):
        result=subprocess.run(['bash', str(DEPLOY/'release.sh'), SHA, 'nasfaq-prod', SERVER],
                              env=dict(self.env, **env), capture_output=True, text=True)
        path=self.root/'calls'
        calls=[json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []
        return result, calls

    def test_render_uses_one_revision_and_separates_bootstrap(self):
        out=self.root/'rendered'
        subprocess.run(['bash', str(DEPLOY/'render-release.sh'), SHA, str(out)], check=True)
        self.assertEqual(sorted(p.name for p in (out/'bootstrap').iterdir()),
                         ['00-namespace.yaml', '05-configmap.yaml'])
        images=[]
        for p in out.rglob('*.yaml'):
            text=p.read_text()
            self.assertNotIn('IMAGE_TAG', text)
            self.assertNotIn(':latest', text)
            images.extend(line.strip() for line in text.splitlines() if 'image: ghcr.io/' in line)
        self.assertEqual(len(images), 11)  # seven application Deployments + migrate/drain/reopen/abort jobs; API image shared
        self.assertTrue(all(x.endswith(':sha-'+SHA) for x in images))
        self.assertIn('name: api-migrate-sha-'+SHA, (out/'migration.yaml').read_text())
        for job in ['drain', 'reopen', 'abort']:
            self.assertIn(f'name: api-{job}-sha-'+SHA, (out/f'{job}.yaml').read_text())
        # The reopen job announces exactly the version the images carry.
        self.assertIn('"--version", "sha-'+SHA+'"', (out/'reopen.yaml').read_text())

    def test_success_migrates_before_workloads_and_checks_rollouts(self):
        result,calls=self.release()
        self.assertEqual(result.returncode, 0, result.stderr)
        migration_wait=next(i for i,c in enumerate(calls) if 'wait' in c)
        workloads=next(i for i,c in enumerate(calls) if any('/workloads/' in a for a in c))
        self.assertLess(migration_wait, workloads)
        prior_applies=[c for c in calls[:migration_wait] if 'apply' in c]
        self.assertEqual(len(prior_applies),2)
        self.assertIn('/bootstrap/',prior_applies[0][-1])
        self.assertTrue(prior_applies[1][-1].endswith('/migration.yaml'))
        self.assertEqual(len([c for c in calls if 'rollout' in c]),8)
        # Games drain after migrations and before any workload restarts; reopen comes after health.
        drain=self.applied(calls, 'drain.yaml')
        self.assertLess(migration_wait, drain)
        self.assertLess(drain, workloads)
        curl=next(i for i,c in enumerate(calls) if c[0]=='curl')
        self.assertLess(curl, self.applied(calls, 'reopen.yaml'))
        self.assertIsNone(self.applied(calls, 'abort.yaml'))
        for call in calls:
            if call[0]=='kubectl': self.assertEqual(call[1:3],['--context','nasfaq-prod'])

    def applied(self, calls, name):
        return next((i for i,c in enumerate(calls) if 'apply' in c and c[-1].endswith('/'+name)), None)

    def test_failed_migration_never_touches_workloads(self):
        result,calls=self.release(FAIL_MIGRATION='1')
        self.assertEqual(result.returncode,42)
        self.assertFalse(any('/workloads/' in a for c in calls for a in c))
        self.assertFalse(any('rollout' in c for c in calls))
        # Games were never paused, so there's nothing to reopen.
        self.assertIsNone(self.applied(calls, 'drain.yaml'))
        self.assertIsNone(self.applied(calls, 'abort.yaml'))

    def test_unfinished_drain_still_releases(self):
        result,calls=self.release(FAIL_DRAIN='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any('/workloads/' in a for c in calls for a in c))
        self.assertIsNotNone(self.applied(calls, 'reopen.yaml'))

    def test_wrong_cluster_never_applies(self):
        result,calls=self.release(TEST_SERVER='https://another-cluster.invalid')
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(any('apply' in c for c in calls))

    def test_rollout_failure_fails_release(self):
        result,calls=self.release(FAIL_ROLLOUT='1')
        self.assertEqual(result.returncode,43)
        self.assertFalse(any(c[0]=='curl' for c in calls))
        # Games were paused for the release: they reopen, and no version is announced.
        self.assertIsNotNone(self.applied(calls, 'abort.yaml'))
        self.assertIsNone(self.applied(calls, 'reopen.yaml'))

    def test_rejects_invalid_revision_without_cluster_access(self):
        result=subprocess.run(['bash',str(DEPLOY/'release.sh'),'main','nasfaq-prod',SERVER],
                              env=self.env,capture_output=True)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse((self.root/'calls').exists())


if __name__=='__main__': unittest.main()
