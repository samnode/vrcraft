#!/usr/bin/env python3
"""Stamp a version onto every module URL so a deploy is atomic.

GitHub Pages serves assets with max-age=600 and offers no way to change that.
Without versioned URLs a returning visitor can get a fresh module alongside a
cached one, and if an export moved between them the page dies with a module
error rather than merely behaving like the old build. Appending ?v=N to every
import specifier makes each release a distinct set of URLs, so a browser either
has the whole old graph or fetches the whole new one.

The query lives in the specifier string, which relative resolution preserves, so
this needs no bundler and no import map.

    python3 release.py 7
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"

if len(sys.argv) != 2 or not sys.argv[1].isdigit():
    sys.exit("usage: python3 release.py <version-number>")

version = sys.argv[1]
changed = []

# Every relative import in every module, including the vendored three.js.
import_re = re.compile(r"""(from\s+['"])([^'"]+?\.js)(\?v=\d+)?(['"])""")

for path in sorted(SRC.glob("*.js")):
    text = path.read_text()
    new = import_re.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={version}{m.group(4)}", text)
    if path.name == "main.js":
        new = re.sub(r"const BUILD = '[^']*'", f"const BUILD = 'build {version}'", new)
    if new != text:
        path.write_text(new)
        changed.append(path.name)

index = ROOT / "index.html"
html = index.read_text()
new_html = re.sub(r'(src="\./src/main\.js)(\?v=\d+)?(")', rf'\1?v={version}\3', html)
if new_html != html:
    index.write_text(new_html)
    changed.append("index.html")

print(f"stamped v{version} onto {len(changed)} files:")
for name in changed:
    print(f"  {name}")
