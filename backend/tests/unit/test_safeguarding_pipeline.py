"""Pipeline + service tests with fake L2/L3 detectors."""

from __future__ import annotations

import asyncio
from typing import List, Sequence

import pytest

from src.safeguarding.models import (
    Direction,
    LayerScore,
    SafeguardingCategory,
    Severity,
)
from src.safeguarding.notifier import SafeguardingNotifier
from src.safeguarding.pipeline import SafeguardingPipeline
from src.safeguarding.repository import (
    InMemorySafeguardingRepository,
    SafeguardingEvent,
)
from src.safeguarding.service import SafeguardingService


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeContentSafety:
    configured = True

    def __init__(self, score: LayerScore | None = None, raise_exc: Exception | None = None):
        self._score = score
        self._raise = raise_exc
        self.calls: List[str] = []

    async def analyze(self, text: str) -> LayerScore:
        self.calls.append(text)
        if self._raise is not None:
            raise self._raise
        return self._score or LayerScore(layer="content_safety", severity=Severity.NONE, categories=(), raw={})


class _FakeClassifier:
    def __init__(self, score: LayerScore | None = None, raise_exc: Exception | None = None):
        self._score = score
        self._raise = raise_exc
        self.calls: List[str] = []

    async def classify(
        self,
        text: str,
        *,
        direction: Direction,
        context_turns: Sequence[str] = (),
    ) -> LayerScore:
        self.calls.append(text)
        if self._raise is not None:
            raise self._raise
        return self._score or LayerScore(layer="llm_classifier", severity=Severity.NONE, categories=(), raw={})


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Pipeline behaviour
# ---------------------------------------------------------------------------


def test_pipeline_no_alert_on_benign_text():
    pipeline = SafeguardingPipeline(content_safety=_FakeContentSafety(), classifier=_FakeClassifier())
    verdict = _run(pipeline.analyse("i love mango", direction=Direction.INBOUND))
    assert verdict.severity == Severity.NONE
    assert not verdict.is_alert


def test_pipeline_lexicon_critical_short_circuits_classifier():
    classifier = _FakeClassifier()
    pipeline = SafeguardingPipeline(content_safety=_FakeContentSafety(), classifier=classifier)
    verdict = _run(pipeline.analyse("i want to kill myself", direction=Direction.INBOUND))
    assert verdict.severity == Severity.CRITICAL
    assert verdict.is_alert
    assert SafeguardingCategory.SUICIDE_IDEATION in verdict.categories
    # L3 must be skipped when L1 already screams critical.
    assert classifier.calls == []


def test_pipeline_merges_layer_severities_max_wins():
    cs = _FakeContentSafety(
        score=LayerScore(
            layer="content_safety",
            severity=Severity.MEDIUM,
            categories=(SafeguardingCategory.PEER_ON_PEER_HARM,),
            raw={},
        )
    )
    clf = _FakeClassifier(
        score=LayerScore(
            layer="llm_classifier",
            severity=Severity.HIGH,
            categories=(SafeguardingCategory.EATING_DISORDER,),
            raw={},
        )
    )
    pipeline = SafeguardingPipeline(content_safety=cs, classifier=clf)
    verdict = _run(pipeline.analyse("some grey-area text", direction=Direction.INBOUND))
    assert verdict.severity == Severity.HIGH
    assert SafeguardingCategory.PEER_ON_PEER_HARM in verdict.categories
    assert SafeguardingCategory.EATING_DISORDER in verdict.categories


def test_pipeline_outbound_floor_raises_to_high():
    # AI says something with only LOW-severity classifier flag — outbound
    # direction must escalate to at least HIGH.
    clf = _FakeClassifier(
        score=LayerScore(
            layer="llm_classifier",
            severity=Severity.LOW,
            categories=(SafeguardingCategory.AI_HARMFUL_OUTPUT,),
            raw={},
        )
    )
    pipeline = SafeguardingPipeline(content_safety=_FakeContentSafety(), classifier=clf)
    verdict = _run(
        pipeline.analyse("model produced borderline advice", direction=Direction.OUTBOUND)
    )
    assert verdict.severity.rank >= Severity.HIGH.rank


def test_pipeline_fails_open_when_detectors_raise():
    pipeline = SafeguardingPipeline(
        content_safety=_FakeContentSafety(raise_exc=RuntimeError("boom")),
        classifier=_FakeClassifier(raise_exc=RuntimeError("boom")),
    )
    # Should not raise; benign text → no alert.
    verdict = _run(pipeline.analyse("hello", direction=Direction.INBOUND))
    assert verdict.severity == Severity.NONE


# ---------------------------------------------------------------------------
# Service / repository
# ---------------------------------------------------------------------------


