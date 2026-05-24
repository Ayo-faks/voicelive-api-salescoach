from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.seed_skills import (
    DEFAULT_DATA_DIR,
    diagnostic_source_paths,
    load_catalogue_skills,
    main,
    seed_skills,
)
from src.learning.repository import InMemoryLearningRepository


def test_diagnostic_source_paths_include_primary_and_subject_pack() -> None:
    paths = diagnostic_source_paths(DEFAULT_DATA_DIR)
    names = {path.name for path in paths}
    assert "jss2_maths_diagnostic_phase_2.json" in names
    assert "jss2_english_phase_2.json" in names
    assert len(paths) >= 5


def test_load_catalogue_skills_from_diagnostics() -> None:
    primary = DEFAULT_DATA_DIR / "jss2_maths_diagnostic_phase_2.json"
    skills = load_catalogue_skills([primary], tenant_id="tenant-seed")
    by_id = {skill.skill_id: skill for skill in skills}

    assert set(by_id) == {
        "fraction-operations",
        "linear-equations",
        "plane-geometry",
        "ratio-proportion",
    }
    assert by_id["ratio-proportion"].tenant_id == "tenant-seed"
    assert by_id["ratio-proportion"].subject == "maths"
    assert by_id["ratio-proportion"].provenance[0].source == "pathfinder_phase_2_fixture"


def test_seed_skills_is_idempotent_against_repository() -> None:
    primary = DEFAULT_DATA_DIR / "jss2_maths_diagnostic_phase_2.json"
    skills = load_catalogue_skills([primary], tenant_id="tenant-seed")
    repository = InMemoryLearningRepository()

    first = seed_skills(repository, skills, source_count=1)
    second = seed_skills(repository, skills, source_count=1)

    assert first.created == 4
    assert first.skipped_existing == 0
    assert second.created == 0
    assert second.skipped_existing == 4
    assert repository.list_skills("tenant-seed").total == 4


def test_seed_skills_dry_run_does_not_write() -> None:
    primary = DEFAULT_DATA_DIR / "jss2_maths_diagnostic_phase_2.json"
    skills = load_catalogue_skills([primary], tenant_id="tenant-seed")
    repository = InMemoryLearningRepository()

    result = seed_skills(repository, skills, dry_run=True, source_count=1)

    assert result.dry_run is True
    assert result.created == 4
    assert repository.list_skills("tenant-seed").total == 0


def test_load_catalogue_skills_rejects_conflicting_duplicates(tmp_path: Path) -> None:
    first = _diagnostic_payload("Shared skill")
    second = _diagnostic_payload("Different skill")
    first_path = tmp_path / "first.json"
    second_path = tmp_path / "second.json"
    first_path.write_text(json.dumps(first), encoding="utf-8")
    second_path.write_text(json.dumps(second), encoding="utf-8")

    with pytest.raises(ValueError, match="conflicting skill seed"):
        load_catalogue_skills([first_path, second_path], tenant_id="tenant-seed")


def test_main_dry_run_outputs_json(capsys) -> None:
    primary = DEFAULT_DATA_DIR / "jss2_maths_diagnostic_phase_2.json"

    exit_code = main([
        "--source",
        str(primary),
        "--tenant-id",
        "tenant-seed",
        "--dry-run",
        "--json",
    ])

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["dry_run"] is True
    assert payload["created"] == 4
    assert payload["total"] == 4


def _diagnostic_payload(skill_name: str) -> dict[str, object]:
    return {
        "diagnostic_id": "jss2-test-phase-2",
        "tenant_id": "tenant-fixture",
        "title": "JSS2 Test Diagnostic",
        "subject": "test-subject",
        "lang": "en-NG",
        "provenance": [
            {
                "source": "test_seed_skills",
                "rule_id": "fixture",
                "confidence": 1.0,
                "evidence_count": 1,
            }
        ],
        "skills": [
            {
                "skill_id": "duplicate-skill",
                "standard_id": "std-duplicate",
                "name": skill_name,
                "description": "A duplicate skill fixture.",
            }
        ],
        "items": [
            {
                "item_id": "item-1",
                "skill_id": "duplicate-skill",
                "prompt": "Answer this item.",
                "item_type": "short_answer",
                "difficulty": 0.0,
                "correct_answer": "yes",
                "lang": "en-NG",
                "provenance": [
                    {
                        "source": "test_seed_skills",
                        "rule_id": "fixture_item",
                        "confidence": 1.0,
                        "evidence_count": 1,
                    }
                ],
            }
        ],
    }