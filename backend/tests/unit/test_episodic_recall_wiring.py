"""Phase 5 follow-up: episodic recall wiring across persistence, the text tutor,
and the voice tutor.

These tests exercise the full consent-gated loop the polish items wire up:

* a wrong diagnostic answer persists the item's misconception tags to the
  episodic store (``answer_diagnostic`` write hook → repository);
* ``ask_assistant`` falls back to that store (working memory absent) only when
  the learner has accepted memory, and surfaces a cross-session trap callback;
* ``run_learner_voice_turn`` opens the greeting with the same callback so the
  voice tutor has parity with the drawer.

The live Playwright smoke (wrong answer → anchored drawer/voice → memory nudge
on a repeat trap) is covered here as a backend integration test because the dev
stack cannot run in the sandbox; the browser pass remains a manual follow-up.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

from src.learning.api import (
    ITEM_BANK_PATH,
    LearningApi,
    PILOT_STUDENT_ID,
    PILOT_TENANT_ID,
)
from src.learning.diagnostic import load_item_bank
from src.learning.repository import InMemoryLearningRepository


def _bank_path() -> Path:
    assert ITEM_BANK_PATH.exists(), f"item bank fixture missing at {ITEM_BANK_PATH}"
    return ITEM_BANK_PATH


class _CaptureProvider:
    """Assistant provider stub that records the context it was asked with."""

    def __init__(self) -> None:
        self.context: Optional[Dict[str, Any]] = None

    def ask(self, question: str, context: Dict[str, Any]) -> Dict[str, Any]:
        self.context = context
        return {"answer": "ok", "citations": []}


def _tagged_api(
    provider: Optional[_CaptureProvider] = None,
) -> LearningApi:
    """Build a LearningApi whose every item carries the same misconception trap.

    Tagging the whole bank makes the wrong-answer write deterministic regardless
    of which item the selector serves first.
    """
    bank = load_item_bank(_bank_path())
    tagged = bank.model_copy(
        update={
            "items": [
                item.model_copy(
                    update={"misconception_codes": ["sign_error"], "topic": "Algebra"}
                )
                for item in bank.items
            ]
        }
    )
    return LearningApi(item_bank=tagged, assistant_provider=provider)


def _start(api: LearningApi) -> Dict[str, Any]:
    return api.start_diagnostic({})


def _answer_wrong(api: LearningApi, session_id: str, item: Dict[str, Any]) -> Dict[str, Any]:
    return api.answer_diagnostic(
        {
            "session_id": session_id,
            "item_id": item["item_id"],
            "response_text": "definitely-wrong-answer",
        }
    )


# ---------------------------------------------------------------------------
# Item 2 — repository persistence
# ---------------------------------------------------------------------------


def test_in_memory_repo_records_and_lists_attempts() -> None:
    repo = InMemoryLearningRepository()
    written = repo.record_misconception_attempts(
        PILOT_TENANT_ID,
        PILOT_STUDENT_ID,
        item_id="item-1",
        skill_id="algebra",
        topic="Algebra",
        misconception_codes=["sign_error", ""],  # blanks are skipped
    )
    assert written == 1
    rows = repo.list_misconception_attempts(PILOT_TENANT_ID, PILOT_STUDENT_ID)
    assert len(rows) == 1
    assert rows[0]["misconception_code"] == "sign_error"
    assert rows[0]["topic"] == "Algebra"
    assert rows[0]["correct"] is False


def test_in_memory_repo_scopes_by_tenant_and_student() -> None:
    repo = InMemoryLearningRepository()
    repo.record_misconception_attempts(
        "tenant-a", "student-a", item_id="i", skill_id="s",
        topic="Algebra", misconception_codes=["sign_error"],
    )
    repo.record_misconception_attempts(
        "tenant-a", "student-b", item_id="i", skill_id="s",
        topic="Algebra", misconception_codes=["sign_error"],
    )
    assert len(repo.list_misconception_attempts("tenant-a", "student-a")) == 1
    assert repo.list_misconception_attempts("tenant-a", "student-c") == []


def test_wrong_diagnostic_answer_persists_misconception_tags() -> None:
    api = _tagged_api()
    started = _start(api)
    session_id = started["session_id"]
    _answer_wrong(api, session_id, started["item"])

    rows = api.repository.list_misconception_attempts(PILOT_TENANT_ID, PILOT_STUDENT_ID)
    assert len(rows) == 1
    assert rows[0]["misconception_code"] == "sign_error"
    assert rows[0]["topic"] == "Algebra"


# ---------------------------------------------------------------------------
# Item 2 + 4 — consent-gated read fallback in the text tutor
# ---------------------------------------------------------------------------


def _seed_two_traps(api: LearningApi) -> None:
    started = _start(api)
    session_id = started["session_id"]
    result = _answer_wrong(api, session_id, started["item"])
    next_item = result["next_item"]
    assert next_item is not None
    _answer_wrong(api, session_id, next_item)


def test_ask_assistant_no_callback_without_consent() -> None:
    provider = _CaptureProvider()
    api = _tagged_api(provider)
    _seed_two_traps(api)

    api.ask_assistant(
        {
            "question": "How do I avoid this?",
            "user_id": PILOT_STUDENT_ID,
            "student_id": PILOT_STUDENT_ID,
            "tenant_id": PILOT_TENANT_ID,
        }
    )
    assert provider.context is not None
    assert provider.context["memory_allowed"] is False
    assert provider.context["attempt_history"] == []
    assert provider.context["memory_callback"] is None


def test_ask_assistant_surfaces_callback_from_store_with_consent() -> None:
    provider = _CaptureProvider()
    api = _tagged_api(provider)
    _seed_two_traps(api)
    api.repository.upsert_memory_consent(PILOT_STUDENT_ID, accepted=True)

    api.ask_assistant(
        {
            "question": "How do I avoid this?",
            "user_id": PILOT_STUDENT_ID,
            "student_id": PILOT_STUDENT_ID,
            "tenant_id": PILOT_TENANT_ID,
            # No attempt_history supplied → must fall back to the episodic store.
        }
    )
    assert provider.context is not None
    assert provider.context["memory_allowed"] is True
    assert len(provider.context["attempt_history"]) == 2
    callback = provider.context["memory_callback"]
    assert callback is not None
    assert "sign error trap caught you twice on Algebra" in callback


def test_ask_assistant_prefers_supplied_working_memory() -> None:
    provider = _CaptureProvider()
    api = _tagged_api(provider)
    api.repository.upsert_memory_consent(PILOT_STUDENT_ID, accepted=True)

    supplied: List[Dict[str, Any]] = [
        {"misconception_code": "ratio_inversion", "topic": "Ratios", "correct": False},
        {"misconception_code": "ratio_inversion", "topic": "Ratios", "correct": False},
    ]
    api.ask_assistant(
        {
            "question": "Help",
            "user_id": PILOT_STUDENT_ID,
            "student_id": PILOT_STUDENT_ID,
            "tenant_id": PILOT_TENANT_ID,
            "attempt_history": supplied,
        }
    )
    assert provider.context is not None
    assert provider.context["attempt_history"] == supplied
    callback = provider.context["memory_callback"]
    assert callback is not None
    assert "ratio inversion trap caught you twice on Ratios" in callback


# ---------------------------------------------------------------------------
# Item 3 — voice greeting parity
# ---------------------------------------------------------------------------


def test_voice_greeting_unchanged_without_consent() -> None:
    api = _tagged_api()
    _seed_two_traps(api)

    turn = api.run_learner_voice_turn({"child_id": PILOT_STUDENT_ID, "tenant_id": PILOT_TENANT_ID})
    assert "sign error trap" not in turn["card"]["speak"]


def test_voice_greeting_opens_with_trap_nudge_with_consent() -> None:
    api = _tagged_api()
    _seed_two_traps(api)
    api.repository.upsert_memory_consent(PILOT_STUDENT_ID, accepted=True)

    turn = api.run_learner_voice_turn({"child_id": PILOT_STUDENT_ID, "tenant_id": PILOT_TENANT_ID})
    # The deterministic planner opens with an mcq-tap card whose speak carries
    # the greeting; the memory nudge is prefixed onto that opening turn.
    assert "sign error trap caught you twice on Algebra" in turn["card"]["speak"]


def test_voice_midsession_card_has_no_nudge_with_consent() -> None:
    api = _tagged_api()
    _seed_two_traps(api)
    api.repository.upsert_memory_consent(PILOT_STUDENT_ID, accepted=True)

    opening = api.run_learner_voice_turn(
        {"child_id": PILOT_STUDENT_ID, "tenant_id": PILOT_TENANT_ID}
    )["card"]
    # A follow-up turn (prior card supplied) must not repeat the nudge.
    follow_up = api.run_learner_voice_turn(
        {
            "child_id": PILOT_STUDENT_ID,
            "tenant_id": PILOT_TENANT_ID,
            "last_card_id": opening["card_id"],
            "last_kind": opening["kind"],
            "answer_option_id": (opening.get("options") or [{}])[0].get("id"),
        }
    )["card"]
    assert "sign error trap" not in follow_up["speak"]
