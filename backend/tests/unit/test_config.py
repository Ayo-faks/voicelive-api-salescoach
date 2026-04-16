"""Tests for configuration management."""

import os
from unittest.mock import patch

from src.config import Config


class TestConfig:
    """Test configuration class."""

    def test_config_initialization(self):
        """Test that config initializes with default values."""
        with patch.dict(os.environ, {}, clear=True):
            config = Config()
            assert config["port"] == 8000
            assert config["host"] == "0.0.0.0"
            assert config["azure_ai_region"] == "swedencentral"
            assert config["local_dev_auth"] is False
            assert config["default_child_id"] == "child-ayo"
            assert config["azure_custom_lexicon_url"] == ""
            assert config["storage_path"].endswith("data/wulo.db")
            assert config["bootstrap_storage_seed_path"].endswith("bootstrap/wulo.db")

    def test_config_with_environment_variables(self):
        """Test that config loads from environment variables."""
        with patch.dict(
            os.environ,
            {
                "PORT": "9000",
                "HOST": "localhost",
                "AZURE_AI_REGION": "westus",
                "AZURE_AI_RESOURCE_NAME": "test-resource",
                "AZURE_CUSTOM_LEXICON_URL": "https://example.com/r-drill-lexicon.xml",
            },
        ):
            config = Config()
            assert config["port"] == 9000
            assert config["host"] == "localhost"
            assert config["azure_ai_region"] == "westus"
            assert config["azure_ai_resource_name"] == "test-resource"
            assert config["azure_custom_lexicon_url"] == "https://example.com/r-drill-lexicon.xml"

    def test_config_get_method(self):
        """Test the get method with defaults."""
        config = Config()
        assert config.get("nonexistent_key", "default") == "default"
        assert config.get("port", 0) == config["port"]

    def test_config_as_dict(self):
        """Test that as_dict returns a copy of the configuration."""
        config = Config()
        config_dict = config.as_dict
        assert isinstance(config_dict, dict)
        assert "port" in config_dict

        # Modify the returned dict - original should be unchanged
        config_dict["port"] = 9999
        assert config["port"] != 9999
        assert config["port"] != 9999
