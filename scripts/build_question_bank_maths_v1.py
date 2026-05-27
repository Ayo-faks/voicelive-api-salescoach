"""Builder for the W1 Maths question bank seed (JSS3 + SS3, English-only).

Outputs a structurally-valid 100-item bank tagged against the v1 misconception
taxonomy. Items ship with provenance.metadata.review_state="pending_two_reviewer_signoff"
and are NOT promoted to learners until subject leads sign off (MVP §4.2, R15).

Run:
    python scripts/build_question_bank_maths_v1.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import List

from src.learning.misconceptions import MisconceptionCode, TAXONOMY_VERSION
from src.learning.models import DiagnosticItem, Provenance


REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = REPO_ROOT / "backend" / "data" / "question_banks" / "maths_jss3_ss3_v1.json"


# ---------------------------------------------------------------------------
# Seed authoring tables. Each row: (skill_id, topic, subtopic, prompt, answer,
# difficulty in [-3, 3], misconception codes most likely on a wrong response).
# Codes are the *expected* miscues for incorrect answers, used to seed the
# explanation surface later (W2/W4) — not classifications of the correct one.
# ---------------------------------------------------------------------------

C = MisconceptionCode


JSS3_ITEMS: list[tuple[str, str, str, str, str, float, list[MisconceptionCode]]] = [
    # Number — place value & decimals
    ("jss3.number.place_value", "Number", "Place value",
     "Write 4,072,503 in words.", "four million seventy-two thousand five hundred and three", -2.0,
     [C.PLACE_VALUE, C.TRANSCRIPTION]),
    ("jss3.number.place_value", "Number", "Place value",
     "What is the value of the digit 6 in 360,124?", "60,000", -2.5,
     [C.PLACE_VALUE]),
    ("jss3.number.decimals", "Number", "Decimals",
     "Round 4.5872 to two decimal places.", "4.59", -1.5,
     [C.PLACE_VALUE, C.CARELESS]),
    ("jss3.number.decimals", "Number", "Decimals",
     "Compute 0.6 × 0.4.", "0.24", -1.0,
     [C.PLACE_VALUE, C.CALC_ERROR]),
    ("jss3.number.decimals", "Number", "Decimals",
     "Express 0.125 as a fraction in simplest form.", "1/8", -0.5,
     [C.FRACTION_PART_WHOLE, C.ANSWER_FORM]),
    # Number — fractions
    ("jss3.number.fractions", "Number", "Fractions",
     "Simplify 18/24.", "3/4", -1.5,
     [C.FRACTION_PART_WHOLE, C.ANSWER_FORM]),
    ("jss3.number.fractions", "Number", "Fractions",
     "Compute 2/3 + 1/4.", "11/12", -0.5,
     [C.FRACTION_PART_WHOLE, C.CALC_ERROR]),
    ("jss3.number.fractions", "Number", "Fractions",
     "Compute 5/6 − 1/2.", "1/3", -0.5,
     [C.FRACTION_PART_WHOLE, C.SIGN_ERROR]),
    ("jss3.number.fractions", "Number", "Fractions",
     "Compute 3/4 × 8/9.", "2/3", 0.0,
     [C.FRACTION_PART_WHOLE, C.ANSWER_FORM]),
    ("jss3.number.fractions", "Number", "Fractions",
     "Divide 4/5 by 2/3.", "6/5", 0.5,
     [C.FRACTION_PART_WHOLE, C.MISREAD_QUESTION]),
    # Number — percentages
    ("jss3.number.percentages", "Number", "Percentages",
     "What is 15% of 240?", "36", -1.0,
     [C.CALC_ERROR, C.UNIT_CONVERSION]),
    ("jss3.number.percentages", "Number", "Percentages",
     "A shirt costs ₦4,000. It is discounted by 20%. What is the sale price?", "₦3,200", 0.0,
     [C.LANGUAGE_COMPREHENSION, C.CALC_ERROR]),
    ("jss3.number.percentages", "Number", "Percentages",
     "Express 7/20 as a percentage.", "35%", -1.0,
     [C.FRACTION_PART_WHOLE, C.ANSWER_FORM]),
    ("jss3.number.percentages", "Number", "Percentages",
     "A salary of ₦60,000 is increased by 12%. What is the new salary?", "₦67,200", 0.5,
     [C.CALC_ERROR, C.LANGUAGE_COMPREHENSION]),
    # Number — ratio & proportion
    ("jss3.number.ratio", "Number", "Ratio",
     "Share ₦4,500 in the ratio 2:3.", "₦1,800 and ₦2,700", 0.0,
     [C.RATIO_INVERSION, C.CALC_ERROR]),
    ("jss3.number.ratio", "Number", "Ratio",
     "If 5 pens cost ₦750, how much do 8 pens cost?", "₦1,200", -0.5,
     [C.RATIO_INVERSION, C.LANGUAGE_COMPREHENSION]),
    ("jss3.number.proportion", "Number", "Proportion",
     "If 3 workers build a wall in 12 days, how long for 4 workers (same rate)?", "9 days", 0.5,
     [C.RATIO_INVERSION, C.LANGUAGE_COMPREHENSION]),
    ("jss3.number.proportion", "Number", "Proportion",
     "Convert 72 km/h to m/s.", "20 m/s", 0.5,
     [C.UNIT_CONVERSION, C.CALC_ERROR]),
    # Number — indices basics
    ("jss3.number.indices", "Number", "Indices",
     "Evaluate 2^5.", "32", -2.0,
     [C.CALC_ERROR, C.COMPUTATION_SLIP]),
    ("jss3.number.indices", "Number", "Indices",
     "Simplify 3^4 × 3^2 (leave in index form).", "3^6", -0.5,
     [C.ALGEBRA_DISTRIBUTION, C.ANSWER_FORM]),
    # Algebra — simplification
    ("jss3.algebra.simplification", "Algebra", "Simplification",
     "Simplify 4x + 3 − x + 5.", "3x + 8", -1.0,
     [C.SIGN_ERROR, C.ALGEBRA_DISTRIBUTION]),
    ("jss3.algebra.simplification", "Algebra", "Simplification",
     "Expand 3(2x − 5).", "6x − 15", -0.5,
     [C.ALGEBRA_DISTRIBUTION, C.SIGN_ERROR]),
    ("jss3.algebra.simplification", "Algebra", "Simplification",
     "Expand (x + 2)(x − 3).", "x^2 − x − 6", 0.5,
     [C.ALGEBRA_DISTRIBUTION, C.SIGN_ERROR]),
    # Algebra — linear equations
    ("jss3.algebra.linear", "Algebra", "Linear equations",
     "Solve 3x + 4 = 19.", "x = 5", -1.5,
     [C.SIGN_ERROR, C.ORDER_OF_OPERATIONS]),
    ("jss3.algebra.linear", "Algebra", "Linear equations",
     "Solve 2(x − 3) = 14.", "x = 10", -0.5,
     [C.ALGEBRA_DISTRIBUTION, C.SIGN_ERROR]),
    ("jss3.algebra.linear", "Algebra", "Linear equations",
     "Solve 5x − 7 = 2x + 8.", "x = 5", 0.0,
     [C.SIGN_ERROR, C.ALGEBRA_DISTRIBUTION]),
    ("jss3.algebra.linear", "Algebra", "Linear equations",
     "Solve (x/3) + 2 = 5.", "x = 9", -0.5,
     [C.FRACTION_PART_WHOLE, C.ORDER_OF_OPERATIONS]),
    ("jss3.algebra.linear", "Algebra", "Linear equations",
     "If 4(y − 1) = 2y + 6, find y.", "y = 5", 0.5,
     [C.ALGEBRA_DISTRIBUTION, C.SIGN_ERROR]),
    # Algebra — inequalities
    ("jss3.algebra.inequalities", "Algebra", "Inequalities",
     "Solve 2x − 1 < 7.", "x < 4", 0.0,
     [C.SIGN_ERROR, C.ANSWER_FORM]),
    ("jss3.algebra.inequalities", "Algebra", "Inequalities",
     "Solve −3x ≥ 12.", "x ≤ −4", 0.5,
     [C.SIGN_ERROR, C.ORDER_OF_OPERATIONS]),
    # Geometry — angles
    ("jss3.geometry.angles", "Geometry", "Angles",
     "Two angles on a straight line are x and 110°. Find x.", "70°", -1.5,
     [C.CALC_ERROR, C.GEOMETRY_UNITS]),
    ("jss3.geometry.angles", "Geometry", "Angles",
     "The angles of a triangle are 50°, 60°, and x. Find x.", "70°", -2.0,
     [C.CALC_ERROR, C.LANGUAGE_COMPREHENSION]),
    ("jss3.geometry.angles", "Geometry", "Angles",
     "Find the size of each interior angle of a regular hexagon.", "120°", 0.0,
     [C.PREREQUISITE_GAP, C.CALC_ERROR]),
    # Geometry — perimeter & area
    ("jss3.geometry.area", "Geometry", "Area and perimeter",
     "Find the area of a rectangle with length 8 cm and width 5 cm.", "40 cm^2", -2.0,
     [C.GEOMETRY_UNITS, C.MISREAD_QUESTION]),
    ("jss3.geometry.area", "Geometry", "Area and perimeter",
     "Find the perimeter of a square of side 7 cm.", "28 cm", -2.0,
     [C.GEOMETRY_UNITS, C.CALC_ERROR]),
    ("jss3.geometry.area", "Geometry", "Area and perimeter",
     "Find the area of a triangle with base 10 cm and height 6 cm.", "30 cm^2", -1.0,
     [C.FRACTION_PART_WHOLE, C.GEOMETRY_UNITS]),
    ("jss3.geometry.area", "Geometry", "Area and perimeter",
     "Find the area of a circle of radius 7 cm (π = 22/7).", "154 cm^2", 0.0,
     [C.GEOMETRY_UNITS, C.CALC_ERROR]),
    ("jss3.geometry.area", "Geometry", "Area and perimeter",
     "Find the circumference of a circle of diameter 14 cm (π = 22/7).", "44 cm", 0.0,
     [C.GEOMETRY_UNITS, C.MISREAD_QUESTION]),
    # Geometry — volume
    ("jss3.geometry.volume", "Geometry", "Volume",
     "Find the volume of a cube of side 4 cm.", "64 cm^3", -1.0,
     [C.GEOMETRY_UNITS, C.CALC_ERROR]),
    ("jss3.geometry.volume", "Geometry", "Volume",
     "A cuboid has dimensions 3 cm × 4 cm × 5 cm. Find its volume.", "60 cm^3", -1.0,
     [C.GEOMETRY_UNITS, C.CALC_ERROR]),
    # Mensuration — units
    ("jss3.measurement.units", "Measurement", "Unit conversion",
     "Convert 2.5 km to metres.", "2,500 m", -2.0,
     [C.UNIT_CONVERSION, C.PLACE_VALUE]),
    ("jss3.measurement.units", "Measurement", "Unit conversion",
     "Convert 4,500 g to kilograms.", "4.5 kg", -2.0,
     [C.UNIT_CONVERSION, C.PLACE_VALUE]),
    ("jss3.measurement.units", "Measurement", "Unit conversion",
     "How many minutes are there in 3.25 hours?", "195 minutes", -0.5,
     [C.UNIT_CONVERSION, C.CALC_ERROR]),
    # Statistics
    ("jss3.statistics.mean", "Statistics", "Mean",
     "Find the mean of 4, 7, 9, 10, 5.", "7", -1.5,
     [C.OFF_BY_ONE, C.CALC_ERROR]),
    ("jss3.statistics.median", "Statistics", "Median",
     "Find the median of 3, 7, 1, 9, 5, 4, 8.", "5", -1.0,
     [C.OFF_BY_ONE, C.LANGUAGE_COMPREHENSION]),
    ("jss3.statistics.mode", "Statistics", "Mode",
     "Find the mode of 2, 5, 3, 5, 4, 5, 6.", "5", -2.0,
     [C.LANGUAGE_COMPREHENSION, C.MISREAD_QUESTION]),
    ("jss3.statistics.range", "Statistics", "Range",
     "Find the range of 12, 7, 18, 4, 15.", "14", -1.5,
     [C.OFF_BY_ONE, C.LANGUAGE_COMPREHENSION]),
    # Probability basics
    ("jss3.probability.basic", "Probability", "Single event",
     "A fair die is rolled. What is the probability of getting a 4?", "1/6", -1.5,
     [C.FRACTION_PART_WHOLE, C.PROBABILITY_COMPLEMENT]),
    ("jss3.probability.basic", "Probability", "Single event",
     "A bag has 3 red and 5 blue balls. What is the probability of drawing red?", "3/8", -0.5,
     [C.FRACTION_PART_WHOLE, C.PROBABILITY_COMPLEMENT]),
    ("jss3.probability.basic", "Probability", "Complement",
     "If P(rain) = 0.3, what is P(no rain)?", "0.7", -1.5,
     [C.PROBABILITY_COMPLEMENT, C.SIGN_ERROR]),
]


SS3_ITEMS: list[tuple[str, str, str, str, str, float, list[MisconceptionCode]]] = [
    # Indices, surds, logs
    ("ss3.indices.laws", "Indices", "Laws of indices",
     "Simplify (2^3)^4.", "2^12", 0.0,
     [C.ALGEBRA_DISTRIBUTION, C.ORDER_OF_OPERATIONS]),
    ("ss3.indices.laws", "Indices", "Laws of indices",
     "Evaluate 27^(2/3).", "9", 0.5,
     [C.ORDER_OF_OPERATIONS, C.CALC_ERROR]),
    ("ss3.indices.negative", "Indices", "Negative indices",
     "Evaluate 5^(−2).", "1/25", 0.0,
     [C.SIGN_ERROR, C.FRACTION_PART_WHOLE]),
    ("ss3.surds.simplify", "Surds", "Simplification",
     "Simplify √50.", "5√2", 0.5,
     [C.PREREQUISITE_GAP, C.CALC_ERROR]),
    ("ss3.surds.rationalise", "Surds", "Rationalisation",
     "Rationalise the denominator of 1/(√3).", "√3/3", 1.0,
     [C.ANSWER_FORM, C.PREREQUISITE_GAP]),
    ("ss3.logarithms.basic", "Logarithms", "Definition",
     "Evaluate log₂ 32.", "5", 0.5,
     [C.PREREQUISITE_GAP, C.CALC_ERROR]),
    ("ss3.logarithms.laws", "Logarithms", "Laws",
     "Simplify log 8 + log 125 (base 10).", "3", 1.0,
     [C.ALGEBRA_DISTRIBUTION, C.PREREQUISITE_GAP]),
    ("ss3.logarithms.solve", "Logarithms", "Equations",
     "Solve log₃ (x + 1) = 2.", "x = 8", 1.0,
     [C.SIGN_ERROR, C.PREREQUISITE_GAP]),
    # Quadratics
    ("ss3.quadratics.factor", "Quadratics", "Factorisation",
     "Factorise x^2 − 9.", "(x − 3)(x + 3)", 0.0,
     [C.ALGEBRA_DISTRIBUTION, C.SIGN_ERROR]),
    ("ss3.quadratics.factor", "Quadratics", "Factorisation",
     "Factorise x^2 + 5x + 6.", "(x + 2)(x + 3)", 0.0,
     [C.SIGN_ERROR, C.ALGEBRA_DISTRIBUTION]),
    ("ss3.quadratics.solve", "Quadratics", "Solving",
     "Solve x^2 − 5x + 6 = 0.", "x = 2 or x = 3", 0.5,
     [C.SIGN_ERROR, C.ALGEBRA_DISTRIBUTION]),
    ("ss3.quadratics.formula", "Quadratics", "Quadratic formula",
     "Use the quadratic formula to solve x^2 − 4x + 1 = 0.", "x = 2 ± √3", 1.5,
     [C.SIGN_ERROR, C.PREREQUISITE_GAP]),
    ("ss3.quadratics.discriminant", "Quadratics", "Discriminant",
     "How many real roots does x^2 + x + 1 = 0 have?", "0", 1.5,
     [C.SIGN_ERROR, C.LANGUAGE_COMPREHENSION]),
    # Simultaneous equations
    ("ss3.algebra.simultaneous", "Algebra", "Simultaneous equations",
     "Solve x + y = 7 and 2x − y = 5.", "x = 4, y = 3", 0.5,
     [C.SIGN_ERROR, C.ALGEBRA_DISTRIBUTION]),
    ("ss3.algebra.simultaneous", "Algebra", "Simultaneous equations",
     "Solve 3x + 2y = 12 and x − y = 1.", "x = 14/5, y = 9/5", 1.5,
     [C.ALGEBRA_DISTRIBUTION, C.FRACTION_PART_WHOLE]),
    # Sequences and series
    ("ss3.sequences.ap.nth", "Sequences", "AP nth term",
     "Find the 10th term of the AP 3, 7, 11, ...", "39", 0.5,
     [C.OFF_BY_ONE, C.CALC_ERROR]),
    ("ss3.sequences.ap.sum", "Sequences", "AP sum",
     "Find the sum of the first 20 terms of the AP 2, 5, 8, ...", "590", 1.0,
     [C.OFF_BY_ONE, C.CALC_ERROR]),
    ("ss3.sequences.gp.nth", "Sequences", "GP nth term",
     "Find the 6th term of the GP 2, 6, 18, ...", "486", 1.0,
     [C.OFF_BY_ONE, C.CALC_ERROR]),
    ("ss3.sequences.gp.sum", "Sequences", "GP sum",
     "Find the sum of the first 5 terms of the GP 3, 6, 12, ...", "93", 1.0,
     [C.OFF_BY_ONE, C.CALC_ERROR]),
    ("ss3.sequences.gp.infinite", "Sequences", "Infinite GP",
     "Find the sum to infinity of 8, 4, 2, 1, ...", "16", 1.5,
     [C.PREREQUISITE_GAP, C.FRACTION_PART_WHOLE]),
    # Trigonometry
    ("ss3.trig.right_triangle", "Trigonometry", "Right triangle",
     "In a right triangle, the opposite side is 3 and hypotenuse is 5. Find sin θ.", "3/5", 0.0,
     [C.FRACTION_PART_WHOLE, C.LANGUAGE_COMPREHENSION]),
    ("ss3.trig.exact", "Trigonometry", "Exact values",
     "What is sin 30°?", "1/2", -0.5,
     [C.FRACTION_PART_WHOLE, C.PREREQUISITE_GAP]),
    ("ss3.trig.exact", "Trigonometry", "Exact values",
     "What is cos 60°?", "1/2", -0.5,
     [C.FRACTION_PART_WHOLE, C.PREREQUISITE_GAP]),
    ("ss3.trig.exact", "Trigonometry", "Exact values",
     "What is tan 45°?", "1", -0.5,
     [C.PREREQUISITE_GAP, C.CALC_ERROR]),
    ("ss3.trig.identity", "Trigonometry", "Identities",
     "Simplify sin^2 θ + cos^2 θ.", "1", 0.5,
     [C.PREREQUISITE_GAP, C.ALGEBRA_DISTRIBUTION]),
    ("ss3.trig.sine_rule", "Trigonometry", "Sine rule",
     "In triangle ABC, A = 30°, B = 45°, a = 10. Find b. (Exact form.)", "10√2", 1.5,
     [C.PREREQUISITE_GAP, C.CALC_ERROR]),
    # Coordinate geometry
    ("ss3.coord.distance", "Coordinate geometry", "Distance",
     "Find the distance between (1, 2) and (4, 6).", "5", 0.0,
     [C.SIGN_ERROR, C.CALC_ERROR]),
    ("ss3.coord.midpoint", "Coordinate geometry", "Midpoint",
     "Find the midpoint of (−2, 3) and (4, 7).", "(1, 5)", 0.0,
     [C.SIGN_ERROR, C.CALC_ERROR]),
    ("ss3.coord.gradient", "Coordinate geometry", "Gradient",
     "Find the gradient of the line through (1, 2) and (5, 10).", "2", 0.0,
     [C.SIGN_ERROR, C.RATIO_INVERSION]),
    ("ss3.coord.line", "Coordinate geometry", "Equation of line",
     "Find the equation of the line through (0, 3) with gradient 2.", "y = 2x + 3", 0.5,
     [C.SIGN_ERROR, C.ANSWER_FORM]),
    # Calculus intro
    ("ss3.calc.diff.poly", "Calculus", "Differentiation of polynomials",
     "Differentiate y = 3x^4 with respect to x.", "12x^3", 0.5,
     [C.ALGEBRA_DISTRIBUTION, C.OFF_BY_ONE]),
    ("ss3.calc.diff.poly", "Calculus", "Differentiation of polynomials",
     "Differentiate y = x^3 − 2x^2 + 5x − 1.", "3x^2 − 4x + 5", 1.0,
     [C.SIGN_ERROR, C.OFF_BY_ONE]),
    ("ss3.calc.diff.stationary", "Calculus", "Stationary points",
     "Find the x-coordinate(s) of the stationary point of y = x^2 − 6x + 5.", "x = 3", 1.5,
     [C.SIGN_ERROR, C.ORDER_OF_OPERATIONS]),
    ("ss3.calc.integration.poly", "Calculus", "Indefinite integration",
     "Find ∫ (4x^3) dx.", "x^4 + C", 1.0,
     [C.OFF_BY_ONE, C.ANSWER_FORM]),
    ("ss3.calc.integration.definite", "Calculus", "Definite integration",
     "Evaluate ∫₀¹ (2x) dx.", "1", 1.5,
     [C.OFF_BY_ONE, C.CALC_ERROR]),
    # Probability advanced
    ("ss3.probability.combined", "Probability", "Independent events",
     "P(A) = 1/3, P(B) = 1/2. If independent, find P(A and B).", "1/6", 0.5,
     [C.FRACTION_PART_WHOLE, C.PROBABILITY_COMPLEMENT]),
    ("ss3.probability.combined", "Probability", "Mutually exclusive",
     "P(A) = 0.2, P(B) = 0.5, exclusive. Find P(A or B).", "0.7", 0.5,
     [C.PROBABILITY_COMPLEMENT, C.CALC_ERROR]),
    ("ss3.probability.complement", "Probability", "Complement",
     "If P(passing) = 0.85, what is P(failing)?", "0.15", -0.5,
     [C.PROBABILITY_COMPLEMENT, C.SIGN_ERROR]),
    # Statistics advanced
    ("ss3.statistics.frequency_mean", "Statistics", "Frequency mean",
     "Scores: 2(f=3), 3(f=5), 4(f=2). Find the mean.", "2.9", 1.0,
     [C.FRACTION_PART_WHOLE, C.CALC_ERROR]),
    ("ss3.statistics.std_dev", "Statistics", "Standard deviation",
     "Find the standard deviation of 4, 4, 4, 4. ", "0", 0.0,
     [C.LANGUAGE_COMPREHENSION, C.PREREQUISITE_GAP]),
    ("ss3.statistics.grouped_mean", "Statistics", "Grouped data",
     "Class 1–5 (f=4) and 6–10 (f=6). Estimate the mean using midpoints.", "5.8", 1.5,
     [C.PREREQUISITE_GAP, C.CALC_ERROR]),
    # Variation
    ("ss3.variation.direct", "Variation", "Direct variation",
     "y varies directly as x. y = 12 when x = 4. Find y when x = 7.", "21", 0.5,
     [C.RATIO_INVERSION, C.CALC_ERROR]),
    ("ss3.variation.inverse", "Variation", "Inverse variation",
     "y varies inversely as x. y = 6 when x = 4. Find y when x = 3.", "8", 0.5,
     [C.RATIO_INVERSION, C.FRACTION_PART_WHOLE]),
    # Sets
    ("ss3.sets.union", "Sets", "Union and intersection",
     "If A = {1,2,3,4} and B = {3,4,5,6}, find A ∪ B.", "{1,2,3,4,5,6}", -1.0,
     [C.LANGUAGE_COMPREHENSION, C.MISREAD_QUESTION]),
    ("ss3.sets.union", "Sets", "Union and intersection",
     "If A = {1,2,3,4} and B = {3,4,5,6}, find A ∩ B.", "{3,4}", -1.0,
     [C.LANGUAGE_COMPREHENSION, C.MISREAD_QUESTION]),
    ("ss3.sets.venn", "Sets", "Two-set Venn",
     "In a class of 30, 18 do Maths and 14 do Physics; 6 do both. How many do Maths only?", "12", 1.0,
     [C.LANGUAGE_COMPREHENSION, C.OFF_BY_ONE]),
    # Mensuration advanced
    ("ss3.mensuration.cone", "Mensuration", "Cone",
     "Find the volume of a cone of radius 7 cm, height 9 cm (π = 22/7).", "462 cm^3", 1.5,
     [C.GEOMETRY_UNITS, C.CALC_ERROR]),
    ("ss3.mensuration.sphere", "Mensuration", "Sphere",
     "Find the volume of a sphere of radius 3 cm (π = 22/7). Give answer to 2 d.p.", "113.14 cm^3", 1.5,
     [C.GEOMETRY_UNITS, C.PLACE_VALUE]),
    # Number bases
    ("ss3.numberbases.binary", "Number bases", "Binary",
     "Convert 1101₂ to base 10.", "13", 0.0,
     [C.PLACE_VALUE, C.PREREQUISITE_GAP]),
    ("ss3.numberbases.octal", "Number bases", "Base conversion",
     "Convert 25₁₀ to base 2.", "11001", 0.5,
     [C.PLACE_VALUE, C.PREREQUISITE_GAP]),
]


def _build_items() -> List[DiagnosticItem]:
    rows = [("JSS3", row) for row in JSS3_ITEMS] + [("SS3", row) for row in SS3_ITEMS]
    items: List[DiagnosticItem] = []
    for year_group, (skill_id, topic, subtopic, prompt, answer, diff, codes) in rows:
        index = len(items) + 1
        item_id = f"maths-v1-{year_group.lower()}-{index:03d}"
        items.append(
            DiagnosticItem(
                item_id=item_id,
                skill_id=skill_id,
                prompt=prompt,
                item_type="short_answer",
                difficulty=diff,
                correct_answer=answer,
                subject="maths",
                year_group=year_group,
                topic=topic,
                subtopic=subtopic,
                misconception_codes=[c.value for c in codes],
                taxonomy_version=TAXONOMY_VERSION,
                lang="en",
                provenance=[
                    Provenance(
                        source="seed-author:pathfinder-learn",
                        rule_id="w1_maths_seed_v1",
                        confidence=1.0,
                        evidence_count=0,
                        metadata={
                            "review_state": "pending_two_reviewer_signoff",
                            "subject_lead_approved": False,
                            "safeguarding_reviewed": False,
                        },
                    )
                ],
            )
        )
    return items


def build() -> dict:
    items = _build_items()
    payload = {
        "bank_id": "maths-jss3-ss3-v1",
        "version": "1.0.0",
        "lang": "en",
        "subject": "maths",
        "taxonomy_version": TAXONOMY_VERSION,
        "year_groups": ["JSS3", "SS3"],
        "review_state": "pending_two_reviewer_signoff",
        "items": [item.model_dump(mode="json") for item in items],
    }
    return payload


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = build()
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(payload['items'])} items to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
