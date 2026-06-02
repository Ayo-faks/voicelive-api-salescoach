"""Turn safety-passed chunks into validated ``WikiNode`` payloads.

Every payload is constructed through ``WikiNode(**payload)`` so an invalid node
fails loudly at build time rather than shipping a broken corpus. Node ids and
anchors are deterministic functions of the curriculum key, so a re-run is
idempotent and stable.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Dict, List, Optional

from ..models import WikiNode
from .chunker import Chunk
from .sources import CurriculumKey

NODE_VERSION = "1.0.0"


def _slug(value: str) -> str:
    value = (value or "").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def _year_lc(year_group: str) -> str:
    return _slug(year_group)


def node_id_for(key: CurriculumKey, part: int = 0) -> str:
    """Deterministic node id: ``wiki.<subject>.<year>.<topic>.<subtopic>``."""
    topic = _slug(key.topic)
    subtopic = _slug(key.subtopic) if key.subtopic else "overview"
    base = f"wiki.{_slug(key.subject)}.{_year_lc(key.year_group)}.{topic}.{subtopic}"
    if part:
        base = f"{base}.p{part + 1}"
    return base


def anchor_for(node_id: str) -> str:
    """A single non-blank, unique anchor derived from the node id."""
    tail = node_id.split(".", 1)[1] if "." in node_id else node_id
    return f"sec-{_slug(tail)}"


def chunk_to_payload(
    chunk: Chunk,
    *,
    part: int = 0,
    ingested_at: Optional[str] = None,
) -> Dict:
    """Build a WikiNode-shaped dict from a chunk (not yet validated)."""
    nid = node_id_for(chunk.key, part=part)
    stamp = ingested_at or datetime.now(timezone.utc).isoformat()
    metadata: Dict[str, str] = {
        "license": chunk.license.license,
        "ingested_at": stamp,
        "ingest_pipeline": "learning.ingest",
    }
    if chunk.license.attribution:
        metadata["attribution"] = chunk.license.attribution
    metadata.update(chunk.metadata)

    payload = {
        "node_id": nid,
        "version": NODE_VERSION,
        "lang": "en",
        "title": chunk.title,
        "subject": chunk.key.subject,
        "year_group": chunk.key.year_group,
        "topic": chunk.key.topic,
        "subtopic": chunk.key.subtopic,
        "misconception_codes": [],
        "body_markdown": chunk.text,
        "anchors": [anchor_for(nid)],
        "status": "approved",
        "provenance": [
            {
                "source": chunk.license.source_url,
                "rule_id": "ingest",
                "confidence": 1.0,
                "evidence_count": 1,
                "metadata": metadata,
            }
        ],
    }
    return payload


def emit_node(chunk: Chunk, *, part: int = 0, ingested_at: Optional[str] = None) -> WikiNode:
    """Construct and validate a :class:`WikiNode` from a chunk.

    Raises ``pydantic.ValidationError`` if the chunk does not yield a valid node.
    """
    payload = chunk_to_payload(chunk, part=part, ingested_at=ingested_at)
    return WikiNode(**payload)
