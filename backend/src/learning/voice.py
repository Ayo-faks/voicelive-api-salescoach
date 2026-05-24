"""Offline-safe voice transport adapter for Pathfinder multilingual flow."""

from __future__ import annotations

from typing import Optional, Protocol
from uuid import uuid4

from pydantic import Field

from src.learning.models import LanguageAndProvenanceModel, OfflineQueuedEvent, Provenance
from src.learning.repository import LearningRepository


class VoiceSocket(Protocol):
    def receive(self) -> str:
        raise NotImplementedError

    def send(self, message: str) -> None:
        raise NotImplementedError


class VoiceFrame(LanguageAndProvenanceModel):
    frame_id: str = Field(default_factory=lambda: f"voice-frame-{uuid4().hex[:12]}")
    tenant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    mode: str = Field(pattern="^(text|audio)$")
    payload: str = Field(min_length=1)


class VoiceTransportResult(LanguageAndProvenanceModel):
    result_id: str = Field(default_factory=lambda: f"voice-transport-result-{uuid4().hex[:12]}")
    accepted: bool
    queued: bool
    transport: str = "flask-sock"
    transcript: Optional[str] = None
    offline_fallback: Optional[str] = None
    queue_id: Optional[str] = None


class FlaskSockVoiceTransportAdapter:
    """Adapter boundary for a future flask-sock route, with deterministic offline queueing."""

    offline_fallback = "queued_multilingual_voice_frame"

    def handle_offline_frame(
        self, frame: VoiceFrame, repository: Optional[LearningRepository] = None
    ) -> VoiceTransportResult:
        provenance = list(frame.provenance) + [
            Provenance(
                source="FlaskSockVoiceTransportAdapter",
                rule_id="phase_3_voice_offline_queue",
                confidence=1.0,
                evidence_count=1,
            )
        ]
        queued_event = OfflineQueuedEvent(
            tenant_id=frame.tenant_id,
            actor_id=frame.actor_id,
            idempotency_key=frame.frame_id,
            event_type="learning.voice_frame",
            payload=frame.model_dump(),
        )
        if repository is not None:
            repository.queue_offline_event(queued_event)
        return VoiceTransportResult(
            accepted=True,
            queued=True,
            transcript=frame.payload if frame.mode == "text" else None,
            offline_fallback=self.offline_fallback,
            queue_id=queued_event.queue_id,
            lang=frame.lang,
            provenance=provenance,
        )
