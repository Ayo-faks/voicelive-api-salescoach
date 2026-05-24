"""Skills catalogue service (Phase 1, Workstream B4).

Wraps :class:`LearningRepository` with curriculum-aware business rules.
The only non-trivial rule today is acyclic prerequisites: a new or
modified skill must not reference itself, and its prerequisite chain
must not cycle back through any ancestor in the catalogue.

The service is intentionally stateless — it reads from the repository
on each call so it stays correct after concurrent writes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Set

from src.learning.models import CatalogueSkill
from src.learning.repository import LearningRepository


class SkillCatalogueError(ValueError):
    """Raised when a skill payload violates the catalogue invariants."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class CycleCheckResult:
    ok: bool
    code: Optional[str] = None
    message: Optional[str] = None
    cycle_path: Optional[List[str]] = None


class SkillsCatalogueService:
    """Curriculum-aware operations on the skills catalogue."""

    def __init__(self, repository: LearningRepository) -> None:
        self.repository = repository

    def check_prerequisites_acyclic(self, skill: CatalogueSkill) -> CycleCheckResult:
        if skill.parent_skill_id == skill.skill_id:
            return CycleCheckResult(
                ok=False,
                code="self_parent",
                message="A skill cannot be its own parent",
                cycle_path=[skill.skill_id],
            )
        if skill.skill_id in skill.prerequisites:
            return CycleCheckResult(
                ok=False,
                code="self_prerequisite",
                message="A skill cannot list itself as a prerequisite",
                cycle_path=[skill.skill_id],
            )

        visited: Set[str] = set()
        for prereq_id in skill.prerequisites:
            path = self._find_cycle(
                tenant_id=skill.tenant_id,
                start=prereq_id,
                target=skill.skill_id,
                visited=visited,
            )
            if path is not None:
                return CycleCheckResult(
                    ok=False,
                    code="prerequisite_cycle",
                    message=(
                        f"Prerequisite chain from {skill.skill_id} returns to itself "
                        f"via {' -> '.join(path)}"
                    ),
                    cycle_path=[skill.skill_id, *path],
                )

        # Check parent chain separately (parent loops are independent of prereqs)
        parent_path = self._find_parent_cycle(
            tenant_id=skill.tenant_id,
            start_parent=skill.parent_skill_id,
            target=skill.skill_id,
        )
        if parent_path is not None:
            return CycleCheckResult(
                ok=False,
                code="parent_cycle",
                message=(
                    f"Parent chain from {skill.skill_id} returns to itself "
                    f"via {' -> '.join(parent_path)}"
                ),
                cycle_path=[skill.skill_id, *parent_path],
            )

        return CycleCheckResult(ok=True)

    def create(self, skill: CatalogueSkill) -> CatalogueSkill:
        check = self.check_prerequisites_acyclic(skill)
        if not check.ok:
            raise SkillCatalogueError(check.code or "invalid_skill", check.message or "invalid")
        return self.repository.create_tenant_skill(skill)

    def archive(self, tenant_id: str, skill_id: str) -> Optional[CatalogueSkill]:
        return self.repository.archive_skill(tenant_id, skill_id)

    # ------------------------------------------------------------------
    # internals
    # ------------------------------------------------------------------
    def _find_cycle(
        self,
        *,
        tenant_id: str,
        start: str,
        target: str,
        visited: Set[str],
    ) -> Optional[List[str]]:
        stack: List[tuple[str, List[str]]] = [(start, [start])]
        while stack:
            current, path = stack.pop()
            if current == target:
                return path
            if current in visited:
                continue
            visited.add(current)
            node = self.repository.get_skill(tenant_id, current)
            if node is None:
                continue
            for prereq in node.prerequisites:
                stack.append((prereq, [*path, prereq]))
            if node.parent_skill_id:
                stack.append((node.parent_skill_id, [*path, node.parent_skill_id]))
        return None

    def _find_parent_cycle(
        self,
        *,
        tenant_id: str,
        start_parent: Optional[str],
        target: str,
    ) -> Optional[List[str]]:
        if start_parent is None:
            return None
        visited: Set[str] = set()
        cursor: Optional[str] = start_parent
        path: List[str] = []
        while cursor is not None:
            path.append(cursor)
            if cursor == target:
                return path
            if cursor in visited:
                return path  # cycle that doesn't include target — still invalid
            visited.add(cursor)
            node = self.repository.get_skill(tenant_id, cursor)
            cursor = node.parent_skill_id if node else None
        return None


__all__ = ["SkillsCatalogueService", "SkillCatalogueError", "CycleCheckResult"]
