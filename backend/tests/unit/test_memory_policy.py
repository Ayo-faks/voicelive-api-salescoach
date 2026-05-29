"""Unit tests for the B2C learner memory policy classifier."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from src.learning import memory_policy


def test_persistent_allowlist_auto_approves_without_expiry() -> None:
    result = memory_policy.classify("preferred_subject", "Maths")
    assert result.decision == "auto_approve"
    assert result.expires_at is None


def test_ephemeral_allowlist_auto_approves_with_72h_expiry() -> None:
    now = datetime(2026, 5, 24, 12, 0, tzinfo=timezone.utc)
    result = memory_policy.classify("mood", "anxious", now=now)
    assert result.decision == "auto_approve"
    assert result.expires_at == (now + timedelta(hours=72)).isoformat()


def test_safeguarding_phrase_blocks_storage() -> None:
    result = memory_policy.classify("mood", "I want to kill myself")
    assert result.decision == "deny_safeguarding"
    assert result.expires_at is None


def test_denylist_key_blocks_storage() -> None:
    result = memory_policy.classify("guardian_name", "Jane Doe")
    assert result.decision == "deny_pii"


def test_pii_value_pattern_blocks_storage() -> None:
    result = memory_policy.classify("weak_topic", "Email me at kid@example.com")
    assert result.decision == "deny_pii"


def test_unknown_key_falls_through_to_pending() -> None:
    result = memory_policy.classify("favourite_pet", "dog")
    assert result.decision == "pending"


def test_safeguarding_help_resources_contain_uk_numbers() -> None:
    labels = {item["phone"] for item in memory_policy.SAFEGUARDING_HELP_RESOURCES}
    assert "116 123" in labels  # Samaritans
    assert "0800 1111" in labels  # Childline
