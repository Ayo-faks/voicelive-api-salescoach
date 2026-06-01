"""Shared brain for the learner Dig-Deeper tutor (text + voice).

This module owns the *pedagogy decisions* that must stay identical across the
text drawer (``/api/learning/assistant/ask``) and the voice surfaces
(``/api/learning/voice/turn`` and the future ``/ws/learning-voice``):

- the **FocusObject** contract — the question-anchored bundle every turn is
  grounded on (the current item, the learner's profile signals, retrieved
  curriculum snippets, and the running dig-deeper thread);
- **mode selection** — Socratic while a diagnostic item is still being scored
  (never reveal the answer and corrupt the assessment signal), full
  explanation once the item is scored or when there is no scored item in play;
- **grounded-context assembly** — the fixed-shape dict a model-backed provider
  turns into a prompt, with retrieved snippets + the item's stored rationale as
  the factual *authority*;
- an **outbound safeguarding guard** — a synchronous screen (deterministic
  lexicon, OUTBOUND floor) so the text path can refuse unsafe generated text
  before it ever reaches a learner, mirroring the realtime voice hooks.

It contains no model calls and no network. Phase 1 composes a model-backed
``AssistantProvider`` on top of it; the deterministic provider keeps working
unchanged because none of this is wired in until a caller opts in.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Literal, Mapping, Optional, Sequence

from src.safeguarding.lexicon import run_lexicon
from src.safeguarding.models import Severity


TutorMode = Literal["socratic", "explain"]

# What an outbound reply is allowed to be. ``LOW`` and above on generated text
# is treated as unsafe (the realtime path escalates any AI-uttered harm to at
# least HIGH; we keep the floor strict here too).
_OUTBOUND_BLOCK_RANK = Severity.LOW.rank

_SAFE_REFUSAL = (
    "Let's keep this on your schoolwork. Try asking about the topic you're "
    "practising and I'll talk it through with you."
)


@dataclass(frozen=True)
class FocusItem:
    """The question the tutor is anchored on for this turn.

    ``scored`` drives mode selection: an item that is still being assessed
    (``scored=False``) forces Socratic guidance so the tutor never hands over
    the answer mid-diagnostic. ``rationale`` is treated as factual authority
    alongside RAG hits.
    """

    stem: str = ""
    options: List[str] = field(default_factory=list)
    chosen: Optional[str] = None
    correct: Optional[str] = None
    rationale: str = ""
    skill_id: Optional[str] = None
    misconception: Optional[str] = None
    scored: bool = False

    @property
    def is_present(self) -> bool:
        return bool(self.stem.strip() or self.skill_id)

    @classmethod
    def from_payload(cls, raw: Any) -> "FocusItem":
        if not isinstance(raw, Mapping):
            return cls()

        def _opt_str(value: Any) -> Optional[str]:
            if value is None:
                return None
            text = str(value).strip()
            return text or None

        options_raw = raw.get("options") or []
        options: List[str] = []
        if isinstance(options_raw, Sequence) and not isinstance(options_raw, (str, bytes)):
            for opt in options_raw:
                if isinstance(opt, Mapping):
                    label = opt.get("text") or opt.get("label") or opt.get("id")
                    if label is not None:
                        options.append(str(label))
                elif opt is not None:
                    options.append(str(opt))

        return cls(
            stem=str(raw.get("stem") or "").strip(),
            options=options,
            chosen=_opt_str(raw.get("chosen")),
            correct=_opt_str(raw.get("correct")),
            rationale=str(raw.get("rationale") or "").strip(),
            skill_id=_opt_str(raw.get("skill_id")),
            misconception=_opt_str(raw.get("misconception")),
            scored=bool(raw.get("scored") or False),
        )


def select_mode(item: FocusItem) -> TutorMode:
    """Socratic while an item is being scored; explain otherwise.

    Revealing the answer to an unscored diagnostic item corrupts the
    assessment signal, so an anchored-but-unscored item is the *only* case
    that locks the tutor into Socratic guidance. A scored item, or no anchored
    item at all (a free-form concept question), opens up to full explanation.
    """
    if item.is_present and not item.scored:
        return "socratic"
    return "explain"


@dataclass(frozen=True)
class GroundedContext:
    """Fixed-shape bundle a model-backed provider turns into a prompt.

    ``authority`` is the only source of factual claims (retrieved curriculum
    snippets + the item's stored rationale). ``memory_allowed`` reflects the
    learner's memory consent: when ``False`` the episodic/semantic ``profile``
    is withheld and only working memory + retrieval remain.
    """

    question: str
    mode: TutorMode
    item: FocusItem
    authority: List[str]
    profile: Mapping[str, Any]
    thread: List[Mapping[str, str]]
    memory_allowed: bool
    grounded: bool


def _coerce_thread(raw: Any) -> List[Mapping[str, str]]:
    turns: List[Mapping[str, str]] = []
    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        for entry in raw:
            if not isinstance(entry, Mapping):
                continue
            role = str(entry.get("role") or "").strip().lower()
            text = str(entry.get("text") or "").strip()
            if role in {"user", "assistant"} and text:
                turns.append({"role": role, "text": text})
    return turns


def build_grounded_context(
    question: str,
    *,
    item: FocusItem,
    retrieved: Sequence[str],
    profile: Mapping[str, Any],
    thread: Any = (),
    memory_allowed: bool,
) -> GroundedContext:
    """Assemble the grounded context for one tutor turn.

    Retrieved snippets and the item's stored ``rationale`` become the factual
    ``authority``. When ``memory_allowed`` is ``False`` the ``profile`` signals
    (weak topics, mastery, prior errors) are dropped so the turn runs on
    working memory + retrieval only.
    """
    authority: List[str] = []
    for snippet in retrieved:
        text = str(snippet or "").strip()
        if text:
            authority.append(text)
    if item.rationale:
        authority.append(item.rationale)

    safe_profile: Mapping[str, Any] = dict(profile) if memory_allowed else {}

    return GroundedContext(
        question=str(question or "").strip(),
        mode=select_mode(item),
        item=item,
        authority=authority,
        profile=safe_profile,
        thread=_coerce_thread(thread),
        memory_allowed=memory_allowed,
        grounded=bool(authority),
    )


@dataclass(frozen=True)
class SafetyDecision:
    """Outcome of screening a generated reply before it reaches a learner."""

    allowed: bool
    severity: Severity
    categories: List[str]
    safe_message: str


def screen_outbound_text(text: str) -> SafetyDecision:
    """Deterministic, synchronous outbound guard for the text tutor path.

    The realtime voice path already runs inbound/outbound safeguarding hooks;
    the text path historically had none. This reuses the same deterministic L1
    lexicon so a model-generated reply that trips any rule is blocked and
    replaced with a safe message. Async L2/L3 (Content Safety + classifier)
    stay on the realtime path; here we keep it sync and fail-open on empty
    input but fail-safe on any detected harm.
    """
    if not text or not text.strip():
        return SafetyDecision(
            allowed=True,
            severity=Severity.NONE,
            categories=[],
            safe_message="",
        )

    score = run_lexicon(text)
    if score.severity.rank >= _OUTBOUND_BLOCK_RANK:
        return SafetyDecision(
            allowed=False,
            severity=score.severity,
            categories=list(score.categories),
            safe_message=_SAFE_REFUSAL,
        )

    return SafetyDecision(
        allowed=True,
        severity=score.severity,
        categories=list(score.categories),
        safe_message=text,
    )


__all__ = [
    "TutorMode",
    "FocusItem",
    "GroundedContext",
    "SafetyDecision",
    "select_mode",
    "build_grounded_context",
    "screen_outbound_text",
]
