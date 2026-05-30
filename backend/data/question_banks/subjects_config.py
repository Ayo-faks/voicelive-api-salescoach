#!/usr/bin/env python3
"""Per-subject registry for the SS MCQ diagnostic-bank pipeline.

Single source of truth for the file names and identifiers each subject uses, so
the Stage 3.5 ensemble verifier and the Phase 3 served-bank builder can run for
any subject without copy-pasting a new script per subject (and, critically,
without two subjects clobbering each other's report / output files when run in
parallel).

Naming conventions (Government is the proven reference):

* source bank   ``<subject>-ss-mcq-v1.json``           e.g. government-ss-mcq-v1.json
* ensemble rpt  ``<subject>_ensemble_verify_report.json``
* served active ``<subject>_ss_v1.json``               (diagnostic_id ss3-<subject>-v1)
* served flagged``<subject>_ss_v1_flagged.json``
* skill_id      ``ss3.<subject>.<topic_key>.<subtopic_key>``
* standard_id   ``ss3.<subject>.waec-neco``

The 10 SS subjects (taxonomy.md). Government is DONE; the other 9 are the
remaining track. Maths/English use the native maths|english DiagnosticItem path
and are intentionally NOT in this registry.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict

HERE = Path(__file__).resolve().parent


@dataclass(frozen=True)
class SubjectConfig:
    key: str          # registry/url key, also the bank-level subject + skill_id segment
    title: str        # human-readable subject title for served bank titles/descriptions

    @property
    def source_bank(self) -> Path:
        return HERE / f"{self.key}-ss-mcq-v1.json"

    @property
    def ensemble_report(self) -> Path:
        return HERE / f"{self.key}_ensemble_verify_report.json"

    @property
    def served_active_name(self) -> str:
        return f"{self.key}_ss_v1.json"

    @property
    def served_flagged_name(self) -> str:
        return f"{self.key}_ss_v1_flagged.json"

    @property
    def diagnostic_id(self) -> str:
        return f"ss3-{self.key}-v1"

    @property
    def standard_id(self) -> str:
        return f"ss3.{self.key}.waec-neco"

    @property
    def provenance_source(self) -> str:
        return f"scrape:{self.key}-ssce-derived"

    @property
    def provenance_source_id(self) -> str:
        return f"{self.key}-ss-mcq-v1"


# Order matches taxonomy.md. Government [0] is complete and kept here as the
# canonical reference; [1:] are the 9 remaining subjects.
_SUBJECT_LIST = [
    SubjectConfig("government", "Government"),
    SubjectConfig("history", "History"),
    SubjectConfig("literature", "Literature-in-English"),
    SubjectConfig("economics", "Economics"),
    SubjectConfig("data_processing", "Data Processing"),
    SubjectConfig("computer_science", "Computer Science"),
    SubjectConfig("agricultural_science", "Agricultural Science"),
    SubjectConfig("biology", "Biology"),
    SubjectConfig("chemistry", "Chemistry"),
    SubjectConfig("physics", "Physics"),
]

SUBJECTS: Dict[str, SubjectConfig] = {s.key: s for s in _SUBJECT_LIST}

TENANT_ID = "pilot-tenant"


def get(subject: str) -> SubjectConfig:
    try:
        return SUBJECTS[subject]
    except KeyError:
        known = ", ".join(SUBJECTS)
        raise SystemExit(f"unknown subject '{subject}'. known: {known}")
