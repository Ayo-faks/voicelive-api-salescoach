"""Tests for the override-mastery xAPI builder (A6).

The override path is the audit hook for C4 (teacher overrides a mastery
estimate from the student drilldown drawer). This test pins the verb IRI,
actor/object shape, and provenance/lang propagation so downstream LRS
filters stay stable.
"""

from __future__ import annotations

from src.learning.models import Provenance
from src.learning.xapi import OverrideEvent, override_event_to_xapi


def _provenance() -> list[Provenance]:
    return [
        Provenance(
            source="LearningApi.override_mastery",
            rule_id="phase_1_c4_mastery_override",
            confidence=1.0,
            evidence_count=1,
        )
    ]


def test_override_event_to_xapi_pins_verb_iri() -> None:
    event = OverrideEvent(
        tenant_id="tenant-a",
        actor_id="teacher-1",
        student_id="student-7",
        skill_id="skill-fractions",
        reason="Diagnostic answers contradict the auto-estimate; child explained reasoning.",
        lang="en-NG",
        provenance=_provenance(),
    )

    statement = override_event_to_xapi(event)

    assert statement.verb["id"] == "https://pathfinder.learn/xapi/verbs/overrode-mastery"
    assert statement.actor["account"]["name"] == "teacher-1"
    assert (
        statement.object["id"]
        == "https://pathfinder.learn/students/student-7/skills/skill-fractions"
    )
    assert statement.result["response"].startswith("Diagnostic answers")


def test_override_event_to_xapi_carries_tenant_lang_provenance() -> None:
    event = OverrideEvent(
        tenant_id="tenant-b",
        actor_id="teacher-2",
        student_id="student-8",
        skill_id="skill-place-value",
        reason="Override after parent meeting (consent on file).",
        lang="yo-NG",
        provenance=_provenance(),
    )

    statement = override_event_to_xapi(event)
    extensions = statement.context["extensions"]

    assert extensions["https://pathfinder.learn/extensions/tenant_id"] == "tenant-b"
    assert extensions["https://pathfinder.learn/extensions/lang"] == "yo-NG"
    provenance = extensions["https://pathfinder.learn/extensions/provenance"]
    assert provenance and provenance[0]["rule_id"] == "phase_1_c4_mastery_override"


def test_override_event_to_xapi_reuses_event_id_as_statement_id() -> None:
    event = OverrideEvent(
        tenant_id="tenant-a",
        actor_id="teacher-1",
        student_id="student-7",
        skill_id="skill-fractions",
        reason="Manual review.",
        lang="en-NG",
        provenance=_provenance(),
    )

    statement = override_event_to_xapi(event)

    assert statement.id == event.event_id
