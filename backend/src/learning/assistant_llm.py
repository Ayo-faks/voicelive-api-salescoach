"""Model-backed ``AssistantProvider`` for the learner Dig-Deeper tutor.

This is the Phase 1 brain behind the text drawer (``/api/learning/assistant/ask``).
It composes the shared pedagogy core in :mod:`src.learning.tutor` with the
existing RAG retriever and Azure OpenAI plumbing:

1. **Retrieval-first grounding** — every turn pulls curriculum snippets via
   ``retrieve_or_refuse``; those snippets plus the focus item's stored
   rationale are the *only* factual authority handed to the model.
2. **Teach-parametric, ground-on-RAG** — the system prompt tells the model to
   teach the method/concept in its own words but to ground every fact, formula
   and final answer strictly in the numbered ``[S#]`` sources, and to defer
   honestly when the sources don't cover the ask (no invention).
3. **Socratic-while-scored** — when an anchored diagnostic item is still being
   assessed, the model must guide with hints/questions and must not reveal the
   answer (protecting the assessment signal).
4. **Citations bind to RAG only** — the model cites sources by index; we map
   those indices back to real retrieval hits and drop anything it invents.
5. **Outbound safeguarding** — the generated reply is screened with the
   deterministic lexicon before it can reach a learner.
6. **Deterministic fallback** — missing creds, no grounding, turn-cap, or any
   error falls back to the injected deterministic provider so the drawer never
   breaks.

The module never imports :mod:`src.learning.api` (one-way dependency) so the
provider stays independently testable with a faked OpenAI client.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, List, Mapping, Optional, Sequence

from src.learning import taxonomy
from src.learning.assistant_intent import is_session_closing
from src.learning.rag import RagRetriever, RetrievalHit, retrieve_or_refuse
from src.learning.tutor import (
    FocusItem,
    build_grounded_context,
    screen_outbound_text,
)
from src.services.azure_openai_auth import build_openai_client

logger = logging.getLogger(__name__)

ASSISTANT_LLM_FLAG_ENV = "PATHFINDER_ASSISTANT_LLM_ENABLED"
ASSISTANT_MAX_TURNS_ENV = "PATHFINDER_ASSISTANT_MAX_TURNS"
# Optional override so the text tutor can run on a faster/cheaper deployment
# (e.g. gpt-4o-mini, ~2-4x faster decode) without touching the voice pipeline,
# which keeps using the shared model_deployment_name.
ASSISTANT_MODEL_ENV = "PATHFINDER_ASSISTANT_MODEL_DEPLOYMENT"

# Per-thread cap on learner (user) turns. This is a cost guard (each turn
# resends the whole thread, so spend grows superlinearly with length) and a
# pedagogy nudge back toward practice cards — not a hard safety gate. The
# thread persists in localStorage across sessions, so the cap is per saved
# conversation, reset by "New conversation". Override via
# PATHFINDER_ASSISTANT_MAX_TURNS.
_DEFAULT_MAX_TURNS = 20
_DEFAULT_TEMPERATURE = 0.3
_DEFAULT_MAX_TOKENS = 600

_VALID_SUBJECTS = set(taxonomy.SUBJECTS)
_VALID_YEAR_GROUPS = set(taxonomy.YEAR_GROUPS)

_SUBJECT_ALIASES = {
    "math": "maths",
    "maths": "maths",
    "mathematics": "maths",
    "english": "english",
    "english language": "english",
    "english-language": "english",
    "lit": "literature",
    "literature in english": "literature",
    "literature-in-english": "literature",
    "agric": "agricultural_science",
    "agriculture": "agricultural_science",
    "agricultural science": "agricultural_science",
    "computer": "computer_science",
    "computer science": "computer_science",
    "data processing": "data_processing",
    "econs": "economics",
}

_DEFER_MESSAGE = (
    "I don't have study material I can ground that on yet, so I won't guess. "
    "Try asking about the topic you're practising, or rephrase using the words "
    "from your worksheet, and I'll talk it through with you."
)

_TURN_CAP_MESSAGE = (
    "We've covered a lot, so this chat is full now — pausing helps it stick. "
    "Try a quick practice card on this topic, or tap the + button up top to "
    "start a new chat and keep asking."
)

# Greetings / social chit-chat that a learner opens with. These never need
# RAG grounding — refusing to "ground" a "hi" feels broken, so we answer warmly
# and steer toward study, exactly like a human tutor would before getting to
# work. Kept deterministic (no model call) so it is free, instant, and safe.
_GREETING_TOKENS = frozenset(
    {
        "hi", "hii", "hiii", "hello", "helo", "hey", "heyy", "yo", "hiya",
        "howdy", "greetings", "morning", "afternoon", "evening",
        "wagwan", "wassup", "whatsup", "sup",
    }
)
_GREETING_PHRASES = (
    "good morning", "good afternoon", "good evening", "good day",
    "how are you", "how are u", "how you dey", "how far", "hope you are well",
    "hope you're well", "are you there", "you there",
)
_THANKS_PHRASES = (
    "thank you", "thanks", "thank u", "thx", "tnks", "well done", "nice one",
    "appreciate it", "good job", "you're the best", "youre the best",
)
# Pure compliments / encouragement aimed at the tutor. Like greetings/thanks
# these never need RAG — answering "You are awesome!" with a "no grounded
# source" refusal feels broken, so we acknowledge warmly and steer to study.
_COMPLIMENT_PHRASES = (
    "you are awesome", "you're awesome", "youre awesome", "ur awesome",
    "you are amazing", "you're amazing", "youre amazing",
    "you are great", "you're great", "youre great",
    "you are the best", "you're the best", "youre the best",
    "you are smart", "you're smart", "youre smart",
    "you are good", "you're good", "youre good",
    "you are cool", "you're cool", "youre cool",
    "you are brilliant", "you're brilliant", "youre brilliant",
    "you are helpful", "you're helpful", "youre helpful",
    "you rock", "you are wonderful", "you're wonderful",
    "i love you", "love you", "i like you", "you are nice", "you're nice",
    "great stuff", "well done",
)
# Bare one-word compliments — only matched when they make up the whole message
# (every token is a compliment word), so a real question like "amazing facts
# about the sun" is never misrouted.
_COMPLIMENT_TOKENS = frozenset(
    {
        "awesome", "amazing", "brilliant", "fantastic", "wonderful",
        "great", "cool", "nice", "wow", "perfect", "excellent", "love",
    }
)
_CAPABILITY_PHRASES = (
    "who are you", "what are you", "what is your name", "what's your name",
    "whats your name", "what can you do", "what do you do", "how can you help",
    "what can you help", "how do you work", "how does this work",
    "what is this", "what's this", "help me", "can you help",
)


def _normalize_smalltalk(text: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in text.lower())
    return " ".join(cleaned.split())


def _classify_smalltalk(question: str) -> Optional[str]:
    """Return ``greeting`` | ``thanks`` | ``capability`` | ``compliment`` |
    ``closing`` for social / session-control openers.

    Conservative on purpose: greetings/thanks only fire for short messages so a
    real study question that happens to contain "hi" (e.g. "what is a
    histogram") is never misrouted. Closings are matched as distinctive
    multi-word phrases, so they may run a little longer. Returns ``None`` for
    anything that should go through grounding.
    """
    norm = _normalize_smalltalk(question)
    if not norm:
        return None
    words = norm.split()
    # Session-control closings ("let's round up", "end the exercise") are
    # distinctive imperatives — match them before the short-message guard so a
    # natural "okay, let's end it, end the exercise please" still lands here.
    # Shared with the intent router so both agree on what counts as a close.
    if is_session_closing(question):
        return "closing"
    # Only treat very short messages as pure social chit-chat.
    if len(words) > 6:
        return None
    if any(p in norm for p in _CAPABILITY_PHRASES):
        return "capability"
    if any(p in norm for p in _COMPLIMENT_PHRASES):
        return "compliment"
    if words and all(w in _COMPLIMENT_TOKENS for w in words):
        return "compliment"
    if any(p in norm for p in _THANKS_PHRASES) or norm in {"ok", "okay", "k", "cool", "alright"}:
        return "thanks"
    if any(p in norm for p in _GREETING_PHRASES):
        return "greeting"
    # Pure greeting tokens only (e.g. "hi", "hey there", "hello!!!").
    if words and all(w in _GREETING_TOKENS or w in {"there", "tutor", "pathfinder"} for w in words):
        return "greeting"
    return None


def _smalltalk_reply(kind: str, context: Mapping[str, Any]) -> str:
    setup = context.get("learner_setup") or {}
    subject = str(setup.get("subject") or "").strip()
    subject_clause = f" in {subject}" if subject else ""
    if kind == "thanks":
        return (
            "You're welcome — glad that helped! Want to lock it in with a quick "
            "practice question, or is there another topic you'd like to go over?"
        )
    if kind == "compliment":
        return (
            "Aw, thank you — that means a lot! I'm here whenever you want to "
            "learn something new. Want to try a quick practice question, or "
            f"go over a topic{subject_clause}?"
        )
    if kind == "closing":
        return (
            "Nice work — let's wrap up there. You did well to keep going. "
            "Whenever you're ready for more, tap Practice up top to start a "
            "fresh set, or just ask me a new question. See you next time! 👋"
        )
    if kind == "capability":
        return (
            "I'm Wulo, your study tutor for WAEC/NECO/JAMB prep. I can "
            "explain how a topic works, talk through a question you got wrong, "
            "and set short practice cards — always grounded in your study "
            f"material. What would you like to start with{subject_clause}?"
        )
    # greeting
    return (
        "Hi! I'm Wulo, your study tutor. I can explain a tricky topic, "
        "work through a question you found hard, or give you a quick practice "
        f"card. What would you like to look at today{subject_clause}?"
    )

_SYSTEM_PROMPT = """You are Wulo, a patient study tutor for Nigerian \
secondary-school learners (JSS3 and SS3) preparing for Junior WAEC/JSSCE and \
WAEC/NECO/JAMB. Speak in clear, warm Nigerian English (en-NG).

Hard rules — follow every one:
- Teach the METHOD and the IDEA in your own words so the learner can reuse it. \
You may explain reasoning, steps and worked technique parametrically.
- GROUND EVERY FACT in the numbered SOURCES below. Any specific fact, formula, \
definition, rule, date or final numeric answer MUST come from the SOURCES. If \
the SOURCES do not cover what is asked, say you don't have it and ask the \
learner to rephrase — DO NOT invent facts, citations, or answers.
- Cite the sources you use by their tag (for example S1, S2) and list those \
numbers in "sources_used".
- Never promise or guarantee an exam grade, pass, or outcome. Encourage effort \
and realistic next steps only.
- Keep it concise, age-appropriate, encouraging, and easy to scan.

Output format rules (STRICT for every reply):
- Return clean Markdown only (no HTML, no code fences).
- Use this exact structure in order:
    1) One short direct answer line.
    2) "**Why it matters:**" with one short sentence.
    3) "**Quick breakdown:**" with 3-5 bullet points.
    4) "**Try this:**" with a numbered list of 2-4 practical steps.
    5) "**In short:**" with one recap sentence.
