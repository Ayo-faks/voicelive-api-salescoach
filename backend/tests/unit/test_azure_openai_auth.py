"""Tests for Azure OpenAI authentication helpers."""

from __future__ import annotations

from unittest.mock import Mock, patch

from src.services.azure_openai_auth import build_copilot_azure_provider_config


@patch("src.services.azure_openai_auth.DefaultAzureCredential")
def test_build_copilot_provider_uses_bearer_token_in_managed_identity_env(
    mock_credential,
    monkeypatch,
):
    monkeypatch.setenv("AZURE_CLIENT_ID", "managed-identity-client-id")
    credential = Mock()
    credential.get_token.return_value = Mock(token="entra-token")
    mock_credential.return_value = credential

    provider = build_copilot_azure_provider_config(
        {
            "azure_openai_endpoint": "https://example.openai.azure.com/",
            "azure_openai_api_key": "fallback-key",
            "copilot_azure_api_version": "2024-10-21",
        }
    )

    assert provider == {
        "type": "azure",
        "base_url": "https://example.openai.azure.com/",
        "bearer_token": "entra-token",
        "azure": {"api_version": "2024-10-21"},
    }


def test_build_copilot_provider_uses_api_key_without_managed_identity(monkeypatch):
    monkeypatch.delenv("AZURE_CLIENT_ID", raising=False)
    provider = build_copilot_azure_provider_config(
        {
            "azure_openai_endpoint": "https://example.openai.azure.com/",
            "azure_openai_api_key": "fallback-key",
            "copilot_azure_api_version": "2024-10-21",
        }
    )

    assert provider == {
        "type": "azure",
        "base_url": "https://example.openai.azure.com/",
        "api_key": "fallback-key",
        "azure": {"api_version": "2024-10-21"},
    }