"""Unit coverage for the Dig-Deeper tutor core (``src.learning.tutor``).

These tests pin the pedagogy decisions that must stay identical across the
text and voice surfaces: mode selection (Socratic while a diagnostic item is
unscored, explanation otherwise), grounded-context assembly with retrieval +
rationale as the only factual authority, memory-consent gating of profile
signals, and the synchronous outbound safeguarding guard.
"""

from __future__ import annotations

from src.learning.tutor import (
    FocusItem,
    build_grounded_context,
    screen_outbound_text,
    select_mode,
)
from src.safeguarding.models import Severity


# ---------------------------------------------------------------------------
# FocusItem parsing
# ---------------------------------------------------------------------------


def test_focus_item_from_payload_parses_options_and_fields() -> None:
    item = FocusItem.from_payload(
        {
            "stem": "Simplify 2/4",
            "options": [
                {"id": "a", "label": "A", "text": "1/2"},
                {"id": "b", "label": "B", "text": "2/2"},
                "raw-string-option",
            ],
            "chosen": "2/2",
            "correct": "1/2",
            "rationale": "Divide numerator and denominator by 2.",
            "skill_id": "fraction-operations",
            "misconception": "adds instead of dividing",
            "scored": True,
        }
    )
    assert item.stem == "Simplify 2/4"
    assert item.options == ["1/2", "2/2", "raw-string-option"]
    assert item.chosen == "2/2"
    assert item.correct == "1/2"
    assert item.skill_id == "fraction-operations"
    assert item.scored is True
    assert item.is_present is True


def test_focus_item_from_payload_handles_non_mapping() -> None:
    item = FocusItem.from_payload(None)
    assert item.is_present is False
    assert item.options == []
    assert select_mode(item) == "explain"


# ---------------------------------------------------------------------------
# Mode selection — the assessment-integrity guard
# ---------------------------------------------------------------------------


def test_unscored_anchored_item_forces_socratic() -> None:
    item = FocusItem(stem="Solve 3x = 9", skill_id="linear-equations", scored=False)
    assert select_mode(item) == "socratic"


def test_scored_item_allows_explanation() -> None:
    item = FocusItem(stem="Solve 3x = 9", skill_id="linear-equations", scored=True)
    assert select_mode(item) == "explain"


def test_no_anchored_item_allows_explanation() -> None:
    # A free-form concept question with no item in play.
    assert select_mode(FocusItem()) == "explain"


# ---------------------------------------------------------------------------
# Grounded-context assembly
# ---------------------------------------------------------------------------


def test_authority_combines_retrieval_and_rationale() -> None:
    item = FocusItem(
        stem="Simplify 2/4",
        rationale="Divide both parts by their HCF.",
        skill_id="fraction-operations",
        scored=True,
    )
    ctx = build_grounded_context(
        "why is it 1/2?",
        item=item,
        retrieved=["A fraction is simplified by dividing by a common factor.", ""],
        profile={"weak_topics": ["fractions"]},
        thread=[],
        memory_allowed=True,
    )
    assert ctx.mode == "explain"
    assert ctx.grounded is True
    # Empty snippet dropped; rationale appended last.
    assert ctx.authority == [
        "A fraction is simplified by dividing by a common factor.",
        "Divide both parts by their HCF.",
    ]


def test_no_retrieval_and_no_rationale_is_ungrounded() -> None:
    ctx = build_grounded_context(
        "what is a black hole?",
        item=FocusItem(),
        retrieved=[],
        profile={},
        thread=[],
        memory_allowed=True,
    )
    assert ctx.grounded is False
    assert ctx.authority == []


def test_memory_consent_false_withholds_profile() -> None:
    ctx = build_grounded_context(
        "what should I study?",
        item=FocusItem(),
        retrieved=["snippet"],
        profile={"weak_topics": ["ratio"], "mastery": {"ratio": 0.2}},
        thread=[],
        memory_allowed=False,
    )
    assert ctx.profile == {}
    assert ctx.memory_allowed is False


def test_thread_coercion_keeps_only_valid_turns() -> None:
    ctx = build_grounded_context(
        "follow up",
        item=FocusItem(),
        retrieved=["snippet"],
        profile={},
        thread=[
            {"role": "user", "text": "first"},
            {"role": "assistant", "text": "reply"},
            {"role": "system", "text": "ignored"},
            {"role": "user", "text": ""},
            "not-a-mapping",
        ],
        memory_allowed=True,
    )
    assert ctx.thread == [
        {"role": "user", "text": "first"},
        {"role": "assistant", "text": "reply"},
    ]


# ---------------------------------------------------------------------------
# Outbound safeguarding guard
# ---------------------------------------------------------------------------


def test_screen_outbound_blocks_harmful_text() -> None:
    decision = screen_outbound_text("you should kill myself to feel better")
    assert decision.allowed is False
    assert decision.severity.rank >= Severity.HIGH.rank
    assert decision.safe_message != "you should kill myself to feel better"


def test_screen_outbound_allows_benign_text() -> None:
    benign = "Great effort! Divide both parts of the fraction by 2 to simplify."
    decision = screen_outbound_text(benign)
    assert decision.allowed is True
    assert decision.severity == Severity.NONE
    assert decision.safe_message == benign


def test_screen_outbound_empty_is_allowed() -> None:
    decision = screen_outbound_text("   ")
    assert decision.allowed is True
    assert decision.severity == Severity.NONE
