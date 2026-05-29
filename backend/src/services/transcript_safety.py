"""Transcript safety: deterministic PII redaction for learner transcripts.

MVP behaviour is provider-pluggable: ship a pure-Python deterministic
redactor that runs everywhere without external creds, and expose a
provider seam so an Azure AI Content Safety / Purview implementation can
replace it later without touching call sites.

Call sites should pass raw transcript text in, and persist only the
``redacted_text`` plus the ``RedactionReport`` metadata. Raw text MUST
NOT be written to durable storage in production.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Mapping, Optional, Protocol, Tuple


# Categories we recognise. Keep the set small and pilot-relevant; richer
# Azure-side categories (e.g. safeguarding, health) plug in via the
# provider seam below.
CATEGORY_EMAIL = "email"
CATEGORY_PHONE = "phone"
CATEGORY_UK_POSTCODE = "uk_postcode"
CATEGORY_NHS_NUMBER = "nhs_number"
CATEGORY_NI_NUMBER = "uk_ni_number"
CATEGORY_URL = "url"
CATEGORY_CHILD_NAME = "child_name"
CATEGORY_GUARDIAN_NAME = "guardian_name"

# Order matters: longer / more specific patterns first so they don't get
# partly eaten by a more permissive rule (e.g. NHS digits matching phone).
_PATTERNS: Tuple[Tuple[str, re.Pattern[str]], ...] = (
    (
        CATEGORY_EMAIL,
        re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    ),
    (
        CATEGORY_URL,
        re.compile(r"\bhttps?://[^\s<>\"')]+", re.IGNORECASE),
    ),
    (
        CATEGORY_NHS_NUMBER,
        # NHS number: 10 digits, conventionally formatted 3-3-4. Match
        # both spaced and unspaced forms.
        re.compile(r"\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b"),
    ),
    (
        CATEGORY_NI_NUMBER,
        # UK National Insurance number, e.g. QQ123456C
        re.compile(
            r"\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b",
            re.IGNORECASE,
        ),
    ),
    (
        CATEGORY_UK_POSTCODE,
        re.compile(
            r"\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b",
            re.IGNORECASE,
        ),
    ),
    (
        CATEGORY_PHONE,
        # UK / international-ish phone numbers. Deliberately conservative
        # to avoid eating ordinary numerals in school content.
        re.compile(
            r"(?<!\d)(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}(?!\d)"
        ),
    ),
)


@dataclass(frozen=True)
class RedactionMatch:
    category: str
    start: int
    end: int
    placeholder: str


@dataclass
class RedactionReport:
    """Structured outcome of a redaction pass.

    ``counts`` is the public summary safe to log/persist; ``matches`` is
    intended for short-lived debugging only.
    """

    redacted_text: str
    counts: Dict[str, int] = field(default_factory=dict)
    matches: List[RedactionMatch] = field(default_factory=list)
    provider: str = "deterministic-v1"

    @property
    def is_clean(self) -> bool:
        return not self.matches

    def to_dict(self) -> Dict[str, object]:
        return {
            "provider": self.provider,
            "counts": dict(self.counts),
            "total_matches": len(self.matches),
        }


class TranscriptSafetyProvider(Protocol):
    """Pluggable provider so Azure AI Content Safety / Purview can swap in."""

    name: str

    def redact(
        self,
        text: str,
        *,
        name_hints: Iterable[str] = (),
    ) -> RedactionReport: ...


def _placeholder(category: str) -> str:
    return f"[REDACTED:{category}]"


def _apply_pattern(
    text: str,
    category: str,
    pattern: re.Pattern[str],
    matches_out: List[RedactionMatch],
) -> str:
    def _sub(match: "re.Match[str]") -> str:
        placeholder = _placeholder(category)
        matches_out.append(
            RedactionMatch(
                category=category,
                start=match.start(),
                end=match.end(),
                placeholder=placeholder,
            )
        )
        return placeholder

    return pattern.sub(_sub, text)


def _redact_name_hints(
    text: str,
    hints: Iterable[str],
    category: str,
    matches_out: List[RedactionMatch],
) -> str:
    seen: set[str] = set()
    result = text
    for hint in hints:
        if not hint:
            continue
        cleaned = hint.strip()
        if len(cleaned) < 2 or cleaned.lower() in seen:
            continue
        seen.add(cleaned.lower())
        # Word boundary, case-insensitive. Names appear as standalone tokens
        # in transcripts; we don't want to redact substrings of unrelated
        # words.
        pattern = re.compile(rf"\b{re.escape(cleaned)}\b", re.IGNORECASE)
        result = _apply_pattern(result, category, pattern, matches_out)
    return result


class DeterministicTranscriptSafetyProvider:
    """Pure-Python redactor. Default provider for MVP and tests."""

    name = "deterministic-v1"

    def redact(
        self,
        text: str,
        *,
        name_hints: Iterable[str] = (),
        guardian_hints: Iterable[str] = (),
    ) -> RedactionReport:
        if not text:
            return RedactionReport(redacted_text="", provider=self.name)

        matches: List[RedactionMatch] = []
        working = text

        # Name hints first so the literal name doesn't survive into a
        # later regex's group (e.g. a phone number adjacent to a name).
        working = _redact_name_hints(working, name_hints, CATEGORY_CHILD_NAME, matches)
        working = _redact_name_hints(
            working, guardian_hints, CATEGORY_GUARDIAN_NAME, matches
        )

        for category, pattern in _PATTERNS:
            working = _apply_pattern(working, category, pattern, matches)

        counts: Dict[str, int] = {}
        for match in matches:
            counts[match.category] = counts.get(match.category, 0) + 1

        return RedactionReport(
            redacted_text=working,
            counts=counts,
            matches=matches,
            provider=self.name,
        )


_DEFAULT_PROVIDER: TranscriptSafetyProvider = DeterministicTranscriptSafetyProvider()


def redact_transcript(
    text: Optional[str],
    *,
    name_hints: Iterable[str] = (),
    guardian_hints: Iterable[str] = (),
    provider: Optional[TranscriptSafetyProvider] = None,
) -> RedactionReport:
    """Public entrypoint. Always returns a ``RedactionReport``."""
    if text is None:
        return RedactionReport(redacted_text="", provider=(provider or _DEFAULT_PROVIDER).name)
    chosen = provider or _DEFAULT_PROVIDER
    # Providers added later (e.g. Azure Content Safety) may not accept the
    # ``guardian_hints`` keyword. Forward only what they understand.
    try:
        return chosen.redact(  # type: ignore[call-arg]
            text,
            name_hints=name_hints,
            guardian_hints=guardian_hints,
        )
    except TypeError:
        return chosen.redact(text, name_hints=name_hints)


def summarise_for_storage(report: RedactionReport) -> Mapping[str, object]:
    """Minimal, durable payload safe to persist alongside a session row."""
    return {
        "provider": report.provider,
        "counts": dict(report.counts),
        "total_matches": len(report.matches),
        "clean": report.is_clean,
    }
