"""Multilingual content-pack and native-rater evaluation helpers."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import Field, computed_field

from src.learning.models import ContentPackManifest, ContractModel, LanguageAndProvenanceModel, Provenance


class LanguageEvalCase(LanguageAndProvenanceModel):
    case_id: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    expected_intent: str = Field(min_length=1)
    rater_labels: List[str] = Field(min_length=2)


class LanguageEvalSlice(ContractModel):
    dataset_id: str = Field(min_length=1)
    lang: str = Field(pattern=r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
    cases: List[LanguageEvalCase] = Field(default_factory=list)
    summary_case_count: Optional[int] = Field(default=None, ge=0)
    summary_kappa: Optional[float] = Field(default=None, ge=-1.0, le=1.0)
    provenance: List[Provenance] = Field(min_length=1)

    @computed_field
    @property
    def case_count(self) -> int:
        return max(len(self.cases), self.summary_case_count or 0)

    @computed_field
    @property
    def cohens_kappa(self) -> float:
        if self.summary_kappa is not None:
            return self.summary_kappa
        return _cohens_kappa([case.rater_labels[:2] for case in self.cases])


def _cohens_kappa(pairs: List[List[str]]) -> float:
    if not pairs:
        return 0.0
    observed = sum(1 for first, second in pairs if first == second) / len(pairs)
    labels = sorted({label for pair in pairs for label in pair})
    expected = 0.0
    total_labels = len(pairs) * 2
    for label in labels:
        first_count = sum(1 for first, _ in pairs if first == label)
        second_count = sum(1 for _, second in pairs if second == label)
        expected += (first_count / total_labels) * (second_count / total_labels)
    if expected >= 1.0:
        return 1.0 if observed >= 1.0 else 0.0
    return (observed - expected) / (1.0 - expected)


def load_language_eval_slice(path: Path) -> LanguageEvalSlice:
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    return LanguageEvalSlice.model_validate(payload)


def build_content_pack_manifest(
    path: Path, tenant_id: str, pack_key: str, version: str, payload: Dict[str, Any]
) -> ContentPackManifest:
    raw = path.read_bytes()
    provenance = [
        Provenance(
            source="pathfinder_phase_3_yoruba_content_pack",
            source_id=path.name,
            rule_id="contract_phase_3_yoruba_pack",
            confidence=1.0,
            evidence_count=len(payload),
        )
    ]
    return ContentPackManifest(
        tenant_id=tenant_id,
        pack_key=pack_key,
        version=version,
        source_uri=f"local://{path.name}",
        sha256=hashlib.sha256(raw).hexdigest(),
        payload=payload,
        lang="yo-NG",
        provenance=provenance,
    )


def load_yoruba_content_pack(path: Path, tenant_id: str = "tenant-phase-3") -> ContentPackManifest:
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    return build_content_pack_manifest(
        path=path,
        tenant_id=tenant_id,
        pack_key=str(payload["pack_key"]),
        version=str(payload["version"]),
        payload=payload,
    )
