"""Misconception taxonomy v1 for Pathfinder Learn.

The taxonomy is the join key between (question, wrong-answer-cluster, explanation
version, retry outcome). It is intentionally small (20 codes), versioned, and
subject-scoped. Bumping ``TAXONOMY_VERSION`` is a breaking change for any
explanation pinned to a prior version.
"""

from __future__ import annotations

from enum import Enum
from typing import Dict, Final, Tuple

from pydantic import Field

from src.learning.models import ContractModel


TAXONOMY_VERSION: Final[str] = "1.0.0"


class MisconceptionCode(str, Enum):
    """20-code starter taxonomy. Stable identifiers; labels may evolve."""

    CALC_ERROR = "calc_error"
    PREREQUISITE_GAP = "prerequisite_gap"
    UNIT_CONVERSION = "unit_conversion"
    PLACE_VALUE = "place_value"
    SIGN_ERROR = "sign_error"
    FRACTION_PART_WHOLE = "fraction_part_whole"
    RATIO_INVERSION = "ratio_inversion"
    ALGEBRA_DISTRIBUTION = "algebra_distribution"
    ORDER_OF_OPERATIONS = "order_of_operations"
    GEOMETRY_UNITS = "geometry_units"
    PROBABILITY_COMPLEMENT = "probability_complement"
    LANGUAGE_COMPREHENSION = "language_comprehension"
    ANSWER_FORM = "answer_form"
    MISREAD_QUESTION = "misread_question"
    COMPUTATION_SLIP = "computation_slip"
    OFF_BY_ONE = "off_by_one"
    TRANSCRIPTION = "transcription"
    CARELESS = "careless"
    TIME_PRESSURE = "time_pressure"
    OTHER_UNCATEGORISED = "other_uncategorised"


class MisconceptionEntry(ContractModel):
    """Authoritative taxonomy row. Used by validators and the wiki join."""

    code: MisconceptionCode
    label: str = Field(min_length=1)
    description: str = Field(min_length=1)
    subject_scope: Tuple[str, ...] = Field(min_length=1)


_E = MisconceptionEntry
_MATHS = ("maths",)
_ENG = ("english",)
_BOTH = ("maths", "english")


TAXONOMY: Final[Tuple[MisconceptionEntry, ...]] = (
    _E(code=MisconceptionCode.CALC_ERROR, label="Calculation error",
       description="Correct method, arithmetic slip in the working.", subject_scope=_MATHS),
    _E(code=MisconceptionCode.PREREQUISITE_GAP, label="Prerequisite gap",
       description="Missing a foundational skill the question assumes.", subject_scope=_BOTH),
    _E(code=MisconceptionCode.UNIT_CONVERSION, label="Unit conversion",
       description="Mixed or unconverted units (cm/m, mins/hrs, g/kg).", subject_scope=_MATHS),
    _E(code=MisconceptionCode.PLACE_VALUE, label="Place value",
       description="Digit position misread; decimal/place value confusion.", subject_scope=_MATHS),
    _E(code=MisconceptionCode.SIGN_ERROR, label="Sign error",
       description="Dropped/added negative sign in arithmetic or algebra.", subject_scope=_MATHS),
    _E(code=MisconceptionCode.FRACTION_PART_WHOLE, label="Fraction part/whole",
       description="Numerator/denominator confusion or invalid fraction operations.", subject_scope=_MATHS),
    _E(code=MisconceptionCode.RATIO_INVERSION, label="Ratio inversion",
       description="Ratio terms swapped (a:b treated as b:a).", subject_scope=_MATHS),
    _E(code=MisconceptionCode.ALGEBRA_DISTRIBUTION, label="Algebraic distribution",
       description="Failure to distribute over brackets, or distributing across non-distributive ops.", subject_scope=_MATHS),
    _E(code=MisconceptionCode.ORDER_OF_OPERATIONS, label="Order of operations",
       description="BODMAS/PEMDAS misapplied.", subject_scope=_MATHS),
    _E(code=MisconceptionCode.GEOMETRY_UNITS, label="Geometry units",
       description="Mixing linear and area units (cm vs cm^2) or perimeter/area swap.", subject_scope=_MATHS),
    _E(code=MisconceptionCode.PROBABILITY_COMPLEMENT, label="Probability complement",
       description="P(A) vs 1 - P(A) confusion.", subject_scope=_MATHS),
    _E(code=MisconceptionCode.LANGUAGE_COMPREHENSION, label="Language comprehension",
       description="Misread the wording, not the maths/skill.", subject_scope=_BOTH),
    _E(code=MisconceptionCode.ANSWER_FORM, label="Answer form",
       description="Correct value, wrong form (e.g. unsimplified fraction, missing units, wrong tense).", subject_scope=_BOTH),
    _E(code=MisconceptionCode.MISREAD_QUESTION, label="Misread question",
       description="Answered a different question than asked.", subject_scope=_BOTH),
    _E(code=MisconceptionCode.COMPUTATION_SLIP, label="Computation slip",
       description="Single transcribed digit/letter wrong despite correct method.", subject_scope=_BOTH),
    _E(code=MisconceptionCode.OFF_BY_ONE, label="Off-by-one",
       description="Counting boundary error; inclusive vs exclusive range.", subject_scope=_MATHS),
    _E(code=MisconceptionCode.TRANSCRIPTION, label="Transcription error",
       description="Copied the wrong number/word from the prompt into working.", subject_scope=_BOTH),
    _E(code=MisconceptionCode.CARELESS, label="Careless",
       description="Method understood; produced an answer they would self-correct on review.", subject_scope=_BOTH),
    _E(code=MisconceptionCode.TIME_PRESSURE, label="Time pressure",
       description="Pattern consistent with rushing under a clock.", subject_scope=_BOTH),
    _E(code=MisconceptionCode.OTHER_UNCATEGORISED, label="Other / uncategorised",
       description="Reviewer queue: new pattern outside the taxonomy; triggers review.", subject_scope=_BOTH),
)


_BY_CODE: Final[Dict[MisconceptionCode, MisconceptionEntry]] = {
    entry.code: entry for entry in TAXONOMY
}


def get_entry(code: MisconceptionCode) -> MisconceptionEntry:
    return _BY_CODE[code]


def codes_for_subject(subject: str) -> Tuple[MisconceptionCode, ...]:
    return tuple(entry.code for entry in TAXONOMY if subject in entry.subject_scope)


__all__ = [
    "TAXONOMY_VERSION",
    "MisconceptionCode",
    "MisconceptionEntry",
    "TAXONOMY",
    "get_entry",
    "codes_for_subject",
]
