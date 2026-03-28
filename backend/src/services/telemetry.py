# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Minimal privacy-safe telemetry helpers for Sprint 6 pilot events."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

try:
    from azure.monitor.opentelemetry import configure_azure_monitor
except ImportError:  # pragma: no cover - handled gracefully until dependencies are installed
    configure_azure_monitor = None

logger = logging.getLogger("wulo.telemetry")
bootstrap_logger = logging.getLogger(__name__)


class PilotTelemetryService:
    """Emit a minimal set of pilot telemetry events to Azure Monitor when configured."""

    _configured = False

    def __init__(self, connection_string: str = ""):
        self.connection_string = connection_string.strip()
        self._enabled = bool(self.connection_string)

        if not self._enabled or PilotTelemetryService._configured or configure_azure_monitor is None:
            return

        try:
            configure_azure_monitor(
                connection_string=self.connection_string,
                logger_name="wulo.telemetry",
            )
            PilotTelemetryService._configured = True
        except Exception as exc:  # pragma: no cover - defensive telemetry bootstrap
            bootstrap_logger.warning("Azure Monitor telemetry bootstrap failed: %s", exc)

    @property
    def enabled(self) -> bool:
        """Return whether telemetry is configured for this process."""
        return self._enabled

    def track_event(
        self,
        name: str,
        properties: Optional[Dict[str, Any]] = None,
        measurements: Optional[Dict[str, float]] = None,
    ):
        """Emit a structured pilot event without any transcript or child PII."""
        if not self._enabled:
            return

        safe_properties = {
            key: str(value)
            for key, value in (properties or {}).items()
            if value is not None and str(value).strip()
        }
        safe_measurements = {
            key: float(value)
            for key, value in (measurements or {}).items()
            if value is not None
        }

        envelope = {
            "event_name": name,
            "properties": safe_properties,
            "measurements": safe_measurements,
        }
        logger.info(json.dumps(envelope, sort_keys=True))