"""Unit tests for the MVP safety gates."""

from __future__ import annotations

import pytest

from src.services import safety_gates as sg


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    for name in (
        sg.ENV_LEARNER_VOICE_KILL_SWITCH,
        sg.ENV_SESSION_TURN_CAP,
        sg.ENV_SESSION_TOKEN_CAP,
        sg.ENV_PRODUCTION_SAFEGUARDING_REQUIRED,
        sg.ENV_ALLOW_UNREVIEWED_CONTENT,
        "IDENTITY_ENDPOINT",
        "WEBSITE_SITE_NAME",
        "CONTAINER_APP_NAME",
    ):
        monkeypatch.delenv(name, raising=False)
    yield


# --- kill switch ----------------------------------------------------------


def test_kill_switch_default_off():
    decision = sg.check_learner_voice_available()
    assert decision.allowed is True


@pytest.mark.parametrize("value", ["1", "true", "YES", "on", "enabled"])
def test_kill_switch_truthy_values_disable(monkeypatch, value):
    monkeypatch.setenv(sg.ENV_LEARNER_VOICE_KILL_SWITCH, value)
    decision = sg.check_learner_voice_available()
    assert decision.allowed is False
    assert decision.reason == sg.REASON_KILL_SWITCH


# --- session caps ---------------------------------------------------------


def test_caps_disabled_by_default():
    assert sg.check_session_caps(turns_used=9999, tokens_used=9999).allowed


def test_turn_cap_blocks_when_reached(monkeypatch):
    monkeypatch.setenv(sg.ENV_SESSION_TURN_CAP, "5")
    assert sg.check_session_caps(turns_used=4, tokens_used=0).allowed
    blocked = sg.check_session_caps(turns_used=5, tokens_used=0)
    assert not blocked.allowed
    assert blocked.reason == sg.REASON_TURN_CAP


def test_token_cap_blocks_when_reached(monkeypatch):
    monkeypatch.setenv(sg.ENV_SESSION_TOKEN_CAP, "1000")
    assert sg.check_session_caps(turns_used=0, tokens_used=999).allowed
    blocked = sg.check_session_caps(turns_used=0, tokens_used=1000)
    assert not blocked.allowed
    assert blocked.reason == sg.REASON_TOKEN_CAP


def test_negative_cap_env_is_ignored(monkeypatch):
    monkeypatch.setenv(sg.ENV_SESSION_TURN_CAP, "-3")
    # negative env -> falls back to default (disabled)
    assert sg.session_turn_cap() == 0


def test_garbage_cap_env_is_ignored(monkeypatch):
    monkeypatch.setenv(sg.ENV_SESSION_TOKEN_CAP, "not-a-number")
    assert sg.session_token_cap() == 0


# --- consent gates --------------------------------------------------------


def _full_consent():
    return {
        "privacy_accepted": True,
        "terms_accepted": True,
        "ai_notice_accepted": True,
        "personal_data_consent_accepted": True,
        "special_category_consent_accepted": True,
        "parental_responsibility_confirmed": True,
    }


def test_child_data_consent_requires_all_base_fields():
    consent = _full_consent()
    assert sg.check_child_data_consent(consent).allowed
    consent["privacy_accepted"] = False
    decision = sg.check_child_data_consent(consent)
    assert not decision.allowed
    assert decision.reason == sg.REASON_MISSING_CONSENT
    assert "privacy_accepted" in (decision.detail or "")


def test_voice_session_requires_special_category_and_parental_responsibility():
    consent = _full_consent()
    assert sg.check_voice_session_consent(consent).allowed
    consent["special_category_consent_accepted"] = False
    decision = sg.check_voice_session_consent(consent)
    assert not decision.allowed
    assert "special_category_consent_accepted" in (decision.detail or "")


def test_missing_consent_mapping_denies_all():
    decision = sg.check_child_data_consent(None)
    assert not decision.allowed
    for field in sg.REQUIRED_CHILD_CONSENT_FIELDS:
        assert field in (decision.detail or "")


# --- content review gate --------------------------------------------------


def test_content_review_off_in_dev_by_default():
    assert not sg.production_content_review_required()
    decision = sg.check_content_review(
        subject_lead_approved=False, safeguarding_reviewed=False
    )
    assert decision.allowed


def test_content_review_on_in_hosted_env(monkeypatch):
    monkeypatch.setenv("WEBSITE_SITE_NAME", "wulo-prod")
    assert sg.production_content_review_required()
    blocked = sg.check_content_review(
        subject_lead_approved=False, safeguarding_reviewed=True
    )
    assert not blocked.allowed
    assert blocked.reason == sg.REASON_UNREVIEWED_CONTENT
    assert "subject_lead_approved" in (blocked.detail or "")


def test_content_review_explicit_opt_in(monkeypatch):
    monkeypatch.setenv(sg.ENV_PRODUCTION_SAFEGUARDING_REQUIRED, "true")
    assert sg.production_content_review_required()
    ok = sg.check_content_review(
        subject_lead_approved=True, safeguarding_reviewed=True
    )
    assert ok.allowed


def test_explicit_dev_override_bypasses_hosted_marker(monkeypatch):
    monkeypatch.setenv("WEBSITE_SITE_NAME", "wulo-prod")
    monkeypatch.setenv(sg.ENV_ALLOW_UNREVIEWED_CONTENT, "1")
    assert not sg.production_content_review_required()


# --- public status payload ------------------------------------------------


def test_public_status_payload_shape(monkeypatch):
    monkeypatch.setenv(sg.ENV_SESSION_TURN_CAP, "12")
    monkeypatch.setenv(sg.ENV_SESSION_TOKEN_CAP, "2048")
    payload = sg.public_status_payload()
    assert payload["learner_voice_disabled"] is False
    assert payload["session_turn_cap"] == 12
    assert payload["session_token_cap"] == 2048
    assert "production_content_review_required" in payload
