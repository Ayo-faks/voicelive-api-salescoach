"""Contract tests for the question-bank loader and kill switch."""

from __future__ import annotations

import os

import pytest

from src.learning import question_banks
from src.learning.misconceptions import TAXONOMY_VERSION
from src.learning.question_banks import (
    QUESTION_BANK_V1_FLAG,
    QuestionBankUnavailableError,
    load_maths_v1_bank,
    question_bank_v1_enabled,
    reset_cache,
)


@pytest.fixture(autouse=True)
def _clear_state(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(QUESTION_BANK_V1_FLAG, raising=False)
    reset_cache()
    yield
    reset_cache()


def test_flag_is_off_by_default() -> None:
    assert question_bank_v1_enabled() is False


def test_load_raises_when_flag_off() -> None:
    with pytest.raises(QuestionBankUnavailableError):
        load_maths_v1_bank()


@pytest.mark.parametrize("value", ["1", "true", "ON", "yes", "enabled"])
def test_flag_truthy_values_enable_loader(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv(QUESTION_BANK_V1_FLAG, value)
    assert question_bank_v1_enabled() is True
    bank = load_maths_v1_bank()
    assert bank.taxonomy_version == TAXONOMY_VERSION
    assert len(bank.items) >= 100


def test_loader_can_be_forced_for_tests() -> None:
    bank = load_maths_v1_bank(require_flag=False)
    assert bank.subject == "maths"
    assert set(bank.year_groups) == {"JSS3", "SS3"}


def test_promotable_items_served_when_owner_approved() -> None:
    bank = load_maths_v1_bank(require_flag=False)
    assert bank.review_state == "approved"
    assert len(bank.promotable_items()) == len(bank.items)


def test_promotable_items_empty_for_synthetic_pending_bank() -> None:
    import dataclasses

    bank = load_maths_v1_bank(require_flag=False)
    pending = dataclasses.replace(
        bank, review_state="pending_two_reviewer_signoff"
    )
    assert pending.promotable_items() == ()


def test_bank_path_resolves_under_repo() -> None:
    assert question_banks.MATHS_V1_BANK_PATH.exists()
    assert question_banks.MATHS_V1_BANK_PATH.name == "maths_jss3_ss3_v1.json"
