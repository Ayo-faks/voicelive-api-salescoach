"""Turn router: classify each voice/text turn to the right handler.

Phase 1 routes: ``chitchat`` (small, no-tool LLM call) and ``insights`` (the
existing Copilot planner). Future phases add ``ui_action`` and
``safety_refusal`` against the same :class:`TurnHandler` protocol without
changing :class:`InsightsService.ask`.
"""

from src.services.turn_router.output_filter import scrub_chitchat_response
from src.services.turn_router.router import classify
from src.services.turn_router.types import (
    RouteDecision,
    RouterConfig,
    TurnHandler,
)

__all__ = [
    "RouteDecision",
    "RouterConfig",
    "TurnHandler",
    "classify",
    "scrub_chitchat_response",
]
