"""Repository contract tests for Pathfinder teacher-class membership lookup."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from src.learning.repository import InMemoryLearningRepository, LearningPostgresRepository


def test_in_memory_teacher_class_lookup_is_tenant_and_user_scoped() -> None:
    repo = InMemoryLearningRepository()
    repo.seed_teacher_class("tenant-A", "teacher-1", "class-a")
    repo.seed_teacher_class("tenant-A", "teacher-1", "class-b")
    repo.seed_teacher_class("tenant-A", "teacher-2", "class-c")
    repo.seed_teacher_class("tenant-B", "teacher-1", "class-d")

    assert repo.list_class_ids_for_teacher("tenant-A", "teacher-1") == {"class-a", "class-b"}
    assert repo.list_class_ids_for_teacher("tenant-A", "teacher-2") == {"class-c"}
    assert repo.list_class_ids_for_teacher("tenant-B", "teacher-1") == {"class-d"}
    assert repo.list_class_ids_for_teacher("tenant-A", "missing") == set()


class _MembershipConnection:
    def __init__(self) -> None:
        self.executions: List[Tuple[str, Tuple[Any, ...]]] = []
        self.rows: List[Dict[str, str]] = []

    def execute(self, sql: str, params: Tuple[Any, ...]) -> "_MembershipConnection":
        self.executions.append((sql, params))
        return self

    def fetchall(self) -> List[Dict[str, str]]:
        return self.rows


class _MembershipStorage:
    def __init__(self) -> None:
        self.connection = _MembershipConnection()

    def _execute_write(self, callback) -> None:
        callback(self.connection)


def test_postgres_teacher_class_lookup_joins_teacher_membership() -> None:
    storage = _MembershipStorage()
    storage.connection.rows = [{"class_id": "class-jss2-a"}, {"class_id": "class-ss1-a"}]
    repository = LearningPostgresRepository(storage)

    class_ids = repository.list_class_ids_for_teacher("tenant-phase-2", "teacher-user-1")

    assert class_ids == {"class-jss2-a", "class-ss1-a"}
    sql, params = storage.connection.executions[-1]
    assert "learning_teacher_classes" in sql
    assert "learning_teachers" in sql
    assert params == ("tenant-phase-2", "teacher-user-1")