# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Configuration management for the Wulo application.

Loads typed configuration from environment variables with validation,
secret redaction, and a cacheable factory for testability. The public
``config`` singleton preserves the legacy ``config[key]`` / ``config.get(key)``
API used across the codebase.
"""

import os
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Any, Dict, Mapping, Optional

from dotenv import load_dotenv

load_dotenv()

# Default values as constants
DEFAULT_PORT = 8000
DEFAULT_HOST = "0.0.0.0"
DEFAULT_REGION = "swedencentral"
DEFAULT_MODEL = "gpt-4o"
# Realtime avatar model used over the Azure Voice Live websocket. Kept separate
# from DEFAULT_MODEL (analyzers, planner, report rewrite) so the realtime voice
# can run on the GPT-5 preview deployment without forcing the batch paths onto
# a preview model.
DEFAULT_VOICE_LIVE_MODEL = "gpt-5-preview"
DEFAULT_API_VERSION = "2024-12-01-preview"
DEFAULT_SPEECH_LANGUAGE = "en-GB"
DEFAULT_INPUT_TRANSCRIPTION_MODEL = "azure-speech"
DEFAULT_INPUT_NOISE_REDUCTION_TYPE = "azure_deep_noise_suppression"
DEFAULT_VOICE_NAME = "en-GB-RubiGanges:DragonHDOmniLatestNeural"
DEFAULT_VOICE_TYPE = "azure-standard"
DEFAULT_AVATAR_CHARACTER = "meg"
DEFAULT_AVATAR_STYLE = "casual"
DEFAULT_CHILD_ID = "child-ayo"
DEFAULT_DATABASE_BACKEND = "postgres"
DEFAULT_DATABASE_POOL_MIN = 1
DEFAULT_DATABASE_POOL_MAX = 5
DEFAULT_DATABASE_MIGRATION_ALLOWED_ENVIRONMENTS = ""
DEFAULT_RATE_LIMIT_DEFAULT_WINDOW_SECONDS = 60
DEFAULT_RATE_LIMIT_MUTATION_LIMIT = 120
DEFAULT_RATE_LIMIT_ANALYZE_LIMIT = 30
DEFAULT_RATE_LIMIT_PLANS_LIMIT = 20
DEFAULT_RATE_LIMIT_INVITATIONS_LIMIT = 20
DEFAULT_RATE_LIMIT_EXPORT_LIMIT = 5
DEFAULT_RATE_LIMIT_DELETE_LIMIT = 3

DEFAULT_STORAGE_PATH = str(Path(__file__).resolve().parents[2] / "data" / "wulo.db")
DEFAULT_BOOTSTRAP_STORAGE_SEED_PATH = str(Path(__file__).resolve().parents[1] / "bootstrap" / "wulo.db")
DEFAULT_APP_INSIGHTS_CONNECTION_STRING = ""
DEFAULT_BLOB_BACKUP_CONTAINER = "wulo-backup"
DEFAULT_BLOB_BACKUP_NAME = "wulo.db"
DEFAULT_COPILOT_PLANNER_MODEL = "gpt-5"
DEFAULT_COPILOT_AZURE_API_VERSION = "2024-10-21"
DEFAULT_REPORT_SUMMARY_REWRITE_MODEL = DEFAULT_MODEL
DEFAULT_PUBLIC_APP_URL = "http://localhost:4173"
DEFAULT_ACS_EMAIL_SENDER_DISPLAY_NAME = "Wulo"

# PR12b mic-mode hybrid. When CONVERSATIONAL_MIC_ENABLED=true the Voice Live
# session is configured with the English semantic VAD (threshold /
# silence / prefix padding tunables) plus barge-in, so the mic can stay open
# for the whole turn. Defaults off; current snapshot-style session config is
# preserved until a pilot enables the flag.
DEFAULT_CONVERSATIONAL_MIC_ENABLED = False
DEFAULT_SEMANTIC_VAD_THRESHOLD = 0.5
DEFAULT_SEMANTIC_VAD_PREFIX_PADDING_MS = 300
DEFAULT_SEMANTIC_VAD_SILENCE_DURATION_MS = 600

# ----- Validation -----------------------------------------------------------

ALLOWED_DATABASE_BACKENDS = frozenset({"postgres", "sqlite"})

# Keys whose values are secrets and must be redacted from ``as_dict``.
_SECRET_KEYS = frozenset(
    {
        "azure_openai_api_key",
        "azure_speech_key",
        "azure_communication_services_connection_string",
        "blob_backup_account_key",
        "copilot_github_token",
    }
)

_TRUTHY = frozenset({"1", "true", "yes", "on", "y", "t"})
_FALSY = frozenset({"0", "false", "no", "off", "n", "f", ""})


class ConfigError(ValueError):
    """Raised when configuration is invalid."""


def _parse_bool_env(env_var: str, default: bool = False) -> bool:
    """Parse a boolean env var. Accepts 1/true/yes/on (case-insensitive)."""
    raw = os.getenv(env_var)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in _TRUTHY:
        return True
    if value in _FALSY:
        return False
    raise ConfigError(
        f"{env_var} must be a boolean (true/false/1/0/yes/no/on/off), got {raw!r}"
    )


def _parse_int_env(env_var: str, default: int, *, min_value: Optional[int] = None) -> int:
    raw = os.getenv(env_var)
    if raw is None or raw == "":
        value = default
    else:
        try:
            value = int(raw)
        except ValueError as exc:
            raise ConfigError(f"{env_var} must be an integer, got {raw!r}") from exc
    if min_value is not None and value < min_value:
        raise ConfigError(f"{env_var} must be >= {min_value}, got {value}")
    return value


def _parse_float_env(
    env_var: str,
    default: float,
    *,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
) -> float:
    raw = os.getenv(env_var)
    if raw is None or raw == "":
        value = default
    else:
        try:
            value = float(raw)
        except ValueError as exc:
            raise ConfigError(f"{env_var} must be a float, got {raw!r}") from exc
    if min_value is not None and value < min_value:
        raise ConfigError(f"{env_var} must be >= {min_value}, got {value}")
    if max_value is not None and value > max_value:
        raise ConfigError(f"{env_var} must be <= {max_value}, got {value}")
    return value


class Config:
    """Application configuration.

    Values are loaded once at construction, validated, and exposed via a
    read-only mapping. Use :func:`get_config` for the process-wide cached
    instance; tests can call :func:`reload_config` to rebuild after
    mutating environment variables.
    """

    def __init__(self) -> None:
        self._config: Mapping[str, Any] = MappingProxyType(self._load_config())

    def _load_config(self) -> Dict[str, Any]:
        database_backend = os.getenv("DATABASE_BACKEND", DEFAULT_DATABASE_BACKEND).strip().lower()
        if database_backend not in ALLOWED_DATABASE_BACKENDS:
            raise ConfigError(
                f"DATABASE_BACKEND must be one of "
                f"{sorted(ALLOWED_DATABASE_BACKENDS)}, got {database_backend!r}"
            )

        pool_min = _parse_int_env("DATABASE_POOL_MIN", DEFAULT_DATABASE_POOL_MIN, min_value=0)
        pool_max = _parse_int_env("DATABASE_POOL_MAX", DEFAULT_DATABASE_POOL_MAX, min_value=1)
        if pool_max < pool_min:
            raise ConfigError(
                f"DATABASE_POOL_MAX ({pool_max}) must be >= DATABASE_POOL_MIN ({pool_min})"
            )

        database_url = os.getenv("DATABASE_URL", "")

        result: Dict[str, Any] = {
            "azure_ai_resource_name": os.getenv("AZURE_AI_RESOURCE_NAME", ""),
            "azure_ai_region": os.getenv("AZURE_AI_REGION", DEFAULT_REGION),
            "azure_ai_project_name": os.getenv("AZURE_AI_PROJECT_NAME", ""),
            "project_endpoint": os.getenv("PROJECT_ENDPOINT", ""),
            "use_azure_ai_agents": _parse_bool_env("USE_AZURE_AI_AGENTS"),
            "agent_id": os.getenv("AGENT_ID", ""),
            "port": _parse_int_env("PORT", DEFAULT_PORT, min_value=1),
            "host": os.getenv("HOST", DEFAULT_HOST),
            "azure_openai_endpoint": os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            "azure_openai_api_key": os.getenv("AZURE_OPENAI_API_KEY", ""),
            "model_deployment_name": os.getenv("MODEL_DEPLOYMENT_NAME", DEFAULT_MODEL),
            # Voice Live realtime model. Defaults to the GPT-5 preview deployment
            # while analyzers/planner/report rewrite stay on MODEL_DEPLOYMENT_NAME.
            # Override per-environment with VOICE_LIVE_MODEL.
            "voice_live_model": os.getenv("VOICE_LIVE_MODEL", DEFAULT_VOICE_LIVE_MODEL),
            "subscription_id": os.getenv("SUBSCRIPTION_ID", ""),
            "resource_group_name": os.getenv("RESOURCE_GROUP_NAME", ""),
            "azure_speech_key": os.getenv("AZURE_SPEECH_KEY", ""),
            "azure_speech_region": os.getenv("AZURE_SPEECH_REGION", DEFAULT_REGION),
            "azure_speech_language": os.getenv("AZURE_SPEECH_LANGUAGE", DEFAULT_SPEECH_LANGUAGE),
            "api_version": DEFAULT_API_VERSION,
            "azure_input_transcription_model": os.getenv(
                "AZURE_INPUT_TRANSCRIPTION_MODEL", DEFAULT_INPUT_TRANSCRIPTION_MODEL
            ),
            "azure_input_transcription_language": os.getenv(
                "AZURE_INPUT_TRANSCRIPTION_LANGUAGE", DEFAULT_SPEECH_LANGUAGE
            ),
            "azure_input_noise_reduction_type": os.getenv(
                "AZURE_INPUT_NOISE_REDUCTION_TYPE", DEFAULT_INPUT_NOISE_REDUCTION_TYPE
            ),
            "azure_voice_name": os.getenv("AZURE_VOICE_NAME", DEFAULT_VOICE_NAME),
            "azure_voice_type": os.getenv("AZURE_VOICE_TYPE", DEFAULT_VOICE_TYPE),
            "azure_custom_lexicon_url": os.getenv("AZURE_CUSTOM_LEXICON_URL", ""),
            "azure_avatar_character": os.getenv("AZURE_AVATAR_CHARACTER", DEFAULT_AVATAR_CHARACTER),
            "azure_avatar_style": os.getenv("AZURE_AVATAR_STYLE", DEFAULT_AVATAR_STYLE),
            "database_backend": database_backend,
            "database_url": database_url,
            "database_admin_url": os.getenv("DATABASE_ADMIN_URL", database_url),
            "database_pool_min": pool_min,
            "database_pool_max": pool_max,
            "database_run_migrations_on_startup": _parse_bool_env(
                "DATABASE_RUN_MIGRATIONS_ON_STARTUP", True
            ),
            "database_migration_allowed_environments": os.getenv(
                "DATABASE_MIGRATION_ALLOWED_ENVIRONMENTS",
                DEFAULT_DATABASE_MIGRATION_ALLOWED_ENVIRONMENTS,
            ),
            "deployment_environment_name": os.getenv(
                "AZD_ENV_NAME", os.getenv("ENVIRONMENT_NAME", "")
            ),
            "storage_path": os.getenv("STORAGE_PATH", DEFAULT_STORAGE_PATH),
            "bootstrap_storage_seed_path": os.getenv(
                "BOOTSTRAP_STORAGE_SEED_PATH", DEFAULT_BOOTSTRAP_STORAGE_SEED_PATH
            ),
            "local_dev_auth": _parse_bool_env("LOCAL_DEV_AUTH"),
            "default_child_id": os.getenv("DEFAULT_CHILD_ID", DEFAULT_CHILD_ID),
            "applicationinsights_connection_string": os.getenv(
                "APPLICATIONINSIGHTS_CONNECTION_STRING",
                os.getenv("APPINSIGHTS_CONNECTIONSTRING", DEFAULT_APP_INSIGHTS_CONNECTION_STRING),
            ),
            "public_app_url": os.getenv("PUBLIC_APP_URL", DEFAULT_PUBLIC_APP_URL),
            "azure_communication_services_connection_string": os.getenv(
                "AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING", ""
            ),
            "azure_communication_services_sender_address": os.getenv(
                "AZURE_COMMUNICATION_SERVICES_SENDER_ADDRESS", ""
            ),
            "azure_communication_services_sender_display_name": os.getenv(
                "AZURE_COMMUNICATION_SERVICES_SENDER_DISPLAY_NAME",
                DEFAULT_ACS_EMAIL_SENDER_DISPLAY_NAME,
            ),
            "copilot_cli_path": os.getenv("COPILOT_CLI_PATH", ""),
            "copilot_github_token": os.getenv(
                "COPILOT_GITHUB_TOKEN",
                os.getenv("GITHUB_TOKEN", os.getenv("GH_TOKEN", "")),
            ),
            "data_retention_months": _parse_int_env("DATA_RETENTION_MONTHS", 6, min_value=1),
            "copilot_planner_model": os.getenv("COPILOT_PLANNER_MODEL", DEFAULT_COPILOT_PLANNER_MODEL),
            "copilot_planner_reasoning_effort": os.getenv("COPILOT_PLANNER_REASONING_EFFORT", ""),
            "copilot_azure_api_version": os.getenv(
                "COPILOT_AZURE_API_VERSION", DEFAULT_COPILOT_AZURE_API_VERSION
            ),
            "report_summary_rewrite_enabled": _parse_bool_env("REPORT_SUMMARY_REWRITE_ENABLED"),
            "report_summary_rewrite_model": os.getenv(
                "REPORT_SUMMARY_REWRITE_MODEL",
                os.getenv("MODEL_DEPLOYMENT_NAME", DEFAULT_REPORT_SUMMARY_REWRITE_MODEL),
            ),
            "blob_backup_account_name": os.getenv("BLOB_BACKUP_ACCOUNT_NAME", ""),
            "blob_backup_account_key": os.getenv("BLOB_BACKUP_ACCOUNT_KEY", ""),
            "blob_backup_container": os.getenv("BLOB_BACKUP_CONTAINER", DEFAULT_BLOB_BACKUP_CONTAINER),
            "blob_backup_name": os.getenv("BLOB_BACKUP_NAME", DEFAULT_BLOB_BACKUP_NAME),
            "rate_limit_default_window_seconds": _parse_int_env(
                "RATE_LIMIT_DEFAULT_WINDOW_SECONDS",
                DEFAULT_RATE_LIMIT_DEFAULT_WINDOW_SECONDS,
                min_value=1,
            ),
            "rate_limit_mutation_limit": _parse_int_env(
                "RATE_LIMIT_MUTATION_LIMIT", DEFAULT_RATE_LIMIT_MUTATION_LIMIT, min_value=1
            ),
            "rate_limit_analyze_limit": _parse_int_env(
                "RATE_LIMIT_ANALYZE_LIMIT", DEFAULT_RATE_LIMIT_ANALYZE_LIMIT, min_value=1
            ),
            "rate_limit_plans_limit": _parse_int_env(
                "RATE_LIMIT_PLANS_LIMIT", DEFAULT_RATE_LIMIT_PLANS_LIMIT, min_value=1
            ),
            "rate_limit_invitations_limit": _parse_int_env(
                "RATE_LIMIT_INVITATIONS_LIMIT", DEFAULT_RATE_LIMIT_INVITATIONS_LIMIT, min_value=1
            ),
            "rate_limit_export_limit": _parse_int_env(
                "RATE_LIMIT_EXPORT_LIMIT", DEFAULT_RATE_LIMIT_EXPORT_LIMIT, min_value=1
            ),
            "rate_limit_delete_limit": _parse_int_env(
                "RATE_LIMIT_DELETE_LIMIT", DEFAULT_RATE_LIMIT_DELETE_LIMIT, min_value=1
            ),
            "conversational_mic_enabled": _parse_bool_env(
                "CONVERSATIONAL_MIC_ENABLED", DEFAULT_CONVERSATIONAL_MIC_ENABLED
            ),
            "semantic_vad_threshold": _parse_float_env(
                "SEMANTIC_VAD_THRESHOLD",
                DEFAULT_SEMANTIC_VAD_THRESHOLD,
                min_value=0.0,
                max_value=1.0,
            ),
            "semantic_vad_prefix_padding_ms": _parse_int_env(
                "SEMANTIC_VAD_PREFIX_PADDING_MS",
                DEFAULT_SEMANTIC_VAD_PREFIX_PADDING_MS,
                min_value=0,
            ),
            "semantic_vad_silence_duration_ms": _parse_int_env(
                "SEMANTIC_VAD_SILENCE_DURATION_MS",
                DEFAULT_SEMANTIC_VAD_SILENCE_DURATION_MS,
                min_value=0,
            ),
        }
        return result

    # Retained for backward compatibility with any subclass/monkeypatch usage.
    def _parse_bool_env(self, env_var: str, default: bool = False) -> bool:
        return _parse_bool_env(env_var, default)

    def __getitem__(self, key: str) -> Any:
        return self._config.get(key)

    def __contains__(self, key: object) -> bool:
        return key in self._config

    def get(self, key: str, default: Any = None) -> Any:
        return self._config.get(key, default)

    @property
    def as_dict(self) -> Dict[str, Any]:
        """Return config as a dict with secret values redacted.

        Intended for logging/telemetry. Use :meth:`get` / ``config[key]`` for
        runtime lookups that need raw secret values.
        """
        redacted: Dict[str, Any] = {}
        for key, value in self._config.items():
            if key in _SECRET_KEYS and value:
                redacted[key] = "***REDACTED***"
            else:
                redacted[key] = value
        return redacted


@lru_cache(maxsize=1)
def get_config() -> Config:
    """Return the process-wide cached :class:`Config` instance."""
    return Config()


def reload_config() -> Config:
    """Drop the cached config and rebuild from the current environment.

    Useful in tests that mutate ``os.environ`` via ``monkeypatch.setenv``.
    """
    get_config.cache_clear()
    return get_config()


# Backwards-compatible module-level singleton. Prefer ``get_config()`` in new
# code so tests can call ``reload_config()`` after patching environment
# variables.
config = get_config()
