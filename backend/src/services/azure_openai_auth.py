"""Authentication helpers for Azure OpenAI and Voice Live integrations."""

from __future__ import annotations

import logging
import os
import threading
from typing import Any, Callable, Mapping, Optional

from azure.core.credentials import AzureKeyCredential
from azure.core.credentials_async import AsyncTokenCredential
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.identity.aio import DefaultAzureCredential as AsyncDefaultAzureCredential
from openai import AzureOpenAI

logger = logging.getLogger(__name__)

COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default"
MANAGED_IDENTITY_MARKERS = (
    "AZURE_CLIENT_ID",
    "IDENTITY_ENDPOINT",
    "MSI_ENDPOINT",
    "CONTAINER_APP_NAME",
    "CONTAINER_APP_ENV_DNS_SUFFIX",
)

# One process-wide credential + bearer provider, shared by every Azure OpenAI
# client (chat, embeddings, voice planner). DefaultAzureCredential is
# thread-safe and caches tokens internally, so the first token fetch (paid by
# the boot-time embedding warmup) also pre-pays the AAD round-trip for the
# first learner chat turn instead of each client probing the credential chain
# from scratch (~1-3s in Container Apps).
_credential_lock = threading.Lock()
_shared_credential: Optional[DefaultAzureCredential] = None
_shared_token_provider: Optional[Callable[[], str]] = None


def _get_shared_token_provider() -> Callable[[], str]:
    global _shared_credential, _shared_token_provider
    with _credential_lock:
        if _shared_token_provider is None:
            _shared_credential = DefaultAzureCredential()
            _shared_token_provider = get_bearer_token_provider(
                _shared_credential, COGNITIVE_SERVICES_SCOPE
            )
        return _shared_token_provider


def _has_managed_identity_markers() -> bool:
    return any(str(os.getenv(marker, "")).strip() for marker in MANAGED_IDENTITY_MARKERS)


def _should_use_token_auth(settings: Mapping[str, Any]) -> bool:
    endpoint = str(settings.get("azure_openai_endpoint") or "").strip()
    api_key = str(settings.get("azure_openai_api_key") or "").strip()
    return bool(endpoint) and (_has_managed_identity_markers() or not api_key)


def build_openai_client(settings: Mapping[str, Any]) -> Optional[AzureOpenAI]:
    endpoint = str(settings.get("azure_openai_endpoint") or "").strip()
    if not endpoint:
        logger.error("Azure OpenAI endpoint not configured")
        return None

    api_version = str(settings.get("api_version") or "").strip() or "2024-12-01-preview"
    if _should_use_token_auth(settings):
        token_provider = _get_shared_token_provider()
        return AzureOpenAI(
            api_version=api_version,
            azure_endpoint=endpoint,
            azure_ad_token_provider=token_provider,
        )

    api_key = str(settings.get("azure_openai_api_key") or "").strip()
    if not api_key:
        logger.error("Azure OpenAI API key not configured")
        return None

    return AzureOpenAI(
        api_version=api_version,
        azure_endpoint=endpoint,
        api_key=api_key,
    )


def build_voicelive_credential(settings: Mapping[str, Any]) -> Optional[AzureKeyCredential | AsyncTokenCredential]:
    if _should_use_token_auth(settings):
        return AsyncDefaultAzureCredential()

    api_key = str(settings.get("azure_openai_api_key") or "").strip()
    if not api_key:
        logger.error("Azure OpenAI API key not configured")
        return None

    return AzureKeyCredential(api_key)


def build_copilot_azure_provider_config(settings: Mapping[str, Any]) -> Optional[dict[str, Any]]:
    endpoint = str(settings.get("azure_openai_endpoint") or "").strip()
    if not endpoint:
        return None

    azure_options = {
        "api_version": str(settings.get("copilot_azure_api_version") or "2024-10-21"),
    }

    if _should_use_token_auth(settings):
        credential = DefaultAzureCredential()
        token = credential.get_token(COGNITIVE_SERVICES_SCOPE).token
        return {
            "type": "azure",
            "base_url": endpoint,
            "bearer_token": token,
            "azure": azure_options,
        }

    api_key = str(settings.get("azure_openai_api_key") or "").strip()
    if not api_key:
        return None

    return {
        "type": "azure",
        "base_url": endpoint,
        "api_key": api_key,
        "azure": azure_options,
    }
