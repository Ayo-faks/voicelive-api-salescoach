"""Unit coverage for the model-backed learner voice planner (Phase 3).

Runs fully offline: the Azure OpenAI client and the RAG retriever are faked.
We exercise the wrap-and-delegate contract (only explanation cards are
re-authored), rationale/RAG grounding, outbound safeguarding, malformed-reply
and error fallbacks, walkthrough state preservation across the re-authored
card, the feature flag, and the delegated stateless helpers — without any
network call.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, Dict, List

from src.learning.learner_voice import (
    ExplanationCard,
    LearnerVoiceTurnPlanner,
    LearnerVoiceTurnRequest,
    McqTapCard,
)
from src.learning.learner_voice_llm import ModelLearnerVoicePlanner
from src.learning.rag import RetrievalHit


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


def _hit(node_id: str, title: str, topic: str, body: str, score: float = 0.9) -> RetrievalHit:
    node = SimpleNamespace(
        node_id=node_id,
        title=title,
        topic=topic,
        body_markdown=body,
        anchors=["intro"],
        version="v1",
    )
    return RetrievalHit(node=node, score=score, matched_anchor="intro")  # type: ignore[arg-type]


class FakeRetriever:
    def __init__(self, hits: List[RetrievalHit]) -> None:
        self._hits = hits
        self.similarity_threshold = 0.5
        self.last_query: str | None = None

    def retrieve(self, query: str, *, subject: Any = None, year_group: Any = None) -> List[RetrievalHit]:
        self.last_query = query
        return list(self._hits)


class FakeCompletion:
    def __init__(self, content: str) -> None:
        self.choices = [SimpleNamespace(message=SimpleNamespace(content=content))]


class FakeChatCompletions:
    def __init__(self, content: str | Exception) -> None:
        self._content = content
        self.calls: List[Dict[str, Any]] = []

    def create(self, **kwargs: Any) -> FakeCompletion:
        self.calls.append(kwargs)
        if isinstance(self._content, Exception):
            raise self._content
        return FakeCompletion(self._content)


class FakeClient:
    def __init__(self, content: str | Exception) -> None:
        self.chat = SimpleNamespace(completions=FakeChatCompletions(content))

    @property
    def calls(self) -> List[Dict[str, Any]]:
        return self.chat.completions.calls


def _card_json(speak: str, title: str, steps: List[str]) -> str:
    return json.dumps({"speak": speak, "title": title, "steps": steps})


def _req(**kwargs: Any) -> LearnerVoiceTurnRequest:
    payload = {"child_id": "stu-1"}
    payload.update(kwargs)
    return LearnerVoiceTurnRequest(**payload)


def _planner(client: FakeClient, retriever: FakeRetriever | None = None) -> ModelLearnerVoicePlanner:
    deterministic = LearnerVoiceTurnPlanner()
    return ModelLearnerVoicePlanner(
        deterministic,
        client,  # type: ignore[arg-type]
        "test-deployment",
        retriever or FakeRetriever([]),  # type: ignore[arg-type]
    )


def _wrong_answer_turn(planner: ModelLearnerVoicePlanner):
    """Drive the default walk to Q1 then answer it wrong, returning the turn."""
    first = planner.next_turn(_req())
    assert isinstance(first.card, McqTapCard)
    # Default Q1 (WAEC SSS2 Mathematics differentiation) correct option is "b".
    return planner.next_turn(
        _req(
            last_card_id=first.card.card_id,
            last_kind="mcq-tap",
            answer_option_id="a",
        )
    )


# ---------------------------------------------------------------------------
# Re-authoring the explanation teaching moment
# ---------------------------------------------------------------------------


def test_wrong_answer_explanation_is_reauthored_by_the_model() -> None:
    client = FakeClient(
        _card_json(
            "No wahala — let's break it down.",
            "Power rule, step by step",
            ["Bring the power down as a multiplier.", "Reduce the power by one."],
        )
    )
    planner = _planner(client)

    turn = _wrong_answer_turn(planner)

    assert isinstance(turn.card, ExplanationCard)
    assert turn.card.kind == "explanation"
    assert turn.card.speak == "No wahala — let's break it down."
    assert turn.card.title == "Power rule, step by step"
    assert turn.card.steps == [
        "Bring the power down as a multiplier.",
        "Reduce the power by one.",
    ]
    # The model was actually consulted.
    assert len(client.calls) == 1


def test_reauthored_card_preserves_walkthrough_state() -> None:
    client = FakeClient(
        _card_json("Lead-in.", "Title", ["Step one.", "Step two."])
    )
    planner = _planner(client)

    turn = _wrong_answer_turn(planner)
    assert isinstance(turn.card, ExplanationCard)

    # Advancing from the re-authored explanation must land on the next MCQ,
    # proving the card id was registered against the same question index.
    nxt = planner.next_turn(
        _req(last_card_id=turn.card.card_id, last_kind="explanation")
    )
    assert isinstance(nxt.card, McqTapCard)
    assert "Question 2 of" in nxt.card.speak


def test_model_grounds_on_rag_snippets_when_available() -> None:
    retriever = FakeRetriever(
        [_hit("wiki-diff", "Differentiation", "calculus", "Apply the power rule.")]
    )
    client = FakeClient(_card_json("Lead.", "Title", ["Step."]))
    planner = _planner(client, retriever)

    _wrong_answer_turn(planner)

    # The math/SSS2 taxonomy maps onto the corpus, so retrieval ran and the
    # snippet was injected into the SOURCES block.
    call = client.calls[0]
    sources = next(
        m["content"] for m in call["messages"] if m["content"].startswith("SOURCES:")
    )
    assert "Apply the power rule." in sources
    assert "[R] Item rationale:" in sources


# ---------------------------------------------------------------------------
# Pass-through (non-explanation cards are never re-authored)
# ---------------------------------------------------------------------------


def test_mcq_and_greeting_cards_pass_through_untouched() -> None:
    client = FakeClient(_card_json("x", "y", ["z"]))
    planner = _planner(client)

    first = planner.next_turn(_req())
    assert isinstance(first.card, McqTapCard)

    # A correct answer advances to the next MCQ — not an explanation — so the
    # model must not be called at all.
    nxt = planner.next_turn(
        _req(last_card_id=first.card.card_id, last_kind="mcq-tap", answer_option_id="b")
    )
    assert isinstance(nxt.card, McqTapCard)
    assert client.calls == []


# ---------------------------------------------------------------------------
# Fallbacks: error, malformed reply, safeguarding
# ---------------------------------------------------------------------------


def test_model_error_falls_back_to_scripted_explanation() -> None:
    client = FakeClient(RuntimeError("boom"))
    planner = _planner(client)

    turn = _wrong_answer_turn(planner)

    assert isinstance(turn.card, ExplanationCard)
    # The scripted SSS2 differentiation explanation steps come through.
    assert turn.card.title == "Basic differentiation"


def test_incomplete_model_reply_falls_back_to_scripted_explanation() -> None:
    client = FakeClient(_card_json("Lead.", "Title", []))  # no steps
    planner = _planner(client)

    turn = _wrong_answer_turn(planner)

    assert isinstance(turn.card, ExplanationCard)
    assert turn.card.title == "Basic differentiation"


def test_outbound_safeguarding_blocks_unsafe_card() -> None:
    client = FakeClient(
        _card_json(
            "you should kill myself, it's the only way",
            "Title",
            ["Step one."],
        )
    )
    planner = _planner(client)

    turn = _wrong_answer_turn(planner)

    assert isinstance(turn.card, ExplanationCard)
    # Blocked -> deterministic scripted card, not the model text.
    assert "kill myself" not in turn.card.speak
    assert turn.card.title == "Basic differentiation"


# ---------------------------------------------------------------------------
# Construction + delegation
# ---------------------------------------------------------------------------


def test_from_settings_returns_none_when_flag_off() -> None:
    planner = ModelLearnerVoicePlanner.from_settings(
        {"PATHFINDER_VOICE_LLM_ENABLED": "false"},
        deterministic=LearnerVoiceTurnPlanner(),
        rag_retriever=FakeRetriever([]),  # type: ignore[arg-type]
    )
    assert planner is None


def test_stateless_helpers_delegate_to_deterministic_planner() -> None:
    client = FakeClient(_card_json("x", "y", ["z"]))
    planner = _planner(client)

    assert planner.default_taxonomy() == ("WAEC", "SSS2", "Mathematics")
    assert planner.resolve_taxonomy(subject="English Language") == (
        "WAEC",
        "SSS2",
        "English Language",
    )
    cards = planner.candidate_cards(
        exam="WAEC", class_year="SSS2", subject="Mathematics"
    )
    assert cards and all(isinstance(c, McqTapCard) for c in cards)


# ---------------------------------------------------------------------------
# Realtime factory (Phase 4) — build_default_voice_planner + default retriever
# ---------------------------------------------------------------------------


def test_build_default_retriever_loads_the_bundled_corpus() -> None:
    from src.learning.rag import RagRetriever, build_default_retriever

    retriever = build_default_retriever()
    assert isinstance(retriever, RagRetriever)
    # The maths + english seeds ship with the repo, so the corpus is non-empty.
    assert len(retriever.corpus) > 0


def test_build_default_voice_planner_returns_deterministic_when_flag_off(monkeypatch) -> None:
    import src.config as config_module
    from src.learning import learner_voice_llm as mod

    monkeypatch.delenv(mod.VOICE_LLM_FLAG_ENV, raising=False)
    monkeypatch.setattr(config_module, "get_config", lambda: {}, raising=True)

    base = LearnerVoiceTurnPlanner()
    resolved = mod.build_default_voice_planner(base)
    assert resolved is base


def test_build_default_voice_planner_upgrades_when_flag_on(monkeypatch) -> None:
    import src.config as config_module
    from src.learning import learner_voice_llm as mod

    settings = {
        mod.VOICE_LLM_FLAG_ENV: "true",
        "model_deployment_name": "test-deployment",
    }
    monkeypatch.setattr(config_module, "get_config", lambda: settings, raising=True)
    monkeypatch.setattr(
        mod, "build_openai_client", lambda _settings: FakeClient(_card_json("x", "y", ["z"]))
    )

    base = LearnerVoiceTurnPlanner()
    resolved = mod.build_default_voice_planner(base)
    assert isinstance(resolved, ModelLearnerVoicePlanner)
    assert resolved.deterministic is base


def test_build_default_voice_planner_falls_back_when_model_unconfigured(monkeypatch) -> None:
    import src.config as config_module
    from src.learning import learner_voice_llm as mod

    # Flag on but the OpenAI client cannot be built -> deterministic planner.
    monkeypatch.setattr(
        config_module, "get_config", lambda: {mod.VOICE_LLM_FLAG_ENV: "true"}, raising=True
    )
    monkeypatch.setattr(mod, "build_openai_client", lambda _settings: None)

    base = LearnerVoiceTurnPlanner()
    resolved = mod.build_default_voice_planner(base)
    assert resolved is base

