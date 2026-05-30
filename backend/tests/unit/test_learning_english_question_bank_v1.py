"""Contract tests for the W4 English question bank seed (JSS3 + SS3)."""

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
    / "english_jss3_ss3_v1.json"
)


@pytest.fixture(scope="module")
def bank() -> dict:
    with BANK_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(scope="module")
def items(bank: dict) -> list[DiagnosticItem]:
    return [DiagnosticItem.model_validate(raw) for raw in bank["items"]]


def test_bank_header_pins_taxonomy_and_metadata(bank: dict) -> None:
    assert bank["bank_id"] == "english-jss3-ss3-v1"
    assert bank["lang"] == "en"
    assert bank["subject"] == "english"
    assert bank["taxonomy_version"] == TAXONOMY_VERSION
    assert bank["review_state"] == "approved"
    assert set(bank["year_groups"]) == {"JSS3", "SS3"}


def test_bank_contains_two_hundred_items(items: list[DiagnosticItem]) -> None:
    # MVP §9 W4 deliverable: 200 English questions.
    assert len(items) >= 200


def test_every_item_validates_as_diagnostic_item(items: list[DiagnosticItem]) -> None:
    assert all(isinstance(item, DiagnosticItem) for item in items)


def test_every_item_has_at_least_one_misconception_code(items: list[DiagnosticItem]) -> None:
    for item in items:
        assert item.misconception_codes, f"{item.item_id} has no misconception_codes"
        assert item.taxonomy_version == TAXONOMY_VERSION


def test_every_item_subject_is_english(items: list[DiagnosticItem]) -> None:
    for item in items:
        assert item.subject == "english", item.item_id


def test_jss3_ss3_balance_is_within_tolerance(items: list[DiagnosticItem]) -> None:
    counts = Counter(item.year_group for item in items)
    assert counts["JSS3"] >= 95
    assert counts["SS3"] >= 95
    assert counts["JSS3"] + counts["SS3"] == len(items)


def test_difficulty_is_in_seed_range(items: list[DiagnosticItem]) -> None:
    for item in items:
        assert -3.0 <= item.difficulty <= 3.0, item.item_id


def test_item_ids_are_unique(items: list[DiagnosticItem]) -> None:
    ids = [item.item_id for item in items]
    assert len(set(ids)) == len(ids)


def test_codes_are_subject_appropriate(items: list[DiagnosticItem]) -> None:
    english_codes = {c.value for c in codes_for_subject("english")}
    for item in items:
        for code in item.misconception_codes:
            assert code in english_codes, (
                f"{item.item_id} uses code {code} that is not in scope for english"
            )


def test_provenance_marks_owner_approved(items: list[DiagnosticItem]) -> None:
    for item in items:
        assert item.provenance, item.item_id
        head = item.provenance[0]
        assert head.metadata.get("review_state") == "approved"
        assert head.metadata.get("subject_lead_approved") is True
        assert head.metadata.get("safeguarding_reviewed") is True


def test_top_misconceptions_have_minimum_coverage(items: list[DiagnosticItem]) -> None:
    counts: Counter[str] = Counter()
    for item in items:
        counts.update(item.misconception_codes)
    # English-relevant high-frequency codes per MVP §9 W4.
    common = {
        MisconceptionCode.LANGUAGE_COMPREHENSION.value,
        MisconceptionCode.ANSWER_FORM.value,
        MisconceptionCode.MISREAD_QUESTION.value,
        MisconceptionCode.TRANSCRIPTION.value,
        MisconceptionCode.CARELESS.value,
        MisconceptionCode.COMPUTATION_SLIP.value,
    }
    for code in common:
        assert counts[code] >= 3, f"{code} only appears {counts[code]} times"


def test_loader_returns_english_bank_when_flag_on(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.learning import question_banks
    from src.learning.question_banks import (
        QUESTION_BANK_V1_FLAG,
        load_english_v1_bank,
        reset_cache,
    )

    monkeypatch.setenv(QUESTION_BANK_V1_FLAG, "1")
    reset_cache()
    try:
        bank = load_english_v1_bank()
        assert bank.bank_id == "english-jss3-ss3-v1"
        assert bank.subject == "english"
        assert bank.taxonomy_version == TAXONOMY_VERSION
        assert len(bank.items) >= 200
        # Owner-approved -> all items promotable to learners.
        assert len(bank.promotable_items()) == len(bank.items)
    finally:
        reset_cache()
    assert question_banks.ENGLISH_V1_BANK_PATH.exists()
