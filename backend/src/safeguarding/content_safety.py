"""Layer 2 — Azure AI Content Safety wrapper.

Async HTTP call to the Azure AI Content Safety ``/text:analyze``
endpoint. Maps Azure's generic harm categories (Hate, SelfHarm,
Sexual, Violence) to a coarse safeguarding severity. Returns a
``NONE`` score if the service is not configured so the pipeline is
safe in dev/test.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Mapping, Optional

import aiohttp

from .models import LayerScore, SafeguardingCategory, Severity

logger = logging.getLogger(__name__)


ENV_ENDPOINT = "AZURE_CONTENT_SAFETY_ENDPOINT"
ENV_KEY = "AZURE_CONTENT_SAFETY_KEY"
ENV_API_VERSION = "AZURE_CONTENT_SAFETY_API_VERSION"
DEFAULT_API_VERSION = "2024-09-01"

# Azure returns severity 0/2/4/6. Map to our severity ladder.
_AZURE_SEVERITY_MAP = {
    0: Severity.NONE,
    2: Severity.LOW,
    4: Severity.MEDIUM,
    6: Severity.HIGH,
}

# Map Azure categories → our internal categories.
_CATEGORY_MAP = {
    "SelfHarm": SafeguardingCategory.SELF_HARM,
    "Hate": SafeguardingCategory.PEER_ON_PEER_HARM,
    "Sexual": SafeguardingCategory.ABUSE_DISCLOSURE,
    "Violence": SafeguardingCategory.ABUSE_DISCLOSURE,
}


@dataclass(frozen=True)
class ContentSafetyConfig:
    endpoint: str
    key: str
    api_version: str = DEFAULT_API_VERSION

    @property
    def configured(self) -> bool:
        return bool(self.endpoint and self.key)


def load_content_safety_config(env: Optional[Mapping[str, str]] = None) -> ContentSafetyConfig:
    src = env if env is not None else os.environ
    return ContentSafetyConfig(
        endpoint=(src.get(ENV_ENDPOINT) or "").strip().rstrip("/"),
        key=(src.get(ENV_KEY) or "").strip(),
        api_version=(src.get(ENV_API_VERSION) or DEFAULT_API_VERSION).strip(),
    )


class ContentSafetyClient:
    """Thin async wrapper around Azure AI Content Safety text:analyze."""

    def __init__(
        self,
        config: ContentSafetyConfig,
        *,
        session_factory: Optional[Any] = None,
        timeout_seconds: float = 4.0,
    ):
        self._config = config
        self._session_factory = session_factory or aiohttp.ClientSession
        self._timeout = aiohttp.ClientTimeout(total=timeout_seconds)

    @property
    def configured(self) -> bool:
        return self._config.configured

    async def analyze(self, text: str) -> LayerScore:
        if not self._config.configured or not text.strip():
            return LayerScore(
                layer="content_safety",
                severity=Severity.NONE,
                model_version="azure-content-safety:not-configured",
            )

        url = (
            f"{self._config.endpoint}/contentsafety/text:analyze"
            f"?api-version={self._config.api_version}"
        )
        headers = {
            "Ocp-Apim-Subscription-Key": self._config.key,
            "Content-Type": "application/json",
        }
        payload = {
            "text": text,
            "categories": ["Hate", "SelfHarm", "Sexual", "Violence"],
            "outputType": "FourSeverityLevels",
        }

        try:
            async with self._session_factory(timeout=self._timeout) as session:
                async with session.post(url, headers=headers, json=payload) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        logger.warning(
                            "Content Safety returned %s: %s", resp.status, body[:200]
                        )
                        return _error_score(f"http_{resp.status}")
                    data = await resp.json()
        except Exception as exc:  # noqa: BLE001 — fail-open, never break the session
            logger.warning("Content Safety call failed: %s", exc)
            return _error_score(str(exc)[:80])

        return _to_layer_score(data, api_version=self._config.api_version)


def _to_layer_score(data: Mapping[str, Any], *, api_version: str) -> LayerScore:
    analyses = data.get("categoriesAnalysis") or []
    severity = Severity.NONE
    categories: list[str] = []
    raw: dict[str, Any] = {"categoriesAnalysis": []}

    for entry in analyses:
        cat = str(entry.get("category", ""))
        sev_raw = int(entry.get("severity", 0))
        mapped_sev = _AZURE_SEVERITY_MAP.get(sev_raw, Severity.NONE)
        raw["categoriesAnalysis"].append({"category": cat, "severity": sev_raw})
        if mapped_sev.rank > Severity.NONE.rank:
            mapped_cat = _CATEGORY_MAP.get(cat)
            if mapped_cat and mapped_cat.value not in categories:
                categories.append(mapped_cat.value)
            if mapped_sev.rank > severity.rank:
                severity = mapped_sev

    return LayerScore(
        layer="content_safety",
        severity=severity,
        categories=tuple(categories),
        raw=raw,
        model_version=f"azure-content-safety:{api_version}",
    )


def _error_score(reason: str) -> LayerScore:
    return LayerScore(
        layer="content_safety",
        severity=Severity.NONE,
        raw={"error": reason},
        model_version="azure-content-safety:error",
    )
