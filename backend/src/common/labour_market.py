"""Deterministic labour-market fixtures for Pathfinder career planning."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List

from pydantic import Field

from src.learning.models import ContractModel, LabourMarketSignal, Provenance


class LabourMarketRecord(ContractModel):
    pathway_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    skill_weights: Dict[str, float] = Field(min_length=1)
    wage_band: LabourMarketSignal
    demand_trend: LabourMarketSignal
    provenance: List[Provenance] = Field(min_length=1)


class LabourMarketDataset(ContractModel):
    dataset_id: str = Field(min_length=1)
    lang: str = Field(pattern=r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
    records: List[LabourMarketRecord] = Field(min_length=1)


class LabourMarketLoader:
    """Load sourced labour-market records without network access."""

    def load(self, path: Path) -> LabourMarketDataset:
        with path.open(encoding="utf-8") as handle:
            payload = json.load(handle)
        return LabourMarketDataset.model_validate(payload)
