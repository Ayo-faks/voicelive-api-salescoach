"""Unit coverage for the realtime learner voice transport.

These tests drive :class:`LearnerVoiceSocketHandler` with a fake in-memory
socket and a fake brain, so they assert the *transport* contract — framing,
RLS enforcement, scope binding, and conversation continuity — without touching
Azure, Flask, or the real planner. The brain itself is covered by
``test_learning_assistant_turn.py``.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Mapping, Optional

import pytest

from src.services.learner_voice_websocket_handler import (
    FRAME_CONNECTED,
    FRAME_ERROR,
    FRAME_TURN_RESULT,
    LearnerVoiceSocketHandler,
)


class FakeSocket:
    """Replays a scripted list of inbound frames and records what is sent."""

    def __init__(self, inbound: List[Optional[str]]) -> None:
        # ``None`` signals the client closed the socket.
        self._inbound = list(inbound) + [None]
        self.sent: List[Dict[str, Any]] = []
        self.closed_with: Optional[int] = None

    def receive(self, timeout: Optional[float] = None) -> Optional[str]:
        return self._inbound.pop(0)

    def send(self, data: str) -> None:
        self.sent.append(json.loads(data))

    def close(self, code: int = 1000, message: str = "") -> None:
        self.closed_with = code

    # Test helpers -------------------------------------------------------
    def frames(self, frame_type: str) -> List[Dict[str, Any]]:
        return [m for m in self.sent if m.get("type") == frame_type]


def _frame(**kwargs: Any) -> str:
    body: Dict[str, Any] = {"type": "turn"}
    body.update(kwargs)
    return json.dumps(body)


def test_connected_frame_is_sent_first() -> None:
    sock = FakeSocket([])
    captured: List[Mapping[str, Any]] = []
    LearnerVoiceSocketHandler(sock, run_turn=lambda p: {"blocks": [], "session_complete": False}).run()
    assert sock.sent[0]["type"] == FRAME_CONNECTED


def test_turn_is_pumped_through_the_brain() -> None:
    seen: List[Mapping[str, Any]] = []

    def brain(payload: Mapping[str, Any]) -> Mapping[str, Any]:
        seen.append(payload)
        return {
            "blocks": [{"kind": "prose", "speak": "Hello there", "text": "Hello there"}],
            "session_complete": False,
        }

    sock = FakeSocket([_frame(question="hi", user_id="s1")])
    LearnerVoiceSocketHandler(sock, run_turn=brain).run()

    assert seen[0]["question"] == "hi"
    results = sock.frames(FRAME_TURN_RESULT)
    assert len(results) == 1
    assert results[0]["blocks"][0]["speak"] == "Hello there"


def test_invalid_json_yields_error_and_keeps_socket_open() -> None:
    sock = FakeSocket(["{not json", _frame(question="still here", user_id="s1")])
    LearnerVoiceSocketHandler(
        sock, run_turn=lambda p: {"blocks": [], "session_complete": False}
    ).run()
    assert sock.frames(FRAME_ERROR)[0]["message"] == "invalid_json"
    # The socket survived the bad frame and served the next one.
    assert len(sock.frames(FRAME_TURN_RESULT)) == 1


def test_unowned_child_is_rejected_before_reaching_the_brain() -> None:
    called = False

    def brain(payload: Mapping[str, Any]) -> Mapping[str, Any]:
        nonlocal called
        called = True
        return {"blocks": [], "session_complete": False}

    sock = FakeSocket([_frame(question="hi", child_id="someone-elses-kid")])
    LearnerVoiceSocketHandler(sock, run_turn=brain, owned_child_ids={"my-kid"}).run()

    assert called is False
    assert sock.frames(FRAME_ERROR)[0]["message"] == "child_access_required"


def test_owned_child_passes_through() -> None:
    sock = FakeSocket([_frame(question="hi", child_id="my-kid")])
    LearnerVoiceSocketHandler(
        sock,
        run_turn=lambda p: {"blocks": [], "session_complete": False},
        owned_child_ids={"my-kid"},
    ).run()
    assert len(sock.frames(FRAME_TURN_RESULT)) == 1
    assert not sock.frames(FRAME_ERROR)


def test_scope_is_bound_per_frame() -> None:
    bound: List[Mapping[str, Any]] = []
    sock = FakeSocket([_frame(question="hi", tenant_id="t1", child_id="my-kid")])
    LearnerVoiceSocketHandler(
        sock,
        run_turn=lambda p: {"blocks": [], "session_complete": False},
        owned_child_ids={"my-kid"},
        bind_scope=lambda payload: bound.append(payload),
    ).run()
    assert bound and bound[0]["tenant_id"] == "t1"


def test_defaults_are_merged_under_client_frame() -> None:
    seen: List[Mapping[str, Any]] = []

    def brain(payload: Mapping[str, Any]) -> Mapping[str, Any]:
        seen.append(payload)
        return {"blocks": [], "session_complete": False}

    sock = FakeSocket([_frame(question="hi")])
    LearnerVoiceSocketHandler(
        sock, run_turn=brain, default_payload={"user_id": "from-principal"}
    ).run()
    assert seen[0]["user_id"] == "from-principal"


def test_practice_card_is_carried_to_the_next_utterance() -> None:
    seen: List[Mapping[str, Any]] = []

    def brain(payload: Mapping[str, Any]) -> Mapping[str, Any]:
        seen.append(dict(payload))
        # First turn opens a card; the learner then answers without re-sending it.
        if payload.get("answer_option_id") is None:
            return {
                "blocks": [
                    {
                        "kind": "mcq-tap",
                        "card_id": "card-42",
                        "speak": "What is 2+2?",
                    }
                ],
                "session_complete": False,
            }
        return {
            "blocks": [{"kind": "explanation", "speak": "Right!"}],
            "session_complete": False,
        }

    sock = FakeSocket(
        [
            _frame(intent="practice", child_id="my-kid", exam="WAEC"),
            _frame(answer_option_id="opt-b", child_id="my-kid"),
        ]
    )
    LearnerVoiceSocketHandler(sock, run_turn=brain, owned_child_ids={"my-kid"}).run()

    # Second turn must inherit the card id and the exam taxonomy.
    second = seen[1]
    assert second["last_card_id"] == "card-42"
    assert second["last_kind"] == "mcq-tap"
    assert second["exam"] == "WAEC"


def test_conversation_thread_accumulates() -> None:
    seen: List[Mapping[str, Any]] = []

    def brain(payload: Mapping[str, Any]) -> Mapping[str, Any]:
        seen.append(dict(payload))
        return {
            "blocks": [{"kind": "prose", "speak": "Answer one", "text": "Answer one"}],
            "session_complete": False,
        }

    sock = FakeSocket([_frame(question="first"), _frame(question="second")])
    LearnerVoiceSocketHandler(sock, run_turn=brain).run()

    # The second turn carries the first exchange as thread context.
    thread = seen[1].get("thread") or []
    roles = [t["role"] for t in thread]
    assert "user" in roles and "assistant" in roles


def test_bye_frame_ends_the_session() -> None:
    sock = FakeSocket([json.dumps({"type": "bye"}), _frame(question="never reached")])
    LearnerVoiceSocketHandler(
        sock, run_turn=lambda p: {"blocks": [], "session_complete": False}
    ).run()
    # No turn was processed because we said goodbye first.
    assert not sock.frames(FRAME_TURN_RESULT)


def test_brain_exception_is_contained() -> None:
    def brain(payload: Mapping[str, Any]) -> Mapping[str, Any]:
        raise RuntimeError("boom")

    sock = FakeSocket([_frame(question="hi"), _frame(question="again")])
    LearnerVoiceSocketHandler(sock, run_turn=brain).run()
    # Both frames produced an error, and the socket never crashed.
    assert len(sock.frames(FRAME_ERROR)) == 2
    assert all(e["message"] == "turn_failed" for e in sock.frames(FRAME_ERROR))
