#!/usr/bin/env python3
"""Dead-man for dsatoolkit.com on the shared VPS (playbook step 8). Runs every 10 minutes
from the user timer dsatoolkit-deadman.timer on auntie (the office box), outside the VPS.

Built on Infra Worker 3's static-site kit (~/nil/infra/moves/static-site-kit/sites-deadman.py),
with the deploy check of bigOspeedrun's dead-man (~/nil/bigospeedrun-data/deadman.py, vps_deploy).

Checks:
  deploy  The forced-command login `sitehealth` prints status.json of auto-deploy.sh and the
          state of both containers. Problem: status.json missing, the last tick 45 minutes old
          or more, a failed/failed_target/rolled_back/rollback_failed/stopped/refused result,
          held or waiting for 24 h, ticks failing for 1 h, units not ok, a container not
          running and healthy. A container that is created, restarting or starting its health
          check is read again every 30 s, at most 4 times. A failed read is "unknown".
  https   GET https://www.dsatoolkit.com/ on the public path (Cloudflare once proxied).
          Problem: not 200 on 2 runs in a row (20 min). A connection error counts the same.
  cert:<name>  TLS handshake to the VPS origin address with SNI <name>, for dsatoolkit.com and
          www.dsatoolkit.com (the cloudflare_only gate aborts after the handshake, so this
          works behind the gate). Problem: the certificate expires in under 21 days (Caddy
          renews at 30), or it does not verify. A failed handshake is "unknown".
3 unknowns in a row are a problem. Each check arms itself on its first success, so nothing is
sent before the site runs on the VPS.

A new incident sends ONE fixed-template message to this site's Isomux webhook, which wakes the
DSA Toolkit Agent. Nothing is sent again for the same incident or on recovery (playbook
decision 6). A failed send stays pending, is retried on the next run, and is written to the
alerts log.

The config (ops-private/deadman.json, gitignored) names the sitehealth key, its pinned
known_hosts and the webhook. The origin address comes from that known_hosts file, so no
address is in this repo. Nothing secret is printed.

Usage: python3 -I deadman.py [--config PATH] [--state-dir PATH] [--dry-run] [--assume-armed]
  --dry-run       check and print; send nothing, keep no state
  --assume-armed  treat every check as armed (the G2 drill with a wrong host name)
"""
import argparse
import hashlib
import hmac
import ipaddress
import json
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CONFIG = REPO / 'ops-private/deadman.json'
STATE_DIR = Path.home() / '.local/state/dsatoolkit-deadman'
RUNBOOK = '~/nil/dsatoolkit/ops/self-host/README.md'
HTTPS_FAILS = 2
UNKNOWNS = 3
CERT_DAYS = 21
TICK_LIMIT = timedelta(minutes=45)
HOLD_LIMIT = timedelta(hours=24)
ERROR_LIMIT = timedelta(hours=1)
BAD_RESULTS = {'failed', 'failed_target', 'rolled_back', 'rollback_failed', 'stopped', 'refused'}
SETTLE_SECONDS = 30
SETTLE_READS = 4


def stamp(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def parse(value):
    if not value:
        return None
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)


def origin_address(known_hosts):
    """The first public IPv4 name in the pinned known_hosts file (the VPS public address)."""
    for line in Path(known_hosts).expanduser().read_text().splitlines():
        for name in line.split()[0].split(',') if line.strip() else []:
            try:
                address = ipaddress.ip_address(name.strip('[]').split(']:')[0])
            except ValueError:
                continue
            if address.version == 4 and address.is_global:
                return str(address)
    raise RuntimeError('no public IPv4 name in the known_hosts file')


