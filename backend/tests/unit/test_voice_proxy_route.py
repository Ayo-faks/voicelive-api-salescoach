"""Tests for /ws/voice scope gating."""

from __future__ import annotations

import src.app as app_module


def test_learner_scope_allows_learner_role_aliases():
    for role in (app_module.ROLE_LEARNER, app_module.ROLE_KID, app_module.ROLE_STUDENT):
        assert app_module._is_voice_scope_allowed_for_role("learner", role)


def test_learner_ask_scope_allows_learner_role_aliases():
    for role in (app_module.ROLE_LEARNER, app_module.ROLE_KID, app_module.ROLE_STUDENT):
        assert app_module._is_voice_scope_allowed_for_role("learner_ask", role)


def test_learner_scope_allows_teacher_and_admin_demo_roles():
    for role in (app_module.ROLE_THERAPIST, app_module.ROLE_ADMIN):
        assert app_module._is_voice_scope_allowed_for_role("learner", role)


def test_learner_ask_scope_allows_teacher_and_admin_demo_roles():
    for role in (app_module.ROLE_THERAPIST, app_module.ROLE_ADMIN):
        assert app_module._is_voice_scope_allowed_for_role("learner_ask", role)


def test_learner_scope_rejects_parent_role():
    assert not app_module._is_voice_scope_allowed_for_role("learner", app_module.ROLE_PARENT)


def test_learner_ask_scope_rejects_parent_role():
    assert not app_module._is_voice_scope_allowed_for_role("learner_ask", app_module.ROLE_PARENT)


def test_practice_scope_preserves_existing_authenticated_access():
    assert app_module._is_voice_scope_allowed_for_role("practice", app_module.ROLE_PARENT)