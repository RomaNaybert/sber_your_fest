#!/usr/bin/env python3
"""Deploy only game/ to hpfs.ru/sber. Default: local check; --deploy enables SSH.

No password handling, nginx edits, PM2 actions, or writes to the HPFS root/API.
"""
import argparse
import ctypes
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import urllib.parse
import zipfile

BASE = Path(__file__).resolve().parents[1]
HOST = os.environ.get('FESTIVAL_SSH_HOST', 'root@your-server')
ROOT = '/var/www/hpfs/site'
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST]
SCP = ['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, **kwargs)


def ssh_python(code, *args):
    command = 'python3 - ' + ' '.join(shlex.quote(str(x)) for x in args)
    return run(SSH + [command], input=code, text=True).stdout


def sha(data):
    return hashlib.sha256(data).hexdigest()


def package(output, web_demo=False):
    source = BASE / 'game'
    if source.is_symlink() or not source.is_dir():
        raise RuntimeError('game/ must be a real directory, not a symlink')
    files = []
    for directory, dirs, names in os.walk(source, followlinks=False):
        for name in dirs + names:
            path = Path(directory) / name
            if path.is_symlink():
                raise RuntimeError(f'Symlink source rejected: {path.relative_to(source)}')
        for name in names:
            path = Path(directory) / name
            if not path.is_file():
                raise RuntimeError(f'Non-regular source rejected: {path}')
            if name == '.DS_Store':
                continue
            relative = path.relative_to(source).as_posix()
            if not re.fullmatch(r'[A-Za-z0-9_./-]+', relative):
                raise RuntimeError(f'Unsafe release filename: {relative}')
            files.append((relative, path.read_bytes()))
    if web_demo:
        files = [(name, data.replace(b'</body>', b'<script src="./web-demo.js"></script></body>') if name == 'index.html' else data) for name, data in files]
        files.append(('web-demo.js', (BASE / 'web-demo/host.js').read_bytes()))
        for source in sorted((BASE / 'content-studio').iterdir()):
            if source.name in ['index.html','app.js','styles.css','validation.js','assets.json','game-files.json','zip.js']:
                data = source.read_bytes().replace(b'../game/', b'../')
                files.append(('mn/' + source.name, data))
    filemap = dict(files)
    for required in ['index.html', 'app.js', 'engine.js', 'styles.css', 'content/scenarios.json']:
        if required not in filemap or not filemap[required]:
            raise RuntimeError(f'Missing/empty {required}')
    json.loads(filemap['content/scenarios.json'])
    total = sum(len(data) for _, data in files)
    if total > 5_000_000:
        raise RuntimeError(f'Release exceeds 5 MB: {total}')
    # Reject obvious external runtime requests; URLs in docs are not shipped.
    for name, data in files:
        if name.endswith(('.html', '.css', '.js')):
            text = data.decode('utf-8')
            if re.search(r'(?:src|href)\s*=\s*[\"\'](?:https?:)?//|url\(\s*[\"\']?(?:https?:)?//|(?:fetch|import)\s*\(\s*[\"\']https?://', text, re.I):
                raise RuntimeError(f'External runtime resource in {name}')
    manifest = {name: {'bytes': len(data), 'sha256': sha(data)} for name, data in sorted(files)}
    archive = output / 'festival-release.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in sorted(files):
            z.writestr(name, data)
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:
            raise RuntimeError('Archive integrity failed')
    (output / 'manifest.json').write_text(json.dumps({'totalBytes': total, 'files': manifest}, indent=2))
    return archive, manifest, total


def http_snapshot(output, prefix, paths):
    snapshots = {}
    for path in paths:
        body = run(['curl', '--fail', '--silent', '--show-error', '--retry', '2', '--retry-delay', '1', '--retry-all-errors', '--location', '--max-time', '30',
                    '--header', 'Cache-Control: no-cache', 'https://hpfs.ru' + path]).stdout
        snapshots[path] = {'bytes': len(body), 'sha256': sha(body)}
    (output / f'{prefix}.json').write_text(json.dumps(snapshots, indent=2))
    return snapshots


def confirm_nginx(config):
    """Conservative check: hpfs TLS servers must use expected root, no sber override."""
    clean = re.sub(r'#.*', '', config)
    blocks, stack = [], []
    start = 0
    for match in re.finditer(r'[{}]', clean):
        if match[0] == '{':
            header = clean[start:match.start()].strip().split(';')[-1].strip()
            stack.append((header, match.end()))
        elif stack:
            header, content_start = stack.pop()
            if header == 'server':
                blocks.append(clean[content_start:match.start()])
        start = match.end()
    def serves_hpfs(block):
        names = re.findall(r'server_name\s+([^;]+);', block)
        return any({'hpfs.ru', 'www.hpfs.ru'}.intersection(value.split()) for value in names)
    relevant = [b for b in blocks if serves_hpfs(b)
                and re.search(r'listen\s+[^;]*443', b)]
    if not relevant:
        raise RuntimeError('No hpfs.ru TLS server block confirmed; inspect nginx manually')
    for block in relevant:
        roots = re.findall(r'\broot\s+([^;]+);', block)
        if not roots or roots[0].strip().rstrip('/') != ROOT:
            raise RuntimeError('hpfs TLS root differs from expected path; manual review required')
        for header, body in re.findall(r'location\s+([^{};]*sber[^{};]*)\{([^{}]*)\}', block):
            route = (' '.join(header.split()), ' '.join(body.split()))
            known = {('= /sber', 'return 301 /sber/;'),
                     ('^~ /sber/', 'try_files $uri $uri/ =404;')}
            if route not in known:
                raise RuntimeError('Unrecognized sber nginx route; manual review required')


INSPECT = r'''
from pathlib import Path
import hashlib,json,os
root=Path('/var/www/hpfs/site'); target=root/'sber'
if not root.is_dir() or root.is_symlink() or root.resolve()!=root:
    raise SystemExit('Expected static root must be a real directory')
if target.is_symlink() or (target.exists() and not target.is_dir()):
    raise SystemExit('Existing sber must be a real directory')
protected={}
for p in [root/'index.html', root/'hse_hw'/'index.html', Path('/var/www/hpfs/app/server.cjs')]:
    if p.is_file():protected[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
print(json.dumps({'root':str(root),'targetExists':target.exists(),'device':root.stat().st_dev,'protected':protected}))
'''

STAGE = r'''
from pathlib import Path
import json,os,sys
release=Path(sys.argv[1]); root=Path('/var/www/hpfs/site')
if not release.parent.is_dir() or release.parent.is_symlink():raise SystemExit('Unexpected releases directory')
release.mkdir(mode=0o755)
if release.stat().st_dev!=root.stat().st_dev:raise SystemExit('Release and site must share filesystem')
print('Release directory created')
'''

ACTIVATE = r'''
from pathlib import Path,PurePosixPath
import ctypes,hashlib,json,os,sys,zipfile
release=Path(sys.argv[1]); expected=sys.argv[2]; root=Path('/var/www/hpfs/site');target=root/'sber'
archive=release/'festival-release.zip';stage=release/'site';backup=release/'previous-sber'
if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise SystemExit('Upload checksum mismatch')
if root.is_symlink() or root.resolve()!=root or target.is_symlink():raise SystemExit('Unexpected symlink')
stage.mkdir(mode=0o755)
with zipfile.ZipFile(archive) as z:
    for info in z.infolist():
        p=PurePosixPath(info.filename)
        if p.is_absolute() or '..' in p.parts or info.is_dir() or ((info.external_attr>>16)&0o170000)==0o120000:
            raise SystemExit('Unsafe archive member')
        dest=stage/str(p);dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_bytes(z.read(info));dest.chmod(0o644)
if not (stage/'index.html').is_file():raise SystemExit('Missing staged index')
def exchange(a,b):
    libc=ctypes.CDLL(None,use_errno=True)
    fn=getattr(libc,'renameat2',None)
    if fn is None:raise RuntimeError('Atomic renameat2 unavailable; no switch performed')
    if fn(-100,os.fsencode(a),-100,os.fsencode(b),2)!=0:
        raise OSError(ctypes.get_errno(),'Atomic exchange failed')
had_previous=target.exists()
record=release/'activated.json'
# Prepare recovery record before mutation; restore exchange if backup naming fails.
record.write_text(json.dumps({'hadPrevious':had_previous,'target':str(target),'backup':str(backup)}))
if had_previous:
    if not target.is_dir():raise SystemExit('Target is not a directory')
    exchange(stage,target)
    try:os.rename(stage,backup)
    except BaseException:
        exchange(stage,target)
        raise
else:os.rename(stage,target)
print(json.dumps({'active':str(target),'hadPrevious':had_previous,'backup':str(backup)}))
'''

ROLLBACK = r'''
from pathlib import Path
import ctypes,json,os,sys
release=Path(sys.argv[1]);record=json.loads((release/'activated.json').read_text());target=Path('/var/www/hpfs/site/sber')
if target.is_symlink() or not target.is_dir():raise SystemExit('Unexpected rollback target')
if record['hadPrevious']:
    backup=release/'previous-sber'
    if backup.is_symlink() or not backup.is_dir():raise SystemExit('Missing prior release')
    fn=ctypes.CDLL(None,use_errno=True).renameat2
    if fn(-100,os.fsencode(target),-100,os.fsencode(backup),2)!=0:raise OSError(ctypes.get_errno(),'Rollback exchange failed')
else:os.rename(target,release/'rolled-back-site')
print('Rolled back only /var/www/hpfs/site/sber')
'''


def main():
    global SSH, SCP
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--web-demo', action='store_true', help='Include website-only sharing host, excluded from native delivery')
    parser.add_argument('--deploy', action='store_true', help='Enable baseline HTTP, SSH inspection and deployment')
    parser.add_argument('--rollback', metavar='RELEASE', help='Rollback a named release after explicit operator selection')
    parser.add_argument('--ssh-control-socket', help='Reuse a user-opened temporary SSH connection')
    args = parser.parse_args()
    if args.ssh_control_socket:
        control = Path(args.ssh_control_socket)
        info = control.lstat()
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
            parser.error('SSH control socket must belong to the current user')
        option = ['-o', 'ControlPath=' + str(control)]
        SSH = SSH[:-1] + option + SSH[-1:]
        SCP += option
    if args.rollback:
        if not re.fullmatch(r'\d{8}T\d{6}Z-festival-[a-f0-9]{8}', args.rollback):
            parser.error('Invalid release identifier')
        print(ssh_python(ROLLBACK, '/var/www/hpfs/releases/' + args.rollback))
        return
    output = BASE / 'output' / 'deployment' / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output.mkdir(parents=True, exist_ok=False)
    archive, manifest, total = package(output, args.web_demo)
    archive_sha = sha(archive.read_bytes())
    print(f'Local release: {len(manifest)} files, {total} bytes; archive {archive_sha}')
    if not args.deploy:
        print('Local check only. No HTTP or SSH performed. Add --deploy when SSH is ready.')
        return
    # These are GETs only, before any SSH inspection/staging.
    baseline = http_snapshot(output, 'baseline-http', ['/', '/hse_hw/'])
    config = run(SSH + ['nginx -T'], text=True).stdout
    config_path = output / 'nginx-before.txt'
    config_path.write_text(config); config_path.chmod(0o600)
    confirm_nginx(config)
    before = json.loads(ssh_python(INSPECT))
    (output / 'baseline-files.json').write_text(json.dumps(before, indent=2))
    release_id = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-festival-' + archive_sha[:8]
    release = '/var/www/hpfs/releases/' + release_id
    (output / 'release.txt').write_text(release + '\n')
    print('Read-only nginx/root checks passed. Staging only game files.')
    ssh_python(STAGE, release)
    run(SCP + [str(archive), HOST + ':' + release + '/festival-release.zip'])
    activated = False
    try:
        result = ssh_python(ACTIVATE, release, archive_sha)
        activated = True
        (output / 'activated.json').write_text(result)
        # Every deployed file must match, including HTML: SPA fallback cannot pass.
        for name, metadata in manifest.items():
            url = 'https://hpfs.ru/sber/' + urllib.parse.quote(name, safe='/')
            data = run(['curl', '--fail', '--silent', '--show-error', '--retry', '2', '--retry-delay', '1', '--retry-all-errors', '--max-time', '30',
                        '--header', 'Cache-Control: no-cache', url]).stdout
            if sha(data) != metadata['sha256']:
                raise RuntimeError(f'Public file checksum differs: {name}')
        entry = run(['curl', '--fail', '--silent', '--show-error', '--retry', '2', '--retry-delay', '1', '--retry-all-errors', '--max-time', '30',
                     '--header', 'Cache-Control: no-cache', 'https://hpfs.ru/sber/']).stdout
        if sha(entry) != manifest['index.html']['sha256']:
            raise RuntimeError('Public directory entry is not the game; inspect scoped nginx routing')
        after = http_snapshot(output, 'after-http', ['/', '/hse_hw/'])
        if baseline != after:
            raise RuntimeError('Protected public page hashes changed; investigate concurrent changes')
        inspect_after = json.loads(ssh_python(INSPECT))
        if before['protected'] != inspect_after['protected']:
            raise RuntimeError('Protected file hashes changed')
        config_after = run(SSH + ['nginx -T'], text=True).stdout
        if sha(config.encode()) != sha(config_after.encode()):
            raise RuntimeError('nginx configuration changed during deployment')
    except Exception:
        if activated:
            print('Post-deploy check failed: restoring only sber from backup.', file=sys.stderr)
            ssh_python(ROLLBACK, release)
        raise
    rollback = f'python3 scripts/deploy_hpfs.py --rollback {release_id}'
    if args.ssh_control_socket:
        rollback += ' --ssh-control-socket ' + shlex.quote(args.ssh_control_socket)
    (output / 'rollback.txt').write_text(rollback + '\n')
    print('Verified: https://hpfs.ru/sber/; protected page/file hashes unchanged.')
    print('Rollback: ' + rollback)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError) as exc:
        print('Deployment stopped: ' + str(exc), file=sys.stderr)
        sys.exit(1)
