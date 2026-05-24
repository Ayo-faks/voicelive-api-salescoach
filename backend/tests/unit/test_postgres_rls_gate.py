"""Unit tests for the Postgres RLS startup gate."""

from __future__ import annotations

from typing import Any, List

import pytest

from src.services.storage_postgres import (
    RLS_PROTECTED_TABLES,
    PostgresRlsGateError,
    assert_postgres_rls_active,
)


class _FakeCursor:
    def __init__(self, rows: List[dict[str, Any]]):
        self._rows = rows

    def fetchall(self) -> List[dict[str, Any]]:
        return list(self._rows)


class _FakeConnection:
    """Minimal stand-in for psycopg.Connection used by the RLS gate."""

    def __init__(self, rows: List[dict[str, Any]]):
        self._rows = rows
        self.executed: List[tuple[str, tuple[Any, ...]]] = []

    def execute(self, query: str, params: tuple[Any, ...] = ()) -> _FakeCursor:
        self.executed.append((query, params))
        return _FakeCursor(self._rows)


def _all_tables_active() -> List[dict[str, Any]]:
    return [
        {"relname": name, "relrowsecurity": True, "relforcerowsecurity": True}
        for name in RLS_PROTECTED_TABLES
    ]


def test_assert_postgres_rls_active_passes_when_every_table_is_enabled_and_forced():
    connection = _FakeConnection(_all_tables_active())

    assert_postgres_rls_active(connection)

    # Sanity: the gate issued exactly one query with the protected table list.
    assert len(connection.executed) == 1
    _, params = connection.executed[0]
    assert params == (list(RLS_PROTECTED_TABLES),)


def test_assert_postgres_rls_active_raises_when_table_is_missing():
    rows = [r for r in _all_tables_active() if r["relname"] != "children"]
    connection = _FakeConnection(rows)

    with pytest.raises(PostgresRlsGateError, match="children: table missing"):
        assert_postgres_rls_active(connection)


def test_assert_postgres_rls_active_raises_when_rls_not_enabled():
    rows = _all_tables_active()
    rows[0] = {**rows[0], "relrowsecurity": False}
    connection = _FakeConnection(rows)

    with pytest.raises(PostgresRlsGateError, match="ROW LEVEL SECURITY not ENABLED"):
        assert_postgres_rls_active(connection)


def test_assert_postgres_rls_active_raises_when_rls_not_forced():
    rows = _all_tables_active()
    rows[0] = {**rows[0], "relforcerowsecurity": False}
    connection = _FakeConnection(rows)

    with pytest.raises(PostgresRlsGateError, match="ROW LEVEL SECURITY not FORCED"):
        assert_postgres_rls_active(connection)


def test_assert_postgres_rls_active_aggregates_multiple_failures():
    rows = _all_tables_active()
    rows[0] = {**rows[0], "relrowsecurity": False}
    rows[1] = {**rows[1], "relforcerowsecurity": False}
    connection = _FakeConnection(rows)

    with pytest.raises(PostgresRlsGateError) as excinfo:
        assert_postgres_rls_active(connection)

    message = str(excinfo.value)
    assert "Postgres RLS gate failed for 2 table(s)" in message
    assert rows[0]["relname"] in message
    assert rows[1]["relname"] in message


def test_assert_postgres_rls_active_supports_tuple_rows():
    """The verify script may use a tuple cursor; the gate must still parse rows."""
    rows = [(name, True, True) for name in RLS_PROTECTED_TABLES]
    connection = _FakeConnection(rows)  # type: ignore[arg-type]

    assert_postgres_rls_active(connection)


def test_rls_protected_tables_constant_is_immutable_tuple():
    """The shared constant must be a tuple so it cannot be mutated at runtime."""
    assert isinstance(RLS_PROTECTED_TABLES, tuple)
    # Spot-check that the canonical tables from the migrations are present.
    for required in (
        "children",
        "sessions",
        "child_invitations",
        "family_intake_invitations",
        "progress_reports",
        "child_ui_state",
    ):
        assert required in RLS_PROTECTED_TABLES
