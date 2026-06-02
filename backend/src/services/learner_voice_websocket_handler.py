"""Realtime transport for the unified learner assistant (``/ws/learning-voice``).

This is the *voice twin* of the ``POST /api/learning/assistant/turn`` endpoint.
Both speak the exact same brain: every frame received here is handed to the same
``run_assistant_turn`` facade, and the resulting :class:`AssistantBlock` list is
streamed back. The only thing the voice transport adds on top of the text drawer
is the persistent socket and a small amount of conversation continuity so a
learner can speak several turns without the client re-stating context.

Design notes
------------
* **One brain, two transports.** This handler owns no planning logic. It is a
  thin pump: ``receive JSON frame -> run_turn(payload) -> send JSON blocks``.
  Each block already carries a ``speak`` field; the client's TTS reads that and
  ignores it in text mode — exactly like ChatGPT's voice/text parity.
* **RLS-safe.** The route layer (``app.py``) authenticates the socket and passes
  in the learner's ``owned_child_ids``. Every frame that names a ``child_id``
  must match one the caller owns, mirroring the ``/api/learning/voice/turn``
  guard. A frame that violates this is rejected without ever reaching a brain.
* **Stateless brains, light transport memory.** The handler keeps a running
  ``thread`` and the last practice-card signals so a spoken "the answer is B"
  can continue a walk the client opened, without the client echoing card ids on
  every utterance. The brains themselves stay stateless.
* **Transport-agnostic & testable.** The handler talks to a minimal duck-typed
  socket (``receive`` / ``send`` / ``close``) so it can be driven by
  ``simple_websocket`` in production and by a fake socket in unit tests. STT and
  TTS happen at the edges (client or the existing ``/ws/voice`` VoiceLive proxy);
  this layer moves *blocks*, not audio.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, List, Mapping, MutableMapping, Optional, Protocol, Set

logger = logging.getLogger(__name__)

# Frame types on the wire.
FRAME_CONNECTED = "connected"
FRAME_TURN = "turn"
FRAME_TURN_RESULT = "turn.result"
FRAME_ERROR = "error"
FRAME_BYE = "bye"

# Practice signal keys we remember across frames so a spoken answer can continue
# a walk the client opened earlier without re-sending these every utterance.
_PRACTICE_CARRY_KEYS = ("exam", "class_year", "subject", "lang")

# A soft ceiling so a long voice session can't grow the in-memory thread without
# bound. The brains only need recent context for continuity.
_MAX_THREAD_TURNS = 20


class _Socket(Protocol):
    """The slice of ``simple_websocket.ws.Server`` this handler needs."""

    def receive(self, timeout: Optional[float] = ...) -> Optional[str]: ...
    def send(self, data: str) -> None: ...
    def close(self, code: int = ..., message: str = ...) -> None: ...


RunTurn = Callable[[Mapping[str, Any]], Mapping[str, Any]]


class LearnerVoiceSocketHandler:
    """Pumps realtime frames through the unified assistant turn facade.

    Parameters
    ----------
    ws:
        The duck-typed socket (``receive`` / ``send`` / ``close``).
    run_turn:
        The bound ``LearningApi.run_assistant_turn`` — the single brain both
        transports share.
    owned_child_ids:
        The set of ``child_id`` values the authenticated caller may act on. An
        empty set means "no child binding required" (e.g. a learner whose own
        ``user_id`` is the subject); a non-empty set is enforced on every frame
        that names a ``child_id``.
    bind_scope:
        Optional callback invoked once per frame with the frame's tenant/class
        so row-level security is rebound on the worker thread the socket runs on
        (HTTP ``before_request`` does not fire for WebSocket frames).
    default_payload:
        Server-side defaults merged *under* each client frame (e.g. ``user_id``
        resolved from the authenticated principal). Client values win, except
        for ``child_id`` which is always re-validated against ``owned_child_ids``.
    """

    def __init__(
        self,
        ws: _Socket,
        *,
        run_turn: RunTurn,
        owned_child_ids: Optional[Set[str]] = None,
        bind_scope: Optional[Callable[[Mapping[str, Any]], None]] = None,
        default_payload: Optional[Mapping[str, Any]] = None,
    ) -> None:
        self._ws = ws
        self._run_turn = run_turn
        self._owned = {str(c) for c in (owned_child_ids or set()) if str(c).strip()}
        self._bind_scope = bind_scope
        self._defaults: Dict[str, Any] = dict(default_payload or {})
        self._thread: List[Dict[str, str]] = []
        # Carried practice context so a spoken answer can continue a walk.
        self._carry: Dict[str, Any] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def run(self) -> None:
        """Block serving frames until the client disconnects or says goodbye."""
        self._send(FRAME_CONNECTED, {"transport": "learning-voice"})
        while True:
            try:
                raw = self._ws.receive()
            except Exception:
                logger.debug("learner voice socket receive failed", exc_info=True)
                break
            if raw is None:  # client closed
                break

            frame = self._parse(raw)
            if frame is None:
                self._send(FRAME_ERROR, {"message": "invalid_json"})
                continue

            ftype = str(frame.get("type") or FRAME_TURN).strip().lower()
            if ftype == FRAME_BYE:
                break
            if ftype != FRAME_TURN:
                self._send(FRAME_ERROR, {"message": f"unsupported_frame:{ftype}"})
                continue

            self._handle_turn(frame)

    # ------------------------------------------------------------------
    # Turn handling
    # ------------------------------------------------------------------
    def _handle_turn(self, frame: Mapping[str, Any]) -> None:
        payload = self._build_payload(frame)
        if payload is None:
            self._send(FRAME_ERROR, {"message": "child_access_required"})
            return

        if self._bind_scope is not None:
            try:
                self._bind_scope(payload)
            except Exception:
                logger.exception("learner voice scope bind failed")
                self._send(FRAME_ERROR, {"message": "scope_bind_failed"})
                return

        try:
            result = self._run_turn(payload)
        except Exception as exc:  # brain/validation error — never crash the socket
            logger.warning("learner voice turn failed: %s", exc)
            self._send(FRAME_ERROR, {"message": "turn_failed"})
            return

        self._remember(frame, result)
        self._send(FRAME_TURN_RESULT, dict(result))

    def _build_payload(self, frame: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
        """Merge defaults + carried context + the client frame, RLS-checked.

        Returns ``None`` if the frame names a ``child_id`` the caller does not
        own (the only hard reject at this layer).
        """
        payload: Dict[str, Any] = dict(self._defaults)
        # Carry practice taxonomy forward so a spoken answer continues the walk.
        for key in _PRACTICE_CARRY_KEYS:
            if key in self._carry and frame.get(key) is None:
                payload[key] = self._carry[key]
        # Carry the last card so "the answer is B" lands on the right question.
        if frame.get("last_card_id") is None and "last_card_id" in self._carry:
            payload["last_card_id"] = self._carry["last_card_id"]
            payload["last_kind"] = self._carry.get("last_kind")

        for key, value in frame.items():
            if key == "type":
                continue
            payload[key] = value

        # RLS: a named child must be owned. We only enforce when the caller has a
        # child binding *and* the frame (or defaults) names a child.
        child_id = str(payload.get("child_id") or "").strip()
        if self._owned and child_id and child_id not in self._owned:
            logger.warning("learner voice frame rejected: child %s not owned", child_id)
            return None

        # Give the brains the running conversation for continuity.
        if self._thread and not payload.get("thread"):
            payload["thread"] = list(self._thread)
        return payload

    def _remember(self, frame: Mapping[str, Any], result: Mapping[str, Any]) -> None:
        """Update light transport memory from the frame and its result."""
        # Persist practice taxonomy + the freshest card id for the next utterance.
        for key in _PRACTICE_CARRY_KEYS:
            if frame.get(key) is not None:
                self._carry[key] = frame[key]

        question = str(frame.get("question") or "").strip()
        if question:
            self._append_thread("user", question)

        blocks = result.get("blocks") or []
        latest_card_id: Optional[str] = None
        latest_kind: Optional[str] = None
        for block in blocks:
            if not isinstance(block, Mapping):
                continue
            # Record the spoken line for prose-style continuity.
            speak = str(block.get("speak") or block.get("text") or "").strip()
            if speak:
                self._append_thread("assistant", speak)
            card_id = block.get("card_id")
            if card_id:
                latest_card_id = str(card_id)
                latest_kind = str(block.get("kind") or "") or None
        if latest_card_id is not None:
            self._carry["last_card_id"] = latest_card_id
            self._carry["last_kind"] = latest_kind
        elif result.get("session_complete"):
            # Walk finished — forget the card so the next turn starts clean.
            self._carry.pop("last_card_id", None)
            self._carry.pop("last_kind", None)

    def _append_thread(self, role: str, text: str) -> None:
        self._thread.append({"role": role, "text": text})
        if len(self._thread) > _MAX_THREAD_TURNS:
            del self._thread[: len(self._thread) - _MAX_THREAD_TURNS]

    # ------------------------------------------------------------------
    # Wire helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _parse(raw: str) -> Optional[Dict[str, Any]]:
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            return None
        if not isinstance(data, dict):
            return None
        return data

    def _send(self, frame_type: str, body: MutableMapping[str, Any] | Mapping[str, Any]) -> None:
        message: Dict[str, Any] = {"type": frame_type}
        message.update(body)
        try:
            self._ws.send(json.dumps(message))
        except Exception:
            logger.debug("learner voice socket send failed", exc_info=True)


__all__ = ["LearnerVoiceSocketHandler"]
