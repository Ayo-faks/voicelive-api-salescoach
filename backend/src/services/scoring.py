# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Live in-session scoring helpers for Stage 8 `structured_conversation`.

This module is intentionally narrow in scope:
- It runs on the backend per live WebSocket connection.
- It consumes transcripts (already produced by the upstream ASR pipeline).
- It does **not** attempt phoneme-level precision. The frontend surfaces
  therapist-override controls for uncertainty.

The single public class ``TargetTokenTally`` maintains:
  * a running correct/incorrect/total token count over the whole session
  * a sliding N-second production window used to decide whether the avatar
    should escalate scaffolding (e.g. target-biased prompts)
  * a cooldown between scaffold escalations so children aren't nagged
  * a list of "standout" productions for the post-session summary

Policy constants are configurable via the tally's ``configure`` call, which is
driven by the exercise YAML's ``scaffoldEscalation`` + ``targetCountGate`` +
``durationFloorSeconds`` fields. Defaults match the PR5 Stage 8 plan
(§A / §H): 60s window, 3 tokens, 45s cooldown.
"""

from __future__ import annotations

import re
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence


# Default clinical scaffolding parameters. See docs/ PR5 Stage 8 plan §A.
DEFAULT_WINDOW_SECONDS = 60.0
DEFAULT_MIN_TOKENS_IN_WINDOW = 3
DEFAULT_COOLDOWN_SECONDS = 45.0

# Token normalization regex: split on whitespace + strip non-letters.
_WORD_RE = re.compile(r"[^a-z']+")


def _normalize_word(word: str) -> str:
    """Lowercase, strip accents, strip non-letters. Returns empty for noise."""
    lowered = unicodedata.normalize("NFKD", word).encode("ascii", "ignore").decode("ascii").lower()
    cleaned = _WORD_RE.sub("", lowered)
    return cleaned


def _tokenize(transcript: str) -> List[str]:
    return [_normalize_word(piece) for piece in transcript.split() if piece.strip()]


@dataclass
class _TokenEvent:
    at: float
    word: str
    correct: bool


@dataclass
class TallySnapshot:
    """JSON-safe snapshot of the current tally state."""

    correct_count: int
    incorrect_count: int
    total_count: int
    accuracy: float
    elapsed_seconds: float
    scaffold_escalated: bool
    standouts: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "correctCount": self.correct_count,
            "incorrectCount": self.incorrect_count,
            "totalCount": self.total_count,
            "accuracy": self.accuracy,
            "elapsedSeconds": self.elapsed_seconds,
            "scaffoldEscalated": self.scaffold_escalated,
            "standouts": list(self.standouts),
        }


class TargetTokenTally:
    """Per-connection running target-sound tally for Stage 8.

    All timestamps use ``time.monotonic()``. Inject ``now_fn`` for deterministic
    tests.
    """

    def __init__(self, now_fn: Optional[Any] = None) -> None:
        self._now = now_fn or time.monotonic
        self._started_at: float = self._now()
        self._suggested_targets: List[str] = []
        self._expected_substitutions: List[str] = []
        self._window_seconds: float = DEFAULT_WINDOW_SECONDS
        self._min_tokens_in_window: int = DEFAULT_MIN_TOKENS_IN_WINDOW
        self._cooldown_seconds: float = DEFAULT_COOLDOWN_SECONDS

        self._events: List[_TokenEvent] = []
        self._escalated: bool = False
        self._last_escalation_at: Optional[float] = None
        self._standouts: List[str] = []
        self._max_standouts = 5

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------
    def configure(
        self,
        *,
        suggested_target_words: Optional[Sequence[str]] = None,
        expected_substitutions: Optional[Sequence[str]] = None,
        window_seconds: Optional[float] = None,
        min_tokens_in_window: Optional[int] = None,
        cooldown_seconds: Optional[float] = None,
    ) -> None:
        if suggested_target_words is not None:
            self._suggested_targets = [
                _normalize_word(w) for w in suggested_target_words if _normalize_word(w)
            ]
        if expected_substitutions is not None:
            self._expected_substitutions = [
                str(s or "").strip().lower() for s in expected_substitutions if str(s or "").strip()
            ]
        if window_seconds is not None and window_seconds > 0:
            self._window_seconds = float(window_seconds)
        if min_tokens_in_window is not None and min_tokens_in_window > 0:
            self._min_tokens_in_window = int(min_tokens_in_window)
        if cooldown_seconds is not None and cooldown_seconds >= 0:
            self._cooldown_seconds = float(cooldown_seconds)

    # ------------------------------------------------------------------
    # Classification
    # ------------------------------------------------------------------
    def _classify(self, word: str) -> Optional[bool]:
        """Return True (correct), False (incorrect), or None (ignore).

        A word is:
        - Correct if it matches a suggested target word (exact normalized).
        - Incorrect if it matches a suggested target word with an expected
          substitution applied (e.g. target 'think' with substitution 'f→th'
          yields 'fink'). We approximate this by substring containment of the
          substituted form; this is intentionally loose for PR5 and will be
          sharpened once phoneme-timing signals are trusted.
        - None otherwise.
        """
        if not word:
            return None
        if word in self._suggested_targets:
            return True
        # Cheap substitution heuristic. Each expected substitution may be
        # expressed as "f→th", "f->th", "f:th", or just "f" (collapses any
        # target-sound graph into 'f'). We only attempt the first form.
        for sub in self._expected_substitutions:
            sub_norm = sub.replace("->", "→").replace(":", "→")
            if "→" not in sub_norm:
                # unstructured substitution — skip (too lossy without context)
                continue
            src, dst = sub_norm.split("→", 1)
            src = src.strip()
            dst = dst.strip()
            if not src or not dst:
                continue
            # If the child said a mutated form of a suggested target, count as incorrect.
            for target in self._suggested_targets:
                if dst and dst in target and src and word == target.replace(dst, src, 1):
                    return False
        return None

    # ------------------------------------------------------------------
    # Public ingest API
    # ------------------------------------------------------------------
    def ingest_transcript(self, transcript: str) -> TallySnapshot:
        """Tokenize ``transcript`` and update tally. Returns a snapshot."""
        now = self._now()
        if transcript:
            for word in _tokenize(transcript):
                verdict = self._classify(word)
                if verdict is None:
                    continue
                self._events.append(_TokenEvent(at=now, word=word, correct=verdict))
                # Keep a small set of exemplar productions for the summary.
                if verdict and len(self._standouts) < self._max_standouts:
                    self._standouts.append(word)
        return self.snapshot()

    def apply_override(self, *, correct: int = 0, incorrect: int = 0) -> TallySnapshot:
        """Therapist-authored override. Values may be negative to undo."""
        now = self._now()
        for _ in range(max(0, correct)):
            self._events.append(_TokenEvent(at=now, word="__override__", correct=True))
        for _ in range(max(0, incorrect)):
            self._events.append(_TokenEvent(at=now, word="__override__", correct=False))
        # Negative overrides: remove last N override events of that polarity.
        if correct < 0:
            self._pop_overrides(correct_polarity=True, count=-correct)
        if incorrect < 0:
            self._pop_overrides(correct_polarity=False, count=-incorrect)
        return self.snapshot()

    def _pop_overrides(self, *, correct_polarity: bool, count: int) -> None:
        removed = 0
        for idx in range(len(self._events) - 1, -1, -1):
            ev = self._events[idx]
            if ev.word == "__override__" and ev.correct is correct_polarity:
                del self._events[idx]
                removed += 1
                if removed >= count:
                    return

    # ------------------------------------------------------------------
    # Scaffold escalation
    # ------------------------------------------------------------------
    def check_escalation(self) -> Optional[Dict[str, Any]]:
        """Decide if scaffolding should escalate now. Idempotent per cooldown.

        Returns an event-payload dict when an escalation transition happens,
        else ``None``. The caller is responsible for emitting the event.
        """
        now = self._now()
        window_start = now - self._window_seconds
        recent = [ev for ev in self._events if ev.at >= window_start]
        tokens_in_window = len(recent)

        # Require at least a full window of elapsed time before escalating,
        # so we don't flag silence in the first few seconds.
        if now - self._started_at < self._window_seconds:
            return None

        if tokens_in_window >= self._min_tokens_in_window:
            return None

        if (
            self._last_escalation_at is not None
            and now - self._last_escalation_at < self._cooldown_seconds
        ):
            return None

        self._escalated = True
        self._last_escalation_at = now
        return {
            "tokensInWindow": tokens_in_window,
            "windowSeconds": self._window_seconds,
            "minTokensInWindow": self._min_tokens_in_window,
            "at": now,
        }

    def mark_paused(self) -> None:
        """Record a pause (e.g. therapist pressed Model it).

        Resets the escalation debt so we don't fire immediately on resume.
        """
        self._last_escalation_at = self._now()

    # ------------------------------------------------------------------
    # Snapshot
    # ------------------------------------------------------------------
    def snapshot(self) -> TallySnapshot:
        correct = sum(1 for ev in self._events if ev.correct)
        incorrect = sum(1 for ev in self._events if not ev.correct)
        total = correct + incorrect
        accuracy = (correct / total) if total > 0 else 0.0
        elapsed = self._now() - self._started_at
        return TallySnapshot(
            correct_count=correct,
            incorrect_count=incorrect,
            total_count=total,
            accuracy=accuracy,
            elapsed_seconds=elapsed,
            scaffold_escalated=self._escalated,
            standouts=list(self._standouts),
        )


# ---------------------------------------------------------------------------
# PR12b.3 — scored-turn dispatcher
# ---------------------------------------------------------------------------

# Default scored-turn window length (ms) used when the client omits it. Mirrors
# the frontend `ScoredTurn.windowMs` default discussed in the PR12b plan.
DEFAULT_SCORED_TURN_WINDOW_MS = 3500
# Hard upper bound so a misbehaving client can't keep a scorer open forever.
MAX_SCORED_TURN_WINDOW_MS = 15000


@dataclass
class ScoredTurnResult:
    """JSON-safe scored-turn outcome."""

    turn_id: str
    target_word: str
    reference_text: str
    transcript: Optional[str]
    verdict: str  # "correct" | "incorrect" | "timeout"
    elapsed_ms: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "turnId": self.turn_id,
            "targetWord": self.target_word,
            "referenceText": self.reference_text,
            "transcript": self.transcript,
            "verdict": self.verdict,
            "elapsedMs": self.elapsed_ms,
        }


class ScoredTurnDispatcher:
    """Pure state machine for a short scored-turn window.

    Lifecycle:
        begin(turn_id, target_word, reference_text, window_ms)
          → one of:
              ingest_transcript(text)  # first non-empty transcript resolves the
                                       # turn as correct/incorrect based on
                                       # whether the normalized target word
                                       # appears in the transcript tokens.
              end(turn_id)             # client-initiated cancel.
              check_timeout()          # resolves as "timeout" when elapsed
                                       # exceeds window_ms.

    Only one turn is tracked at a time — a second ``begin`` while active
    supersedes the first (emits a synthetic timeout for the stale turn so the
    frontend reducer clears its state). All timestamps use the injectable
    ``now_fn`` (seconds, monotonic).

    This class is intentionally unaware of WebSockets, asyncio, and the Azure
    Speech SDK. Integration with the realtime pipeline lives in
    ``websocket_handler.py``; a future PR can swap in real pronunciation
    assessment by calling ``resolve_with_assessment`` instead of
    ``ingest_transcript``.
    """

    def __init__(self, now_fn: Optional[Any] = None) -> None:
        self._now = now_fn or time.monotonic
        self._turn_id: Optional[str] = None
        self._target_word_normalized: str = ""
        self._target_word_raw: str = ""
        self._reference_text: str = ""
        self._window_seconds: float = DEFAULT_SCORED_TURN_WINDOW_MS / 1000.0
        self._started_at: Optional[float] = None

    # ------------------------------------------------------------------
    # State helpers
    # ------------------------------------------------------------------
    @property
    def active_turn_id(self) -> Optional[str]:
        return self._turn_id

    def is_active(self) -> bool:
        return self._turn_id is not None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def begin(
        self,
        *,
        turn_id: str,
        target_word: str,
        reference_text: Optional[str] = None,
        window_ms: Optional[int] = None,
    ) -> Optional[ScoredTurnResult]:
        """Start a new scored-turn window.

        Returns a synthetic timeout result for any previously active turn so
        the caller can inform the client that the old turn is gone.
        """
        preempted: Optional[ScoredTurnResult] = None
        if self._turn_id is not None:
            preempted = self._build_result(verdict="timeout", transcript=None)
        normalized = _normalize_word(target_word or "")
        clamped_ms = DEFAULT_SCORED_TURN_WINDOW_MS
        if window_ms is not None:
            try:
                clamped_ms = max(500, min(int(window_ms), MAX_SCORED_TURN_WINDOW_MS))
            except (TypeError, ValueError):
                clamped_ms = DEFAULT_SCORED_TURN_WINDOW_MS
        self._turn_id = str(turn_id)
        self._target_word_raw = str(target_word or "")
        self._target_word_normalized = normalized
        self._reference_text = str(reference_text or target_word or "")
        self._window_seconds = clamped_ms / 1000.0
        self._started_at = self._now()
        return preempted

    def end(self, turn_id: str) -> Optional[ScoredTurnResult]:
        """Client-initiated cancel. Returns a timeout result for the matched
        turn, or ``None`` if the id doesn't match the active turn."""
        if self._turn_id is None or self._turn_id != str(turn_id):
            return None
        result = self._build_result(verdict="timeout", transcript=None)
        self._reset()
        return result

    def ingest_transcript(self, transcript: str) -> Optional[ScoredTurnResult]:
        """Feed a transcript during the active window. Returns a result when
        the turn resolves. Transcripts arriving after expiry are ignored (the
        caller should have called ``check_timeout`` already)."""
        if self._turn_id is None or self._started_at is None:
            return None
        if self._now() - self._started_at > self._window_seconds:
            # Stale — caller should drive resolution via check_timeout().
            return None
        text = (transcript or "").strip()
        if not text:
            return None
        tokens = _tokenize(text)
        verdict = "correct" if self._target_word_normalized and self._target_word_normalized in tokens else "incorrect"
        result = self._build_result(verdict=verdict, transcript=text)
        self._reset()
        return result

    def check_timeout(self) -> Optional[ScoredTurnResult]:
        """Resolve the active turn as a timeout if the window has elapsed."""
        if self._turn_id is None or self._started_at is None:
            return None
        if self._now() - self._started_at < self._window_seconds:
            return None
        result = self._build_result(verdict="timeout", transcript=None)
        self._reset()
        return result

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _build_result(self, *, verdict: str, transcript: Optional[str]) -> ScoredTurnResult:
        started = self._started_at if self._started_at is not None else self._now()
        elapsed_ms = max(0.0, (self._now() - started) * 1000.0)
        return ScoredTurnResult(
            turn_id=self._turn_id or "",
            target_word=self._target_word_raw,
            reference_text=self._reference_text,
            transcript=transcript,
            verdict=verdict,
            elapsed_ms=elapsed_ms,
        )

    def _reset(self) -> None:
        self._turn_id = None
        self._target_word_normalized = ""
        self._target_word_raw = ""
        self._reference_text = ""
        self._started_at = None
        self._window_seconds = DEFAULT_SCORED_TURN_WINDOW_MS / 1000.0
