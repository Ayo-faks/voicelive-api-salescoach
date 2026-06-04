"""Phase 1 tests: SafeguardingAgent returns non-raising read-only verdicts.

Covers the four headline veto cases from the plan — child-access bypass,
missing consent, RLS/role escalation, transcript PII — plus the benign
allow path, and confirms the agent never mutates the storage it wraps.
"""

from __future__ import annotations

import os
from typing import Any, List, Optional

import pytest

from src.agents.safeguarding_agent import (
    REASON_CHILD_ACCESS_DENIED,
    REASON_MISSING_CONSENT,
    REASON_NOT_AUTHENTICATED,
    REASON_OK,
    REASON_ROLE_FORBIDDEN,
    REASON_TRANSCRIPT_PII,
    REASON_UNKNOWN_ACTION,
    SafeguardingAgent,
    SafeguardingVerdict,
)


class _FakeStorage:
    """Records access queries; grants access only to allow-listed pairs."""

    def __init__(self, allowed: Optional[set[tuple[str, str]]] = None) -> None:
        self.allowed = allowed or set()
        self.calls: List[dict[str, Any]] = []

    def user_has_child_access(
        self,
        user_id: str,
        child_id: str,
        *,
        allowed_relationships: Optional[List[str]] = None,
        include_deleted: bool = False,
    ) -> bool:
        self.calls.append(
            {
                "user_id": user_id,
                "child_id": child_id,
                "allowed_relationships": allowed_relationships,
                "include_deleted": include_deleted,
            }
        )
        return (user_id, child_id) in self.allowed


_FULL_CONSENT = {
    "privacy_accepted": True,
    "terms_accepted": True,
    "ai_notice_accepted": True,
    "personal_data_consent_accepted": True,
    "special_category_consent_accepted": True,
    "parental_responsibility_confirmed": True,
}


def _agent(allowed: Optional[set[tuple[str, str]]] = None) -> tuple[SafeguardingAgent, _FakeStorage]:
    storage = _FakeStorage(allowed)
    return SafeguardingAgent(storage), storage


# -- child access -----------------------------------------------------------


def test_child_access_allowed_for_linked_therapist() -> None:
    agent, storage = _agent(allowed={("therapist-1", "child-1")})
    verdict = agent.check_child_access(
        user={"id": "therapist-1", "role": "therapist"},
        child_id="child-1",
        allowed_roles=["therapist", "admin"],
        allowed_relationships=["therapist"],
    )
    assert verdict.allowed is True
    assert verdict.reason == REASON_OK
    assert storage.calls[0]["allowed_relationships"] == ["therapist"]


def test_child_access_denied_when_not_linked() -> None:
    agent, _ = _agent(allowed=set())
    verdict = agent.check_child_access(
        user={"id": "therapist-2", "role": "therapist"},
        child_id="child-1",
        allowed_roles=["therapist", "admin"],
    )
    assert verdict.vetoed is True
    assert verdict.reason == REASON_CHILD_ACCESS_DENIED


def test_child_access_role_escalation_vetoed() -> None:
    # A parent trying to use a therapist-only endpoint is vetoed on role,
    # before any storage lookup happens.
    agent, storage = _agent(allowed={("parent-1", "child-1")})
    verdict = agent.check_child_access(
        user={"id": "parent-1", "role": "parent"},
        child_id="child-1",
        allowed_roles=["therapist", "admin"],
    )
    assert verdict.vetoed is True
    assert verdict.reason == REASON_ROLE_FORBIDDEN
    assert storage.calls == []  # fail-fast: no access query on role veto


def test_child_access_unauthenticated_vetoed() -> None:
    agent, _ = _agent()
    verdict = agent.check_child_access(user=None, child_id="child-1")
    assert verdict.vetoed is True
    assert verdict.reason == REASON_NOT_AUTHENTICATED


# -- consent ----------------------------------------------------------------


def test_data_consent_missing_fields_vetoed() -> None:
    agent, _ = _agent()
    verdict = agent.check_data_consent({"privacy_accepted": True})
    assert verdict.vetoed is True
    assert verdict.reason == REASON_MISSING_CONSENT
    assert "terms_accepted" in verdict.signals["missing_fields"]


def test_voice_consent_requires_special_category() -> None:
    agent, _ = _agent()
    # Full data consent but missing the voice-specific fields.
    data_only = {
        "privacy_accepted": True,
        "terms_accepted": True,
        "ai_notice_accepted": True,
        "personal_data_consent_accepted": True,
    }
    verdict = agent.check_voice_consent(data_only)
    assert verdict.vetoed is True
    assert verdict.reason == REASON_MISSING_CONSENT


def test_full_consent_allows() -> None:
    agent, _ = _agent()
    assert agent.check_data_consent(_FULL_CONSENT).allowed is True
    assert agent.check_voice_consent(_FULL_CONSENT).allowed is True


# -- transcript PII ---------------------------------------------------------


def test_transcript_with_pii_vetoed() -> None:
    agent, _ = _agent()
    verdict = agent.inspect_transcript("Email me at parent@example.com please")
    assert verdict.vetoed is True
    assert verdict.reason == REASON_TRANSCRIPT_PII
    assert verdict.signals["counts"].get("email") == 1


def test_clean_transcript_allowed() -> None:
    agent, _ = _agent()
    verdict = agent.inspect_transcript("the cat sat on the mat")
    assert verdict.allowed is True


# -- unified dispatch + fail-closed -----------------------------------------


def test_assess_dispatches_child_access() -> None:
    agent, _ = _agent(allowed={("therapist-1", "child-1")})
    verdict = agent.assess(
        {
            "kind": "child_access",
            "user": {"id": "therapist-1", "role": "therapist"},
            "child_id": "child-1",
            "allowed_roles": ["therapist", "admin"],
        }
    )
    assert verdict.allowed is True


def test_assess_unknown_kind_fails_closed() -> None:
    agent, _ = _agent()
    verdict = agent.assess({"kind": "delete_everything"})
    assert verdict.vetoed is True
    assert verdict.reason == REASON_UNKNOWN_ACTION


def test_session_caps_kill_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WULO_LEARNER_VOICE_DISABLED", "true")
    agent, _ = _agent()
    verdict = agent.check_session_caps(turns_used=0, tokens_used=0)
    assert verdict.vetoed is True


def test_verdict_helpers() -> None:
    allow = SafeguardingVerdict.allow()
    veto = SafeguardingVerdict.veto("nope", detail="because")
    assert allow.allowed and not allow.vetoed
    assert veto.vetoed and not veto.allowed
    assert veto.detail == "because"
