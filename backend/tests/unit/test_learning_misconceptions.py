"""Tests for the misconception taxonomy v1."""

from __future__ import annotations

import pytest

from src.learning.misconceptions import (
    TAXONOMY,
    TAXONOMY_VERSION,
    MisconceptionCode,
    MisconceptionEntry,
    codes_for_subject,
    get_entry,
)
from src.learning.models import DiagnosticItem, Provenance


def _prov() -> list[Provenance]:
    return [Provenance(source="test", rule_id="taxonomy_test")]


def test_taxonomy_version_is_semver_pinned() -> None:
    assert TAXONOMY_VERSION == "1.0.0"


def test_taxonomy_covers_every_enum_member_exactly_once() -> None:
    codes_in_table = [entry.code for entry in TAXONOMY]
    assert len(codes_in_table) == len(MisconceptionCode)
    assert set(codes_in_table) == set(MisconceptionCode)
    # No duplicates.
    assert len(set(codes_in_table)) == len(codes_in_table)


def test_taxonomy_has_at_least_twenty_codes() -> None:
    # MVP §4.2: starter taxonomy has ≥20 misconception codes.
    assert len(TAXONOMY) >= 20


def test_every_entry_has_label_description_and_scope() -> None:
    for entry in TAXONOMY:
        assert isinstance(entry, MisconceptionEntry)
        assert entry.label.strip()
        assert entry.description.strip()
        assert entry.subject_scope
        assert all(s in {"maths", "english"} for s in entry.subject_scope)


def test_get_entry_returns_matching_row() -> None:
    entry = get_entry(MisconceptionCode.RATIO_INVERSION)
    assert entry.code is MisconceptionCode.RATIO_INVERSION
    assert "maths" in entry.subject_scope


def test_codes_for_subject_filters_by_scope() -> None:
    maths_codes = set(codes_for_subject("maths"))
    english_codes = set(codes_for_subject("english"))
    # Maths-only codes should not appear in english scope.
    assert MisconceptionCode.RATIO_INVERSION in maths_codes
    assert MisconceptionCode.RATIO_INVERSION not in english_codes
    # Shared codes appear in both.
    assert MisconceptionCode.LANGUAGE_COMPREHENSION in maths_codes
    assert MisconceptionCode.LANGUAGE_COMPREHENSION in english_codes


# ---------------------------------------------------------------------------
# DiagnosticItem schema extension contract
# ---------------------------------------------------------------------------


def _make_item(**overrides: object) -> DiagnosticItem:
    defaults: dict[str, object] = dict(
        item_id="item-1",
        skill_id="skill-1",
        prompt="What is 1 + 1?",
        item_type="short_answer",
        difficulty=0.0,
        correct_answer="2",
        lang="en",
        provenance=_prov(),
    )
    defaults.update(overrides)
    return DiagnosticItem(**defaults)


def test_diagnostic_item_remains_backward_compatible() -> None:
    item = _make_item()
    assert item.misconception_codes == []
    assert item.taxonomy_version is None
    assert item.subject is None
    assert item.year_group is None
    assert item.topic is None
    assert item.subtopic is None


def test_diagnostic_item_accepts_full_taxonomy_tagging() -> None:
    item = _make_item(
        subject="maths",
        year_group="JSS3",
        topic="Ratio and proportion",
        subtopic="Direct proportion",
        misconception_codes=[MisconceptionCode.RATIO_INVERSION.value],
        taxonomy_version=TAXONOMY_VERSION,
    )
    assert item.taxonomy_version == TAXONOMY_VERSION
    assert item.misconception_codes == ["ratio_inversion"]


def test_diagnostic_item_rejects_unknown_code() -> None:
    with pytest.raises(ValueError, match="unknown misconception code"):
        _make_item(
            misconception_codes=["not_a_real_code"],
            taxonomy_version=TAXONOMY_VERSION,
        )


def test_diagnostic_item_rejects_duplicate_codes() -> None:
    with pytest.raises(ValueError, match="duplicate misconception code"):
        _make_item(
            misconception_codes=["calc_error", "calc_error"],
            taxonomy_version=TAXONOMY_VERSION,
        )


def test_diagnostic_item_requires_taxonomy_version_when_tagged() -> None:
    with pytest.raises(ValueError, match="taxonomy_version is required"):
        _make_item(misconception_codes=["calc_error"])


def test_diagnostic_item_rejects_mismatched_taxonomy_version() -> None:
    with pytest.raises(ValueError, match="does not match current"):
        _make_item(
            misconception_codes=["calc_error"],
            taxonomy_version="0.9.0",
        )


def test_diagnostic_item_rejects_unknown_subject() -> None:
    with pytest.raises(ValueError):
        _make_item(subject="science")


def test_diagnostic_item_rejects_unknown_year_group() -> None:
    with pytest.raises(ValueError):
        _make_item(year_group="JSS9")


def test_diagnostic_item_rejects_blank_topic() -> None:
    with pytest.raises(ValueError, match="topic must be non-blank"):
        _make_item(topic="   ")
