"""Public types for the turn router."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Protocol, Sequence

from src.services.insights_service import (
    InsightsPlannerResult,
    InsightsRequestContext,
)


@dataclass(frozen=True)
class RouteDecision:
    """Output of :func:`classify`.

    ``route`` is one of ``"chitchat"`` or ``"insights"`` in Phase 1.
    ``classifier`` records which layer fired (``"rules"`` or ``"bypass"``)
    and ``reason`` is a short, log-friendly tag.
    """

    route: str
    confidence: float
    reason: str
    classifier: str


@dataclass(frozen=True)
class RouterConfig:
    """Tunables surfaced to ``InsightsService`` (sourced from env)."""

    enabled: bool = False
    shadow: bool = False
    chitchat_model: str = "gpt-4o-mini"
    chitchat_timeout_seconds: float = 4.0
    chitchat_max_tokens: int = 80


class TurnHandler(Protocol):
    """One concrete handler producing an :class:`InsightsPlannerResult`."""

    name: str

    def handle(
        self,
        *,
        user_message: str,
        history: Sequence[Mapping[str, Any]],
        context: InsightsRequestContext,
    ) -> InsightsPlannerResult: ...
