"""Domain types for the safeguarding pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Mapping, Optional, Tuple


class Severity(str, Enum):
    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    @property
    def rank(self) -> int:
        return _SEVERITY_RANK[self]

    @classmethod
    def max(cls, *values: "Severity") -> "Severity":
        if not values:
            return cls.NONE
        return max(values, key=lambda s: s.rank)


_SEVERITY_RANK: Dict[Severity, int] = {
    Severity.NONE: 0,
    Severity.LOW: 1,
    Severity.MEDIUM: 2,
    Severity.HIGH: 3,
    Severity.CRITICAL: 4,
}


class Direction(str, Enum):
    INBOUND = "inbound"   # child → AI
    OUTBOUND = "outbound"  # AI → child


class SafeguardingCategory(str, Enum):
    """KCSIE-aligned categories. Kept intentionally narrow."""

    SELF_HARM = "self_harm"
    SUICIDE_IDEATION = "suicide_ideation"
    ABUSE_DISCLOSURE = "abuse_disclosure"          # physical / sexual / emotional
    NEGLECT_DISCLOSURE = "neglect_disclosure"
    PEER_ON_PEER_HARM = "peer_on_peer_harm"        # bullying, peer abuse
    GROOMING_INDICATORS = "grooming_indicators"
    EATING_DISORDER = "eating_disorder"
    SUBSTANCE_USE = "substance_use"
    RUNNING_AWAY = "running_away"
    DOMESTIC_VIOLENCE = "domestic_violence"
    AI_HARMFUL_OUTPUT = "ai_harmful_output"        # only used on outbound
    OTHER = "other"


# Public list — handy for UI / docs.
KCSIE_CATEGORIES: Tuple[str, ...] = tuple(c.value for c in SafeguardingCategory)


@dataclass(frozen=True)
class LayerScore:
    """Per-layer detection output, captured verbatim for audit."""

    layer: str                       # "lexicon" | "content_safety" | "classifier"
    severity: Severity
    categories: Tuple[str, ...] = ()
    raw: Mapping[str, Any] = field(default_factory=dict)
    model_version: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "layer": self.layer,
            "severity": self.severity.value,
            "categories": list(self.categories),
            "raw": dict(self.raw),
            "model_version": self.model_version,
        }


@dataclass(frozen=True)
class SafeguardingVerdict:
    """Final merged outcome of the pipeline for a single utterance."""

    severity: Severity
    categories: Tuple[str, ...]
    evidence_quote: str
    direction: Direction
    layer_scores: Tuple[LayerScore, ...] = ()
    rationale: Optional[str] = None

    @property
    def is_alert(self) -> bool:
        return self.severity.rank >= Severity.LOW.rank and bool(self.categories)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "severity": self.severity.value,
            "categories": list(self.categories),
            "evidence_quote": self.evidence_quote,
            "direction": self.direction.value,
            "layer_scores": [s.to_dict() for s in self.layer_scores],
            "rationale": self.rationale,
        }
