"""Unit tests for :mod:`src.services.drill_tokens`.

Ensures the Python mirror of ``frontend/src/utils/drillTokens.ts`` stays in
sync with the TypeScript source of truth.
"""

from __future__ import annotations

import re
from pathlib import Path

from src.services.drill_tokens import DRILL_TOKEN_DISPLAY_MAP, resolve_drill_token


_TS_ENTRY = re.compile(r"^\s*([A-Z][A-Z0-9_]+):\s*'([^']*)'", re.MULTILINE)


def _load_ts_map() -> dict[str, str]:
    repo_root = Path(__file__).resolve().parents[3]
    ts_path = repo_root / "frontend" / "src" / "utils" / "drillTokens.ts"
    if not ts_path.exists():
        return {}
    source = ts_path.read_text(encoding="utf-8")
    return {match.group(1): match.group(2) for match in _TS_ENTRY.finditer(source)}


class TestDrillTokens:
    def test_known_token_resolves(self) -> None:
        assert resolve_drill_token("TH_THIN_MODEL") == "th-in, thin"

    def test_unknown_token_returns_input(self) -> None:
        assert resolve_drill_token("UNKNOWN_TOKEN") == "UNKNOWN_TOKEN"

    def test_map_in_sync_with_frontend(self) -> None:
        ts_map = _load_ts_map()
        if not ts_map:
            import pytest

            pytest.skip("frontend drillTokens.ts not present")
        py_map = dict(DRILL_TOKEN_DISPLAY_MAP)
        assert py_map == ts_map, (
            f"Python and TS drill token maps drifted. "
            f"Only in Python: {set(py_map) - set(ts_map)}. "
            f"Only in TS: {set(ts_map) - set(py_map)}."
        )
