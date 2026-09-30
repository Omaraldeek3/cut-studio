"""Install a private, checksum-verified libcdr runtime (Python 3.14+, Windows x64).

Only extracts regular runtime DLLs and cdr2xhtml; no installers or package scripts.
Upstream package URLs, hashes and license metadata are saved for reproducibility.
"""
from pathlib import Path
from urllib.request import urlopen, Request
import hashlib
import io
import json
import re
import tarfile
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.tools' / 'cdr'
LOCK = ROOT / 'scripts' / 'cdr-runtime-lock.json'
PACKAGES = ['libcdr', 'librevenge', 'icu', 'lcms2', 'zlib', 'gcc-libs', 'libwinpthread', 'libiconv', 'bzip2']

def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': 'CutStudio-local-converter-setup/1'}), timeout=90) as response:
        return response.read()

def resolve(name):
    package = 'mingw-w64-x86_64-' + name
    page = fetch('https://packages.msys2.org/packages/' + package).decode()
    url = re.search(r'https://mirror\.msys2\.org/mingw/mingw64/[^"<>\s]+\.pkg\.tar\.zst', page).group(0)
    sha = re.search(r'(?<![a-f0-9])[a-f0-9]{64}(?![a-f0-9])', page).group(0)
    return {'package': package, 'url': url, 'sha256': sha}

def obtain(item):
    cache = RUNTIME / 'packages' / item['url'].rsplit('/', 1)[-1]
    data = cache.read_bytes() if cache.exists() else fetch(item['url'])
    if hashlib.sha256(data).hexdigest() != item['sha256']:
        raise RuntimeError('Checksum mismatch: ' + item['package'])
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(data)
    return item, data

def main():
    if LOCK.exists():
        packages = json.loads(LOCK.read_text())['packages']
    else:
        with ThreadPoolExecutor(max_workers=5) as pool:
            packages = list(pool.map(resolve, PACKAGES))
    (RUNTIME / 'bin').mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for item, data in pool.map(obtain, packages):
            with tarfile.open(fileobj=io.BytesIO(data), mode='r:zst') as archive:
                for member in archive:
                    if not member.isfile():
                        continue
                    path = Path(member.name)
                    is_binary = member.name.startswith('mingw64/bin/') and (path.suffix.lower() == '.dll' or path.name == 'cdr2xhtml.exe')
                    is_license = '/licenses/' in member.name or path.name in ('.PKGINFO', '.BUILDINFO')
                    if not (is_binary or is_license):
                        continue
                    destination = RUNTIME / ('bin' if is_binary else 'licenses/' + item['package']) / path.name
                    if not destination.resolve().is_relative_to(RUNTIME.resolve()):
                        raise RuntimeError('Unsafe archive path')
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(archive.extractfile(member).read())
            print('Installed ' + item['package'], flush=True)
    LOCK.write_text(json.dumps({'source': 'Official MSYS2 mingw64 packages', 'packages': packages}, indent=2) + '\n')
    print('CDR runtime: ' + str(RUNTIME / 'bin' / 'cdr2xhtml.exe'))

if __name__ == '__main__':
    main()
