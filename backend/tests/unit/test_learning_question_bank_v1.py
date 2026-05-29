"""Contract tests for the W1 Maths question bank seed (JSS3 + SS3)."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from src.learning.misconceptions import (
    TAXONOMY_VERSION,
    MisconceptionCode,
    codes_for_subject,
)
from src.learning.models import DiagnosticItem


BANK_PATH = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "question_banks"
    / "maths_jss3_ss3_v1.json"
)


@pytest.fixture(scope="module")
def bank() -> dict:
    with BANK_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(scope="module")
def items(bank: dict) -> list[DiagnosticItem]:
    return [DiagnosticItem.model_validate(raw) for raw in bank["items"]]


def test_bank_header_pins_taxonomy_and_metadata(bank: dict) -> None:
    assert bank["bank_id"] == "maths-jss3-ss3-v1"
    assert bank["lang"] == "en"
    assert bank["subject"] == "maths"
    assert bank["taxonomy_version"] == TAXONOMY_VERSION
    assert bank["review_state"] == "pending_two_reviewer_signoff"
    assert set(bank["year_groups"]) == {"JSS3", "SS3"}


def test_bank_contains_at_least_one_hundred_items(items: list[DiagnosticItem]) -> None:
    assert len(items) >= 100


def test_every_item_validates_as_diagnostic_item(items: list[DiagnosticItem]) -> None:
    # Already validated by the fixture, but assert the count to guard against
    # silent fixture changes.
    assert all(isinstance(item, DiagnosticItem) for item in items)


def test_every_item_has_at_least_one_misconception_code(items: list[DiagnosticItem]) -> None:
    for item in items:
        assert item.misconception_codes, f"{item.item_id} has no misconception_codes"
        assert item.taxonomy_version == TAXONOMY_VERSION


def test_every_item_subject_is_maths(items: list[DiagnosticItem]) -> None:
    for item in items:
        assert item.subject == "maths", item.item_id


def test_jss3_ss3_balance_is_within_tolerance(items: list[DiagnosticItem]) -> None:
    counts = Counter(item.year_group for item in items)
    assert counts["JSS3"] >= 45
    assert counts["SS3"] >= 45
    assert counts["JSS3"] + counts["SS3"] == len(items)


def test_difficulty_is_in_seed_range(items: list[DiagnosticItem]) -> None:
    for item in items:
        assert -3.0 <= item.difficulty <= 3.0, item.item_id


def test_item_ids_are_unique(items: list[DiagnosticItem]) -> None:
    ids = [item.item_id for item in items]
    assert len(set(ids)) == len(ids)


def test_codes_are_subject_appropriate(items: list[DiagnosticItem]) -> None:
    maths_codes = {c.value for c in codes_for_subject("maths")}
    for item in items:
        for code in item.misconception_codes:
            assert code in maths_codes, f"{item.item_id} uses non-maths code {code}"


def test_provenance_marks_review_pending(items: list[DiagnosticItem]) -> None:
    for item in items:
        assert item.provenance, item.item_id
        head = item.provenance[0]
        assert head.metadata.get("review_state") == "pending_two_reviewer_signoff"
        assert head.metadata.get("subject_lead_approved") is False
        assert head.metadata.get("safeguarding_reviewed") is False


def test_top_misconceptions_have_minimum_coverage(items: list[DiagnosticItem]) -> None:
    # Soft eval (W1): the common-in-maths codes should each appear ≥3 times
    # across the seed bank. This becomes a hard gate by W4 once English
    # questions are added (MVP §9 W4).
    counts: Counter[str] = Counter()
    for item in items:
        counts.update(item.misconception_codes)
    common = {
        MisconceptionCode.CALC_ERROR.value,
        MisconceptionCode.SIGN_ERROR.value,
        MisconceptionCode.FRACTION_PART_WHOLE.value,
        MisconceptionCode.ALGEBRA_DISTRIBUTION.value,
        MisconceptionCode.UNIT_CONVERSION.value,
        MisconceptionCode.GEOMETRY_UNITS.value,
        MisconceptionCode.PROBABILITY_COMPLEMENT.value,
        MisconceptionCode.LANGUAGE_COMPREHENSION.value,
    }
    for code in common:
        assert counts[code] >= 3, f"{code} only appears {counts[code]} times"


# ----- Production safeguarding-content gate (MVP step 3) -------------------


def _clear_safety_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in (
        "WULO_REQUIRE_REVIEWED_CONTENT",
        "WULO_ALLOW_UNREVIEWED_CONTENT",
        "IDENTITY_ENDPOINT",
        "WEBSITE_SITE_NAME",
        "CONTAINER_APP_NAME",
    ):
        monkeypatch.delenv(var, raising=False)


def test_production_safe_items_blocks_pending_bank_in_hosted_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.learning.question_banks import (
        QuestionBankUnavailableError,
        load_maths_v1_bank,
        reset_cache,
    )

    _clear_safety_env(monkeypatch)
    monkeypatch.setenv("CONTAINER_APP_NAME", "voicelab")
    reset_cache()
    bank = load_maths_v1_bank(require_flag=False)

    # Bank ships with review_state=pending_two_reviewer_signoff so promotable
    # is empty. In a hosted env this MUST fail loudly, not silently empty.
    assert bank.promotable_items() == ()
    with pytest.raises(QuestionBankUnavailableError):
        bank.production_safe_items()


def test_production_safe_items_allows_when_dev_override_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.learning.question_banks import load_maths_v1_bank, reset_cache

    _clear_safety_env(monkeypatch)
    monkeypatch.setenv("CONTAINER_APP_NAME", "voicelab")
    monkeypatch.setenv("WULO_ALLOW_UNREVIEWED_CONTENT", "1")
    reset_cache()
    bank = load_maths_v1_bank(require_flag=False)

    # Escape hatch makes the gate non-required; falls back to promotable_items()
    # which is still empty for the pending bank but no longer raises.
    assert bank.production_safe_items() == ()


def test_production_safe_items_passthrough_in_non_prod(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.learning.question_banks import load_maths_v1_bank, reset_cache

    _clear_safety_env(monkeypatch)
    reset_cache()
    bank = load_maths_v1_bank(require_flag=False)

    # No hosted markers, no explicit require flag → gate not required.
    assert bank.production_safe_items() == bank.promotable_items()
