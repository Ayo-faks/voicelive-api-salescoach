"""High-level orchestrator that glues pipeline → repository → notifier.

Designed to be invoked as a fire-and-forget task from the realtime
websocket handler:

    asyncio.create_task(
        safeguarding_service.process_utterance(
            text=transcript,
            direction=Direction.INBOUND,
            ...
        )
    )

The service guarantees the calling code is never blocked or crashed
by a detector / DB / notification error.
"""

from __future__ import annotations

import logging
from typing import Optional, Sequence

from .models import Direction, SafeguardingVerdict
from .notifier import DispatchResult, SafeguardingNotifier
from .pipeline import SafeguardingPipeline
from .repository import (
    InMemorySafeguardingRepository,
    SafeguardingEvent,
    SafeguardingRepository,
)

logger = logging.getLogger(__name__)


class SafeguardingService:
    def __init__(
        self,
        pipeline: SafeguardingPipeline,
        repository: SafeguardingRepository,
        notifier: Optional[SafeguardingNotifier] = None,
    ):
        self._pipeline = pipeline
        self._repo = repository
        self._notifier = notifier

    @property
    def enabled(self) -> bool:
        return self._pipeline.enabled

    def status(self) -> dict:
        """Secret-free runtime posture for an admin status surface.

        Surfaces whether safeguarding is active, whether it is in shadow mode
        (in-app only, no outbound alerts), which detection layers are live, and
        whether events persist durably (postgres) or only in memory.
        """
        snapshot = self._pipeline.status()
        snapshot["repository"] = (
            "postgres"
            if type(self._repo).__name__ == "PostgresSafeguardingRepository"
            else "in_memory"
        )
        snapshot["durable"] = snapshot["repository"] == "postgres"
        if self._notifier is not None:
            snapshot["shadow_mode"] = self._notifier.shadow_mode
            snapshot["notifications_enabled"] = self._notifier.enabled
        else:
            snapshot["shadow_mode"] = False
            snapshot["notifications_enabled"] = False
        return snapshot

    async def process_utterance(
        self,
        *,
        text: str,
        direction: Direction,
        user_id: Optional[str] = None,
        child_id: Optional[str] = None,
        parent_user_id: Optional[str] = None,
        session_id: Optional[str] = None,
        context_turns: Sequence[str] = (),
    ) -> Optional[SafeguardingEvent]:
        if not self.enabled or not text or not text.strip():
            return None

        try:
            verdict = await self._pipeline.analyse(
                text, direction=direction, context_turns=context_turns
            )
        except Exception as exc:  # noqa: BLE001 — fail-open
            logger.exception("Safeguarding pipeline raised: %s", exc)
            return None

        if not verdict.is_alert:
            return None

        event = SafeguardingEvent.from_verdict(
            verdict,
            user_id=user_id,
            child_id=child_id,
            parent_user_id=parent_user_id,
            session_id=session_id,
            context_window=list(context_turns)[-5:],
        )

        try:
            event = self._repo.insert(event)
        except Exception as exc:  # noqa: BLE001 — fail-LOUD on persistence
            logger.error(
                "FAILED to persist safeguarding event (severity=%s, cats=%s): %s",
                verdict.severity.value,
                ",".join(verdict.categories),
                exc,
            )
            return None

        if self._notifier is not None:
            try:
                result = self._notifier.dispatch(event)
                logger.info(
                    "Safeguarding notify event=%s severity=%s delivered=%s errors=%s",
                    event.id,
                    event.severity,
                    ",".join(result.channels_delivered),
                    ",".join(result.errors),
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Notifier dispatch raised: %s", exc)
        return event

    def list_recent(
        self,
        *,
        limit: int = 50,
        acknowledged: Optional[bool] = None,
    ) -> list[SafeguardingEvent]:
        return self._repo.list_recent(limit=limit, acknowledged=acknowledged)

    def acknowledge(
        self,
        event_id: str,
        *,
        acknowledged_by: str,
        action_taken: str,
        action_notes: Optional[str] = None,
    ) -> Optional[SafeguardingEvent]:
        return self._repo.acknowledge(
            event_id,
            acknowledged_by=acknowledged_by,
            action_taken=action_taken,
            action_notes=action_notes,
        )


def build_safeguarding_service(
    pipeline: SafeguardingPipeline,
    *,
    repository: Optional[SafeguardingRepository] = None,
    notifier: Optional[SafeguardingNotifier] = None,
) -> SafeguardingService:
    return SafeguardingService(
        pipeline=pipeline,
        repository=repository or InMemorySafeguardingRepository(),
        notifier=notifier,
    )
