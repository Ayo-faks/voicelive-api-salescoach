"""CASE framework adapter conformance test (F4 compliance pack).

Validates that ``CASEAdapter`` accepts the NERDC JSS2 Maths CASE 1.1
fixture under ``evidence/compliance/`` and rejects malformed documents. The
fixture is the source-of-truth catalogue for the JSS2 maths skills used by
the validator and planner; any change here is regulated evidence.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.common.case_loader import (
    CASEAdapter,
    CASEConformanceError,
    REQUIRED_DOCUMENT_KEYS,
    REQUIRED_ITEM_KEYS,
)


FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "evidence"
    / "compliance"
    / "case_framework_nerdc_jss2_maths.json"
)


def test_case_fixture_is_present_for_evidence_bundle() -> None:
    assert FIXTURE_PATH.is_file(), f"missing CASE fixture at {FIXTURE_PATH}"


def test_case_adapter_loads_nerdc_jss2_maths_framework() -> None:
    result = CASEAdapter().load(FIXTURE_PATH)
    framework = result.framework

    assert framework.identifier == "9f6c3f2e-1a4f-4b80-9a8a-1f4f3c4f8a01"
    assert "JSS2 Mathematics" in framework.title
    assert framework.creator.startswith("Nigerian Educational Research")
    assert framework.official_source_url.startswith("https://")

    codes = {item.human_coding_scheme for item in framework.items}
    assert codes == {"JSS2-MA-1", "JSS2-MA-2", "JSS2-MA-3", "JSS2-MA-4"}
    identifiers = {item.identifier for item in framework.items}
    assert identifiers == {
        "skill-ratio-proportion",
        "skill-fraction-operations",
        "skill-linear-equations",
        "skill-plane-geometry",
    }
    for item in framework.items:
        assert item.item_type == "Skill"
        assert item.full_statement
        assert item.abbreviated_statement

    assert result.item_count == 4
    assert result.association_count == 2
    assert len(result.sha256) == 64
    for association in framework.associations:
        assert association.association_type == "isPeerOf"
        assert association.origin_node_identifier in identifiers
        assert association.destination_node_identifier in identifiers


def test_case_adapter_rejects_missing_document_keys(tmp_path: Path) -> None:
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    payload["CFDocument"].pop("officialSourceURL")
    bad = tmp_path / "case.json"
    bad.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(CASEConformanceError, match="missing required keys"):
        CASEAdapter().load(bad)


def test_case_adapter_rejects_unsupported_association_type(tmp_path: Path) -> None:
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    payload["CFAssociations"][0]["associationType"] = "wandersInto"
    bad = tmp_path / "case.json"
    bad.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(CASEConformanceError, match="unsupported associationType"):
        CASEAdapter().load(bad)


def test_case_adapter_rejects_dangling_association_origin(tmp_path: Path) -> None:
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    payload["CFAssociations"][0]["originNodeURI"] = {"identifier": "skill-missing"}
    bad = tmp_path / "case.json"
    bad.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(CASEConformanceError, match="not in CFItems"):
        CASEAdapter().load(bad)


def test_required_constants_are_complete() -> None:
    # Guard against accidental shrinking of conformance requirements.
    assert REQUIRED_DOCUMENT_KEYS >= {"identifier", "title", "creator", "officialSourceURL"}
    assert REQUIRED_ITEM_KEYS >= {"identifier", "fullStatement", "humanCodingScheme", "CFItemType"}
