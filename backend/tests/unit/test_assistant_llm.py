"""Unit coverage for the model-backed Dig-Deeper tutor provider.

These tests run fully offline: the Azure OpenAI client and the RAG retriever
are faked, so we exercise prompt assembly, retrieval-first grounding, the
Socratic-while-scored guard, citation binding (RAG anchors only), outbound
safeguarding, the deterministic fallback, the per-learner turn cap, and
consent gating — without any network call.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, Dict, List

from src.learning.assistant_llm import ModelAssistantProvider
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


class FakeFallback:
    def __init__(self) -> None:
        self.called_with: Any = None

    def ask(self, question: str, context: Any) -> Dict[str, Any]:
        self.called_with = (question, context)
        return {"answer": "FALLBACK", "citations": []}


def _model_json(answer: str, sources_used: List[int]) -> str:
    return json.dumps({"answer": answer, "sources_used": sources_used})


def _provider(client: FakeClient, retriever: FakeRetriever, fallback: FakeFallback, **kw: Any) -> ModelAssistantProvider:
    return ModelAssistantProvider(client, "test-deployment", retriever, fallback, **kw)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Grounded happy path + citation binding
# ---------------------------------------------------------------------------


def test_grounded_explain_returns_answer_and_bound_citations() -> None:
    retriever = FakeRetriever([
        _hit("wiki-fractions", "Simplifying fractions", "fractions", "Divide both parts by the HCF."),
    ])
    client = FakeClient(_model_json("Divide top and bottom by 2 to get 1/2.", [1]))
    fallback = FakeFallback()
    provider = _provider(client, retriever, fallback)

    reply = provider.ask(
        "why is 2/4 the same as 1/2?",
        {
            "focus_item": {"stem": "Simplify 2/4", "scored": True},
            "thread": [],
            "memory_allowed": False,
        },
    )

    assert "1/2" in reply["answer"]
    assert reply["grounded"] is True
    assert reply["citations"] == [
        {"label": "Simplifying fractions", "topic_id": "wiki-fractions"}
    ]
    assert len(client.calls) == 1


def test_citation_binding_drops_out_of_range_indices() -> None:
    retriever = FakeRetriever([
        _hit("wiki-a", "Topic A", "a", "Body A."),
    ])
    client = FakeClient(_model_json("Here you go.", [1, 99, 0]))
    provider = _provider(client, retriever, FakeFallback())

    reply = provider.ask(
        "explain topic a",
        {"focus_item": {"stem": "Topic A item", "scored": True}, "memory_allowed": False},
    )
    assert reply["citations"] == [{"label": "Topic A", "topic_id": "wiki-a"}]


# ---------------------------------------------------------------------------
# Mode selection in the prompt
# ---------------------------------------------------------------------------


def _system_text(client: FakeClient) -> str:
    messages = client.calls[0]["messages"]
    return "\n".join(m["content"] for m in messages if m["role"] == "system")


def test_unscored_item_uses_socratic_clause() -> None:
    retriever = FakeRetriever([_hit("wiki-a", "Topic A", "a", "Body A.")])
    client = FakeClient(_model_json("Think about what stays the same.", [1]))
    provider = _provider(client, retriever, FakeFallback())

    provider.ask(
        "is it option B?",
        {"focus_item": {"stem": "Solve 3x=9", "scored": False}, "memory_allowed": False},
    )
    system = _system_text(client)
    assert "STILL BEING MARKED" in system


def test_scored_item_uses_explain_clause() -> None:
    retriever = FakeRetriever([_hit("wiki-a", "Topic A", "a", "Body A.")])
    client = FakeClient(_model_json("The answer is x=3.", [1]))
    provider = _provider(client, retriever, FakeFallback())

    provider.ask(
        "what is x?",
        {"focus_item": {"stem": "Solve 3x=9", "scored": True}, "memory_allowed": False},
    )
    system = _system_text(client)
    assert "STILL BEING MARKED" not in system
    assert "full worked explanation" in system


# ---------------------------------------------------------------------------
# Grounding contract — defer when no authority
# ---------------------------------------------------------------------------


def test_no_grounding_defers_without_calling_model() -> None:
    retriever = FakeRetriever([])  # no hits
    client = FakeClient(_model_json("should not be used", [1]))
    provider = _provider(client, retriever, FakeFallback())

    reply = provider.ask(
        "what is a black hole?",
        {"focus_item": {}, "memory_allowed": False},
    )
    assert reply["citations"] == []
    assert "won't guess" in reply["answer"]
    assert reply["grounded"] is False
    assert client.calls == []


def test_item_rationale_grounds_even_without_hits() -> None:
    retriever = FakeRetriever([])
    client = FakeClient(_model_json("Because you divide by the common factor.", []))
    provider = _provider(client, retriever, FakeFallback())

    reply = provider.ask(
        "why?",
        {
            "focus_item": {
                "stem": "Simplify 2/4",
                "rationale": "Divide numerator and denominator by 2.",
                "scored": True,
            },
            "memory_allowed": False,
        },
    )
    assert len(client.calls) == 1
    assert "divide" in reply["answer"].lower()


# ---------------------------------------------------------------------------
# Outbound safeguarding
# ---------------------------------------------------------------------------


def test_outbound_safeguarding_blocks_harmful_model_output() -> None:
    retriever = FakeRetriever([_hit("wiki-a", "Topic A", "a", "Body A.")])
    client = FakeClient(_model_json("you should kill myself, it's the only way", [1]))
    provider = _provider(client, retriever, FakeFallback())

    reply = provider.ask(
        "i feel low",
        {"focus_item": {"stem": "Topic A item", "scored": True}, "memory_allowed": False},
    )
    assert "kill myself" not in reply["answer"]
    assert reply["citations"] == []
    assert reply["grounded"] is False


# ---------------------------------------------------------------------------
# Deterministic fallback on model error
# ---------------------------------------------------------------------------


def test_model_error_falls_back_to_deterministic() -> None:
    retriever = FakeRetriever([_hit("wiki-a", "Topic A", "a", "Body A.")])
    client = FakeClient(RuntimeError("boom"))
    fallback = FakeFallback()
    provider = _provider(client, retriever, fallback)

    reply = provider.ask(
        "explain topic a",
        {"focus_item": {"stem": "Topic A item", "scored": True}, "memory_allowed": False},
    )
    assert reply["answer"] == "FALLBACK"
    assert fallback.called_with is not None


# ---------------------------------------------------------------------------
# Turn cap
# ---------------------------------------------------------------------------


def test_turn_cap_short_circuits_before_model() -> None:
    retriever = FakeRetriever([_hit("wiki-a", "Topic A", "a", "Body A.")])
    client = FakeClient(_model_json("nope", [1]))
    provider = _provider(client, retriever, FakeFallback(), max_turns=2)

    thread = [
        {"role": "user", "text": "q1"},
        {"role": "assistant", "text": "a1"},
        {"role": "user", "text": "q2"},
        {"role": "assistant", "text": "a2"},
    ]
    reply = provider.ask(
        "q3",
        {"focus_item": {"stem": "x", "scored": True}, "thread": thread, "memory_allowed": False},
    )
    assert client.calls == []
    assert "pause here" in reply["answer"]


# ---------------------------------------------------------------------------
# Social openers (greeting / thanks / capability) — answered without grounding
# ---------------------------------------------------------------------------


def test_greeting_answers_warmly_without_grounding() -> None:
    retriever = FakeRetriever([])  # no sources at all
    client = FakeClient(_model_json("should not be used", [1]))
    provider = _provider(client, retriever, FakeFallback())

    reply = provider.ask("hi", {"focus_item": {}, "memory_allowed": False})

    assert client.calls == []  # no model call
    assert "won't guess" not in reply["answer"]  # not the defer message
    assert "Pathfinder" in reply["answer"]
    assert reply["smalltalk"] is True
    assert reply["grounded"] is False


def test_capability_question_describes_tutor() -> None:
    provider = _provider(FakeClient(_model_json("x", [])), FakeRetriever([]), FakeFallback())
    reply = provider.ask("what can you do?", {"focus_item": {}, "memory_allowed": False})
    assert "explain" in reply["answer"].lower()
    assert reply.get("smalltalk") is True


def test_greeting_with_anchored_item_still_grounds() -> None:
    # A "hi" while a diagnostic item is anchored must not bypass grounding.
    retriever = FakeRetriever([])
    client = FakeClient(_model_json("should not be used", [1]))
    provider = _provider(client, retriever, FakeFallback())

    reply = provider.ask(
        "hi",
        {"focus_item": {"stem": "Simplify 2/4", "scored": True}, "memory_allowed": False},
    )
    assert reply.get("smalltalk") is not True
    assert "won't guess" in reply["answer"]


def test_study_question_with_greeting_word_is_not_smalltalk() -> None:
    retriever = FakeRetriever([_hit("wiki-a", "Histograms", "stats", "A histogram groups data.")])
    client = FakeClient(_model_json("A histogram groups data into bars.", [1]))
    provider = _provider(client, retriever, FakeFallback())

    reply = provider.ask("what is a histogram", {"focus_item": {}, "memory_allowed": False})
    assert reply.get("smalltalk") is not True
    assert len(client.calls) == 1


# ---------------------------------------------------------------------------
# Consent gating of the learner profile
# ---------------------------------------------------------------------------


def test_profile_included_only_with_memory_consent() -> None:
    retriever = FakeRetriever([_hit("wiki-a", "Topic A", "a", "Body A.")])
    client = FakeClient(_model_json("ok", [1]))
    provider = _provider(client, retriever, FakeFallback())

    provider.ask(
        "help",
        {
            "focus_item": {"stem": "Topic A item", "scored": True},
            "weak_topics": ["ratio"],
            "memory_allowed": True,
        },
    )
    assert "LEARNER PROFILE" in _system_text(client)


def test_profile_withheld_without_memory_consent() -> None:
    retriever = FakeRetriever([_hit("wiki-a", "Topic A", "a", "Body A.")])
    client = FakeClient(_model_json("ok", [1]))
    provider = _provider(client, retriever, FakeFallback())

    provider.ask(
        "help",
        {
            "focus_item": {"stem": "Topic A item", "scored": True},
            "weak_topics": ["ratio"],
            "memory_allowed": False,
        },
    )
    assert "LEARNER PROFILE" not in _system_text(client)


def test_memory_callback_injected_with_consent() -> None:
    retriever = FakeRetriever([_hit("wiki-a", "Topic A", "a", "Body A.")])
    client = FakeClient(_model_json("ok", [1]))
    provider = _provider(client, retriever, FakeFallback())

    provider.ask(
        "help",
        {
            "focus_item": {"stem": "Topic A item", "scored": True},
            "memory_callback": "Heads up — the sign error trap caught you twice on Algebra recently.",
            "memory_allowed": True,
        },
    )
    system = _system_text(client)
    assert "LEARNER MEMORY" in system
    assert "sign error trap" in system


def test_memory_callback_withheld_without_consent() -> None:
    retriever = FakeRetriever([_hit("wiki-a", "Topic A", "a", "Body A.")])
    client = FakeClient(_model_json("ok", [1]))
    provider = _provider(client, retriever, FakeFallback())

    provider.ask(
        "help",
        {
            "focus_item": {"stem": "Topic A item", "scored": True},
            "memory_callback": "Heads up — the sign error trap caught you twice on Algebra recently.",
            "memory_allowed": False,
        },
    )
    assert "LEARNER MEMORY" not in _system_text(client)


# ---------------------------------------------------------------------------
# from_settings gating (no network)
# ---------------------------------------------------------------------------


def test_from_settings_returns_none_when_flag_off() -> None:
    retriever = FakeRetriever([])
    provider = ModelAssistantProvider.from_settings(
        {"PATHFINDER_ASSISTANT_LLM_ENABLED": "false"},
        rag_retriever=retriever,  # type: ignore[arg-type]
        fallback=FakeFallback(),
    )
    assert provider is None


def test_from_settings_returns_none_when_not_configured() -> None:
    retriever = FakeRetriever([])
    # Flag on but no endpoint → build_openai_client returns None → no provider.
    provider = ModelAssistantProvider.from_settings(
        {
            "PATHFINDER_ASSISTANT_LLM_ENABLED": "true",
            "azure_openai_endpoint": "",
            "model_deployment_name": "gpt-4o",
        },
        rag_retriever=retriever,  # type: ignore[arg-type]
        fallback=FakeFallback(),
    )
    assert provider is None
