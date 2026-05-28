"""Learner-side fullscreen voice + gen-UI planner.

The therapist-side ``insights`` voice path is hard-locked to clinician
roles. Learners need their own fullscreen voice surface that renders
gen-UI cards (questions, MCQ tap targets, explanations) instead of a
text chat. This module owns the *deterministic* brain for that
surface; a future ``/ws/learning-voice`` realtime transport can swap
this planner for a model-backed one without changing the card
contract.

Card vocabulary (v0):

- ``greeting``       — opening message the agent speaks.
- ``mcq-tap``        — multiple-choice question with four tap targets.
- ``explanation``    — short worked example shown after a wrong answer.
- ``progress``       — daily-plan progress pill ("3 of 7 done").
- ``mark-known``     — single-tap confirmation card ("Got it").

The planner is intentionally stateless: the client sends the last
card id plus the learner's answer, the planner returns the next card.
Session state lives client-side so we never trust caller-supplied
``actor_id`` for cross-learner reads.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, FrozenSet, List, Literal, Optional, Tuple, Union
from uuid import uuid4

from pydantic import BaseModel, Field


CardKind = Literal["greeting", "mcq-tap", "explanation", "progress", "mark-known"]

Exam = Literal["WAEC", "NECO", "JAMB", "Junior WAEC"]
ClassYear = Literal["JSS2", "JSS3", "SSS1", "SSS2", "SSS3"]
Subject = Literal["Mathematics", "English Language", "Basic Science"]

# Exams permitted per class band. JAMB is an SSS-leaver exam; Junior WAEC is
# the JSS exit. WAEC and NECO appear at both levels in real Nigerian usage but
# the pilot only models them at the senior tier.
_VALID_EXAMS_FOR_CLASS: Dict[str, FrozenSet[str]] = {
    "JSS2": frozenset({"Junior WAEC"}),
    "JSS3": frozenset({"Junior WAEC"}),
    "SSS1": frozenset({"WAEC", "NECO", "JAMB"}),
    "SSS2": frozenset({"WAEC", "NECO", "JAMB"}),
    "SSS3": frozenset({"WAEC", "NECO", "JAMB"}),
}


class _BaseCard(BaseModel):
    card_id: str = Field(default_factory=lambda: f"lv-card-{uuid4().hex[:10]}")
    kind: CardKind
    speak: str = Field(min_length=1, description="What the agent says out loud.")


class GreetingCard(_BaseCard):
    kind: Literal["greeting"] = "greeting"
    headline: str
    sub: str


class McqOption(BaseModel):
    id: str
    label: str  # e.g. "A"
    text: str


class McqTapCard(_BaseCard):
    kind: Literal["mcq-tap"] = "mcq-tap"
    stem: str
    options: List[McqOption]
    skill_id: Optional[str] = None


class ExplanationCard(_BaseCard):
    kind: Literal["explanation"] = "explanation"
    title: str
    steps: List[str]
    next_action_label: str = "Try the next one"


class ProgressCard(_BaseCard):
    kind: Literal["progress"] = "progress"
    completed: int
    total: int


class MarkKnownCard(_BaseCard):
    kind: Literal["mark-known"] = "mark-known"
    prompt: str
    confirm_label: str = "Got it"


LearnerVoiceCard = Union[
    GreetingCard, McqTapCard, ExplanationCard, ProgressCard, MarkKnownCard
]


class LearnerVoiceTurnRequest(BaseModel):
    """Client -> server turn payload.

    ``child_id`` is required so we can later RLS-scope every read. v0
    ignores it; the field is reserved for the realtime transport.

    ``exam``/``class_year``/``subject`` describe the learner's chosen
    study path so the planner can pick content from the right taxonomy
    bucket. If omitted, the planner falls back to a WAEC SSS2
    Mathematics walkthrough so phase 2.0 demos keep working without
    the home form.
    """

    child_id: str = Field(min_length=1)
    lang: str = "en-NG"
    last_card_id: Optional[str] = None
    last_kind: Optional[CardKind] = None
    answer_option_id: Optional[str] = None  # MCQ choice
    advance: bool = False  # tap-through for non-MCQ cards
    exam: Optional[Exam] = None
    class_year: Optional[ClassYear] = None
    subject: Optional[Subject] = None


class LearnerVoiceTurnResponse(BaseModel):
    card: LearnerVoiceCard
    session_complete: bool = False


# ---------------------------------------------------------------------------
# Deterministic v0 brain — taxonomy-filtered 3-question walk-through.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _ScriptedQuestion:
    exams: FrozenSet[str]  # which exams this item is valid for
    class_year: str
    subject: str
    stem: str
    options: Tuple[McqOption, ...]
    correct_option_id: str
    explanation_title: str
    explanation_steps: Tuple[str, ...]
    skill_id: str


def _opts(*pairs: Tuple[str, str]) -> Tuple[McqOption, ...]:
    return tuple(
        McqOption(id=letter.lower(), label=letter.upper(), text=text)
        for letter, text in pairs
    )


# Tag every item with the exams it legitimately appears in. Junior WAEC ==
# JSS only; WAEC/NECO/JAMB == SSS only. WAEC + NECO share most senior items.
_JSS = frozenset({"Junior WAEC"})
_SSS_NATIONAL = frozenset({"WAEC", "NECO"})  # School-leaving cert
_SSS_ALL = frozenset({"WAEC", "NECO", "JAMB"})  # Includes JAMB UTME


_CONTENT_BANK: Tuple[_ScriptedQuestion, ...] = (
    # ============================ JSS2 ============================
    # --- JSS2 Mathematics (Junior WAEC) ---
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS2", subject="Mathematics",
        stem="If a recipe uses flour to sugar in the ratio 3 : 2 and you use 6 cups of flour, how many cups of sugar do you need?",
        options=_opts(("A", "2 cups"), ("B", "3 cups"), ("C", "4 cups"), ("D", "9 cups")),
        correct_option_id="c",
        explanation_title="Scaling a ratio",
        explanation_steps=(
            "The ratio flour : sugar = 3 : 2.",
            "Multiply both parts by 2 because 6 = 3 x 2.",
            "So sugar = 2 x 2 = 4 cups.",
        ),
        skill_id="ratio-proportion",
    ),
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS2", subject="Mathematics",
        stem="Which fraction is equivalent to 3/4?",
        options=_opts(("A", "2/3"), ("B", "6/8"), ("C", "4/5"), ("D", "9/16")),
        correct_option_id="b",
        explanation_title="Equivalent fractions",
        explanation_steps=(
            "Multiply the top and bottom of 3/4 by the same number.",
            "3 x 2 = 6 and 4 x 2 = 8.",
            "So 3/4 = 6/8.",
        ),
        skill_id="fraction-operations",
    ),
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS2", subject="Mathematics",
        stem="What is 25% of 80?",
        options=_opts(("A", "15"), ("B", "20"), ("C", "25"), ("D", "30")),
        correct_option_id="b",
        explanation_title="Percentage of a number",
        explanation_steps=(
            "25% means 25 out of 100, which is the same as 1/4.",
            "1/4 of 80 = 80 ÷ 4.",
            "So 25% of 80 = 20.",
        ),
        skill_id="percentage-basics",
    ),
    # --- JSS2 English Language (Junior WAEC) ---
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS2", subject="English Language",
        stem="Choose the sentence that uses the correct form of the verb: 'She ___ to school every morning.'",
        options=_opts(("A", "go"), ("B", "going"), ("C", "goes"), ("D", "gone")),
        correct_option_id="c",
        explanation_title="Subject-verb agreement",
        explanation_steps=(
            "The subject 'She' is third-person singular.",
            "Third-person singular verbs in the present tense take an -s.",
            "So 'She goes' is correct.",
        ),
        skill_id="subject-verb-agreement",
    ),
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS2", subject="English Language",
        stem="Which word is a synonym of 'happy'?",
        options=_opts(("A", "sad"), ("B", "tired"), ("C", "joyful"), ("D", "angry")),
        correct_option_id="c",
        explanation_title="Synonyms",
        explanation_steps=(
            "A synonym is a word with the same or similar meaning.",
            "'Joyful' carries the same meaning as 'happy'.",
            "So joyful is the synonym.",
        ),
        skill_id="vocabulary-synonyms",
    ),
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS2", subject="English Language",
        stem="Which sentence shows that the writer is making an inference?",
        options=_opts(
            ("A", "The text says the boy was tired."),
            ("B", "The text suggests the boy walked far because his shoes were muddy."),
            ("C", "The text lists the boy's chores."),
            ("D", "The text names the boy."),
        ),
        correct_option_id="b",
        explanation_title="Reading inference",
        explanation_steps=(
            "An inference combines stated facts with a sensible conclusion.",
            "The muddy shoes are a clue; the conclusion is the long walk.",
            "Option B does both, so it is the inference.",
        ),
        skill_id="reading-inference",
    ),
    # --- JSS2 Basic Science (Junior WAEC) ---
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS2", subject="Basic Science",
        stem="Which of these is a renewable source of energy?",
        options=_opts(("A", "Coal"), ("B", "Solar"), ("C", "Petrol"), ("D", "Natural gas")),
        correct_option_id="b",
        explanation_title="Renewable vs non-renewable",
        explanation_steps=(
            "Renewable sources naturally refill on a human timescale.",
            "Sunlight is replenished every day.",
            "So solar is the renewable source.",
        ),
        skill_id="energy-sources",
    ),
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS2", subject="Basic Science",
        stem="The process by which green plants make their own food is called",
        options=_opts(("A", "respiration"), ("B", "photosynthesis"), ("C", "digestion"), ("D", "excretion")),
        correct_option_id="b",
        explanation_title="How plants feed",
        explanation_steps=(
            "Green plants use sunlight, water, and carbon dioxide.",
            "They turn these into glucose inside their leaves.",
            "That process is called photosynthesis.",
        ),
        skill_id="photosynthesis",
    ),
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS2", subject="Basic Science",
        stem="Which state of matter has a fixed volume but no fixed shape?",
        options=_opts(("A", "Solid"), ("B", "Liquid"), ("C", "Gas"), ("D", "Plasma")),
        correct_option_id="b",
        explanation_title="States of matter",
        explanation_steps=(
            "Solids keep both shape and volume.",
            "Gases fill any container, changing both.",
            "Liquids keep volume but take the container's shape.",
        ),
        skill_id="states-of-matter",
    ),
    # ============================ JSS3 ============================
    # --- JSS3 Mathematics (Junior WAEC) ---
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS3", subject="Mathematics",
        stem="Solve for x: 2x + 5 = 13.",
        options=_opts(("A", "3"), ("B", "4"), ("C", "5"), ("D", "9")),
        correct_option_id="b",
        explanation_title="One-step linear equation",
        explanation_steps=(
            "Subtract 5 from both sides: 2x = 8.",
            "Divide both sides by 2: x = 4.",
            "Check: 2(4) + 5 = 13. ✓",
        ),
        skill_id="linear-equations",
    ),
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS3", subject="Mathematics",
        stem="The angles in a triangle add up to how many degrees?",
        options=_opts(("A", "90°"), ("B", "180°"), ("C", "270°"), ("D", "360°")),
        correct_option_id="b",
        explanation_title="Triangle angle sum",
        explanation_steps=(
            "Every triangle's interior angles total the same amount.",
            "That total is 180°.",
            "So the missing angle = 180° minus the other two.",
        ),
        skill_id="triangle-angles",
    ),
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS3", subject="Mathematics",
        stem="Find the simple interest on ₦20,000 for 2 years at 5% per annum.",
        options=_opts(("A", "₦1,000"), ("B", "₦2,000"), ("C", "₦5,000"), ("D", "₦10,000")),
        correct_option_id="b",
        explanation_title="Simple interest",
        explanation_steps=(
            "Simple interest = (P × R × T) / 100.",
            "= (20,000 × 5 × 2) / 100.",
            "= 200,000 / 100 = ₦2,000.",
        ),
        skill_id="simple-interest",
    ),
    # --- JSS3 English Language (Junior WAEC) ---
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS3", subject="English Language",
        stem="Identify the noun in the sentence: 'The honest boy returned the wallet.'",
        options=_opts(("A", "honest"), ("B", "boy"), ("C", "returned"), ("D", "the")),
        correct_option_id="b",
        explanation_title="Spotting a noun",
        explanation_steps=(
            "A noun names a person, place, or thing.",
            "'Boy' names a person.",
            "'Honest' is an adjective; 'returned' is a verb.",
        ),
        skill_id="parts-of-speech",
    ),
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS3", subject="English Language",
        stem="Which option is the correct plural of 'child'?",
        options=_opts(("A", "childs"), ("B", "childes"), ("C", "children"), ("D", "childrens")),
        correct_option_id="c",
        explanation_title="Irregular plurals",
        explanation_steps=(
            "Most English nouns add -s for the plural.",
            "'Child' is irregular and changes form completely.",
            "Its plural is 'children'.",
        ),
        skill_id="plurals",
    ),
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS3", subject="English Language",
        stem="Choose the option closest in meaning to 'reluctant'.",
        options=_opts(("A", "eager"), ("B", "unwilling"), ("C", "confident"), ("D", "loud")),
        correct_option_id="b",
        explanation_title="Reading vocabulary",
        explanation_steps=(
            "'Reluctant' describes someone who hesitates to act.",
            "Someone unwilling also hesitates.",
            "So 'unwilling' is the closest match.",
        ),
        skill_id="vocabulary-context",
    ),
    # --- JSS3 Basic Science (Junior WAEC) ---
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS3", subject="Basic Science",
        stem="Which gas do humans breathe in to stay alive?",
        options=_opts(("A", "Carbon dioxide"), ("B", "Oxygen"), ("C", "Nitrogen"), ("D", "Hydrogen")),
        correct_option_id="b",
        explanation_title="Breathing",
        explanation_steps=(
            "When we inhale, the lungs absorb a gas the blood carries to cells.",
            "That gas is oxygen.",
            "We exhale carbon dioxide as the waste gas.",
        ),
        skill_id="human-respiration",
    ),
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS3", subject="Basic Science",
        stem="A magnet's two ends are called its",
        options=_opts(("A", "axes"), ("B", "poles"), ("C", "currents"), ("D", "circuits")),
        correct_option_id="b",
        explanation_title="Magnetism basics",
        explanation_steps=(
            "Every magnet has a north end and a south end.",
            "These are called magnetic poles.",
            "Like poles repel and unlike poles attract.",
        ),
        skill_id="magnetism",
    ),
    _ScriptedQuestion(
        exams=_JSS, class_year="JSS3", subject="Basic Science",
        stem="Which of these foods is the best source of protein?",
        options=_opts(("A", "Bread"), ("B", "Beans"), ("C", "Sugar"), ("D", "Butter")),
        correct_option_id="b",
        explanation_title="Food nutrients",
        explanation_steps=(
            "Carbohydrate-rich foods include bread and rice.",
            "Fat-rich foods include butter and oil.",
            "Beans are a strong plant source of protein.",
        ),
        skill_id="food-nutrients",
    ),
    # ============================ SSS1 ============================
    # --- SSS1 Mathematics (WAEC/NECO/JAMB) ---
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS1", subject="Mathematics",
        stem="Solve the quadratic equation x² - 5x + 6 = 0.",
        options=_opts(("A", "x = 1 or 6"), ("B", "x = 2 or 3"), ("C", "x = -2 or -3"), ("D", "x = 0 or 5")),
        correct_option_id="b",
        explanation_title="Factoring a quadratic",
        explanation_steps=(
            "Find two numbers that multiply to 6 and add to -5: -2 and -3.",
            "Factor: (x - 2)(x - 3) = 0.",
            "So x = 2 or x = 3.",
        ),
        skill_id="quadratic-equations",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS1", subject="Mathematics",
        stem="If log₁₀ 2 = 0.301, find log₁₀ 8.",
        options=_opts(("A", "0.602"), ("B", "0.903"), ("C", "1.204"), ("D", "2.408")),
        correct_option_id="b",
        explanation_title="Logarithm rules",
        explanation_steps=(
            "log₁₀ 8 = log₁₀ 2³.",
            "= 3 × log₁₀ 2.",
            "= 3 × 0.301 = 0.903.",
        ),
        skill_id="logarithms",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS1", subject="Mathematics",
        stem="The set A = {2, 4, 6, 8} and B = {1, 2, 3, 4}. Find A ∩ B.",
        options=_opts(("A", "{2}"), ("B", "{4}"), ("C", "{2, 4}"), ("D", "{1, 3}")),
        correct_option_id="c",
        explanation_title="Set intersection",
        explanation_steps=(
            "A ∩ B is the set of elements in both A and B.",
            "2 is in A and B; 4 is in A and B.",
            "So A ∩ B = {2, 4}.",
        ),
        skill_id="set-theory",
    ),
    # --- SSS1 English Language ---
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS1", subject="English Language",
        stem="Choose the option that best replaces the underlined word: 'The athlete's *meticulous* preparation paid off.'",
        options=_opts(("A", "careless"), ("B", "thorough"), ("C", "quick"), ("D", "noisy")),
        correct_option_id="b",
        explanation_title="Lexis in context",
        explanation_steps=(
            "'Meticulous' means showing great attention to detail.",
            "'Thorough' carries the same idea of completeness.",
            "So 'thorough' is the best match.",
        ),
        skill_id="lexis-context",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS1", subject="English Language",
        stem="Identify the figure of speech: 'Her smile was a ray of sunshine.'",
        options=_opts(("A", "Simile"), ("B", "Metaphor"), ("C", "Onomatopoeia"), ("D", "Hyperbole")),
        correct_option_id="b",
        explanation_title="Figures of speech",
        explanation_steps=(
            "Similes use 'like' or 'as'; this sentence uses neither.",
            "It says the smile *is* a ray, equating two unlike things directly.",
            "That direct comparison is a metaphor.",
        ),
        skill_id="figures-of-speech",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS1", subject="English Language",
        stem="Pick the option with the correct punctuation: ",
        options=_opts(
            ("A", "He asked, where are you going."),
            ("B", "He asked, 'Where are you going?'"),
            ("C", "He asked Where are you going?"),
            ("D", "'He asked where are you going.'"),
        ),
        correct_option_id="b",
        explanation_title="Direct speech punctuation",
        explanation_steps=(
            "A direct question needs quotation marks around the spoken words.",
            "The first word inside the quotation is capitalised.",
            "And a question mark closes the quoted question.",
        ),
        skill_id="punctuation",
    ),
    # --- SSS1 Basic Science ---
    # Senior tier renames this to "Basic Science / Integrated Science" in some
    # syllabi. The pilot keeps the JSS label.
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS1", subject="Basic Science",
        stem="The chemical symbol for sodium is",
        options=_opts(("A", "S"), ("B", "So"), ("C", "Na"), ("D", "N")),
        correct_option_id="c",
        explanation_title="Chemical symbols",
        explanation_steps=(
            "Many element symbols come from their Latin names.",
            "Sodium's Latin name is 'natrium'.",
            "So its symbol is Na.",
        ),
        skill_id="chemical-symbols",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS1", subject="Basic Science",
        stem="Which organelle is known as the powerhouse of the cell?",
        options=_opts(("A", "Nucleus"), ("B", "Ribosome"), ("C", "Mitochondrion"), ("D", "Lysosome")),
        correct_option_id="c",
        explanation_title="Cell organelles",
        explanation_steps=(
            "The nucleus stores DNA; ribosomes build proteins.",
            "Mitochondria release energy by respiration.",
            "That energy role earned them the 'powerhouse' nickname.",
        ),
        skill_id="cell-biology",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS1", subject="Basic Science",
        stem="Which law states that pressure of a fixed mass of gas is inversely proportional to its volume at constant temperature?",
        options=_opts(("A", "Charles' Law"), ("B", "Boyle's Law"), ("C", "Newton's Law"), ("D", "Ohm's Law")),
        correct_option_id="b",
        explanation_title="Gas laws",
        explanation_steps=(
            "Charles' Law relates volume and temperature.",
            "Newton's and Ohm's Laws are about motion and current, not gases.",
            "Pressure × Volume = constant is Boyle's Law.",
        ),
        skill_id="gas-laws",
    ),
    # ============================ SSS2 ============================
    # --- SSS2 Mathematics ---
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS2", subject="Mathematics",
        stem="Differentiate y = 3x² + 4x with respect to x.",
        options=_opts(("A", "3x + 4"), ("B", "6x + 4"), ("C", "6x"), ("D", "x² + 4")),
        correct_option_id="b",
        explanation_title="Basic differentiation",
        explanation_steps=(
            "Apply the power rule: d/dx (xⁿ) = n·xⁿ⁻¹.",
            "d/dx (3x²) = 6x; d/dx (4x) = 4.",
            "So dy/dx = 6x + 4.",
        ),
        skill_id="differentiation",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS2", subject="Mathematics",
        stem="In a right-angled triangle, the side opposite the 30° angle is 5 cm. Find the hypotenuse.",
        options=_opts(("A", "5 cm"), ("B", "10 cm"), ("C", "15 cm"), ("D", "20 cm")),
        correct_option_id="b",
        explanation_title="Trigonometric ratios",
        explanation_steps=(
            "sin 30° = opposite / hypotenuse.",
            "sin 30° = 1/2, so 1/2 = 5 / hypotenuse.",
            "Hypotenuse = 10 cm.",
        ),
        skill_id="trigonometry",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS2", subject="Mathematics",
        stem="The mean of 5, 8, 10, 12, and 15 is",
        options=_opts(("A", "8"), ("B", "10"), ("C", "12"), ("D", "50")),
        correct_option_id="b",
        explanation_title="Mean of a data set",
        explanation_steps=(
            "Add all the values: 5 + 8 + 10 + 12 + 15 = 50.",
            "Divide by how many values there are: 50 / 5.",
            "Mean = 10.",
        ),
        skill_id="statistics-mean",
    ),
    # --- SSS2 English Language ---
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS2", subject="English Language",
        stem="Choose the option nearest in meaning to *ubiquitous*.",
        options=_opts(("A", "rare"), ("B", "present everywhere"), ("C", "expensive"), ("D", "small")),
        correct_option_id="b",
        explanation_title="Advanced lexis",
        explanation_steps=(
            "'Ubiquitous' describes something found in many places at once.",
            "'Present everywhere' captures that exact idea.",
            "So option B is the answer.",
        ),
        skill_id="advanced-lexis",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS2", subject="English Language",
        stem="Convert to indirect speech: She said, 'I will travel tomorrow.'",
        options=_opts(
            ("A", "She said she will travel tomorrow."),
            ("B", "She said she would travel the next day."),
            ("C", "She says she travelled yesterday."),
            ("D", "She said I will travel tomorrow."),
        ),
        correct_option_id="b",
        explanation_title="Reported speech rules",
        explanation_steps=(
            "Backshift the reporting verb 'said' → past affects the inner tense.",
            "'Will' becomes 'would' in reported speech.",
            "'Tomorrow' becomes 'the next day'.",
        ),
        skill_id="reported-speech",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS2", subject="English Language",
        stem="Pick the sentence that contains a dangling modifier.",
        options=_opts(
            ("A", "Walking to school, the rain began to fall."),
            ("B", "Walking to school, I felt the rain begin to fall."),
            ("C", "While I was walking to school, the rain began to fall."),
            ("D", "The rain began to fall while I walked to school."),
        ),
        correct_option_id="a",
        explanation_title="Dangling modifiers",
        explanation_steps=(
            "The opening phrase must describe the sentence's subject.",
            "In option A the subject is 'the rain', not the walker.",
            "That mismatch makes the modifier dangle.",
        ),
        skill_id="modifier-clarity",
    ),
    # --- SSS2 Basic Science ---
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS2", subject="Basic Science",
        stem="Ohm's Law states that V = I × R. If a current of 2 A flows through a 5 Ω resistor, what is the voltage?",
        options=_opts(("A", "2.5 V"), ("B", "7 V"), ("C", "10 V"), ("D", "25 V")),
        correct_option_id="c",
        explanation_title="Ohm's Law",
        explanation_steps=(
            "V = I × R is the working formula.",
            "Substitute I = 2 A and R = 5 Ω: V = 2 × 5.",
            "So V = 10 volts.",
        ),
        skill_id="ohms-law",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS2", subject="Basic Science",
        stem="The pH of pure water at 25°C is approximately",
        options=_opts(("A", "0"), ("B", "1"), ("C", "7"), ("D", "14")),
        correct_option_id="c",
        explanation_title="Acidity and pH",
        explanation_steps=(
            "pH 0 is strongly acidic; pH 14 is strongly alkaline.",
            "Pure water is neutral, sitting between the two extremes.",
            "That neutral value is pH 7.",
        ),
        skill_id="ph-scale",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS2", subject="Basic Science",
        stem="The process by which a liquid changes to a gas at any temperature is called",
        options=_opts(("A", "Boiling"), ("B", "Melting"), ("C", "Evaporation"), ("D", "Condensation")),
        correct_option_id="c",
        explanation_title="State changes",
        explanation_steps=(
            "Boiling needs a specific temperature (the boiling point).",
            "Evaporation happens at any temperature, from the surface.",
            "So the everyday change is called evaporation.",
        ),
        skill_id="state-changes",
    ),
    # ============================ SSS3 ============================
    # --- SSS3 Mathematics ---
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS3", subject="Mathematics",
        stem="Evaluate ∫ (2x + 3) dx.",
        options=_opts(("A", "x² + 3x + C"), ("B", "2x² + 3x + C"), ("C", "x² + 3 + C"), ("D", "2x + C")),
        correct_option_id="a",
        explanation_title="Indefinite integration",
        explanation_steps=(
            "Integrate term by term: ∫ 2x dx = x².",
            "∫ 3 dx = 3x.",
            "Add the constant of integration: x² + 3x + C.",
        ),
        skill_id="integration",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS3", subject="Mathematics",
        stem="Find the probability of getting an even number when a fair die is rolled once.",
        options=_opts(("A", "1/6"), ("B", "1/3"), ("C", "1/2"), ("D", "2/3")),
        correct_option_id="c",
        explanation_title="Basic probability",
        explanation_steps=(
            "A fair die has 6 equally likely outcomes: 1–6.",
            "Even outcomes are 2, 4, 6 — that's 3 of them.",
            "Probability = 3/6 = 1/2.",
        ),
        skill_id="probability",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS3", subject="Mathematics",
        stem="The nth term of the sequence 3, 7, 11, 15, … is",
        options=_opts(("A", "n + 3"), ("B", "3n"), ("C", "4n - 1"), ("D", "4n + 3")),
        correct_option_id="c",
        explanation_title="Arithmetic progression",
        explanation_steps=(
            "First term a = 3; common difference d = 4.",
            "nth term = a + (n - 1)d = 3 + (n - 1)·4.",
            "Simplify: 3 + 4n - 4 = 4n - 1.",
        ),
        skill_id="arithmetic-progression",
    ),
    # --- SSS3 English Language ---
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS3", subject="English Language",
        stem="Choose the option opposite in meaning to *frugal*.",
        options=_opts(("A", "wasteful"), ("B", "thrifty"), ("C", "careful"), ("D", "honest")),
        correct_option_id="a",
        explanation_title="Antonyms",
        explanation_steps=(
            "'Frugal' means careful with money or resources.",
            "An antonym is a word with the opposite meaning.",
            "'Wasteful' is the direct opposite of frugal.",
        ),
        skill_id="antonyms",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS3", subject="English Language",
        stem="Identify the type of clause in *italics*: 'The book *that you lent me* is interesting.'",
        options=_opts(("A", "Noun clause"), ("B", "Adjective clause"), ("C", "Adverbial clause"), ("D", "Independent clause")),
        correct_option_id="b",
        explanation_title="Types of subordinate clauses",
        explanation_steps=(
            "The italicised clause describes the noun 'book'.",
            "Clauses that modify a noun act like adjectives.",
            "So it is an adjective (relative) clause.",
        ),
        skill_id="clause-types",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS3", subject="English Language",
        stem="Which sentence is in the passive voice?",
        options=_opts(
            ("A", "The chef cooked the meal."),
            ("B", "The meal was cooked by the chef."),
            ("C", "The chef is cooking the meal."),
            ("D", "The chef will cook the meal."),
        ),
        correct_option_id="b",
        explanation_title="Active vs passive voice",
        explanation_steps=(
            "In passive voice the subject receives the action.",
            "'The meal' is acted upon; the doer comes after 'by'.",
            "So option B is passive.",
        ),
        skill_id="active-passive-voice",
    ),
    # --- SSS3 Basic Science ---
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS3", subject="Basic Science",
        stem="DNA stands for",
        options=_opts(
            ("A", "Diribonucleic acid"),
            ("B", "Deoxyribonucleic acid"),
            ("C", "Dinitric acid"),
            ("D", "Double nucleotide acid"),
        ),
        correct_option_id="b",
        explanation_title="Molecules of life",
        explanation_steps=(
            "DNA is the molecule that carries genetic information.",
            "The 'D' stands for deoxyribose, a 5-carbon sugar.",
            "So DNA = Deoxyribonucleic acid.",
        ),
        skill_id="genetics",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS3", subject="Basic Science",
        stem="Which of these is *not* a greenhouse gas?",
        options=_opts(("A", "Carbon dioxide"), ("B", "Methane"), ("C", "Water vapour"), ("D", "Oxygen")),
        correct_option_id="d",
        explanation_title="Greenhouse gases",
        explanation_steps=(
            "Greenhouse gases trap heat in the atmosphere.",
            "CO₂, methane, and water vapour all do this.",
            "Oxygen does not absorb infrared significantly, so it is excluded.",
        ),
        skill_id="climate-science",
    ),
    _ScriptedQuestion(
        exams=_SSS_ALL, class_year="SSS3", subject="Basic Science",
        stem="The SI unit of force is the",
        options=_opts(("A", "joule"), ("B", "watt"), ("C", "newton"), ("D", "pascal")),
        correct_option_id="c",
        explanation_title="SI units",
        explanation_steps=(
            "Joule is the unit of energy; watt is the unit of power.",
            "Pascal is the unit of pressure.",
            "Force is measured in newtons (N).",
        ),
        skill_id="si-units",
    ),
)


# Default taxonomy used when the client doesn't yet send exam/class/subject —
# this matches what the home form pre-selects so phase 2.0 demos remain
# deterministic.
_DEFAULT_EXAM: str = "WAEC"
_DEFAULT_CLASS_YEAR: str = "SSS2"
_DEFAULT_SUBJECT: str = "Mathematics"


def _filter_bank(
    bank: Tuple[_ScriptedQuestion, ...],
    *,
    exam: str,
    class_year: str,
    subject: str,
) -> List[_ScriptedQuestion]:
    return [
        q
        for q in bank
        if q.class_year == class_year and q.subject == subject and exam in q.exams
    ]


class LearnerVoiceTurnPlanner:
    """Deterministic turn planner used by the fullscreen voice surface.

    Picks up to three taxonomy-matched questions from ``_CONTENT_BANK`` for
    the learner's chosen ``(exam, class_year, subject)``. When the request
    omits any of those, the planner falls back to ``WAEC SSS2 Mathematics``
    so demos and tests keep their deterministic walk. When a combination has
    no content yet (e.g. ``JAMB JSS2``), the planner returns a single
    ``mark-known`` card explaining what to do instead — no cross-subject
    leakage.
    """

    MAX_QUESTIONS: int = 3

    def __init__(self, bank: Optional[Tuple[_ScriptedQuestion, ...]] = None) -> None:
        self._bank = tuple(bank) if bank is not None else _CONTENT_BANK
        # Per-session walkthrough cache keyed by the resolved taxonomy so the
        # planner can map a ``last_card_id`` back to its question index.
        self._sessions: Dict[Tuple[str, str, str], List[_ScriptedQuestion]] = {}
        self._index_by_card: Dict[str, Tuple[Tuple[str, str, str], int]] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def next_turn(self, request: LearnerVoiceTurnRequest) -> LearnerVoiceTurnResponse:
        taxonomy = self._resolve_taxonomy(request)
        invalid_card = self._validate_taxonomy(taxonomy)
        if invalid_card is not None:
            return LearnerVoiceTurnResponse(card=invalid_card)

        walkthrough = self._walkthrough_for(taxonomy)
        if not walkthrough:
            return LearnerVoiceTurnResponse(card=self._no_content_card(taxonomy))

        total = len(walkthrough)

        # Opening turn: no prior card -> greet + Q1.
        if request.last_card_id is None or request.last_kind is None:
            return self._present_question(
                taxonomy=taxonomy, walkthrough=walkthrough, index=0, prefix_greeting=True, total=total,
            )

        prev_lookup = self._index_by_card.get(request.last_card_id)
        prev_index: Optional[int] = (
            prev_lookup[1] if prev_lookup is not None and prev_lookup[0] == taxonomy else None
        )

        if request.last_kind == "greeting":
            return self._present_question(
                taxonomy=taxonomy, walkthrough=walkthrough, index=0, prefix_greeting=False, total=total,
            )

        if request.last_kind == "mcq-tap":
            if prev_index is None:
                return self._present_question(
                    taxonomy=taxonomy, walkthrough=walkthrough, index=0, prefix_greeting=False, total=total,
                )
            question = walkthrough[prev_index]
            if request.answer_option_id == question.correct_option_id:
                next_index = prev_index + 1
                if next_index >= total:
                    return LearnerVoiceTurnResponse(
                        card=ProgressCard(
                            speak="Nice work — you finished today's quick check.",
                            completed=total,
                            total=total,
                        ),
                        session_complete=True,
                    )
                return self._present_question(
                    taxonomy=taxonomy, walkthrough=walkthrough, index=next_index, prefix_greeting=False, total=total,
                )
            # Wrong answer -> show the worked example for this question.
            card = ExplanationCard(
                speak=(
                    f"Not quite — let me walk you through it. "
                    f"{question.explanation_title}."
                ),
                title=question.explanation_title,
                steps=list(question.explanation_steps),
            )
            self._index_by_card[card.card_id] = (taxonomy, prev_index)
            return LearnerVoiceTurnResponse(card=card)

        if request.last_kind == "explanation":
            if prev_index is None:
                return self._present_question(
                    taxonomy=taxonomy, walkthrough=walkthrough, index=0, prefix_greeting=False, total=total,
                )
            next_index = prev_index + 1
            if next_index >= total:
                return LearnerVoiceTurnResponse(
                    card=ProgressCard(
                        speak="That's the end of today's check — good effort.",
                        completed=total,
                        total=total,
                    ),
                    session_complete=True,
                )
            return self._present_question(
                taxonomy=taxonomy, walkthrough=walkthrough, index=next_index, prefix_greeting=False, total=total,
            )

        # Fallback: re-greet.
        return self._present_question(
            taxonomy=taxonomy, walkthrough=walkthrough, index=0, prefix_greeting=True, total=total,
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _resolve_taxonomy(self, request: LearnerVoiceTurnRequest) -> Tuple[str, str, str]:
        exam = request.exam or _DEFAULT_EXAM
        class_year = request.class_year or _DEFAULT_CLASS_YEAR
        subject = request.subject or _DEFAULT_SUBJECT
        return (exam, class_year, subject)

    @staticmethod
    def _validate_taxonomy(taxonomy: Tuple[str, str, str]) -> Optional[MarkKnownCard]:
        exam, class_year, _subject = taxonomy
        allowed = _VALID_EXAMS_FOR_CLASS.get(class_year, frozenset())
        if exam not in allowed:
            human_allowed = ", ".join(sorted(allowed)) if allowed else "another exam"
            return MarkKnownCard(
                speak=(
                    f"{exam} is not offered at {class_year}. "
                    f"Try {human_allowed} instead."
                ),
                prompt=(
                    f"{exam} isn't available for {class_year} learners — "
                    f"choose {human_allowed} on your home page and try again."
                ),
                confirm_label="Got it",
            )
        return None

    def _walkthrough_for(self, taxonomy: Tuple[str, str, str]) -> List[_ScriptedQuestion]:
        cached = self._sessions.get(taxonomy)
        if cached is not None:
            return cached
        exam, class_year, subject = taxonomy
        matches = _filter_bank(self._bank, exam=exam, class_year=class_year, subject=subject)
        walkthrough = matches[: self.MAX_QUESTIONS]
        self._sessions[taxonomy] = walkthrough
        return walkthrough

    def _no_content_card(self, taxonomy: Tuple[str, str, str]) -> MarkKnownCard:
        exam, class_year, subject = taxonomy
        return MarkKnownCard(
            speak=(
                f"No {exam} {class_year} {subject} cards yet — pick another subject for now."
            ),
            prompt=(
                f"Pathfinder doesn't have {exam} {class_year} {subject} content yet. "
                "Pick a different subject on your home page while we add more."
            ),
            confirm_label="Got it",
        )

    def _present_question(
        self,
        *,
        taxonomy: Tuple[str, str, str],
        walkthrough: List[_ScriptedQuestion],
        index: int,
        prefix_greeting: bool,
        total: int,
    ) -> LearnerVoiceTurnResponse:
        question = walkthrough[index]
        exam, class_year, subject = taxonomy
        intro = (
            f"Hi — let's do a quick {exam} {class_year} {subject} check. "
            if prefix_greeting
            else ""
        )
        card = McqTapCard(
            speak=f"{intro}Question {index + 1} of {total}. {question.stem}",
            stem=question.stem,
            options=list(question.options),
            skill_id=question.skill_id,
        )
        self._index_by_card[card.card_id] = (taxonomy, index)
        return LearnerVoiceTurnResponse(card=card)


__all__ = [
    "CardKind",
    "GreetingCard",
    "McqOption",
    "McqTapCard",
    "ExplanationCard",
    "ProgressCard",
    "MarkKnownCard",
    "LearnerVoiceCard",
    "LearnerVoiceTurnRequest",
    "LearnerVoiceTurnResponse",
    "LearnerVoiceTurnPlanner",
]
