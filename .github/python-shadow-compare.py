"""Compares the two pipeline copies the Python shadow test wrote (see
python-shadow-test.sh). Differences that are only run timestamps are counted
but not shown; anything else is printed as a short diff and listed in the job
summary. Exits 0 either way: differing numbers are for a person to judge."""
import difflib
import os
import re
import sys

A, B, OLD, NEW, GROUP = sys.argv[1:6]
SKIP_DIRS = {".git", "__pycache__"}
STAMP = re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?")


def files(root):
    out = set()
    for d, dirs, names in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        out.update(os.path.relpath(os.path.join(d, n), root) for n in names)
    return out


def read(path):
    with open(path, "rb") as f:
        return f.read()


fa, fb = files(A), files(B)
only = sorted(fa ^ fb)
stamp_only, real = [], []
for rel in sorted(fa & fb):
    a, b = read(os.path.join(A, rel)), read(os.path.join(B, rel))
    if a == b:
        continue
    try:
        ta, tb = a.decode(), b.decode()
    except UnicodeDecodeError:
        real.append((rel, ["(binary file differs)"]))
        continue
    na, nb = STAMP.sub("<time>", ta), STAMP.sub("<time>", tb)
    if na == nb:
        stamp_only.append(rel)
        continue
    diff = [l for l in difflib.unified_diff(na.splitlines(), nb.splitlines(), OLD, NEW, n=0, lineterm="")
            if not l.startswith("@@")]
    real.append((rel, diff))

print(f"{len(stamp_only)} files differ only in run timestamps")
for rel in only:
    print(f"only in {'OLD' if rel in fa else 'NEW'} copy: {rel}")
for rel, diff in real:
    print(f"\n=== {rel} ({len(diff)} diff lines)")
    print("\n".join(diff[:40]))

lines = [f"### {GROUP}: Python {OLD} vs {NEW}",
         f"- {len(stamp_only)} files differ only in run timestamps",
         f"- {len(only)} files written by only one version",
         f"- {len(real)} files with other differences"]
lines += [f"  - `{rel}` ({len(diff)} diff lines)" for rel, diff in real[:30]]
lines += [f"  - only in one copy: `{rel}`" for rel in only[:30]]
with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a") as f:
    f.write("\n".join(lines) + "\n")
if real or only:
    print(f"::warning::{GROUP}: {len(real)} files differ beyond timestamps, {len(only)} written by only one version (see the job summary)")