- Keep each sentence simple (roughly 8-16 words).
- Use **bold** only for key terms (max 6 bold phrases total).
- Keep bullets flat (no nested bullets).
- Keep total response concise for teens (about 90-180 words unless the user asks for more).
{mode_clause}

Return ONLY a JSON object: {{"answer": "<your reply>", "sources_used": [<source numbers you used>]}}."""

_SOCRATIC_CLAUSE = (
    "- THIS QUESTION IS STILL BEING MARKED. Do NOT reveal or confirm the final "
    "answer or which option is correct. Guide with one hint or one guiding "
    "question so the learner works it out themselves."
)
_EXPLAIN_CLAUSE = (
    "- You may give a full worked explanation, including the correct answer, as "
    "long as every fact is grounded in the SOURCES."
)


def _coerce_subject(value: Any) -> Optional[str]:
    if not value:
        return None
    key = str(value).strip().lower()
    resolved = _SUBJECT_ALIASES.get(key)
    if resolved in _VALID_SUBJECTS:
        return resolved
    if key in _VALID_SUBJECTS:
        return key
    return None


def _coerce_year_group(value: Any) -> Optional[str]:
    if not value:
        return None
    key = str(value).strip().upper().replace(" ", "")
    return key if key in _VALID_YEAR_GROUPS else None


class ModelAssistantProvider:
    """Azure OpenAI-backed tutor provider with deterministic fallback."""

    def __init__(
        self,
        client: Any,
        model: str,
        rag_retriever: RagRetriever,
        fallback: Any,
        *,
        temperature: float = _DEFAULT_TEMPERATURE,
        max_tokens: int = _DEFAULT_MAX_TOKENS,
        max_turns: int = _DEFAULT_MAX_TURNS,
    ) -> None:
        self.client = client
        self.model = model
        self.rag_retriever = rag_retriever
        self.fallback = fallback
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.max_turns = max_turns
        # Mutable call kwargs; adapted in _call_model when the deployment
        # rejects max_tokens / temperature (gpt-5.x families).
        self._model_kwargs: Dict[str, Any] = {
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------
    @classmethod
    def from_settings(
        cls,
        settings: Mapping[str, Any],
        *,
        rag_retriever: RagRetriever,
        fallback: Any,
    ) -> Optional["ModelAssistantProvider"]:
        """Build the provider, or ``None`` when it should not be used.

        Returns ``None`` (so the caller keeps the deterministic provider) when
        the feature flag is off, the model deployment is unresolved, or Azure
        OpenAI is not configured.
        """
        raw_flag = str(settings.get(ASSISTANT_LLM_FLAG_ENV) or os.environ.get(ASSISTANT_LLM_FLAG_ENV, ""))
        if raw_flag.strip().lower() not in {"1", "true", "yes", "on"}:
            return None

        client = build_openai_client(settings)
        if client is None:
            logger.warning("Assistant LLM enabled but Azure OpenAI is not configured; using deterministic provider")
            return None

        model = str(
            settings.get(ASSISTANT_MODEL_ENV)
            or os.environ.get(ASSISTANT_MODEL_ENV)
            or settings.get("model_deployment_name")
            or ""
        ).strip()
        if not model:
            logger.warning("Assistant LLM enabled but no model deployment name resolved; using deterministic provider")
            return None

        max_turns = _DEFAULT_MAX_TURNS
        raw_cap = settings.get(ASSISTANT_MAX_TURNS_ENV) or os.environ.get(ASSISTANT_MAX_TURNS_ENV)
        if raw_cap:
            try:
                max_turns = max(1, int(raw_cap))
            except (TypeError, ValueError):
                max_turns = _DEFAULT_MAX_TURNS

        return cls(client, model, rag_retriever, fallback, max_turns=max_turns)

    # ------------------------------------------------------------------
    # AssistantProvider protocol
    # ------------------------------------------------------------------
    def ask(self, question: str, context: Mapping[str, Any]) -> Dict[str, Any]:
        q = (question or "").strip()
        if not q:
            return {"answer": "", "citations": []}

        item = FocusItem.from_payload(context.get("focus_item"))
        memory_allowed = bool(context.get("memory_allowed"))
        thread_raw = context.get("thread") or []

        # Per-learner turn cap (cost / fatigue guard) — count user turns.
        user_turns = sum(
            1
            for t in thread_raw
            if isinstance(t, Mapping) and str(t.get("role") or "").lower() == "user"
        )
        if user_turns >= self.max_turns:
            # `smalltalk: True` marks this as a deliberate, deterministic reply —
            # the UI suppresses the "No grounded source" badge, which would
            # otherwise make an intentional pause read like a retrieval failure.
            return {
                "answer": _TURN_CAP_MESSAGE,
                "citations": [],
                "grounded": False,
                "smalltalk": True,
            }

        # Social opener (greeting / thanks / "what can you do") — answer warmly
        # and steer to study instead of demanding grounded sources. Only when no
        # diagnostic item is anchored, so a hint request mid-question still goes
        # through the grounded, assessment-protecting path.
        if not item.is_present:
            smalltalk = _classify_smalltalk(q)
            if smalltalk is not None:
                reply = _smalltalk_reply(smalltalk, context)
                decision = screen_outbound_text(reply)
                if not decision.allowed:
                    return {"answer": decision.safe_message, "citations": [], "grounded": False}
                return {"answer": reply, "citations": [], "grounded": False, "smalltalk": True}

        # Retrieval-first grounding.
        setup = context.get("learner_setup") or {}
        subject = _coerce_subject(item.skill_id) or _coerce_subject(setup.get("subject"))
        year_group = _coerce_year_group(setup.get("year_group"))
        retrieval_query = f"{q}\n{item.stem}".strip() if item.stem else q

        hits: List[RetrievalHit] = []
        try:
            hits, _refusal = retrieve_or_refuse(
                self.rag_retriever,
                retrieval_query,
                subject=subject,  # type: ignore[arg-type]
                year_group=year_group,  # type: ignore[arg-type]
            )
            # Subject/year scoping is a relevance preference, not a wall: a learner
            # whose profile says Maths can still ask a valid Biology question. When
            # the scoped pass finds nothing, retry across the whole corpus so any
            # grounded curriculum answer is reachable. Only widens on an empty
            # scoped result, so in-subject relevance is unchanged.
            if not hits and (subject is not None or year_group is not None):
                hits, _refusal = retrieve_or_refuse(
                    self.rag_retriever,
                    retrieval_query,
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Assistant retrieval failed: %s", exc)
            hits = []

        snippets = [hit.node.body_markdown for hit in hits]
        # Consent-gated learner memory signals: weak topics (semantic) plus the
        # cross-session episodic callback for recurring misconception traps. Both
        # are withheld inside build_grounded_context when memory is not allowed.
        memory_profile: Dict[str, Any] = {}
        if context.get("weak_topics"):
            memory_profile["weak_topics"] = context.get("weak_topics")
        memory_callback = context.get("memory_callback")
        if memory_callback:
            memory_profile["memory_callback"] = str(memory_callback)
        grounded = build_grounded_context(
            q,
            item=item,
            retrieved=snippets,
            profile=memory_profile,
            thread=thread_raw,
            memory_allowed=memory_allowed,
        )

        # Grounding contract: no authority → defer honestly, never invent.
        if not grounded.grounded:
            return {"answer": _DEFER_MESSAGE, "citations": [], "grounded": False}

        try:
            answer, used_indices = self._call_model(grounded, hits)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Assistant model call failed; falling back: %s", exc)
            return self.fallback.ask(question, context)

        # Outbound safeguarding before anything reaches the learner.
        decision = screen_outbound_text(answer)
        if not decision.allowed:
            logger.warning(
                "Assistant outbound reply blocked (severity=%s, categories=%s)",
                decision.severity.value,
                decision.categories,
            )
            return {"answer": decision.safe_message, "citations": [], "grounded": False}

        citations = self._bind_citations(used_indices, hits)
        return {"answer": answer, "citations": citations, "grounded": True}

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _call_model(
        self, grounded: Any, hits: Sequence[RetrievalHit]
    ) -> tuple[str, List[int]]:
        mode_clause = _SOCRATIC_CLAUSE if grounded.mode == "socratic" else _EXPLAIN_CLAUSE
        system = _SYSTEM_PROMPT.format(mode_clause=mode_clause)

        messages: List[Dict[str, str]] = [{"role": "system", "content": system}]

        # Sources block (numbered) — the only factual authority.
        source_lines: List[str] = []
        for idx, hit in enumerate(hits, start=1):
            title = hit.node.title or hit.node.topic or hit.node.node_id
            source_lines.append(f"[S{idx}] {title}: {hit.node.body_markdown}")
        if grounded.item.rationale:
            source_lines.append(f"[R] Item rationale: {grounded.item.rationale}")
        messages.append(
            {"role": "system", "content": "SOURCES:\n" + "\n".join(source_lines)}
        )

        # Focus item (the question being worked on).
        if grounded.item.is_present:
            item_bits: List[str] = []
            if grounded.item.stem:
                item_bits.append(f"Question: {grounded.item.stem}")
            if grounded.item.options:
                item_bits.append("Options: " + " | ".join(grounded.item.options))
            if grounded.item.chosen:
                item_bits.append(f"Learner chose: {grounded.item.chosen}")
            if item_bits:
                messages.append(
                    {"role": "system", "content": "CURRENT ITEM:\n" + "\n".join(item_bits)}
                )

        # Learner profile only when memory consent allows it.
        if grounded.memory_allowed and grounded.profile:
            profile_view = dict(grounded.profile)
            # Surface the episodic cross-session callback as a readable memory
            # line (a pedagogy nudge, not a curriculum fact — never a citation).
            callback = profile_view.pop("memory_callback", None)
            if callback:
                messages.append(
                    {
                        "role": "system",
                        "content": (
                            "LEARNER MEMORY (use to motivate and pre-empt the trap; "
                            "do not treat as a source): " + str(callback)
                        ),
                    }
                )
            if profile_view:
                messages.append(
                    {
                        "role": "system",
                        "content": "LEARNER PROFILE: " + json.dumps(profile_view, ensure_ascii=False),
                    }
                )

        # Prior turns in this dig-deeper thread.
        for turn in grounded.thread:
            role = "assistant" if turn.get("role") == "assistant" else "user"
            messages.append({"role": role, "content": str(turn.get("text") or "")})

        messages.append({"role": "user", "content": grounded.question})

        # Newer model families (gpt-5.x) reject `max_tokens` (use
        # `max_completion_tokens`) and some reject non-default `temperature`.
        # Adapt on the 400 instead of hardcoding a model matrix so the
        # PATHFINDER_ASSISTANT_MODEL_DEPLOYMENT override works with any
        # deployment; the adapted kwargs are remembered for later turns.
        kwargs: Dict[str, Any] = dict(self._model_kwargs)
        model_started = time.perf_counter()
        completion = None
        for _attempt in range(3):
            try:
                completion = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    **kwargs,
                )
                break
            except Exception as exc:  # noqa: BLE001
                msg = str(exc)
                adapted = False
                if "max_tokens" in msg and "max_tokens" in kwargs:
                    kwargs.pop("max_tokens")
                    kwargs["max_completion_tokens"] = self.max_tokens
                    adapted = True
                if "temperature" in msg and "temperature" in kwargs:
                    kwargs.pop("temperature")
                    adapted = True
                if not adapted:
                    raise
                self._model_kwargs = dict(kwargs)
        if completion is None:
            raise RuntimeError("assistant model call failed after parameter adaptation")
        logger.info(
            "wulo.assistant_model completion_ms=%d model=%s",
            int((time.perf_counter() - model_started) * 1000),
            self.model,
        )
        content = completion.choices[0].message.content
        if not content:
            raise RuntimeError("assistant model returned empty content")
        payload = json.loads(content)
        answer = str(payload.get("answer") or "").strip()
        if not answer:
            raise RuntimeError("assistant model returned empty answer")

        used: List[int] = []
        for raw in payload.get("sources_used") or []:
            try:
                used.append(int(raw))
            except (TypeError, ValueError):
                continue
        return answer, used

    @staticmethod
    def _bind_citations(
        used_indices: Sequence[int], hits: Sequence[RetrievalHit]
    ) -> List[Dict[str, str]]:
        """Map model-reported source numbers back to real retrieval hits.

        Any index outside the retrieved set is dropped — citations can only
        point at sources we actually supplied (no invented references).
        """
        citations: List[Dict[str, str]] = []
        seen: set[str] = set()
        for idx in used_indices:
            if idx < 1 or idx > len(hits):
                continue
            hit = hits[idx - 1]
            node = hit.node
            topic_id = str(node.node_id)
            if topic_id in seen:
                continue
            seen.add(topic_id)
            label = str(node.title or node.topic or node.node_id)
            citations.append({"label": label, "topic_id": topic_id})
        return citations


__all__ = [
    "ASSISTANT_LLM_FLAG_ENV",
    "ASSISTANT_MAX_TURNS_ENV",
    "ASSISTANT_MODEL_ENV",
    "ModelAssistantProvider",
]
