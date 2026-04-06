# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Configuration management for the Wulo application."""

import os
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv

load_dotenv()

# Default values as constants
DEFAULT_PORT = 8000
DEFAULT_HOST = "0.0.0.0"
DEFAULT_REGION = "swedencentral"
DEFAULT_MODEL = "gpt-4o"
DEFAULT_API_VERSION = "2024-12-01-preview"
DEFAULT_SPEECH_LANGUAGE = "en-US"
DEFAULT_INPUT_TRANSCRIPTION_MODEL = "azure-speech"
DEFAULT_INPUT_NOISE_REDUCTION_TYPE = "azure_deep_noise_suppression"
DEFAULT_VOICE_NAME = "en-GB-RubiGanges:DragonHDOmniLatestNeural"
DEFAULT_VOICE_TYPE = "azure-standard"
DEFAULT_AVATAR_CHARACTER = "meg"
DEFAULT_AVATAR_STYLE = "casual"
DEFAULT_CHILD_ID = "child-ayo"
DEFAULT_DATABASE_BACKEND = "sqlite"
DEFAULT_DATABASE_POOL_MIN = 1
DEFAULT_DATABASE_POOL_MAX = 5
DEFAULT_DATABASE_MIGRATION_ALLOWED_ENVIRONMENTS = ""

DEFAULT_STORAGE_PATH = str(Path(__file__).resolve().parents[2] / "data" / "wulo.db")
DEFAULT_BOOTSTRAP_STORAGE_SEED_PATH = str(Path(__file__).resolve().parents[1] / "bootstrap" / "wulo.db")
DEFAULT_APP_INSIGHTS_CONNECTION_STRING = ""
DEFAULT_BLOB_BACKUP_CONTAINER = "wulo-backup"
DEFAULT_BLOB_BACKUP_NAME = "wulo.db"
DEFAULT_COPILOT_PLANNER_MODEL = "gpt-5"
DEFAULT_COPILOT_AZURE_API_VERSION = "2024-10-21"


class Config:
    """Application configuration class."""

    def __init__(self):
        """Initialize configuration from environment variables."""
        self._config = self._load_config()

    def _load_config(self) -> Dict[str, Any]:
        """Load configuration from environment variables with defaults."""
        result: Dict[str, Any] = {
            "azure_ai_resource_name": os.getenv("AZURE_AI_RESOURCE_NAME", ""),
            "azure_ai_region": os.getenv("AZURE_AI_REGION", DEFAULT_REGION),
            "azure_ai_project_name": os.getenv("AZURE_AI_PROJECT_NAME", ""),
            "project_endpoint": os.getenv("PROJECT_ENDPOINT", ""),
            "use_azure_ai_agents": self._parse_bool_env("USE_AZURE_AI_AGENTS"),
            "agent_id": os.getenv("AGENT_ID", ""),
            "port": int(os.getenv("PORT", str(DEFAULT_PORT))),
            "host": os.getenv("HOST", DEFAULT_HOST),
            "azure_openai_endpoint": os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            "azure_openai_api_key": os.getenv("AZURE_OPENAI_API_KEY", ""),
            "model_deployment_name": os.getenv("MODEL_DEPLOYMENT_NAME", DEFAULT_MODEL),
            "subscription_id": os.getenv("SUBSCRIPTION_ID", ""),
            "resource_group_name": os.getenv("RESOURCE_GROUP_NAME", ""),
            "azure_speech_key": os.getenv("AZURE_SPEECH_KEY", ""),
            "azure_speech_region": os.getenv("AZURE_SPEECH_REGION", DEFAULT_REGION),
            "azure_speech_language": os.getenv("AZURE_SPEECH_LANGUAGE", DEFAULT_SPEECH_LANGUAGE),
            "api_version": DEFAULT_API_VERSION,
            # NEW ADDITIONS
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
            "azure_avatar_character": os.getenv("AZURE_AVATAR_CHARACTER", DEFAULT_AVATAR_CHARACTER),
            "azure_avatar_style": os.getenv("AZURE_AVATAR_STYLE", DEFAULT_AVATAR_STYLE),
            "database_backend": os.getenv("DATABASE_BACKEND", DEFAULT_DATABASE_BACKEND),
            "database_url": os.getenv("DATABASE_URL", ""),
            "database_pool_min": int(os.getenv("DATABASE_POOL_MIN", str(DEFAULT_DATABASE_POOL_MIN))),
            "database_pool_max": int(os.getenv("DATABASE_POOL_MAX", str(DEFAULT_DATABASE_POOL_MAX))),
            "database_run_migrations_on_startup": self._parse_bool_env("DATABASE_RUN_MIGRATIONS_ON_STARTUP", True),
            "database_migration_allowed_environments": os.getenv(
                "DATABASE_MIGRATION_ALLOWED_ENVIRONMENTS",
                DEFAULT_DATABASE_MIGRATION_ALLOWED_ENVIRONMENTS,
            ),
            "deployment_environment_name": os.getenv("AZD_ENV_NAME", os.getenv("ENVIRONMENT_NAME", "")),
            "storage_path": os.getenv("STORAGE_PATH", DEFAULT_STORAGE_PATH),
            "bootstrap_storage_seed_path": os.getenv(
                "BOOTSTRAP_STORAGE_SEED_PATH", DEFAULT_BOOTSTRAP_STORAGE_SEED_PATH
            ),
            "local_dev_auth": self._parse_bool_env("LOCAL_DEV_AUTH"),
            "default_child_id": os.getenv("DEFAULT_CHILD_ID", DEFAULT_CHILD_ID),
            "applicationinsights_connection_string": os.getenv(
                "APPLICATIONINSIGHTS_CONNECTION_STRING",
                os.getenv("APPINSIGHTS_CONNECTIONSTRING", DEFAULT_APP_INSIGHTS_CONNECTION_STRING),
            ),
            "copilot_cli_path": os.getenv("COPILOT_CLI_PATH", ""),
            "copilot_github_token": os.getenv(
                "COPILOT_GITHUB_TOKEN",
                os.getenv("GITHUB_TOKEN", os.getenv("GH_TOKEN", "")),
            ),
            "copilot_planner_model": os.getenv("COPILOT_PLANNER_MODEL", DEFAULT_COPILOT_PLANNER_MODEL),
            "copilot_planner_reasoning_effort": os.getenv("COPILOT_PLANNER_REASONING_EFFORT", ""),
            "copilot_azure_api_version": os.getenv(
                "COPILOT_AZURE_API_VERSION",
                DEFAULT_COPILOT_AZURE_API_VERSION,
            ),
            "blob_backup_account_name": os.getenv("BLOB_BACKUP_ACCOUNT_NAME", ""),
            "blob_backup_account_key": os.getenv("BLOB_BACKUP_ACCOUNT_KEY", ""),
            "blob_backup_container": os.getenv("BLOB_BACKUP_CONTAINER", DEFAULT_BLOB_BACKUP_CONTAINER),
            "blob_backup_name": os.getenv("BLOB_BACKUP_NAME", DEFAULT_BLOB_BACKUP_NAME),
        }
        return result

    def _parse_bool_env(self, env_var: str, default: bool = False) -> bool:
        """Parse boolean environment variable."""
        return os.getenv(env_var, str(default)).lower() == "true"

    def __getitem__(self, key: str) -> Any:
        """Get configuration value by key."""
        return self._config.get(key)

    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value with optional default."""
        return self._config.get(key, default)

    @property
    def as_dict(self) -> Dict[str, Any]:
        """Return configuration as dictionary."""
        return self._config.copy()


config = Config()
