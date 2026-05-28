"""Contract tests for the W4 explanation seed (`explanation_seeds_v1.json`).

Every seed entry must:
* parse as `ExplanationResult` (fail-closed grounding contract)
* cite at least one (node_id, version, anchor) that resolves to a real
  retrievable WikiNode in one of the bundled wiki corpora
* declare a misconception_code drawn from `MisconceptionCode`
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.learning.misconceptions import MisconceptionCode
from src.learning.models import ExplanationResult
from src.learning.rag import WikiCorpus, load_wiki_corpus


DATA_ROOT = Path(__file__).resolve().parents[3] / "data" / "learning"
SEED_PATH = DATA_ROOT / "explanations" / "explanation_seeds_v1.json"
WIKI_PATHS = (
    DATA_ROOT / "wiki" / "jss3_maths_wiki_seed.json",
    DATA_ROOT / "wiki" / "english_jss3_ss3_wiki_seed.json",
)


@pytest.fixture(scope="module")
def seed_doc() -> dict:
    with SEED_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(scope="module")
def explanations(seed_doc: dict) -> list[ExplanationResult]:
    default_lang = seed_doc.get("lang", "en")
    default_provenance = seed_doc.get("provenance") or []
    out: list[ExplanationResult] = []
    for entry in seed_doc["explanations"]:
        payload = dict(entry)
        payload.setdefault("lang", default_lang)
        payload.setdefault("provenance", default_provenance)
        out.append(ExplanationResult.model_validate(payload))
    return out


@pytest.fixture(scope="module")
def merged_corpus() -> WikiCorpus:
    nodes = []
    for path in WIKI_PATHS:
        nodes.extend(load_wiki_corpus(path).nodes())
    return WikiCorpus(nodes)


def test_seed_doc_header(seed_doc: dict) -> None:
    assert seed_doc["version"] == "1.0.0"
    assert seed_doc["lang"] == "en"
    assert isinstance(seed_doc["explanations"], list)
    assert len(seed_doc["explanations"]) >= 8


def test_every_entry_parses_as_explanation_result(
    explanations: list[ExplanationResult],
) -> None:
    assert all(isinstance(e, ExplanationResult) for e in explanations)


def test_every_explanation_has_at_least_one_wiki_citation(
    explanations: list[ExplanationResult],
) -> None:
    for explanation in explanations:
        assert explanation.wiki_citations, explanation.explanation_id


def test_every_citation_resolves_to_a_retrievable_node(
    explanations: list[ExplanationResult],
    merged_corpus: WikiCorpus,
) -> None:
    for explanation in explanations:
        for citation in explanation.wiki_citations:
            node = merged_corpus.find(citation.node_id, citation.version)
            assert node is not None, (
                f"{explanation.explanation_id} cites unknown "
                f"{citation.node_id}@{citation.version}"
            )
            assert citation.anchor in node.anchors, (
                f"{explanation.explanation_id} cites unknown anchor "
                f"{citation.anchor} on {citation.node_id}"
            )


def test_misconception_codes_are_valid(
    explanations: list[ExplanationResult],
) -> None:
    valid = {m.value for m in MisconceptionCode}
    for explanation in explanations:
        assert explanation.misconception_code in valid, (
            f"{explanation.explanation_id} declares unknown code "
            f"{explanation.misconception_code}"
        )


def test_common_misconceptions_have_explanation_coverage(
    explanations: list[ExplanationResult],
) -> None:
    covered = {e.misconception_code for e in explanations}
    # MVP §9 W4: "explanation seed (1 per common misconception)".
    common = {
        MisconceptionCode.FRACTION_PART_WHOLE.value,
        MisconceptionCode.RATIO_INVERSION.value,
        MisconceptionCode.ALGEBRA_DISTRIBUTION.value,
        MisconceptionCode.SIGN_ERROR.value,
        MisconceptionCode.LANGUAGE_COMPREHENSION.value,
        MisconceptionCode.ANSWER_FORM.value,
        MisconceptionCode.MISREAD_QUESTION.value,
        MisconceptionCode.TRANSCRIPTION.value,
    }
    missing = common - covered
    assert not missing, f"common codes without explanation seed: {sorted(missing)}"
