"""Contract tests for the W2 RAG grounding contract.

Covers WikiAnchor, WikiNode, ExplanationResult, and RefusalCard. The single
non-negotiable rule under test is MVP §4.1: "no citation, no answer."
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.learning.misconceptions import MisconceptionCode, TAXONOMY_VERSION
from src.learning.models import (
    ExplanationResult,
    Provenance,
    RefusalCard,
    WikiAnchor,
    WikiNode,
)


def _prov(source: str = "rag:wiki") -> list[Provenance]:
    return [Provenance(source=source, confidence=0.92, evidence_count=1)]


# ---------------------------------------------------------------------------
# WikiAnchor
# ---------------------------------------------------------------------------


def test_wiki_anchor_requires_all_fields() -> None:
    anchor = WikiAnchor(node_id="maths.fractions.v1", version="1.0.0", anchor="sec-1")
    assert anchor.node_id == "maths.fractions.v1"


@pytest.mark.parametrize("field", ["node_id", "version", "anchor"])
def test_wiki_anchor_rejects_blank_field(field: str) -> None:
    base = dict(node_id="n", version="v", anchor="a")
    base[field] = ""
    with pytest.raises(ValidationError):
        WikiAnchor(**base)


# ---------------------------------------------------------------------------
# WikiNode
# ---------------------------------------------------------------------------


def _wiki_node(**overrides) -> WikiNode:
    payload = dict(
        lang="en",
        provenance=_prov("authoring:subject-lead"),
        node_id="maths.fractions.simplify",
        version="1.0.0",
        title="Simplifying fractions",
        subject="maths",
        year_group="JSS3",
        topic="Number",
        subtopic="Fractions",
        misconception_codes=[MisconceptionCode.FRACTION_PART_WHOLE.value],
        body_markdown="A fraction is in simplest form when ...",
        anchors=["sec-intro", "sec-worked-example"],
        status="approved",
    )
    payload.update(overrides)
    return WikiNode(**payload)


def test_wiki_node_round_trip() -> None:
    node = _wiki_node()
    assert node.status == "approved"
    assert node.misconception_codes == [MisconceptionCode.FRACTION_PART_WHOLE.value]


def test_wiki_node_rejects_unknown_misconception_code() -> None:
    with pytest.raises(ValidationError):
        _wiki_node(misconception_codes=["NOT_A_CODE"])


def test_wiki_node_rejects_duplicate_misconception_code() -> None:
    code = MisconceptionCode.CALC_ERROR.value
    with pytest.raises(ValidationError):
        _wiki_node(misconception_codes=[code, code])


def test_wiki_node_rejects_blank_anchor() -> None:
    with pytest.raises(ValidationError):
        _wiki_node(anchors=["sec-intro", "   "])


def test_wiki_node_rejects_duplicate_anchor() -> None:
    with pytest.raises(ValidationError):
        _wiki_node(anchors=["sec-intro", "sec-intro"])


def test_wiki_node_requires_provenance() -> None:
    with pytest.raises(ValidationError):
        _wiki_node(provenance=[])


# ---------------------------------------------------------------------------
# RefusalCard
# ---------------------------------------------------------------------------


def test_refusal_card_no_grounding_shape() -> None:
    card = RefusalCard(
        lang="en",
        provenance=_prov("retriever:bm25"),
        reason="no_grounding",
        learner_message="I can't explain this yet — let's try a different question.",
        detail="No wiki node passed similarity threshold.",
        suggested_action="retry_with_different_question",
    )
    assert card.reason == "no_grounding"


def test_refusal_card_rejects_unknown_reason() -> None:
    with pytest.raises(ValidationError):
        RefusalCard(
            lang="en",
            provenance=_prov(),
            reason="hallucinated",
            learner_message="x",
        )


def test_refusal_card_requires_provenance() -> None:
    with pytest.raises(ValidationError):
        RefusalCard(
            lang="en",
            provenance=[],
            reason="safety_block",
            learner_message="x",
        )


# ---------------------------------------------------------------------------
# ExplanationResult — the "no citation, no answer" gate
# ---------------------------------------------------------------------------


def _explanation(**overrides) -> ExplanationResult:
    payload = dict(
        lang="en",
        provenance=_prov("agent:explanation"),
        explanation_version="exp-fractions-simplify-1.0.0",
        question_id="maths-v1-jss3-006",
        skill_id="jss3.number.fractions",
        misconception_code=MisconceptionCode.FRACTION_PART_WHOLE.value,
        body_markdown="To simplify, divide top and bottom by the GCD ...",
        wiki_citations=[
            WikiAnchor(
                node_id="maths.fractions.simplify",
                version="1.0.0",
                anchor="sec-worked-example",
            )
        ],
    )
    payload.update(overrides)
    return ExplanationResult(**payload)


def test_explanation_requires_at_least_one_citation() -> None:
    with pytest.raises(ValidationError) as exc:
        _explanation(wiki_citations=[])
    msg = str(exc.value).lower()
    # Pydantic's field-level min_length=1 fires first ("too_short" /
    # "at least 1 item"). Either signal proves the contract is enforced.
    assert "at least 1 item" in msg or "too_short" in msg or "no citation, no answer" in msg


def test_explanation_round_trip_carries_provenance_and_citation() -> None:
    e = _explanation()
    assert e.provenance, "provenance is mandatory via LanguageAndProvenanceModel"
    assert len(e.wiki_citations) >= 1


def test_explanation_rejects_unknown_misconception_code() -> None:
    with pytest.raises(ValidationError):
        _explanation(misconception_code="NOT_A_CODE")


def test_explanation_misconception_code_optional() -> None:
    e = _explanation(misconception_code=None)
    assert e.misconception_code is None


def test_explanation_assignment_revalidates_citations() -> None:
    e = _explanation()
    with pytest.raises(ValidationError):
        e.wiki_citations = []


def test_taxonomy_version_pin_is_stable() -> None:
    # Sanity: WikiNode + ExplanationResult must be valid under the same
    # taxonomy_version the question bank pins.
    assert TAXONOMY_VERSION == "1.0.0"
