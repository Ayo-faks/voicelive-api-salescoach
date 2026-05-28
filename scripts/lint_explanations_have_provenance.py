"""CI lint: enforce "no citation, no answer" at construction sites.

Pydantic already fails closed at runtime — but a missing test path could let
an unreachable construction site slip into the codebase. This linter does an
AST walk over the backend source tree and fails the build if any
`ExplanationResult(...)` literal is constructed without a non-empty
`wiki_citations=` keyword.

Rules checked at each `ExplanationResult(...)` call site:
  1. A `wiki_citations=` keyword MUST be present.
  2. If the value is a List literal, it MUST be non-empty.
  3. `**kwargs` spreads are flagged as ambiguous (warning, not fatal).

Usage:
    python scripts/lint_explanations_have_provenance.py [path ...]

Exit codes:
    0 — clean.
    1 — at least one violation found.
    2 — usage / IO error.

MVP §4.1; risk R1 in §7a.1.
"""

from __future__ import annotations

import argparse
import ast
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TARGETS = (REPO_ROOT / "backend" / "src",)
TARGET_CALLABLE = "ExplanationResult"
REQUIRED_KW = "wiki_citations"
# Files we never lint (the contract definition itself + its tests + fixtures).
EXCLUDE_SUFFIXES = (
    "backend/src/learning/models.py",
    "backend/tests/",
)


@dataclass(frozen=True)
class Violation:
    path: Path
    lineno: int
    col_offset: int
    message: str

    def render(self) -> str:
        return f"{self.path}:{self.lineno}:{self.col_offset}: {self.message}"


def _is_target_call(node: ast.Call) -> bool:
    func = node.func
    if isinstance(func, ast.Name) and func.id == TARGET_CALLABLE:
        return True
    if isinstance(func, ast.Attribute) and func.attr == TARGET_CALLABLE:
        return True
    return False


def _check_call(node: ast.Call, path: Path) -> List[Violation]:
    violations: List[Violation] = []
    citations_kw = None
    has_kwargs_spread = False
    for kw in node.keywords:
        if kw.arg is None:
            has_kwargs_spread = True
            continue
        if kw.arg == REQUIRED_KW:
            citations_kw = kw

    if citations_kw is None:
        if has_kwargs_spread:
            # Ambiguous: a **kwargs may carry citations. Warn but don't fail.
            violations.append(
                Violation(
                    path=path,
                    lineno=node.lineno,
                    col_offset=node.col_offset,
                    message=(
                        f"WARN: {TARGET_CALLABLE}(**kwargs) — cannot statically "
                        f"verify {REQUIRED_KW!r} is present. Pass it explicitly."
                    ),
                )
            )
        else:
            violations.append(
                Violation(
                    path=path,
                    lineno=node.lineno,
                    col_offset=node.col_offset,
                    message=(
                        f"{TARGET_CALLABLE}(...) missing required keyword "
                        f"{REQUIRED_KW!r}: no citation, no answer (MVP §4.1)."
                    ),
                )
            )
        return violations

    value = citations_kw.value
    if isinstance(value, (ast.List, ast.Tuple, ast.Set)) and not value.elts:
        violations.append(
            Violation(
                path=path,
                lineno=value.lineno,
                col_offset=value.col_offset,
                message=(
                    f"{TARGET_CALLABLE}({REQUIRED_KW}=[]) — empty literal forbidden: "
                    f"no citation, no answer (MVP §4.1)."
                ),
            )
        )
    return violations


def _scan_file(path: Path) -> List[Violation]:
    try:
        source = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [Violation(path=path, lineno=0, col_offset=0, message=f"IO error: {exc}")]
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as exc:
        return [Violation(path=path, lineno=exc.lineno or 0, col_offset=exc.offset or 0,
                          message=f"SyntaxError: {exc.msg}")]

    violations: List[Violation] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _is_target_call(node):
            violations.extend(_check_call(node, path))
    return violations


def _iter_python_files(paths: Iterable[Path]) -> Iterable[Path]:
    for root in paths:
        if root.is_file() and root.suffix == ".py":
            yield root
            continue
        if not root.is_dir():
            continue
        for path in root.rglob("*.py"):
            posix = path.as_posix()
            if any(posix.endswith(suffix) or f"/{suffix}" in posix for suffix in EXCLUDE_SUFFIXES):
                continue
            yield path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", type=Path, default=list(DEFAULT_TARGETS))
    parser.add_argument(
        "--allow-warnings",
        action="store_true",
        help="Treat WARN-prefixed messages as non-fatal.",
    )
    args = parser.parse_args(argv)

    all_violations: List[Violation] = []
    for path in _iter_python_files(args.paths):
        all_violations.extend(_scan_file(path))

    if not all_violations:
        print("lint_explanations_have_provenance: clean.")
        return 0

    fatal = 0
    for v in all_violations:
        print(v.render())
        if v.message.startswith("WARN:") and args.allow_warnings:
            continue
        fatal += 1

    if fatal:
        print(f"lint_explanations_have_provenance: {fatal} violation(s).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