class Sources:
    """The live reads. Tests replace these methods."""

    def __init__(self, config):
        self.config = config

    def sitehealth(self):
        health = self.config['sitehealth']
        command = ['ssh', '-F', '/dev/null', '-T', '-i', str(Path(health['key']).expanduser()),
                   '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'PreferredAuthentications=publickey',
                   '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                   '-o', 'UserKnownHostsFile=' + str(Path(health['known_hosts']).expanduser()),
                   '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=20',
                   'sitehealth@' + health['address'], health['site']]
        # stderr is dropped so nothing about the key or the host is printed.
        out = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise RuntimeError(f'sitehealth read exited {out.returncode}')
        return json.loads(out.stdout)

    def https_status(self, url):
        request = urllib.request.Request(url, headers={'User-Agent': 'dsatoolkit-deadman/1 (Nil office)'})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                response.read(1024 * 1024)
                return response.status
        except urllib.error.HTTPError as error:
            return error.code

    def cert_expiry(self, name):
        origin = origin_address(self.config['sitehealth']['known_hosts'])
        with socket.create_connection((origin, 443), timeout=15) as raw:
            with ssl.create_default_context().wrap_socket(raw, server_hostname=name) as tls:
                cert = tls.getpeercert()
        return datetime.fromtimestamp(ssl.cert_time_to_seconds(cert['notAfter']), timezone.utc)

    def pause(self, seconds):
        time.sleep(seconds)


def settling(data):
    return any(c.get('present') and (c.get('status') in ('created', 'restarting') or c.get('health') == 'starting')
               for c in (data.get('containers') or {}).values())


def deploy_problems(data, now, memory):
    """The problems in one sitehealth read; updates memory (held_since)."""
    problems = []
    status = data.get('auto_deploy') or {}
    if status.get('missing') or status.get('malformed') or not status:
        problems.append('status.json ' + ('missing' if status.get('missing') else 'unreadable'))
    else:
        tick = parse(status.get('tick_at'))
        if not tick or now - tick >= TICK_LIMIT:
            problems.append(f"last_tick={stamp(tick) if tick else 'none'}")
        bad = [status['result']] if status.get('result') in BAD_RESULTS else []
        if status.get('stopped'):
            bad.append('stopped')
        if bad:
            problems.append('result=' + '/'.join(dict.fromkeys(bad)))
        if status.get('held'):
            since = parse(memory.setdefault('held_since', stamp(now)))
            if now - since >= HOLD_LIMIT:
                problems.append(f'held_since={stamp(since)}')
        else:
            memory.pop('held_since', None)
        waiting = parse(status.get('waiting_since'))
        if status.get('waiting') and waiting and now - waiting >= HOLD_LIMIT:
            problems.append(f'waiting_since={stamp(waiting)}')
        # tick_error_since can outlive the error in a held or locked status; only a tick_error result counts.
        erring = parse(status.get('tick_error_since')) if status.get('result') == 'tick_error' else None
        if erring and now - erring >= ERROR_LIMIT:
            problems.append(f'tick_error_since={stamp(erring)}')
        # A tick that found the lock taken ends before the unit check, so its units stay 'unchecked'.
        if status.get('units') != 'ok' and not (status.get('result') == 'locked' and status.get('units') == 'unchecked'):
            problems.append(f"units={status.get('units')}")
    containers = data.get('containers') or {}
    for name, c in sorted(containers.items()):
        if not c.get('present'):
            problems.append(f'{name}=missing')
        elif c.get('error') or c.get('status') != 'running' or c.get('health') not in (None, 'healthy'):
            problems.append(f"{name}={c.get('status')}/{c.get('health')}")
    if not containers:
        problems.append('no container states')
    return problems


def check_deploy(src, now, memory):
    """(ok, evidence); ok is None when sitehealth cannot be read."""
    try:
        data = src.sitehealth()
        for _ in range(SETTLE_READS - 1):
            if not settling(data):
                break
            src.pause(SETTLE_SECONDS)
            data = src.sitehealth()
    except Exception as error:
        return None, f'read_error={type(error).__name__}'
    problems = deploy_problems(data, now, memory)
    if problems:
        return False, ' '.join(problems)[:300]
    status = data['auto_deploy']
    return True, f"result={status.get('result')} deployed={str(status.get('deployed'))[:12]}"


