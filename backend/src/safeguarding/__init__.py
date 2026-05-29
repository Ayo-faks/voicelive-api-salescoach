"""Safeguarding detection pipeline + admin notification.

Layered detection (deterministic lexicon → Azure AI Content Safety →
LLM classifier) writes events to ``safeguarding_events`` and fans out
admin-facing notifications via in-app, email and SMS. B2C scope: a
single admin (the operator) receives all alerts; parents on the account
are CC'd on ``high``/``critical`` outcomes.

The pipeline is fail-OPEN for the live voice session (a detector error
must never crash a child's session) but fail-SAFE for the event store
(if we cannot persist an event, we log loudly so the operator can
investigate). All side effects (DB write, email, SMS) run via
``asyncio.create_task`` from the websocket handler so they never block
the realtime turn.
"""

from .models import (
    Direction,
    KCSIE_CATEGORIES,
    LayerScore,
    SafeguardingCategory,
    SafeguardingVerdict,
    Severity,
)
from .bootstrap import configure_safeguarding_service, get_safeguarding_service
from .pipeline import SafeguardingPipeline, build_default_pipeline
from .routes import build_safeguarding_blueprint
from .service import SafeguardingService, build_safeguarding_service

__all__ = [
    "Direction",
    "KCSIE_CATEGORIES",
    "LayerScore",
    "SafeguardingCategory",
    "SafeguardingPipeline",
    "SafeguardingService",
    "SafeguardingVerdict",
    "Severity",
    "build_default_pipeline",
    "build_safeguarding_blueprint",
    "build_safeguarding_service",
    "configure_safeguarding_service",
    "get_safeguarding_service",
]
