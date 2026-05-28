"""Question-bank loaders for the learning bounded context.

W1 ships the Maths JSS3 + SS3 seed (100 items). The bank is dormant unless the
`LEARNING_QUESTION_BANK_V1` kill switch is enabled, and every item is gated by a
pending two-reviewer sign-off marker on its provenance. Surfaces that intend to
serve items from this bank MUST call `load_maths_v1_bank()` and respect the
`promotable_items()` filter — items still under review are never served to
learners.

Observability is intentionally minimal at this layer: this module performs pure
validation against the Pydantic contract. Spans + structured logs are added at
the call site (route handler) so that PII redaction and tenant scope remain the
egress gateway's concern.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Final, List, Tuple

from src.learning.misconceptions import TAXONOMY_VERSION
from src.learning.models import DiagnosticItem


# Kill switch: default OFF in every environment.
QUESTION_BANK_V1_FLAG: Final[str] = "LEARNING_QUESTION_BANK_V1"

_TRUTHY = frozenset({"1", "true", "yes", "on", "enabled"})


def _flag_enabled(name: str) -> bool:
    raw = os.environ.get(name, "")
    return raw.strip().lower() in _TRUTHY


def question_bank_v1_enabled() -> bool:
    """Return True iff the W1 question bank kill switch is enabled."""
    return _flag_enabled(QUESTION_BANK_V1_FLAG)


def _resolve_bank_path(filename: str = "maths_jss3_ss3_v1.json") -> Path:
    module_path = Path(__file__).resolve()
    candidates = (
        module_path.parents[3] / "data" / "question_banks" / filename,
        module_path.parents[2] / "data" / "question_banks" / filename,
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


MATHS_V1_BANK_PATH: Final[Path] = _resolve_bank_path("maths_jss3_ss3_v1.json")
ENGLISH_V1_BANK_PATH: Final[Path] = _resolve_bank_path("english_jss3_ss3_v1.json")


@dataclass(frozen=True)
class QuestionBank:
    bank_id: str
    version: str
    lang: str
    subject: str
    taxonomy_version: str
    year_groups: Tuple[str, ...]
    review_state: str
    items: Tuple[DiagnosticItem, ...]

    def promotable_items(self) -> Tuple[DiagnosticItem, ...]:
        """Items that may be served to learners (reviewer sign-off complete).

        For W1 the bank-level `review_state` is `pending_two_reviewer_signoff`,
        so this returns an empty tuple. Individual items can also opt out via
        their first provenance entry's `metadata.subject_lead_approved` /
        `metadata.safeguarding_reviewed` flags.
        """
        if self.review_state != "approved":
            return ()
        approved: List[DiagnosticItem] = []
        for item in self.items:
            head = item.provenance[0] if item.provenance else None
            if head is None:
                continue
            metadata = head.metadata or {}
            if metadata.get("subject_lead_approved") and metadata.get("safeguarding_reviewed"):
                approved.append(item)
        return tuple(approved)


class QuestionBankUnavailableError(RuntimeError):
    """Raised when callers request the bank while the kill switch is off."""


class QuestionBankIntegrityError(RuntimeError):
    """Raised when the on-disk bank fails contract validation."""


@lru_cache(maxsize=2)
def _load_bank_cached(path_str: str) -> QuestionBank:
    path = Path(path_str)
    if not path.exists():
        raise QuestionBankIntegrityError(f"Question bank not found: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise QuestionBankIntegrityError(f"Invalid JSON in {path}: {exc}") from exc

    declared = payload.get("taxonomy_version")
    if declared != TAXONOMY_VERSION:
        raise QuestionBankIntegrityError(
            f"Bank taxonomy_version {declared!r} does not match runtime {TAXONOMY_VERSION!r}"
        )

    try:
        items = tuple(DiagnosticItem.model_validate(raw) for raw in payload.get("items", ()))
    except Exception as exc:  # Pydantic ValidationError or otherwise
        raise QuestionBankIntegrityError(f"Bank item failed contract validation: {exc}") from exc

    return QuestionBank(
        bank_id=str(payload["bank_id"]),
        version=str(payload["version"]),
        lang=str(payload["lang"]),
        subject=str(payload["subject"]),
        taxonomy_version=declared,
        year_groups=tuple(payload.get("year_groups", ())),
        review_state=str(payload.get("review_state", "pending_two_reviewer_signoff")),
        items=items,
    )


def load_maths_v1_bank(*, require_flag: bool = True) -> QuestionBank:
    """Load the Maths JSS3+SS3 v1 seed bank.

    By default this is gated by `LEARNING_QUESTION_BANK_V1`. Tests and the
    builder set `require_flag=False` to load directly.
    """
    if require_flag and not question_bank_v1_enabled():
        raise QuestionBankUnavailableError(
            f"{QUESTION_BANK_V1_FLAG} is off; W1 bank is not loadable at runtime."
        )
    return _load_bank_cached(str(MATHS_V1_BANK_PATH))


def load_english_v1_bank(*, require_flag: bool = True) -> QuestionBank:
    """Load the English JSS3+SS3 v1 seed bank (W4).

    Same kill switch as the maths bank: both come online together once content
    sign-off completes. The bank is contract-validated at load time.
    """
    if require_flag and not question_bank_v1_enabled():
        raise QuestionBankUnavailableError(
            f"{QUESTION_BANK_V1_FLAG} is off; W4 English bank is not loadable at runtime."
        )
    return _load_bank_cached(str(ENGLISH_V1_BANK_PATH))


def reset_cache() -> None:
    """Test helper: drop the memoised bank so a new path/flag combo re-loads."""
    _load_bank_cached.cache_clear()
