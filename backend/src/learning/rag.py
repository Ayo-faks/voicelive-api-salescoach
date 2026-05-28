"""RAG retriever skeleton for Pathfinder Learn explanations.

Scope (W3-A):
- Deterministic, offline-only scorer over an in-memory `WikiCorpus`.
- Single similarity threshold; below it the retriever returns a
  ``RefusalCard("no_grounding")`` — see MVP §4.1 ("no citation, no answer")
  and risk R1.
- No LLM calls and no network. The explanation agent (W3-B) will compose
  this retriever with the grounded generator. Vector index slots in later
  by swapping the scorer; the public API stays.

Scoring uses the overlap coefficient:
  score = |q_tokens ∩ n_tokens| / min(|q_tokens|, |n_tokens|)
i.e. "what fraction of the smaller side matches". For typical short
learner queries (2–4 content words) against verbose wiki bodies this is
recall over the query, which matches the "did we find the topic they
asked about?" intuition better than Jaccard. Subject and year_group are
hard filters when supplied. Vector ranking slots in here later without
touching the public API.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Literal, Optional, Sequence, Tuple, Union

from src.learning.models import (
    Provenance,
    RefusalCard,
    WikiAnchor,
    WikiNode,
)


DEFAULT_SIMILARITY_THRESHOLD: float = 0.5
DEFAULT_TOP_K: int = 3

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    {
        "the", "a", "an", "of", "to", "in", "and", "or", "is", "are",
        "for", "on", "with", "as", "by", "this", "that", "it", "be",
        "how", "what", "why", "when", "do", "does", "i", "you",
    }
)


def _stem(token: str) -> str:
    # Tiny suffix stripper — gets us "fraction"/"fractions" and
    # "simplify"/"simplifying" matching. Real retriever swaps this for
    # embeddings; the skeleton just needs to be fair to obvious morphology.
    for suffix in ("ing", "ies", "ied", "ed", "es", "s"):
        if len(token) > len(suffix) + 2 and token.endswith(suffix):
            stem = token[: -len(suffix)]
            # "ies" → "y" (e.g. studies → study)
            if suffix == "ies":
                return stem + "y"
            return stem
    return token


def _tokens(text: str) -> frozenset[str]:
    return frozenset(
        _stem(t) for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS
    )


def _jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def _overlap_coefficient(a: frozenset[str], b: frozenset[str]) -> float:
    """|a ∩ b| / min(|a|, |b|). 1.0 when the smaller side is fully covered."""
    if not a or not b:
        return 0.0
    inter = len(a & b)
    denom = min(len(a), len(b))
    return inter / denom if denom else 0.0


@dataclass(frozen=True)
class RetrievalHit:
    """A single ranked retrieval candidate."""

    node: WikiNode
    score: float
    matched_anchor: str  # First anchor on the node; refined by agent later.

    def to_citation(self) -> WikiAnchor:
        return WikiAnchor(
            node_id=self.node.node_id,
            version=self.node.version,
            anchor=self.matched_anchor,
        )


class WikiCorpus:
    """In-memory corpus of `WikiNode` keyed by (node_id, version).

    Only ``status in {"approved", "frozen"}`` nodes are retrievable.
    Draft/review nodes exist for authoring workflows but must never reach
    a learner explanation — enforced here at retrieval time, not just in UI.
    """

    _RETRIEVABLE_STATUSES = frozenset({"approved", "frozen"})

    def __init__(self, nodes: Iterable[WikiNode]) -> None:
        self._nodes: List[WikiNode] = [
            n for n in nodes if n.status in self._RETRIEVABLE_STATUSES
        ]

    def __len__(self) -> int:
        return len(self._nodes)

    def nodes(self) -> Sequence[WikiNode]:
        return tuple(self._nodes)

    def find(self, node_id: str, version: str) -> Optional[WikiNode]:
        for node in self._nodes:
            if node.node_id == node_id and node.version == version:
                return node
        return None


class RagRetriever:
    """Threshold-gated lexical retriever.

    Returns ``RetrievalHit`` rows above ``similarity_threshold``; otherwise
    callers should treat the result as ungrounded and emit a refusal.
    """

    def __init__(
        self,
        corpus: WikiCorpus,
        *,
        similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
        top_k: int = DEFAULT_TOP_K,
    ) -> None:
        if similarity_threshold < 0 or similarity_threshold > 1:
            raise ValueError("similarity_threshold must be in [0, 1]")
        if top_k < 1:
            raise ValueError("top_k must be >= 1")
        self.corpus = corpus
        self.similarity_threshold = similarity_threshold
        self.top_k = top_k

    def retrieve(
        self,
        query: str,
        *,
        subject: Optional[Literal["maths", "english"]] = None,
        year_group: Optional[Literal["JSS3", "SS3"]] = None,
    ) -> List[RetrievalHit]:
        q_tokens = _tokens(query)
        if not q_tokens:
            return []
        scored: List[Tuple[float, WikiNode]] = []
        for node in self.corpus.nodes():
            if subject is not None and node.subject != subject:
                continue
            if year_group is not None and node.year_group != year_group:
                continue
            n_tokens = _tokens(
                " ".join(
                    [node.title, node.topic, node.subtopic or "", node.body_markdown]
                )
            )
            score = _overlap_coefficient(q_tokens, n_tokens)
            if score >= self.similarity_threshold:
                scored.append((score, node))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        hits: List[RetrievalHit] = []
        for score, node in scored[: self.top_k]:
            anchor = node.anchors[0] if node.anchors else ""
            if not anchor:
                # An approved node without anchors is a content bug — skip
                # rather than fabricate. The reviewer queue catches it.
                continue
            hits.append(RetrievalHit(node=node, score=score, matched_anchor=anchor))
        return hits


def retrieve_or_refuse(
    retriever: RagRetriever,
    query: str,
    *,
    lang: str = "en",
    subject: Optional[Literal["maths", "english"]] = None,
    year_group: Optional[Literal["JSS3", "SS3"]] = None,
) -> Tuple[List[RetrievalHit], Optional[RefusalCard]]:
    """Convenience entry point.

    Returns ``(hits, None)`` if at least one hit clears the threshold, else
    ``([], RefusalCard("no_grounding"))``. The agent layer (W3-B) chooses
    between rendering the explanation and surfacing the refusal.
    """
    hits = retriever.retrieve(query, subject=subject, year_group=year_group)
    if hits:
        return hits, None
    refusal = RefusalCard(
        lang=lang,
        provenance=[
            Provenance(
                source="rag:retriever",
                rule_id="no_grounding",
                confidence=1.0,
                evidence_count=0,
                metadata={"threshold": retriever.similarity_threshold},
            )
        ],
        reason="no_grounding",
        learner_message=(
            "I couldn't find a wiki source for that — try a different question "
            "or rephrase what you'd like explained."
        ),
        detail=(
            "Retrieval returned no candidate at or above the configured "
            "similarity threshold."
        ),
        suggested_action="ask_simpler_question",
    )
    return [], refusal


def load_wiki_corpus(path: Union[str, Path]) -> WikiCorpus:
    """Load a `WikiCorpus` from a JSON seed file.

    Expected shape:
        {
          "version": "1.0.0",
          "lang": "en",
          "provenance": [...],
          "nodes": [ {... WikiNode fields ...}, ... ]
        }

    Per-node ``lang`` / ``provenance`` are inherited from the top-level
    document when not set on the node itself — keeps the seed file compact
    without weakening the contract enforced by :class:`WikiNode`.
    """

    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("wiki corpus file must be a JSON object")
    default_lang = raw.get("lang", "en")
    default_provenance = raw.get("provenance") or []
    nodes_raw = raw.get("nodes") or []
    if not isinstance(nodes_raw, list):
        raise ValueError("wiki corpus 'nodes' must be a list")
    nodes: List[WikiNode] = []
    for entry in nodes_raw:
        if not isinstance(entry, dict):
            raise ValueError("wiki node entries must be JSON objects")
        payload = dict(entry)
        payload.setdefault("lang", default_lang)
        payload.setdefault("provenance", default_provenance)
        nodes.append(WikiNode(**payload))
    return WikiCorpus(nodes)
