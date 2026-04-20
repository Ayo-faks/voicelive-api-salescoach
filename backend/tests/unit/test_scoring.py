"""Tests for Stage 8 structured_conversation live scoring."""

from src.services.scoring import (
    DEFAULT_COOLDOWN_SECONDS,
    DEFAULT_MIN_TOKENS_IN_WINDOW,
    DEFAULT_SCORED_TURN_WINDOW_MS,
    DEFAULT_WINDOW_SECONDS,
    MAX_SCORED_TURN_WINDOW_MS,
    ScoredTurnDispatcher,
    TargetTokenTally,
)


class _Clock:
    """Deterministic monotonic clock stand-in."""

    def __init__(self, start: float = 0.0) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


class TestTargetTokenTally:
    def test_defaults_match_plan(self) -> None:
        tally = TargetTokenTally()
        # Defaults per PR5 Stage 8 plan §A.
        assert DEFAULT_WINDOW_SECONDS == 60.0
        assert DEFAULT_MIN_TOKENS_IN_WINDOW == 3
        assert DEFAULT_COOLDOWN_SECONDS == 45.0
        snap = tally.snapshot()
        assert snap.total_count == 0
        assert snap.accuracy == 0.0
        assert snap.scaffold_escalated is False

    def test_ingest_counts_correct_tokens(self) -> None:
        clock = _Clock()
        tally = TargetTokenTally(now_fn=clock)
        tally.configure(suggested_target_words=["think", "thumb", "thick"])

        snap = tally.ingest_transcript("I think the thumb is thick.")

        assert snap.correct_count == 3
        assert snap.incorrect_count == 0
        assert snap.total_count == 3
        assert snap.accuracy == 1.0
        assert set(snap.standouts) >= {"think", "thumb", "thick"}

    def test_ingest_counts_substitution_as_incorrect(self) -> None:
        tally = TargetTokenTally(now_fn=_Clock())
        tally.configure(
            suggested_target_words=["think", "thumb"],
            expected_substitutions=["f→th"],
        )

        snap = tally.ingest_transcript("I fink and fumb a lot.")

        assert snap.incorrect_count == 2
        assert snap.correct_count == 0
        assert snap.accuracy == 0.0

    def test_unknown_words_are_ignored(self) -> None:
        tally = TargetTokenTally(now_fn=_Clock())
        tally.configure(suggested_target_words=["think"])

        snap = tally.ingest_transcript("the cat sat on the mat")

        assert snap.total_count == 0

    def test_escalation_fires_after_silent_window(self) -> None:
        clock = _Clock()
        tally = TargetTokenTally(now_fn=clock)
        tally.configure(
            suggested_target_words=["think"],
            window_seconds=10.0,
            min_tokens_in_window=3,
            cooldown_seconds=5.0,
        )

        # Before a full window elapses, no escalation.
        assert tally.check_escalation() is None

        clock.advance(11.0)

        escalation = tally.check_escalation()
        assert escalation is not None
        assert escalation["tokensInWindow"] == 0
        assert escalation["minTokensInWindow"] == 3

    def test_escalation_cooldown_prevents_spam(self) -> None:
        clock = _Clock()
        tally = TargetTokenTally(now_fn=clock)
        tally.configure(
            suggested_target_words=["think"],
            window_seconds=10.0,
            min_tokens_in_window=3,
            cooldown_seconds=20.0,
        )
        clock.advance(11.0)
        assert tally.check_escalation() is not None
        # Immediately asking again is suppressed.
        assert tally.check_escalation() is None
        clock.advance(5.0)
        assert tally.check_escalation() is None
        clock.advance(20.0)
        assert tally.check_escalation() is not None

    def test_escalation_does_not_fire_when_tokens_sufficient(self) -> None:
        clock = _Clock()
        tally = TargetTokenTally(now_fn=clock)
        tally.configure(
            suggested_target_words=["think"],
            window_seconds=10.0,
            min_tokens_in_window=2,
            cooldown_seconds=5.0,
        )
        clock.advance(11.0)
        tally.ingest_transcript("think think")
        assert tally.check_escalation() is None

    def test_therapist_override_mutates_counts(self) -> None:
        tally = TargetTokenTally(now_fn=_Clock())
        snap = tally.apply_override(correct=2, incorrect=1)
        assert snap.correct_count == 2
        assert snap.incorrect_count == 1
        # Undo one correct.
        snap = tally.apply_override(correct=-1)
        assert snap.correct_count == 1

    def test_snapshot_is_json_safe(self) -> None:
        import json

        tally = TargetTokenTally(now_fn=_Clock())
        tally.configure(suggested_target_words=["think"])
        tally.ingest_transcript("think")
        payload = tally.snapshot().to_dict()
        # Must round-trip through JSON.
        assert json.loads(json.dumps(payload))["correctCount"] == 1
        assert "scaffoldEscalated" in payload
        assert "standouts" in payload

    def test_mark_paused_suppresses_immediate_escalation(self) -> None:
        clock = _Clock()
        tally = TargetTokenTally(now_fn=clock)
        tally.configure(
            suggested_target_words=["think"],
            window_seconds=10.0,
            min_tokens_in_window=3,
            cooldown_seconds=15.0,
        )
        clock.advance(11.0)
        tally.mark_paused()
        # Cooldown now starts fresh; within cooldown no escalation.
        assert tally.check_escalation() is None
        clock.advance(10.0)
        assert tally.check_escalation() is None
        clock.advance(10.0)
        assert tally.check_escalation() is not None


