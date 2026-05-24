"""CASE framework loader (IMS Global CASE 1.1 subset).

Loads a curriculum framework expressed as a CASE-conformant JSON document
(`CFDocument` + `CFItems` + `CFAssociations`) and exposes it as typed
contracts the validator and planner can use to ground skill catalogues
without reaching any network. MVP target is NERDC JSS2 Maths.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional

from pydantic import Field

from src.learning.models import ContractModel


REQUIRED_DOCUMENT_KEYS = {"identifier", "title", "creator", "officialSourceURL"}
REQUIRED_ITEM_KEYS = {"identifier", "fullStatement", "humanCodingScheme", "CFItemType"}
SUPPORTED_ASSOCIATION_TYPES = {"isChildOf", "isPartOf", "isPeerOf", "exemplar", "exactMatchOf"}


class CASEConformanceError(ValueError):
    """Raised when a CASE document fails conformance checks."""


class CFItem(ContractModel):
    identifier: str = Field(min_length=1)
    full_statement: str = Field(min_length=1)
    human_coding_scheme: str = Field(min_length=1)
    item_type: str = Field(min_length=1)
    abbreviated_statement: Optional[str] = None


class CFAssociation(ContractModel):
    identifier: str = Field(min_length=1)
    association_type: str = Field(min_length=1)
    origin_node_identifier: str = Field(min_length=1)
    destination_node_identifier: str = Field(min_length=1)


class CurriculumFramework(ContractModel):
    identifier: str = Field(min_length=1)
    title: str = Field(min_length=1)
    creator: str = Field(min_length=1)
    official_source_url: str = Field(min_length=1)
    items: List[CFItem] = Field(min_length=1)
    associations: List[CFAssociation] = Field(default_factory=list)


class CASEImportResult(ContractModel):
    framework: CurriculumFramework
    item_count: int = Field(ge=1)
    association_count: int = Field(ge=0)
    source_path: str = Field(min_length=1)
    sha256: str = Field(min_length=64, max_length=64)


class CASEAdapter:
    """Parse and conformance-check a CASE 1.1 JSON document."""

    def load(self, path: Path) -> CASEImportResult:
        if not path.exists() or not path.is_file():
            raise CASEConformanceError(f"CASE document not found: {path}")
        raw = path.read_bytes()
        import hashlib

        digest = hashlib.sha256(raw).hexdigest()
        payload = json.loads(raw.decode("utf-8"))
        framework = self._parse(payload)
        return CASEImportResult(
            framework=framework,
            item_count=len(framework.items),
            association_count=len(framework.associations),
            source_path=str(path),
            sha256=digest,
        )

    @staticmethod
    def _parse(payload: dict) -> CurriculumFramework:
        document = payload.get("CFDocument")
        if not isinstance(document, dict):
            raise CASEConformanceError("CASE payload missing CFDocument object")
        missing_doc = REQUIRED_DOCUMENT_KEYS - document.keys()
        if missing_doc:
            raise CASEConformanceError(
                f"CFDocument missing required keys: {sorted(missing_doc)}"
            )

        raw_items = payload.get("CFItems") or []
        if not isinstance(raw_items, list) or not raw_items:
            raise CASEConformanceError("CASE payload must declare a non-empty CFItems array")
        items: List[CFItem] = []
        for index, raw in enumerate(raw_items):
            if not isinstance(raw, dict):
                raise CASEConformanceError(f"CFItems[{index}] is not an object")
            missing_item = REQUIRED_ITEM_KEYS - raw.keys()
            if missing_item:
                raise CASEConformanceError(
                    f"CFItems[{index}] missing required keys: {sorted(missing_item)}"
                )
            items.append(
                CFItem(
                    identifier=str(raw["identifier"]),
                    full_statement=str(raw["fullStatement"]),
                    human_coding_scheme=str(raw["humanCodingScheme"]),
                    item_type=str(raw["CFItemType"]),
                    abbreviated_statement=raw.get("abbreviatedStatement"),
                )
            )

        raw_assocs = payload.get("CFAssociations") or []
        associations: List[CFAssociation] = []
        if not isinstance(raw_assocs, list):
            raise CASEConformanceError("CFAssociations must be an array when present")
        item_ids = {item.identifier for item in items}
        for index, raw in enumerate(raw_assocs):
            if not isinstance(raw, dict):
                raise CASEConformanceError(f"CFAssociations[{index}] is not an object")
            assoc_type = str(raw.get("associationType", ""))
            if assoc_type not in SUPPORTED_ASSOCIATION_TYPES:
                raise CASEConformanceError(
                    f"CFAssociations[{index}] uses unsupported associationType '{assoc_type}'"
                )
            origin = (raw.get("originNodeURI") or {}).get("identifier") or raw.get("originNodeIdentifier")
            destination = (raw.get("destinationNodeURI") or {}).get("identifier") or raw.get("destinationNodeIdentifier")
            if not origin or not destination:
                raise CASEConformanceError(
                    f"CFAssociations[{index}] missing origin/destination identifier"
                )
            if origin not in item_ids:
                raise CASEConformanceError(
                    f"CFAssociations[{index}] originNodeIdentifier '{origin}' not in CFItems"
                )
            associations.append(
                CFAssociation(
                    identifier=str(raw["identifier"]),
                    association_type=assoc_type,
                    origin_node_identifier=str(origin),
                    destination_node_identifier=str(destination),
                )
            )

        return CurriculumFramework(
            identifier=str(document["identifier"]),
            title=str(document["title"]),
            creator=str(document["creator"]),
            official_source_url=str(document["officialSourceURL"]),
            items=items,
            associations=associations,
        )


__all__ = [
    "CASEAdapter",
    "CASEConformanceError",
    "CASEImportResult",
    "CurriculumFramework",
    "CFItem",
    "CFAssociation",
    "REQUIRED_DOCUMENT_KEYS",
    "REQUIRED_ITEM_KEYS",
    "SUPPORTED_ASSOCIATION_TYPES",
]
