"""Unit tests for :mod:`src.services.lexicon_healthcheck`."""

from __future__ import annotations

import textwrap
from pathlib import Path

from src.services.drill_tokens import DRILL_TOKEN_DISPLAY_MAP
from src.services.lexicon_healthcheck import check_lexicon


def _write_pls(tmp_path: Path, graphemes: list[str]) -> Path:
    lexemes = "\n".join(
        f"  <lexeme><grapheme>{g}</grapheme><phoneme>θ</phoneme></lexeme>"
        for g in graphemes
    )
    body = textwrap.dedent(
        """\
        <?xml version="1.0" encoding="UTF-8"?>
        <lexicon version="1.0"
                 xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"
                 alphabet="ipa" xml:lang="en-GB">
        {lexemes}
        </lexicon>
        """
    ).format(lexemes=lexemes)
    path = tmp_path / "lexicon.xml"
    path.write_text(body, encoding="utf-8")
    return path


class TestCheckLexicon:
    def test_ok_when_all_required_tokens_present(self, tmp_path: Path) -> None:
        tokens = list(DRILL_TOKEN_DISPLAY_MAP.keys())
        path = _write_pls(tmp_path, tokens)
        result = check_lexicon(str(path))
        assert result.ok is True
        assert result.missing_tokens == []
        assert result.graphemes_found >= len(tokens)

    def test_fails_when_token_missing(self, tmp_path: Path) -> None:
        tokens = list(DRILL_TOKEN_DISPLAY_MAP.keys())
        path = _write_pls(tmp_path, tokens[:-1])  # drop last token
        result = check_lexicon(str(path))
        assert result.ok is False
        assert tokens[-1] in result.missing_tokens

    def test_reports_per_sound_coverage(self, tmp_path: Path) -> None:
        path = _write_pls(tmp_path, ["TH_THIN_MODEL"])
        result = check_lexicon(
            str(path),
            required_tokens=["TH_THIN_MODEL", "F_FIN_MODEL"],
        )
        assert result.per_sound_coverage == {
            "th": {"required": 1, "covered": 1},
            "f": {"required": 1, "covered": 0},
        }

    def test_fails_on_missing_file(self, tmp_path: Path) -> None:
        result = check_lexicon(str(tmp_path / "does-not-exist.xml"))
        assert result.ok is False
        assert result.error is not None
        assert "does not exist" in result.error

    def test_fails_on_malformed_xml(self, tmp_path: Path) -> None:
        path = tmp_path / "broken.xml"
        path.write_text("<not-a-lexicon/>", encoding="utf-8")
        result = check_lexicon(str(path))
        assert result.ok is False
        assert "not a PLS document" in (result.error or "")

    def test_real_repo_lexicon_covers_drill_tokens(self) -> None:
        """The checked-in PLS must cover every frontend drill token."""
        repo_root = Path(__file__).resolve().parents[3]
        lexicon_path = repo_root / "data" / "lexicons" / "wulo.pls"
        if not lexicon_path.exists():
            import pytest

            pytest.skip(f"lexicon not present at {lexicon_path}")
        result = check_lexicon(str(lexicon_path))
        assert result.ok is True, (
            f"wulo.pls is missing tokens: {result.missing_tokens}"
        )