class _CollectingNotifier(SafeguardingNotifier):
    def __init__(self):
        super().__init__(channels=[])
        self.dispatched: List[SafeguardingEvent] = []

    def dispatch(self, event):  # type: ignore[override]
        self.dispatched.append(event)
        from src.safeguarding.notifier import DispatchResult

        return DispatchResult()


def test_service_persists_and_notifies_on_alert():
    pipeline = SafeguardingPipeline(content_safety=_FakeContentSafety(), classifier=_FakeClassifier())
    repo = InMemorySafeguardingRepository()
    notifier = _CollectingNotifier()
    svc = SafeguardingService(pipeline=pipeline, repository=repo, notifier=notifier)

    event = _run(
        svc.process_utterance(
            text="i want to kill myself",
            direction=Direction.INBOUND,
            user_id="parent-1",
            child_id="child-1",
            session_id="sess-1",
        )
    )
    assert event is not None
    assert event.severity == Severity.CRITICAL.value
    assert repo.list_recent() == [event]
    assert notifier.dispatched == [event]


def test_service_skips_persistence_on_benign():
    pipeline = SafeguardingPipeline(content_safety=_FakeContentSafety(), classifier=_FakeClassifier())
    repo = InMemorySafeguardingRepository()
    notifier = _CollectingNotifier()
    svc = SafeguardingService(pipeline=pipeline, repository=repo, notifier=notifier)

    event = _run(
        svc.process_utterance(text="i love mango", direction=Direction.INBOUND, user_id="u")
    )
    assert event is None
    assert repo.list_recent() == []
    assert notifier.dispatched == []


def test_service_acknowledge_flow():
    pipeline = SafeguardingPipeline(content_safety=_FakeContentSafety(), classifier=_FakeClassifier())
    repo = InMemorySafeguardingRepository()
    svc = SafeguardingService(pipeline=pipeline, repository=repo, notifier=None)

    event = _run(
        svc.process_utterance(
            text="i want to kill myself",
            direction=Direction.INBOUND,
            user_id="parent-1",
        )
    )
    assert event is not None
    acked = svc.acknowledge(
        event.id, acknowledged_by="admin@wulo", action_taken="called_parent", action_notes="spoke briefly"
    )
    assert acked is not None
    assert acked.acknowledged_by == "admin@wulo"
    assert acked.action_taken == "called_parent"

    # Second ack returns the existing event unchanged.
    second = svc.acknowledge(event.id, acknowledged_by="someone_else", action_taken="x", action_notes=None)
    assert second is not None
    assert second.acknowledged_by == "admin@wulo"


# ---------------------------------------------------------------------------
# Notifier matrix
# ---------------------------------------------------------------------------


def test_notifier_critical_dispatches_to_all_registered_channels():
    from src.safeguarding.notifier import (
        AdminEmailChannel,
        InAppChannel,
        ParentEmailChannel,
        SafeguardingNotifier,
    )

    rows: list = []
    emails: list = []
    notifier = SafeguardingNotifier(
        channels=[
            InAppChannel(insert_row=rows.append),
            AdminEmailChannel(
                send_email=lambda *args: emails.append(("admin", args)),
                admin_email="admin@wulo",
            ),
            ParentEmailChannel(
                send_email=lambda *args: emails.append(("parent", args)),
                resolve_parent_email=lambda _uid: "parent@example.com",
            ),
        ]
    )
    event = SafeguardingEvent(
        id="e1",
        user_id="u1",
        child_id="c1",
        parent_user_id="p1",
        session_id="s1",
        direction=Direction.INBOUND.value,
        severity=Severity.CRITICAL.value,
        categories=[SafeguardingCategory.SUICIDE_IDEATION.value],
        evidence_quote="...",
        layer_scores=[],
    )
    result = notifier.dispatch(event)
    assert "in_app" in result.channels_delivered
    assert "admin_email" in result.channels_delivered
    assert "parent_email" in result.channels_delivered
    assert len(rows) == 1
    assert {tag for tag, _ in emails} == {"admin", "parent"}


def test_notifier_medium_only_uses_in_app():
    from src.safeguarding.notifier import (
        AdminEmailChannel,
        InAppChannel,
        SafeguardingNotifier,
    )

    rows: list = []
    emails: list = []
    notifier = SafeguardingNotifier(
        channels=[
            InAppChannel(insert_row=rows.append),
            AdminEmailChannel(
                send_email=lambda *args: emails.append(args),
                admin_email="admin@wulo",
            ),
        ]
    )
    event = SafeguardingEvent(
        id="e2",
        user_id=None,
        child_id=None,
        parent_user_id=None,
        session_id=None,
        direction=Direction.INBOUND.value,
        severity=Severity.MEDIUM.value,
        categories=[SafeguardingCategory.PEER_ON_PEER_HARM.value],
        evidence_quote="...",
        layer_scores=[],
    )
    result = notifier.dispatch(event)
    assert result.channels_delivered == ["in_app"]
    assert len(rows) == 1
    assert emails == []
