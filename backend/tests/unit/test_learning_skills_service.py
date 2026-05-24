"""Tests for the skills-catalogue service (B4) — prerequisite cycle detection.

The service is the only place where curriculum-acyclicity is enforced
before a write reaches the repository. Tests pin the contract so any
future async/Postgres implementation must match.
"""

from __future__ import annotations

import pytest

from src.learning.models import CatalogueSkill, Provenance
from src.learning.repository import InMemoryLearningRepository
from src.learning.skills import SkillCatalogueError, SkillsCatalogueService


def _skill(
    skill_id: str,
    *,
    tenant_id: str = "tenant-A",
    parent: str | None = None,
    prereqs: list[str] | None = None,
) -> CatalogueSkill:
    return CatalogueSkill(
        skill_id=skill_id,
        tenant_id=tenant_id,
        standard_id=f"std-{skill_id}",
        name=skill_id.title(),
        subject="maths",
        parent_skill_id=parent,
        prerequisites=prereqs or [],
        kc_tags=[],
        localisations={},
        status="active",
        lang="en-NG",
        provenance=[
            Provenance(
                source="test_learning_skills_service",
                rule_id="fixture",
                confidence=1.0,
                evidence_count=1,
            )
        ],
    )


def _service() -> tuple[SkillsCatalogueService, InMemoryLearningRepository]:
    repo = InMemoryLearningRepository()
    return SkillsCatalogueService(repo), repo


def test_create_accepts_skill_without_prerequisites() -> None:
    svc, repo = _service()
    created = svc.create(_skill("integers"))
    assert created.skill_id == "integers"
    assert repo.get_skill("tenant-A", "integers") is not None


def test_create_accepts_dag_chain() -> None:
    svc, _ = _service()
    svc.create(_skill("integers"))
    svc.create(_skill("fractions", prereqs=["integers"]))
    svc.create(_skill("decimals", prereqs=["fractions"]))
    # No raises = pass


def test_create_rejects_self_prerequisite() -> None:
    svc, _ = _service()
    with pytest.raises(SkillCatalogueError) as exc:
        svc.create(_skill("loop", prereqs=["loop"]))
    assert exc.value.code == "self_prerequisite"


def test_create_rejects_self_parent() -> None:
    svc, _ = _service()
    with pytest.raises(SkillCatalogueError) as exc:
        svc.create(_skill("loop", parent="loop"))
    assert exc.value.code == "self_parent"


def test_create_rejects_cycle_back_to_new_skill() -> None:
    """The classic case: a → b, then creating c with c→a→b→c."""
    svc, _ = _service()
    svc.create(_skill("a"))
    svc.create(_skill("b", prereqs=["a"]))
    # Mutate a so it now lists c as a prerequisite (c doesn't exist yet —
    # in real life this would be impossible, so we use the repo directly).
    repo = svc.repository
    a_with_c = _skill("a", prereqs=["c"])
    repo.skills[("tenant-A", "a")] = a_with_c  # type: ignore[attr-defined]
    # Now creating c that depends on b should fail: c → b → a → c
    with pytest.raises(SkillCatalogueError) as exc:
        svc.create(_skill("c", prereqs=["b"]))
    assert exc.value.code == "prerequisite_cycle"
    assert "c" in (exc.value.args[0] if exc.value.args else "")


def test_create_rejects_parent_chain_cycle() -> None:
    svc, _ = _service()
    svc.create(_skill("root"))
    svc.create(_skill("child", parent="root"))
    # Corrupt root so its parent points at the future grandchild
    repo = svc.repository
    repo.skills[("tenant-A", "root")] = _skill("root", parent="grand")  # type: ignore[attr-defined]
    with pytest.raises(SkillCatalogueError) as exc:
        svc.create(_skill("grand", parent="child"))
    assert exc.value.code == "parent_cycle"


def test_archive_returns_archived_record() -> None:
    svc, _ = _service()
    svc.create(_skill("temp"))
    archived = svc.archive("tenant-A", "temp")
    assert archived is not None
    assert archived.status == "archived"


def test_archive_unknown_returns_none() -> None:
    svc, _ = _service()
    assert svc.archive("tenant-A", "ghost") is None
