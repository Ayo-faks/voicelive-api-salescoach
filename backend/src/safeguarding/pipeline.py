"""Pipeline orchestrator: L1 → L2 → L3 → merged ``SafeguardingVerdict``."""

from __future__ import annotations

import logging
import os
from typing import List, Optional, Sequence

from .classifier import SafeguardingClassifier
from .content_safety import ContentSafetyClient, load_content_safety_config
from .lexicon import run_lexicon
from .models import Direction, LayerScore, SafeguardingVerdict, Severity

logger = logging.getLogger(__name__)


ENV_DISABLED = "SAFEGUARDING_DISABLED"


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


class SafeguardingPipeline:
    """Runs the three layers and merges them into a single verdict."""

    def __init__(
        self,
        content_safety: Optional[ContentSafetyClient] = None,
        classifier: Optional[SafeguardingClassifier] = None,
    ):
        self._content_safety = content_safety
        self._classifier = classifier

    @property
    def enabled(self) -> bool:
        return not _flag(ENV_DISABLED)

    async def analyse(
        self,
        text: str,
        *,
        direction: Direction,
        context_turns: Sequence[str] = (),
    ) -> SafeguardingVerdict:
        if not self.enabled or not text or not text.strip():
            return SafeguardingVerdict(
                severity=Severity.NONE,
                categories=(),
                evidence_quote=text or "",
                direction=direction,
                layer_scores=(),
            )

        layer_scores: List[LayerScore] = []

        # L1 — deterministic lexicon (always on, sync, fast).
        l1 = run_lexicon(text)
        layer_scores.append(l1)

        # L2 — Azure Content Safety (skip if not configured).
        if self._content_safety is not None and self._content_safety.configured:
            try:
                l2 = await self._content_safety.analyze(text)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Content Safety unexpected error: %s", exc)
                l2 = LayerScore(layer="content_safety", severity=Severity.NONE)
            layer_scores.append(l2)

        # L3 — LLM classifier. Skip if L1 already says critical and is the
        # right category; otherwise run for nuance / soft disclosures.
        l1_is_critical = l1.severity == Severity.CRITICAL
        if self._classifier is not None and not l1_is_critical:
            try:
                l3 = await self._classifier.classify(
                    text,
                    direction=direction.value,
                    context_turns=context_turns,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Classifier unexpected error: %s", exc)
                l3 = LayerScore(layer="classifier", severity=Severity.NONE)
            layer_scores.append(l3)

        return _merge(text, direction, tuple(layer_scores))


def _merge(
    text: str,
    direction: Direction,
    layers: tuple[LayerScore, ...],
) -> SafeguardingVerdict:
    severity = Severity.NONE
    categories: list[str] = []
    rationale_parts: list[str] = []

    for layer in layers:
        if layer.severity.rank > severity.rank:
            severity = layer.severity
        for c in layer.categories:
            if c not in categories:
                categories.append(c)
        # Pull human-readable rationale off the classifier raw payload.
        raw = layer.raw or {}
        r = raw.get("rationale") if isinstance(raw, dict) else None
        if r:
            rationale_parts.append(str(r))

    # On outbound checks, escalate floor: anything the AI says that any layer
    # marks as harm is at least "high".
    if direction == Direction.OUTBOUND and severity.rank >= Severity.LOW.rank:
        severity = Severity.max(severity, Severity.HIGH)

    return SafeguardingVerdict(
        severity=severity,
        categories=tuple(categories),
        evidence_quote=text[:1000],
        direction=direction,
        layer_scores=layers,
        rationale=" | ".join(rationale_parts) if rationale_parts else None,
    )


def build_default_pipeline(
    *,
    openai_client_factory: Optional[object] = None,
) -> SafeguardingPipeline:
    """Construct the pipeline using env-driven config.

    ``openai_client_factory`` is a no-arg callable returning an OpenAI-
    compatible client; when ``None`` the classifier layer is disabled.
    """
    cs_cfg = load_content_safety_config()
    cs_client = ContentSafetyClient(cs_cfg) if cs_cfg.configured else None

    classifier = SafeguardingClassifier(openai_client_factory) if openai_client_factory else None
    return SafeguardingPipeline(content_safety=cs_client, classifier=classifier)
