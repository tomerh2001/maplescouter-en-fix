"""Verify release packages against the tag and prepare Mozilla's source archive."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile


def run(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def contents(path):
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if not n.endswith('/')]
        if len(names) != len(set(names)):
            raise ValueError(f'Duplicate files in {path}')
        return {name: hashlib.sha256(archive.read(name)).hexdigest() for name in names}


def main():
    version = os.environ['RELEASE_VERSION']
    if not re.fullmatch(r'\d+(?:\.\d+){1,3}', version):
        raise ValueError('Invalid release version')
    tag = 'v' + version
    repo = os.environ['GITHUB_REPOSITORY']
    out = Path('store-release').resolve()
    out.mkdir(exist_ok=False)
    run('git', 'fetch', 'origin', f'refs/tags/{tag}:refs/tags/{tag}')
    release = json.loads(run('gh', 'release', 'view', tag, '--repo', repo, '--json', 'isDraft,isPrerelease,body'))
    if release['isDraft'] or release['isPrerelease']:
        raise ValueError('Only public stable GitHub releases can be submitted')
    packages = ['maplescouter-en-fix-extension.zip', 'maplescouter-en-fix-firefox.zip']
    for name in packages:
        run('gh', 'release', 'download', tag, '--repo', repo, '--pattern', name, '--dir', str(out))
    source = out / 'maplescouter-en-fix-source.zip'
    run('git', 'archive', '--format=zip', '-o', str(source), tag, '--', 'src', 'data', 'build.js', 'build-extension.js', 'extension/manifest.json', 'extension/icons', 'README.md', 'BUILD.md', 'PRIVACY.md', 'LICENSE')
    with tempfile.TemporaryDirectory(prefix='msfix-build-') as work:
        with zipfile.ZipFile(source) as archive:
            archive.extractall(work)
        run('node', 'build.js', cwd=work)
        run('node', 'build-extension.js', cwd=work)
        for name in packages:
            path = out / name
            if contents(path) != contents(Path(work) / 'dist' / name):
                raise ValueError(f'{name} differs from a build of {tag}')
            with zipfile.ZipFile(path) as archive:
                manifest = json.loads(archive.read('manifest.json'))
            if manifest['version'] != version:
                raise ValueError('Manifest does not match requested version')
            gecko = manifest.get('browser_specific_settings', {}).get('gecko')
            if 'firefox' in name:
                if not gecko or gecko['id'] != 'maplescouter-enhancements@tomerh2001.github.io':
                    raise ValueError('Unexpected Firefox identity')
            elif gecko:
                raise ValueError('Firefox manifest found in Chrome package')
    (out / 'release-notes.txt').write_text(release['body'] or f'MapleScouter Enhancements {version}', encoding='utf-8')
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in out.glob('*.zip')}
    (out / 'checksums.json').write_text(json.dumps(hashes, indent=2) + '\n')
    print(f'Verified Chrome, Firefox, and source packages for {tag}')


if __name__ == '__main__':
    main()
