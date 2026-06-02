"""Central curriculum taxonomy: allowed subjects and year groups.

Schema fields (``WikiNode`` / ``DiagnosticItem``) validate subject and year
group against these allowed sets via :func:`validate_subject` and
:func:`validate_year_group`. The sets are open in the sense that adding a new
subject is a one-line change here — not a model edit in lockstep across the
codebase — but still closed enough to reject typos and out-of-curriculum values.

Kept in sync with ``data/learning/curriculum/ng_curriculum_map.json``
(``year_group_vocab`` and the distinct subjects across entries).
"""
from __future__ import annotations

from typing import Optional

# Nigerian junior + senior secondary year groups (JSS1–SS3).
YEAR_GROUPS = (
    "JSS1",
    "JSS2",
    "JSS3",
    "SS1",
    "SS2",
    "SS3",
)

# All WAEC/NECO/JSSCE subjects the corpus may cover. Lower-case snake ids.
SUBJECTS = (
    "maths",
    "english",
    "agricultural_science",
    "biology",
    "chemistry",
    "computer_science",
    "data_processing",
    "economics",
    "government",
    "history",
    "literature",
    "physics",
)

_YEAR_GROUP_SET = frozenset(YEAR_GROUPS)
_SUBJECT_SET = frozenset(SUBJECTS)


def is_valid_subject(value: str) -> bool:
    return value in _SUBJECT_SET


def is_valid_year_group(value: str) -> bool:
    return value in _YEAR_GROUP_SET


def validate_subject(value: str) -> str:
    """Return ``value`` if it is an allowed subject, else raise ``ValueError``."""
    if value not in _SUBJECT_SET:
        raise ValueError(
            f"unknown subject: {value!r} (allowed: {', '.join(SUBJECTS)})"
        )
    return value


def validate_year_group(value: Optional[str]) -> Optional[str]:
    """Return ``value`` if it is an allowed year group or ``None``."""
    if value is None:
        return None
    if value not in _YEAR_GROUP_SET:
        raise ValueError(
            f"unknown year_group: {value!r} (allowed: {', '.join(YEAR_GROUPS)})"
        )
    return value