class TestScoredTurnDispatcher:
    def test_begin_sets_active_turn(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        assert d.is_active() is False
        assert d.begin(turn_id="t1", target_word="think") is None
        assert d.is_active() is True
        assert d.active_turn_id == "t1"

    def test_ingest_transcript_resolves_correct(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        d.begin(turn_id="t1", target_word="think", reference_text="I think so", window_ms=3000)
        clock.advance(1.0)
        result = d.ingest_transcript("Yes I think so")
        assert result is not None
        assert result.verdict == "correct"
        assert result.turn_id == "t1"
        assert result.target_word == "think"
        assert result.reference_text == "I think so"
        assert result.transcript == "Yes I think so"
        assert 900.0 <= result.elapsed_ms <= 1100.0
        assert d.is_active() is False  # resolved clears state

    def test_ingest_transcript_resolves_incorrect_when_target_missing(self) -> None:
        d = ScoredTurnDispatcher(now_fn=_Clock())
        d.begin(turn_id="t1", target_word="think")
        result = d.ingest_transcript("I fink so")
        assert result is not None
        assert result.verdict == "incorrect"
        assert result.transcript == "I fink so"

    def test_ingest_transcript_ignored_when_no_active_turn(self) -> None:
        d = ScoredTurnDispatcher(now_fn=_Clock())
        assert d.ingest_transcript("anything") is None

    def test_ingest_transcript_ignored_after_window(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        d.begin(turn_id="t1", target_word="think", window_ms=1000)
        clock.advance(2.0)
        assert d.ingest_transcript("think") is None
        # Still active — caller must drive timeout.
        assert d.is_active() is True

    def test_check_timeout_resolves_after_window(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        d.begin(turn_id="t1", target_word="think", window_ms=1000)
        assert d.check_timeout() is None  # not yet elapsed
        clock.advance(1.5)
        result = d.check_timeout()
        assert result is not None
        assert result.verdict == "timeout"
        assert result.transcript is None
        assert d.is_active() is False

    def test_end_cancels_matching_turn(self) -> None:
        d = ScoredTurnDispatcher(now_fn=_Clock())
        d.begin(turn_id="t1", target_word="think")
        result = d.end("t1")
        assert result is not None
        assert result.verdict == "timeout"
        assert d.is_active() is False

    def test_end_ignores_mismatched_turn_id(self) -> None:
        d = ScoredTurnDispatcher(now_fn=_Clock())
        d.begin(turn_id="t1", target_word="think")
        assert d.end("nope") is None
        assert d.is_active() is True

    def test_begin_preempts_previous_turn(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        d.begin(turn_id="t1", target_word="think")
        clock.advance(0.1)
        preempted = d.begin(turn_id="t2", target_word="thumb")
        assert preempted is not None
        assert preempted.turn_id == "t1"
        assert preempted.verdict == "timeout"
        assert d.active_turn_id == "t2"

    def test_window_ms_clamped(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        # Way too large — clamped to MAX.
        d.begin(turn_id="t1", target_word="think", window_ms=60000)
        clock.advance(MAX_SCORED_TURN_WINDOW_MS / 1000.0 + 0.1)
        assert d.check_timeout() is not None

    def test_window_ms_defaults_when_invalid(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        d.begin(turn_id="t1", target_word="think", window_ms="not a number")  # type: ignore[arg-type]
        clock.advance(DEFAULT_SCORED_TURN_WINDOW_MS / 1000.0 + 0.1)
        assert d.check_timeout() is not None


class TestScoredTurnDispatcher:
    def test_begin_sets_active_turn(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        assert d.is_active() is False
        assert d.begin(turn_id="t1", target_word="think") is None
        assert d.is_active() is True
        assert d.active_turn_id == "t1"

    def test_ingest_transcript_resolves_correct(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        d.begin(turn_id="t1", target_word="think", reference_text="I think so", window_ms=3000)
        clock.advance(1.0)
        result = d.ingest_transcript("Yes I think so")
        assert result is not None
        assert result.verdict == "correct"
        assert result.turn_id == "t1"
        assert result.target_word == "think"
        assert result.reference_text == "I think so"
        assert result.transcript == "Yes I think so"
        assert 900.0 <= result.elapsed_ms <= 1100.0
        assert d.is_active() is False  # resolved clears state

    def test_ingest_transcript_resolves_incorrect_when_target_missing(self) -> None:
        d = ScoredTurnDispatcher(now_fn=_Clock())
        d.begin(turn_id="t1", target_word="think")
        result = d.ingest_transcript("I fink so")
        assert result is not None
        assert result.verdict == "incorrect"
        assert result.transcript == "I fink so"

    def test_ingest_transcript_ignored_when_no_active_turn(self) -> None:
        d = ScoredTurnDispatcher(now_fn=_Clock())
        assert d.ingest_transcript("anything") is None

    def test_ingest_transcript_ignored_after_window(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        d.begin(turn_id="t1", target_word="think", window_ms=1000)
        clock.advance(2.0)
        assert d.ingest_transcript("think") is None
        # Still active — caller must drive timeout.
        assert d.is_active() is True

    def test_check_timeout_resolves_after_window(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        d.begin(turn_id="t1", target_word="think", window_ms=1000)
        assert d.check_timeout() is None  # not yet elapsed
        clock.advance(1.5)
        result = d.check_timeout()
        assert result is not None
        assert result.verdict == "timeout"
        assert result.transcript is None
        assert d.is_active() is False

    def test_end_cancels_matching_turn(self) -> None:
        d = ScoredTurnDispatcher(now_fn=_Clock())
        d.begin(turn_id="t1", target_word="think")
        result = d.end("t1")
        assert result is not None
        assert result.verdict == "timeout"
        assert d.is_active() is False

    def test_end_ignores_mismatched_turn_id(self) -> None:
        d = ScoredTurnDispatcher(now_fn=_Clock())
        d.begin(turn_id="t1", target_word="think")
        assert d.end("nope") is None
        assert d.is_active() is True

    def test_begin_preempts_previous_turn(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        d.begin(turn_id="t1", target_word="think")
        clock.advance(0.1)
        preempted = d.begin(turn_id="t2", target_word="thumb")
        assert preempted is not None
        assert preempted.turn_id == "t1"
        assert preempted.verdict == "timeout"
        assert d.active_turn_id == "t2"

    def test_window_ms_clamped(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        # Way too large — clamped to MAX.
        d.begin(turn_id="t1", target_word="think", window_ms=60000)
        clock.advance(MAX_SCORED_TURN_WINDOW_MS / 1000.0 + 0.1)
        assert d.check_timeout() is not None

    def test_window_ms_defaults_when_invalid(self) -> None:
        clock = _Clock()
        d = ScoredTurnDispatcher(now_fn=clock)
        d.begin(turn_id="t1", target_word="think", window_ms="not a number")  # type: ignore[arg-type]
        clock.advance(DEFAULT_SCORED_TURN_WINDOW_MS / 1000.0 + 0.1)
        assert d.check_timeout() is not None
