"""OneRoster 1.2 CSV import smoke test (F4 compliance pack).

Exercises ``OneRosterAdapter`` against ``evidence/compliance/oneroster_smoke/``
so the smoke fixture stays in lock-step with the loader as the pilot
evolves. The fixture itself is regulated evidence: any drift here must be
reflected in the next signed compliance bundle.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.common.oneroster import (
    OneRosterAdapter,
    OneRosterImportError,
    REQUIRED_COLUMNS,
)


EVIDENCE_DIR = Path(__file__).resolve().parents[3] / "evidence" / "compliance" / "oneroster_smoke"


def test_smoke_directory_is_present_for_evidence_bundle() -> None:
    assert EVIDENCE_DIR.is_dir(), f"missing OneRoster smoke fixtures at {EVIDENCE_DIR}"
    for stem in REQUIRED_COLUMNS:
        assert (EVIDENCE_DIR / f"{stem}.csv").is_file(), f"missing {stem}.csv"


def test_oneroster_smoke_import_succeeds_and_records_manifest() -> None:
    adapter = OneRosterAdapter()
    result = adapter.import_directory(EVIDENCE_DIR, tenant_id="tenant-pilot")

    assert result.tenant_id == "tenant-pilot"
    assert len(result.orgs) == 2
    assert {row["sourcedId"] for row in result.orgs} == {"org-wulo-pilot", "org-school-001"}
    assert len(result.classes) == 2
    assert len(result.users) == 4
    assert {row["role"] for row in result.users} == {"teacher", "student", "administrator"}
    assert len(result.enrollments) == 4
    assert len(result.academic_sessions) == 2

    manifest_names = [entry.filename for entry in result.manifest]
    assert manifest_names == sorted(manifest_names)
    assert set(manifest_names) == {
        "academicSessions.csv",
        "classes.csv",
        "enrollments.csv",
        "orgs.csv",
        "users.csv",
    }
    for entry in result.manifest:
        assert len(entry.sha256) == 64
        assert entry.row_count >= 1


def test_oneroster_import_requires_tenant_id() -> None:
    with pytest.raises(OneRosterImportError):
        OneRosterAdapter().import_directory(EVIDENCE_DIR, tenant_id="")


def test_oneroster_import_rejects_unknown_role(tmp_path: Path) -> None:
    (tmp_path / "orgs.csv").write_text(
        "sourcedId,status,name,type\norg-1,active,Test,school\n", encoding="utf-8"
    )
    (tmp_path / "classes.csv").write_text(
        "sourcedId,status,title,schoolSourcedId\nclass-1,active,J1,org-1\n", encoding="utf-8"
    )
    (tmp_path / "users.csv").write_text(
        "sourcedId,status,role,familyName,givenName\nuser-1,active,wizard,Doe,Jane\n",
        encoding="utf-8",
    )
    (tmp_path / "enrollments.csv").write_text(
        "sourcedId,status,classSourcedId,userSourcedId,role\nenr-1,active,class-1,user-1,student\n",
        encoding="utf-8",
    )
    (tmp_path / "academicSessions.csv").write_text(
        "sourcedId,status,title,type,startDate,endDate\nterm-1,active,T1,term,2026-01-01,2026-04-01\n",
        encoding="utf-8",
    )

    with pytest.raises(OneRosterImportError, match="invalid role"):
        OneRosterAdapter().import_directory(tmp_path, tenant_id="tenant-x")


def test_oneroster_import_rejects_missing_required_column(tmp_path: Path) -> None:
    (tmp_path / "orgs.csv").write_text(
        "sourcedId,status,type\norg-1,active,school\n", encoding="utf-8"
    )
    (tmp_path / "classes.csv").write_text(
        "sourcedId,status,title,schoolSourcedId\nclass-1,active,J1,org-1\n", encoding="utf-8"
    )
    (tmp_path / "users.csv").write_text(
        "sourcedId,status,role,familyName,givenName\nuser-1,active,student,Doe,Jane\n",
        encoding="utf-8",
    )
    (tmp_path / "enrollments.csv").write_text(
        "sourcedId,status,classSourcedId,userSourcedId,role\nenr-1,active,class-1,user-1,student\n",
        encoding="utf-8",
    )
    (tmp_path / "academicSessions.csv").write_text(
        "sourcedId,status,title,type,startDate,endDate\nterm-1,active,T1,term,2026-01-01,2026-04-01\n",
        encoding="utf-8",
    )

    with pytest.raises(OneRosterImportError, match="missing required OneRoster"):
        OneRosterAdapter().import_directory(tmp_path, tenant_id="tenant-x")
