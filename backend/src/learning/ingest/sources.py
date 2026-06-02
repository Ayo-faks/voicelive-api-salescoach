"""Pluggable source loaders for the offline ingestion pipeline.

A *source* yields :class:`RawBlock` records — a unit of source material keyed to
a curriculum-map entry, carrying its license and origin URL so provenance can be
recorded on every emitted node.

Allowed sources (constraint #2 in the build spec):
  * Local clean-room notes authored from the curriculum topic list (CC0 / clean
    room). This is the default working source — :class:`NotesSource`.
  * Openly/CC-licensed material (Siyavula, OpenStax, Simple English Wikipedia
    under CC BY-SA WITH attribution). These would be implemented as subclasses
    of :class:`OfflineFetcherSource`. They run ONLY inside this offline tool and
    are NOT wired into the default build until their license + attribution are
    recorded. None are enabled by default — if a source's license is unclear the
    build must STOP rather than ingest.

Never ingest commercial textbook text (Macmillan, University Press, etc.).
"""
from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional


@dataclass(frozen=True)
class CurriculumKey:
    """Identifies the curriculum-map entry a block teaches."""

    subject: str
    year_group: str
    topic: str
    subtopic: Optional[str] = None


@dataclass(frozen=True)
class LicenseInfo:
    """License + attribution for a piece of source material."""

    license: str          # SPDX-ish id, e.g. "CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0"
    source_url: str       # canonical URL of the source
    attribution: Optional[str] = None  # required for CC-BY / CC-BY-SA reuse

    def is_clear(self) -> bool:
        """True when the license is non-empty and a URL is present."""
        return bool(self.license.strip()) and bool(self.source_url.strip())


@dataclass(frozen=True)
class RawBlock:
    """A unit of source material keyed to a curriculum entry."""

    key: CurriculumKey
    title: str
    text: str
    license: LicenseInfo
    metadata: Dict[str, str] = field(default_factory=dict)


class Source(ABC):
    """Base class for all ingestion sources."""

    @abstractmethod
    def load(self) -> Iterable[RawBlock]:
        """Yield raw blocks. Must not perform network I/O in the request path
        (this whole package is offline/build-time only)."""
        raise NotImplementedError


class NotesSource(Source):
    """Load clean-room authored notes from a notes directory.

    Each note file is JSON of the shape::

        {
          "subject": "maths",
          "license": "CC0-1.0",
          "source_url": "https://nerdc.gov.ng/ (scheme of work topic taxonomy)",
          "attribution": null,
          "notes": [
            {"year_group": "SS3", "topic": "quadratics",
             "subtopic": "factorisation", "title": "...", "body": "..."},
            ...
          ]
        }

    The note ``body`` is clean-room prose authored from the curriculum topic
    list — no copyrighted text. ``subject`` may be overridden per-note.
    """

    def __init__(self, notes_dir: Path, *, only_subject: Optional[str] = None) -> None:
        self._dir = Path(notes_dir)
        self._only_subject = only_subject

    def load(self) -> Iterator[RawBlock]:
        if not self._dir.exists():
            return
        for path in sorted(self._dir.glob("*.json")):
            doc = json.loads(path.read_text(encoding="utf-8"))
            file_subject = doc.get("subject")
            license_info = LicenseInfo(
                license=str(doc.get("license", "")).strip(),
                source_url=str(doc.get("source_url", "")).strip(),
                attribution=doc.get("attribution"),
            )
            if not license_info.is_clear():
                raise ValueError(
                    f"{path.name}: license/source_url missing or unclear — "
                    f"refusing to ingest (got license={license_info.license!r}, "
                    f"url={license_info.source_url!r})"
                )
            notes: List[dict] = doc.get("notes") or []
            for note in notes:
                subject = note.get("subject") or file_subject
                if self._only_subject and subject != self._only_subject:
                    continue
                key = CurriculumKey(
                    subject=subject,
                    year_group=note["year_group"],
                    topic=note["topic"],
                    subtopic=note.get("subtopic"),
                )
                yield RawBlock(
                    key=key,
                    title=note["title"],
                    text=note["body"],
                    license=license_info,
                    metadata={"note_file": path.name},
                )


class OfflineFetcherSource(Source):
    """Base for openly-licensed remote sources (Siyavula / OpenStax / Simple
    English Wikipedia).

    Subclasses fetch and clean-room summarise CC-licensed material *offline* and
    MUST populate :class:`LicenseInfo` with the correct license + attribution
    (CC-BY / CC-BY-SA require attribution). They are intentionally not enabled in
    the default build. Implement + review license before wiring one in.
    """

    def __init__(self, license_info: LicenseInfo) -> None:
        if not license_info.is_clear():
            raise ValueError("OfflineFetcherSource requires a clear license + URL")
        self.license_info = license_info

    @abstractmethod
    def load(self) -> Iterable[RawBlock]:  # pragma: no cover - not enabled by default
        raise NotImplementedError(
            "Enable a concrete CC-licensed fetcher only after its license and "
            "attribution are reviewed and recorded."
        )
