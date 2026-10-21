"""Fail if any source file is over the size limit in CLAUDE.md ("Readable code").

Ruff has no file-length rule, and ESLint's max-lines covers TypeScript, so this
covers the Python files. Run: python3 tests/check_sizes.py
"""
import sys
from pathlib import Path

LIMIT = 500
root = Path(__file__).resolve().parent.parent
too_big = [(p, n) for p in sorted([root / "main.py", *(root / "defaults").glob("*.py")])
           if (n := len(p.read_text().splitlines())) > LIMIT]
for path, lines in too_big:
    print(f"{path.relative_to(root)}: {lines} lines (limit {LIMIT})")
sys.exit(1 if too_big else 0)
