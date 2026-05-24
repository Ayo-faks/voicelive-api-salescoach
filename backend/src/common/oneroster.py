"""OneRoster 1.2 CSV import adapter.

Implements the minimum CSV import surface mandated by the architecture
contract (§A.4, PRD §5.5 H2 / §7.10): orgs, classes, users, enrollments,
and academicSessions. The adapter is intentionally offline-first; it reads
local CSVs, validates required column sets per the OneRoster 1.2 CSV
binding, and returns a deterministic import manifest with per-file SHA-256
digests so downstream evidence bundles can re-verify the import.
"""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import Field

from src.learning.models import ContractModel


REQUIRED_COLUMNS: Dict[str, List[str]] = {
    "orgs": ["sourcedId", "status", "name", "type"],
    "classes": ["sourcedId", "status", "title", "schoolSourcedId"],
    "users": ["sourcedId", "status", "role", "familyName", "givenName"],
    "enrollments": ["sourcedId", "status", "classSourcedId", "userSourcedId", "role"],
    "academicSessions": ["sourcedId", "status", "title", "type", "startDate", "endDate"],
}

VALID_USER_ROLES = {"student", "teacher", "administrator", "parent", "guardian", "aide", "proctor", "relative"}
VALID_ENROLLMENT_ROLES = {"student", "teacher", "administrator", "aide", "proctor"}


class OneRosterImportError(ValueError):
    """Raised when a OneRoster CSV fails structural validation."""


class FileManifest(ContractModel):
    filename: str = Field(min_length=1)
    sha256: str = Field(min_length=64, max_length=64)
    row_count: int = Field(ge=0)


class RosterImportResult(ContractModel):
    tenant_id: str = Field(min_length=1)
    orgs: List[Dict[str, Any]] = Field(default_factory=list)
    classes: List[Dict[str, Any]] = Field(default_factory=list)
    users: List[Dict[str, Any]] = Field(default_factory=list)
    enrollments: List[Dict[str, Any]] = Field(default_factory=list)
    academic_sessions: List[Dict[str, Any]] = Field(default_factory=list)
    manifest: List[FileManifest] = Field(default_factory=list)


class OneRosterAdapter:
    """Read a OneRoster 1.2 CSV bundle from a local directory."""

    def __init__(self, *, strict: bool = True) -> None:
        self.strict = strict

    def import_directory(self, directory: Path, *, tenant_id: str) -> RosterImportResult:
        if not directory.exists() or not directory.is_dir():
            raise OneRosterImportError(f"OneRoster import directory not found: {directory}")
        if not tenant_id:
            raise OneRosterImportError("tenant_id is required for OneRoster import")

        result = RosterImportResult(tenant_id=tenant_id)
        target_attrs = {
            "orgs": "orgs",
            "classes": "classes",
            "users": "users",
            "enrollments": "enrollments",
            "academicSessions": "academic_sessions",
        }

        for stem, attr in target_attrs.items():
            path = directory / f"{stem}.csv"
            if not path.exists():
                if self.strict:
                    raise OneRosterImportError(f"Missing required CSV: {stem}.csv")
                continue
            rows, digest = self._read_csv(path, REQUIRED_COLUMNS[stem])
            self._validate_rows(stem, rows)
            setattr(result, attr, rows)
            result.manifest.append(
                FileManifest(filename=path.name, sha256=digest, row_count=len(rows))
            )

        result.manifest.sort(key=lambda entry: entry.filename)
        return result

    @staticmethod
    def _read_csv(path: Path, required_columns: List[str]) -> tuple[List[Dict[str, Any]], str]:
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        text = raw.decode("utf-8-sig")
        reader = csv.DictReader(text.splitlines())
        fieldnames = reader.fieldnames or []
        missing = [col for col in required_columns if col not in fieldnames]
        if missing:
            raise OneRosterImportError(
                f"{path.name} is missing required OneRoster 1.2 columns: {missing}"
            )
        rows = [dict(row) for row in reader]
        return rows, digest

    @staticmethod
    def _validate_rows(stem: str, rows: List[Dict[str, Any]]) -> None:
        for index, row in enumerate(rows):
            if not row.get("sourcedId"):
                raise OneRosterImportError(f"{stem}.csv row {index}: missing sourcedId")
            if row.get("status") not in {"active", "tobedeleted"}:
                raise OneRosterImportError(
                    f"{stem}.csv row {index}: invalid status '{row.get('status')}'"
                )
        if stem == "users":
            for index, row in enumerate(rows):
                if row.get("role") not in VALID_USER_ROLES:
                    raise OneRosterImportError(
                        f"users.csv row {index}: invalid role '{row.get('role')}'"
                    )
        if stem == "enrollments":
            class_ids = {row["sourcedId"] for row in rows}
            for index, row in enumerate(rows):
                if row.get("role") not in VALID_ENROLLMENT_ROLES:
                    raise OneRosterImportError(
                        f"enrollments.csv row {index}: invalid role '{row.get('role')}'"
                    )
                if not row.get("classSourcedId") or not row.get("userSourcedId"):
                    raise OneRosterImportError(
                        f"enrollments.csv row {index}: missing classSourcedId or userSourcedId"
                    )
            del class_ids


__all__ = [
    "OneRosterAdapter",
    "OneRosterImportError",
    "RosterImportResult",
    "FileManifest",
    "REQUIRED_COLUMNS",
]
