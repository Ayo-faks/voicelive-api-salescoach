"""Allowed enums and validators for the learner profile API.

Centralising these here (vs. inlining in ``app.py``) is the Q2 answer from the
plan: exam set lives in config so it can grow without touching route code.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Final, Iterable

ALLOWED_EXAMS: Final[tuple[str, ...]] = (
    "WAEC",
    "NECO",
    "JAMB",
    "Junior WAEC",
    "IGCSE",
    "A-Level",
)

ALLOWED_YEAR_GROUPS: Final[tuple[str, ...]] = (
    "JSS1",
    "JSS2",
    "JSS3",
    "SS1",
    "SS2",
    "SS3",
)

ALLOWED_AGE_BANDS: Final[tuple[str, ...]] = (
    "under-13",
    "13-15",
    "16-17",
    "18-24",
    "25-plus",
)

ALLOWED_CONSENT_KINDS: Final[tuple[str, ...]] = (
    "terms",
    "privacy",
    "ai_notice",
    "career",
    "analytics",
)

# Subset of consent kinds that are mirrored as a boolean on learner_profiles.
PROFILE_CONSENT_MIRRORS: Final[dict[str, str]] = {
    "career": "career_consent",
    "analytics": "analytics_consent",
}

# Consents that must be present for onboarding to count as complete.
REQUIRED_CONSENT_KINDS: Final[tuple[str, ...]] = ("terms", "privacy")

# Fields that must all be populated for ``needs_onboarding`` to flip false.
REQUIRED_PROFILE_FIELDS: Final[tuple[str, ...]] = (
    "display_name",
    "exam",
    "year_group",
    "age_band",
    "locale",
)

# Age bands that classify the registering learner as a minor.
# For these bands the wizard surfaces the guardian contact section.
MINOR_AGE_BANDS: Final[frozenset[str]] = frozenset(("under-13", "13-15", "16-17"))

# Age band for which guardian_email is treated as required on the client
# and triggers a server-side ``needs_onboarding`` extension (see
# ``profile_needs_onboarding``).
GUARDIAN_EMAIL_REQUIRED_BAND: Final[str] = "under-13"

MAX_SUBJECTS: Final[int] = 6
MAX_INTERESTS: Final[int] = 12
MAX_GOALS: Final[int] = 5
MAX_DISPLAY_NAME_LEN: Final[int] = 80
MAX_FREEFORM_LEN: Final[int] = 120

# Coarse pacing buckets for a learner goal. Deliberately not free-form dates:
# the planner only needs a pacing hint ("by this term" tightens the daily plan),
# so a bounded enum keeps the spoken/typed answer trivially mappable.
ALLOWED_GOAL_TIMEFRAMES: Final[tuple[str, ...]] = (
    "this_term",
    "this_year",
    "no_deadline",
)

_BCP47_RE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
# Pragmatic RFC-5322 subset; full grammar is famously not worth implementing.
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_COUNTRY_RE = re.compile(r"^[A-Za-z]{2}$")


def is_valid_locale(value: str) -> bool:
    return bool(_BCP47_RE.match(value or ""))


def is_valid_email(value: str) -> bool:
    return bool(_EMAIL_RE.match(value or "")) and len(value) <= 254


def is_valid_country(value: str) -> bool:
    return bool(_COUNTRY_RE.match(value or ""))


def age_band_from_dob(date_of_birth: str | None, *, today: date | None = None) -> str | None:
    """Map an ISO ``YYYY-MM-DD`` date of birth to an :data:`ALLOWED_AGE_BANDS` value.

    Returns ``None`` when the input is missing, unparseable, or a future date.
    Callers treat ``None`` as "age unknown" and must fail safe (e.g. route the
    safeguarding contact to the admin backstop rather than the learner's own
    inbox).
    """
    if not isinstance(date_of_birth, str):
        return None
    raw = date_of_birth.strip()
    if not raw:
        return None
    try:
        dob = date.fromisoformat(raw[:10])
    except ValueError:
        return None
    reference = today or date.today()
    if dob > reference:
        return None
    age = reference.year - dob.year - (
        (reference.month, reference.day) < (dob.month, dob.day)
    )
    if age < 13:
        return "under-13"
    if age <= 15:
        return "13-15"
    if age <= 17:
        return "16-17"
    if age <= 24:
        return "18-24"
    return "25-plus"


def is_minor_age_band(age_band: str | None) -> bool:
    """True when ``age_band`` denotes a minor (see :data:`MINOR_AGE_BANDS`)."""
    return age_band in MINOR_AGE_BANDS


def _coerce_string_list(value: object, *, limit: int) -> list[str] | None:
    if not isinstance(value, list):
        return None
    if len(value) > limit:
        return None
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            return None
        cleaned = item.strip()
        if not cleaned or len(cleaned) > MAX_FREEFORM_LEN:
            return None
        out.append(cleaned)
    return out


def normalise_subjects(value: object) -> list[str] | None:
    return _coerce_string_list(value, limit=MAX_SUBJECTS)


def normalise_interests(value: object) -> list[str] | None:
    return _coerce_string_list(value, limit=MAX_INTERESTS)


def normalise_goal(value: object) -> dict | None:
    """Validate a single learner goal dict (guided-then-freeform intake).

    Returns the cleaned goal or ``None`` when the shape is invalid. All fields
    are optional individually, but the goal must carry at least one biasing
    signal (``subject``, ``exam``, or ``target_date``) so an empty goal can't be
    stored. ``created_at`` is preserved when present (server stamps it otherwise).
    """
    if not isinstance(value, dict):
        return None
    cleaned: dict = {}

    subject = value.get("subject")
    if subject is not None:
        if not isinstance(subject, str):
            return None
        subject = subject.strip()
        if not subject or len(subject) > MAX_FREEFORM_LEN:
            return None
        cleaned["subject"] = subject

    exam = value.get("exam")
    if exam is not None:
        if not _enum_check(exam, ALLOWED_EXAMS):
            return None
        cleaned["exam"] = exam

    target_date = value.get("target_date")
    if target_date is not None:
        if not _enum_check(target_date, ALLOWED_GOAL_TIMEFRAMES):
            return None
        cleaned["target_date"] = target_date

    note = value.get("note")
    if note is not None:
        if not isinstance(note, str):
            return None
        note = note.strip()
        if not note:
            note = None
        elif len(note) > MAX_FREEFORM_LEN:
            return None
        if note is not None:
            cleaned["note"] = note

    # An empty goal carries no biasing signal — reject it.
    if not any(k in cleaned for k in ("subject", "exam", "target_date")):
        return None

    created_at = value.get("created_at")
    if isinstance(created_at, str) and created_at.strip():
        cleaned["created_at"] = created_at.strip()
    return cleaned


def normalise_goals(value: object) -> list[dict] | None:
    if not isinstance(value, list):
        return None
    if len(value) > MAX_GOALS:
        return None
    out: list[dict] = []
    for item in value:
        goal = normalise_goal(item)
        if goal is None:
            return None
        out.append(goal)
    return out


def _enum_check(value: object, allowed: Iterable[str]) -> bool:
    return isinstance(value, str) and value in allowed


def validate_patch(patch: dict) -> tuple[dict, str | None]:
    """Validate a profile PATCH body.

    Returns ``(cleaned, None)`` on success or ``({}, error_message)`` on
    failure. Only fields actually present in ``patch`` are validated; the
    caller decides which fields are required for "complete" onboarding.
    """
    cleaned: dict = {}

    if "display_name" in patch:
        raw = patch["display_name"]
        if not isinstance(raw, str):
            return {}, "display_name must be a string"
        stripped = raw.strip()
        if not stripped or len(stripped) > MAX_DISPLAY_NAME_LEN:
            return {}, "display_name must be 1..80 chars"
        cleaned["display_name"] = stripped

    if "exam" in patch:
        raw = patch["exam"]
        if raw is None:
            cleaned["exam"] = None
        elif not _enum_check(raw, ALLOWED_EXAMS):
            return {}, f"exam must be one of: {', '.join(ALLOWED_EXAMS)}"
        else:
            cleaned["exam"] = raw

    if "year_group" in patch:
        raw = patch["year_group"]
        if raw is None:
            cleaned["year_group"] = None
        elif not _enum_check(raw, ALLOWED_YEAR_GROUPS):
            return {}, f"year_group must be one of: {', '.join(ALLOWED_YEAR_GROUPS)}"
        else:
            cleaned["year_group"] = raw

    if "age_band" in patch:
        raw = patch["age_band"]
        if raw is None:
            cleaned["age_band"] = None
        elif not _enum_check(raw, ALLOWED_AGE_BANDS):
            return {}, f"age_band must be one of: {', '.join(ALLOWED_AGE_BANDS)}"
        else:
            cleaned["age_band"] = raw

    if "subjects" in patch:
        subjects = normalise_subjects(patch["subjects"])
        if subjects is None:
            return {}, f"subjects must be a list of <= {MAX_SUBJECTS} non-empty strings"
        cleaned["subjects"] = subjects

    if "interests" in patch:
        interests = normalise_interests(patch["interests"])
        if interests is None:
            return {}, f"interests must be a list of <= {MAX_INTERESTS} non-empty strings"
        cleaned["interests"] = interests

    if "goals" in patch:
        goals = normalise_goals(patch["goals"])
        if goals is None:
            return {}, (
                f"goals must be a list of <= {MAX_GOALS} objects, each with at "
                "least one of subject/exam/target_date"
            )
        cleaned["goals"] = goals

    if "locale" in patch:
        raw = patch["locale"]
        if not isinstance(raw, str) or not is_valid_locale(raw):
            return {}, "locale must be a BCP-47 tag (e.g. en-GB)"
        cleaned["locale"] = raw

    if "country" in patch:
        raw = patch["country"]
        if raw is None or raw == "":
            cleaned["country"] = None
        elif not isinstance(raw, str) or not is_valid_country(raw):
            return {}, "country must be a 2-letter ISO code"
        else:
            cleaned["country"] = raw.upper()

    if "guardian_email" in patch:
        raw = patch["guardian_email"]
        if raw is None or raw == "":
            cleaned["guardian_email"] = None
        elif not isinstance(raw, str) or not is_valid_email(raw):
            return {}, "guardian_email must be a valid email address"
        else:
            cleaned["guardian_email"] = raw

    if "guardian_relationship" in patch:
        raw = patch["guardian_relationship"]
        if raw is None or raw == "":
            cleaned["guardian_relationship"] = None
        elif not isinstance(raw, str) or len(raw.strip()) == 0 or len(raw) > MAX_FREEFORM_LEN:
            return {}, "guardian_relationship must be 1..120 chars"
        else:
            cleaned["guardian_relationship"] = raw.strip()

    if "career_consent" in patch:
        raw = patch["career_consent"]
        if not isinstance(raw, bool):
            return {}, "career_consent must be boolean"
        cleaned["career_consent"] = raw

    if "analytics_consent" in patch:
        raw = patch["analytics_consent"]
        if not isinstance(raw, bool):
            return {}, "analytics_consent must be boolean"
        cleaned["analytics_consent"] = raw

    if "tour_seen_at" in patch:
        raw = patch["tour_seen_at"]
        if raw is not None and not isinstance(raw, str):
            return {}, "tour_seen_at must be an ISO-8601 string or null"
        cleaned["tour_seen_at"] = raw

    return cleaned, None


def profile_needs_onboarding(profile: dict | None, latest_consents: dict) -> bool:
    if not profile:
        return True
    for field in REQUIRED_PROFILE_FIELDS:
        value = profile.get(field)
        if value is None or value == "":
            return True
    for kind in REQUIRED_CONSENT_KINDS:
        row = latest_consents.get(kind)
        if not row or not row.get("granted"):
            return True
    # Under-13 learners must supply a guardian email before onboarding
    # is considered complete (mirrors the client-side required gate).
    if profile.get("age_band") == GUARDIAN_EMAIL_REQUIRED_BAND:
        guardian_email = profile.get("guardian_email")
        if not (guardian_email and str(guardian_email).strip()):
            return True
    return False
