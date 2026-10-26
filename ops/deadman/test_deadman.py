# Run: python3 -I -m unittest discover -s ops/deadman
# deadman.py against fake reads. Nothing here opens a network connection or sends a message.
import importlib.util
import json
import ssl
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location('deadman', Path(__file__).with_name('deadman.py'))
deadman = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deadman)

NOW = datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc)
CONFIG = {'site': 'www.dsatoolkit.com', 'https_url': 'https://www.dsatoolkit.com/',
          'cert_names': ['dsatoolkit.com', 'www.dsatoolkit.com']}
HEALTHY = {'running': True, 'status': 'running', 'health': 'healthy', 'present': True}


def status(**fields):
    # tick_at None: the fake reports a tick 5 minutes before the run.
    base = {'tick_at': None, 'deployed': 'a' * 40, 'result': 'up_to_date', 'phase': 'select',
            'stopped': False, 'held': False, 'waiting': False, 'waiting_since': None, 'tick_error_since': None,
            'units': 'ok'}
    return {**base, **fields}


def health(auto_deploy=None, site=HEALTHY, egress=HEALTHY):
    return {'site': 'dsatoolkit', 'auto_deploy': auto_deploy if auto_deploy is not None else status(),
            'containers': {'dsatoolkit-site-1': site, 'dsatoolkit-egress-1': egress}}


class Fake:
    def __init__(self):
        self.reads = [health()]
        self.code = 200
        self.expiry = {name: NOW + timedelta(days=80) for name in CONFIG['cert_names']}
        self.paused = 0
        self.now = NOW

    def sitehealth(self):
        read = self.reads[0] if len(self.reads) == 1 else self.reads.pop(0)
        if isinstance(read, Exception):
            raise read
        status = read.get('auto_deploy') or {}
        if 'tick_at' in status and status['tick_at'] is None:
            read = {**read, 'auto_deploy': {**status, 'tick_at': deadman.stamp(self.now - timedelta(minutes=5))}}
        return read

    def https_status(self, url):
        if isinstance(self.code, Exception):
            raise self.code
        return self.code

    def cert_expiry(self, name):
        value = self.expiry[name]
        if isinstance(value, Exception):
            raise value
        return value

    def pause(self, seconds):
        self.paused += 1


class DeadmanTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.state_dir = Path(self.dir.name)
        self.src = Fake()
        self.state = {}
        self.sent = []
        self.fail_send = False

    def tearDown(self):
        self.dir.cleanup()

    def send(self, payload):
        if self.fail_send:
            raise RuntimeError('down')
        self.sent.append(payload)

    def tick(self, minutes=0, **options):
        self.src.now = NOW + timedelta(minutes=minutes)
        return deadman.run(CONFIG, self.src, self.send, self.state, self.state_dir, now=self.src.now, **options)

    def checks_sent(self):
        return [p['check'] for p in self.sent]

    def test_unarmed_checks_send_nothing(self):
        # Before the install: status.json missing, containers absent, no certificate on the origin.
        self.src.reads = [{'site': 'dsatoolkit', 'auto_deploy': {'missing': True},
                           'containers': {'dsatoolkit-site-1': {'present': False}, 'dsatoolkit-egress-1': {'present': False}}}]
        self.src.expiry = {name: ConnectionRefusedError() for name in CONFIG['cert_names']}
        self.src.code = 500
        for i in range(5):
            self.tick(10 * i)
        self.assertEqual(self.sent, [])

    def test_deploy_incident_sends_once_and_again_after_recovery(self):
        self.tick()
        self.src.reads = [health(status(result='rolled_back'))]
        self.tick(10)
        self.tick(20)
        self.assertEqual(self.checks_sent(), ['deploy'])
        text = self.sent[0]['text']
        self.assertTrue(text.startswith('Dead-man | site=www.dsatoolkit.com | check=deploy | verdict=problem | observed_at=2026-10-26T12:10:00Z'))
        self.assertIn('result=rolled_back', text)
        self.assertEqual(self.sent[0]['kind'], 'dsatoolkit-deadman')
        # Recovery sends nothing; a new incident sends one more message.
        self.src.reads = [health()]
        self.tick(30)
        self.assertEqual(len(self.sent), 1)
        self.src.reads = [health(site={'present': True, 'status': 'exited', 'health': 'unhealthy'})]
        self.tick(40)
        self.assertEqual(self.checks_sent(), ['deploy', 'deploy'])
        self.assertIn('dsatoolkit-site-1=exited/unhealthy', self.sent[1]['text'])

    def test_https_needs_two_failures_in_a_row(self):
        self.tick()
        self.src.code = 502
        self.tick(10)
        self.assertEqual(self.sent, [])
        self.tick(20)
        self.tick(30)
        self.assertEqual(self.checks_sent(), ['https'])
        self.assertIn('status=502', self.sent[0]['text'])

    def test_one_https_failure_then_200_is_no_incident(self):
        self.tick()
        self.src.code = OSError('reset')
        self.tick(10)
        self.src.code = 200
        self.tick(20)
        self.src.code = 503
        self.tick(30)
        self.assertEqual(self.sent, [])

    def test_cert_unknown_three_times_and_short_expiry(self):
        self.tick()
        self.src.expiry['dsatoolkit.com'] = TimeoutError()
        self.tick(10)
        self.tick(20)
        self.assertEqual(self.sent, [])
        self.tick(30)
        self.tick(40)
        self.assertEqual(self.checks_sent(), ['cert:dsatoolkit.com'])
        self.assertIn('verdict=unknown', self.sent[0]['text'])
        self.assertIn('handshake_error=TimeoutError', self.sent[0]['text'])
        self.src.expiry['www.dsatoolkit.com'] = NOW + timedelta(days=10)
        self.tick(50)
        self.assertEqual(self.checks_sent(), ['cert:dsatoolkit.com', 'cert:www.dsatoolkit.com'])
        self.assertIn('days_left=10.0', self.sent[1]['text'])

    def test_cert_that_does_not_verify_is_a_problem_at_once(self):
        self.tick()
        error = ssl.SSLCertVerificationError('bad')
        error.verify_message = 'certificate has expired'
        self.src.expiry['www.dsatoolkit.com'] = error
        self.tick(10)
        self.assertEqual(self.checks_sent(), ['cert:www.dsatoolkit.com'])
        self.assertIn('verify_failed=certificate has expired', self.sent[0]['text'])

    def test_sitehealth_read_errors_alert_after_three(self):
        self.tick()
        self.src.reads = [RuntimeError('sitehealth read exited 255')]
        self.tick(10)
        self.tick(20)
        self.assertEqual(self.sent, [])
        self.tick(30)
        self.assertEqual(self.checks_sent(), ['deploy'])
        self.assertIn('verdict=unknown | observed_at=2026-10-26T12:30:00Z | evidence=read_error=RuntimeError', self.sent[0]['text'])

    def test_failed_send_is_retried_and_logged(self):
        self.tick()
        self.src.reads = [health(status(result='failed_target'))]
        self.fail_send = True
        lines = self.tick(10)
        self.assertIn('deploy send_failed=RuntimeError (retry next run)', lines)
        self.assertIn('unsent: Dead-man | site=www.dsatoolkit.com | check=deploy', (self.state_dir / 'alerts.log').read_text())
        self.fail_send = False
        self.tick(20)
        self.tick(30)
        self.assertEqual(self.checks_sent(), ['deploy'])
        # The retried message keeps the time the incident was first seen.
        self.assertIn('observed_at=2026-10-26T12:10:00Z', self.sent[0]['text'])

    def test_settling_container_is_read_again(self):
        self.tick()
        starting = health(site={**HEALTHY, 'health': 'starting'})
        self.src.reads = [starting, starting, health()]
        self.tick(10)
        self.assertEqual(self.src.paused, 2)
        self.assertEqual(self.sent, [])

    def test_assume_armed_drill_sends_one_message_per_check(self):
        self.src.reads = [RuntimeError('sitehealth read exited 1')]
        self.src.code = OSError('no such host')
        self.src.expiry = {name: OSError('no such host') for name in CONFIG['cert_names']}
        for i in range(4):
            self.tick(10 * i, assume_armed=True)
        self.assertEqual(sorted(self.checks_sent()), ['cert:dsatoolkit.com', 'cert:www.dsatoolkit.com', 'deploy', 'https'])

    def test_dry_run_sends_nothing(self):
        self.tick()
        self.src.reads = [health(status(result='stopped', stopped=True))]
        lines = self.tick(10, dry_run=True)
        self.assertEqual(self.sent, [])
        self.assertTrue(any(line.startswith('deploy ok=False result=stopped') for line in lines))


class DeployProblemsTest(unittest.TestCase):
    def problems(self, auto_deploy, now=NOW, memory=None):
        if auto_deploy.get('tick_at', 'x') is None:
            auto_deploy = {**auto_deploy, 'tick_at': deadman.stamp(now - timedelta(minutes=5))}
        return deadman.deploy_problems(health(auto_deploy), now, {} if memory is None else memory)

    def test_healthy(self):
        self.assertEqual(self.problems(status()), [])

    def test_stale_tick_and_units(self):
        self.assertEqual(self.problems(status(tick_at='2026-10-26T11:15:00Z', units='error')),
                         ['last_tick=2026-10-26T11:15:00Z', 'units=error'])

    def test_locked_tick_with_unchecked_units_is_fine(self):
        self.assertEqual(self.problems(status(result='locked', units='unchecked')), [])

    def test_held_for_a_day(self):
        memory = {}
        self.assertEqual(self.problems(status(held=True), memory=memory), [])
        later = NOW + timedelta(hours=24)
        self.assertEqual(self.problems(status(held=True), now=later, memory=memory),
                         ['held_since=2026-10-26T12:00:00Z'])

    def test_tick_errors_for_an_hour(self):
        self.assertEqual(self.problems(status(result='tick_error', tick_error_since='2026-10-26T10:59:00Z')),
                         ['tick_error_since=2026-10-26T10:59:00Z'])
        self.assertEqual(self.problems(status(result='held', held=True, tick_error_since='2026-10-26T10:00:00Z')), [])

    def test_missing_status(self):
        self.assertEqual(self.problems({'missing': True}), ['status.json missing'])


class OriginTest(unittest.TestCase):
    def test_first_public_ipv4_name(self):
        with tempfile.NamedTemporaryFile('w', suffix='.known_hosts') as f:
            f.write('100.64.0.9,1.1.1.1 ssh-ed25519 AAAA\n')
            f.flush()
            # 100.64.0.0/10 is CGNAT (a tailnet address), not public.
            self.assertEqual(deadman.origin_address(f.name), '1.1.1.1')


if __name__ == '__main__':
    unittest.main()
