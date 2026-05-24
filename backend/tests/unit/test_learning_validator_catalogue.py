"""Tests for `catalogue_skill_existence_rule` (B5)."""

from __future__ import annotations

from src.learning.models import CatalogueSkill, InterventionPlan, Provenance
from src.learning.repository import InMemoryLearningRepository
from src.learning.validator import PlanValidator, catalogue_skill_existence_rule


def _provenance() -> list[Provenance]:
    return [
        Provenance(
            source="test_learning_validator_catalogue",
            rule_id="fixture",
            confidence=1.0,
            evidence_count=1,
        )
    ]


def _seed(repo: InMemoryLearningRepository, skill_id: str, status: str = "active") -> None:
    repo.create_tenant_skill(
        CatalogueSkill(
            skill_id=skill_id,
            tenant_id="tenant-V",
            standard_id=f"std-{skill_id}",
            name=skill_id.title(),
            subject="maths",
            prerequisites=[],
            kc_tags=[],
            localisations={},
            status=status,
            lang="en-NG",
            provenance=_provenance(),
        )
    )


def _plan(skill_ids: list[str]) -> InterventionPlan:
    return InterventionPlan(
        plan_id="plan-v-1",
        target_skill_ids=skill_ids,
        target_student_ids=["student-v"],
        item_types=["mcq"],
        rationale="test plan",
        lang="en-NG",
        provenance=_provenance(),
    )


def test_rule_passes_when_all_skills_active() -> None:
    repo = InMemoryLearningRepository()
    _seed(repo, "a")
    _seed(repo, "b")
    validator = PlanValidator(rules=[catalogue_skill_existence_rule(repo, "tenant-V")])
    assert validator.validate(_plan(["a", "b"])).ok


def test_rule_fails_for_missing_skill() -> None:
    repo = InMemoryLearningRepository()
    _seed(repo, "a")
    validator = PlanValidator(rules=[catalogue_skill_existence_rule(repo, "tenant-V")])
    result = validator.validate(_plan(["a", "ghost"]))
    assert not result.ok
    assert result.failures[0].code == "catalogue_skill_missing"


def test_rule_fails_for_archived_skill_by_default() -> None:
    repo = InMemoryLearningRepository()
    _seed(repo, "a")
    repo.archive_skill("tenant-V", "a")
    validator = PlanValidator(rules=[catalogue_skill_existence_rule(repo, "tenant-V")])
    result = validator.validate(_plan(["a"]))
    assert not result.ok
    assert result.failures[0].code == "catalogue_skill_archived"


def test_rule_allows_archived_when_flag_off() -> None:
    repo = InMemoryLearningRepository()
    _seed(repo, "a")
    repo.archive_skill("tenant-V", "a")
    rule = catalogue_skill_existence_rule(repo, "tenant-V", require_active=False)
    assert PlanValidator(rules=[rule]).validate(_plan(["a"])).ok