def check_https(src, url):
    try:
        code = src.https_status(url)
    except Exception as error:
        return False, f'error={type(error).__name__}'
    return code == 200, f'status={code}'


def check_cert(src, name, now):
    try:
        expires = src.cert_expiry(name)
    except ssl.SSLCertVerificationError as error:
        return False, f'verify_failed={error.verify_message}'
    except Exception as error:
        return None, f'handshake_error={type(error).__name__}'
    days = (expires - now).total_seconds() / 86400
    return days >= CERT_DAYS, f'days_left={days:.1f} not_after={stamp(expires)}'


def evaluate(entry, check, ok, assume_armed=False):
    """Updates one check's state; returns 'problem', 'unknown' or None (no incident)."""
    if ok is True:
        entry.update(armed=True, fails=0, unknowns=0, incident=False, pending=None)
        return None
    if not (entry.get('armed') or assume_armed):
        return None
    if ok is None:
        entry['unknowns'] = entry.get('unknowns', 0) + 1
        return 'unknown' if entry['unknowns'] >= UNKNOWNS else None
    entry['unknowns'] = 0
    entry['fails'] = entry.get('fails', 0) + 1
    if check == 'https':
        return 'problem' if entry['fails'] >= HTTPS_FAILS else None
    return 'problem'


def sender(config):
    hook = config['webhook']

    def send(payload):
        secret = Path(hook['secret_file']).expanduser().read_text().strip().encode()
        body = json.dumps(payload).encode()
        signature = 'sha256=' + hmac.new(secret, body, hashlib.sha256).hexdigest()
        request = urllib.request.Request(hook['url'], data=body, method='POST', headers={
            'Content-Type': 'application/json', hook['signature_header']: signature, hook['event_header']: 'deadman'})
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status >= 300:
                raise RuntimeError(f'webhook HTTP {response.status}')
    return send


def run(config, src, send, state, state_dir, dry_run=False, assume_armed=False, now=None):
    now = now or datetime.now(timezone.utc)
    results = {'deploy': check_deploy(src, now, state.setdefault('memory', {})),
               'https': check_https(src, config['https_url'])}
    for name in config['cert_names']:
        results['cert:' + name] = check_cert(src, name, now)
    lines = []
    for check, (ok, evidence) in results.items():
        entry = state.setdefault('checks', {}).setdefault(check, {})
        verdict = evaluate(entry, check, ok, assume_armed)
        lines.append(f'{check} ok={ok} {evidence}' + (f' verdict={verdict}' if verdict else ''))
        if verdict and not entry.get('incident'):
            entry['incident'] = True
            entry['pending'] = (f'Dead-man | site={config["site"]} | check={check} | verdict={verdict} | '
                                f'observed_at={stamp(now)} | evidence={evidence} | runbook={RUNBOOK}')
        if entry.get('pending') and not dry_run:
            try:
                send({'kind': 'dsatoolkit-deadman', 'check': check, 'text': entry['pending']})
                lines.append(f'{check} sent')
                entry['pending'] = None
            except Exception as error:
                lines.append(f'{check} send_failed={type(error).__name__} (retry next run)')
                with open(state_dir / 'alerts.log', 'a') as log:
                    log.write(f'{stamp(now)} unsent: {entry["pending"]}\n')
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--config', default=str(CONFIG))
    parser.add_argument('--state-dir', default=str(STATE_DIR))
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--assume-armed', action='store_true')
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    state_dir = Path(args.state_dir)
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_path = state_dir / 'state.json'
    state = {} if args.dry_run or not state_path.exists() else json.loads(state_path.read_text())
    for line in run(config, Sources(config), sender(config), state, state_dir,
                    dry_run=args.dry_run, assume_armed=args.assume_armed):
        print(line)
    if not args.dry_run:
        tmp = state_path.with_suffix('.tmp')
        tmp.write_text(json.dumps(state, indent=1, sort_keys=True))
        tmp.replace(state_path)


if __name__ == '__main__':
    sys.exit(main())
