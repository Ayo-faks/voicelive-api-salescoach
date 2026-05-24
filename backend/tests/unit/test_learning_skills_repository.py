"""Tests for the in-memory skills-catalogue repository methods (B2).

Phase 1, Workstream B — Skills catalogue. The Postgres path is exercised
by the integration suite; here we pin the contract the in-memory adapter
must honour so unit tests and trace evidence stay backend-agnostic.
"""

from __future__ import annotations

import pytest

from src.learning.models import CatalogueSkill, Provenance
from src.learning.repository import InMemoryLearningRepository


def _provenance() -> list[Provenance]:
    return [
        Provenance(
            source="test_learning_skills_repository",
            rule_id="seed_fixture",
            confidence=1.0,
            evidence_count=1,
        )
    ]


def _skill(
    skill_id: str,
    *,
    tenant_id: str = "tenant-A",
    name: str | None = None,
    subject: str = "maths",
    status: str = "active",
    prerequisites: list[str] | None = None,
    parent_skill_id: str | None = None,
    kc_tags: list[str] | None = None,
    description: str | None = None,
) -> CatalogueSkill:
    return CatalogueSkill(
        skill_id=skill_id,
        tenant_id=tenant_id,
        standard_id=f"std-{skill_id}",
        name=name or f"Skill {skill_id}",
        description=description,
        subject=subject,
        parent_skill_id=parent_skill_id,
        prerequisites=prerequisites or [],
        kc_tags=kc_tags or [],
        localisations={},
        status=status,
        lang="en-NG",
        provenance=_provenance(),
    )


def test_create_and_get_skill_roundtrip() -> None:
    repo = InMemoryLearningRepository()
    skill = _skill("fractions-add")
    created = repo.create_tenant_skill(skill)
    assert created.skill_id == "fractions-add"
    fetched = repo.get_skill("tenant-A", "fractions-add")
    assert fetched is not None
    assert fetched.standard_id == "std-fractions-add"


def test_create_duplicate_skill_raises() -> None:
    repo = InMemoryLearningRepository()
    repo.create_tenant_skill(_skill("ratios"))
    with pytest.raises(ValueError):
        repo.create_tenant_skill(_skill("ratios"))


def test_get_skill_isolates_tenants() -> None:
    repo = InMemoryLearningRepository()
    repo.create_tenant_skill(_skill("integers", tenant_id="tenant-A"))
    assert repo.get_skill("tenant-B", "integers") is None


def test_archive_skill_flips_status_only() -> None:
    repo = InMemoryLearningRepository()
    repo.create_tenant_skill(_skill("decimals"))
    archived = repo.archive_skill("tenant-A", "decimals")
    assert archived is not None
    assert archived.status == "archived"
    # Original tenant_id and provenance preserved
    assert archived.tenant_id == "tenant-A"
    assert archived.provenance[0].rule_id == "seed_fixture"


def test_archive_unknown_skill_returns_none() -> None:
    repo = InMemoryLearningRepository()
    assert repo.archive_skill("tenant-A", "ghost") is None


def test_list_skills_filters_by_status_and_subject() -> None:
    repo = InMemoryLearningRepository()
    repo.create_tenant_skill(_skill("a", subject="maths"))
    repo.create_tenant_skill(_skill("b", subject="english"))
    repo.create_tenant_skill(_skill("c", subject="maths", status="archived"))

    active_maths = repo.list_skills("tenant-A", subject="maths", status="active")
    assert {s.skill_id for s in active_maths.skills} == {"a"}
    assert active_maths.total == 1

    archived_any = repo.list_skills("tenant-A", subject=None, status="archived")
    assert {s.skill_id for s in archived_any.skills} == {"c"}


def test_list_skills_query_matches_name_description_and_tags() -> None:
    repo = InMemoryLearningRepository()
    repo.create_tenant_skill(_skill("a", name="Adding Fractions"))
    repo.create_tenant_skill(_skill("b", description="practise FrAcTiOnS daily"))
    repo.create_tenant_skill(_skill("c", kc_tags=["fractions", "number"]))
    repo.create_tenant_skill(_skill("d", name="Long Division"))

    result = repo.list_skills("tenant-A", query="fractions")
    assert {s.skill_id for s in result.skills} == {"a", "b", "c"}
    assert result.total == 3


def test_list_skills_paginates_deterministically() -> None:
    repo = InMemoryLearningRepository()
    for letter in ["d", "c", "b", "a"]:
        repo.create_tenant_skill(_skill(letter, name=f"Skill {letter.upper()}"))
    page1 = repo.list_skills("tenant-A", limit=2, offset=0)
    page2 = repo.list_skills("tenant-A", limit=2, offset=2)
    assert [s.skill_id for s in page1.skills] == ["a", "b"]
    assert [s.skill_id for s in page2.skills] == ["c", "d"]
    assert page1.total == 4 and page2.total == 4


def test_list_skills_rejects_invalid_pagination() -> None:
    repo = InMemoryLearningRepository()
    with pytest.raises(ValueError):
        repo.list_skills("tenant-A", limit=0)
    with pytest.raises(ValueError):
        repo.list_skills("tenant-A", limit=201)
    with pytest.raises(ValueError):
        repo.list_skills("tenant-A", offset=-1)


def test_list_skills_empty_result_still_carries_provenance() -> None:
    """SkillSearchResult extends LanguageAndProvenanceModel, so even an
    empty page must satisfy the contract."""
    repo = InMemoryLearningRepository()
    result = repo.list_skills("tenant-empty")
    assert result.total == 0
    assert result.skills == []
    assert result.lang  # non-empty default
    assert result.provenance and result.provenance[0].source
