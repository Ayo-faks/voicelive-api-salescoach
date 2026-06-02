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

import difflib
import json
import logging
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, List, Literal, Mapping, Optional, Sequence, Tuple, Union

from src.learning.models import (
    Provenance,
    RefusalCard,
    WikiAnchor,
    WikiNode,
)


DEFAULT_SIMILARITY_THRESHOLD: float = 0.5
DEFAULT_TOP_K: int = 3

# Dense (semantic) admission threshold on cosine similarity between the query
# embedding and a node embedding. Embeddings only *add* candidates the lexical
# gate missed (paraphrases, heavy phonetic misspellings), so this must sit
# above where off-topic / jailbreak queries land against the curriculum.
# Calibrated for text-embedding-3-small on this corpus via the validation
# harness: legit (incl. heavy misspellings like "whats fotosynthisis") score
# cosine 0.33-0.63 while off-topic/jailbreak score 0.07-0.21 — a clean ~0.12
# dead-zone. 0.30 sits in that gap (defers the worst adversarial at 0.21 with
# margin, grounds the weakest legit at 0.33). NOTE: this is model-specific —
# ada-002 cannot separate these bands (they overlap ~0.68-0.81); re-run
# scripts/eval_rag_grounding.py before changing the embedding deployment.
DEFAULT_EMBEDDING_THRESHOLD: float = 0.30

# Max characters of a node body folded into its embedding text. Caps cost and
# keeps the vector focused on the topic instead of being diluted by long
# worked examples further down the body.
_EMBED_BODY_CHARS: int = 2000

logger = logging.getLogger(__name__)

# An embedder maps a batch of texts to unit-comparable vectors, or returns
# ``None`` to signal "unavailable" (no creds / network error). Returning None
# rather than raising is load-bearing: the retriever then falls back to the
# pure-lexical path and the fail-closed grounding guarantee is preserved.
EmbedFn = Callable[[List[str]], Optional[List[List[float]]]]

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    {
        "the", "a", "an", "of", "to", "in", "and", "or", "is", "are",
        "for", "on", "with", "as", "by", "this", "that", "it", "be",
        "how", "what", "why", "when", "do", "does", "i", "you",
        # Low-information filler / intent words. Dropping them keeps the
        # fail-closed gate dependent on real content tokens, so a single
        # incidental verb (e.g. "make") cannot ground an off-topic query.
        "make", "get", "find", "use", "want", "need", "give", "show",
        "tell", "explain", "mean", "help", "please", "my", "me", "can",
        "will", "would", "should", "could", "about", "into", "your",
        "work", "out", "some", "any", "we", "us",
        # Indefinite pronouns carry no topical signal. Without them a short
        # query like "hurt someone" shares the generic word "someone" with a
        # node ("...in your own words to someone...") and clears the 0.5
        # overlap gate on a single incidental token. Dropping them keeps the
        # gate dependent on real subject vocabulary.
        "someone", "somebody", "something", "anyone", "anybody", "anything",
        "everyone", "everybody", "everything", "nobody", "nothing", "one",
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


def _normalize(vec: Sequence[float]) -> List[float]:
    """Return the L2-normalised vector so a dot product equals cosine."""
    norm = math.sqrt(sum(x * x for x in vec))
    if norm == 0.0:
        return [0.0] * len(vec)
    return [x / norm for x in vec]


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


# Only correct reasonably long tokens — short words ("sum", "area") are too
# easy to mis-map onto an unrelated corpus term and would weaken the gate.
_FUZZY_MIN_LEN: int = 5
# SequenceMatcher ratio cutoff. Measured legit typo snaps on this corpus sit at
# ratio >= 0.94 ("fracions"->"fractions" 0.94, "photsynthesis"->"photosynthesis"
# 0.96), while a dangerous common-word collision like "world"->"word" sits at
# 0.888. 0.90 is set just above that collision and below every genuine snap, so
# off-topic queries can no longer borrow grounding by mutating a common English
# word into a curriculum term ("world" -> "word" -> the english "paraphrase"
# node). Anything below 0.90 is left untouched and still fails the overlap gate.
_FUZZY_CUTOFF: float = 0.90


def _canonicalize_query_tokens(
    q_tokens: frozenset[str], vocab: frozenset[str]
) -> frozenset[str]:
    """Spell-correct learner typos *only* to words already in the corpus.

    A query token that is not in ``vocab`` is replaced by its closest corpus
    term when the match is unambiguous (long enough, same first letter, above
    the ratio cutoff). Because corrections can only ever map to existing
    vocabulary, this never invents grounding for off-topic queries — a word
    with no near neighbour in the corpus is left untouched and still fails the
    overlap gate. It only rescues obvious misspellings of on-topic terms,
    which matters for a kids' product where typos are constant.
    """
    if not vocab:
        return q_tokens
    corrected: set[str] = set()
    changed = False
    for tok in q_tokens:
        if tok in vocab or len(tok) < _FUZZY_MIN_LEN:
            corrected.add(tok)
            continue
        match = difflib.get_close_matches(tok, vocab, n=1, cutoff=_FUZZY_CUTOFF)
        if match and match[0][0] == tok[0]:
            corrected.add(match[0])
            changed = True
        else:
            corrected.add(tok)
    return frozenset(corrected) if changed else q_tokens


class _Bm25Index:
    """Deterministic, offline BM25 index over the corpus documents.

    Used to refine ranking *within* the overlap-gated candidate set. It never
    changes which nodes pass the fail-closed similarity threshold — the overlap
    coefficient remains the gate — so the "no citation, no answer" guarantee is
    untouched. BM25 only re-orders candidates that the gate already admitted,
    which matters once the corpus is large and many nodes tie on overlap.

    Built once at retriever construction from already-loaded nodes. No network,
    no model download; pure term-frequency statistics. A future embedding
    re-ranker can blend in here behind the same retrieve() API.
    """

    __slots__ = ("_k1", "_b", "_avgdl", "_doc_len", "_tf", "_idf")

    def __init__(self, documents: Sequence[Sequence[str]], *, k1: float = 1.5, b: float = 0.75) -> None:
        self._k1 = k1
        self._b = b
        n_docs = len(documents)
        self._doc_len: List[int] = [len(doc) for doc in documents]
        self._avgdl = (sum(self._doc_len) / n_docs) if n_docs else 0.0
        self._tf: List[dict] = []
        df: dict = {}
        for doc in documents:
            counts: dict = {}
            for term in doc:
                counts[term] = counts.get(term, 0) + 1
            self._tf.append(counts)
            for term in counts:
                df[term] = df.get(term, 0) + 1
        # BM25 idf with +1 smoothing so it is always non-negative.
        import math

        self._idf: dict = {
            term: math.log(1 + (n_docs - freq + 0.5) / (freq + 0.5))
            for term, freq in df.items()
        }

    def score(self, doc_index: int, query_terms: Iterable[str]) -> float:
        if not self._avgdl:
            return 0.0
        tf = self._tf[doc_index]
        dl = self._doc_len[doc_index]
        k1, b = self._k1, self._b
        total = 0.0
        for term in query_terms:
            freq = tf.get(term, 0)
            if not freq:
                continue
            idf = self._idf.get(term, 0.0)
            denom = freq + k1 * (1 - b + b * dl / self._avgdl)
            total += idf * (freq * (k1 + 1)) / denom
        return total



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
        embedder: Optional[EmbedFn] = None,
        embedding_threshold: float = DEFAULT_EMBEDDING_THRESHOLD,
    ) -> None:
        if similarity_threshold < 0 or similarity_threshold > 1:
            raise ValueError("similarity_threshold must be in [0, 1]")
        if top_k < 1:
            raise ValueError("top_k must be >= 1")
        if embedding_threshold < 0 or embedding_threshold > 1:
            raise ValueError("embedding_threshold must be in [0, 1]")
        self.corpus = corpus
        self.similarity_threshold = similarity_threshold
        self.top_k = top_k
        self.embedding_threshold = embedding_threshold
        # Precompute indexed token sets + a BM25 index once. Both are static for
        # the lifetime of the retriever (corpus is immutable after load), so the
        # request hot path does no re-tokenisation of node bodies and no I/O.
        self._nodes: Tuple[WikiNode, ...] = tuple(corpus.nodes())
        self._node_tokens: List[frozenset[str]] = [
            _tokens(
                " ".join(
                    [n.title, n.topic, n.subtopic or "", n.body_markdown]
                )
            )
            for n in self._nodes
        ]
        # Union vocabulary across the corpus — the only terms a learner typo is
        # ever allowed to be corrected to (see _canonicalize_query_tokens).
        self._vocab: frozenset[str] = frozenset().union(*self._node_tokens) if self._node_tokens else frozenset()
        self._bm25 = _Bm25Index([sorted(toks) for toks in self._node_tokens])

        # Dense (semantic) stage — optional and lazily warmed. When ``embedder``
        # is None the retriever is byte-for-byte the pure-lexical retriever, so
        # offline use and existing tests are unchanged. Node vectors are built
        # on first use (not at construction) to keep import/startup network-free
        # and to avoid paying the embedding round-trip for retrievers that are
        # built but never queried.
        self._embedder = embedder
        self._node_vectors: Optional[List[List[float]]] = None
        self._embed_disabled = embedder is None
        self._query_vec_cache: "dict[str, Optional[List[float]]]" = {}

    def _ensure_node_vectors(self) -> Optional[List[List[float]]]:
        """Embed every node once, lazily. Returns None if embedding is off/failed.

        On any failure the dense stage self-disables for the process lifetime so
        a flaky embedding endpoint degrades to lexical-only rather than throwing
        on every request.
        """
        if self._embed_disabled or self._embedder is None:
            return None
        if self._node_vectors is not None:
            return self._node_vectors
        texts = [
            " ".join(
                [
                    n.title,
                    n.topic,
                    n.subtopic or "",
                    (n.body_markdown or "")[:_EMBED_BODY_CHARS],
                ]
            )
            for n in self._nodes
        ]
        try:
            raw = self._embedder(texts) if texts else []
        except Exception:  # noqa: BLE001 — never let embedding break retrieval
            logger.warning("RAG node embedding failed; falling back to lexical", exc_info=True)
            self._embed_disabled = True
            return None
        if raw is None or len(raw) != len(self._nodes):
            self._embed_disabled = True
            return None
        self._node_vectors = [_normalize(v) for v in raw]
        return self._node_vectors

    def _query_vector(self, query: str) -> Optional[List[float]]:
        """Return the normalised embedding for ``query`` (cached), or None."""
        if self._embed_disabled or self._embedder is None:
            return None
        if query in self._query_vec_cache:
            return self._query_vec_cache[query]
        try:
            raw = self._embedder([query])
        except Exception:  # noqa: BLE001
            logger.warning("RAG query embedding failed; falling back to lexical", exc_info=True)
            self._embed_disabled = True
            return None
        vec = _normalize(raw[0]) if raw else None
        self._query_vec_cache[query] = vec
        return vec

    def retrieve(
        self,
        query: str,
        *,
        subject: Optional[str] = None,
        year_group: Optional[str] = None,
    ) -> List[RetrievalHit]:
        q_tokens = _tokens(query)
        if not q_tokens:
            return []
        # Rescue obvious typos by snapping query tokens onto known corpus terms
        # before the fail-closed gate runs. Off-topic words have no near match
        # and pass through unchanged, so the grounding guarantee is preserved.
        q_tokens = _canonicalize_query_tokens(q_tokens, self._vocab)
        # Dense stage (optional). When embeddings are unavailable both of these
        # are None and the loop below behaves exactly like the lexical retriever.
        node_vectors = self._ensure_node_vectors()
        q_vector = self._query_vector(query) if node_vectors is not None else None
        # (combined, overlap, bm25, node). ``combined = max(overlap, cosine)`` is
        # the ranking key; a node is admitted when EITHER the lexical overlap
        # gate OR the dense cosine gate clears its own threshold.
        #
        # The dense (cosine) gate is SAFE ONLY with an embedding model whose
        # cosine cleanly separates curriculum-relevant queries from off-topic /
        # jailbreak ones. text-embedding-3-small does (legit 0.33-0.63 vs
        # adversarial 0.07-0.21, threshold 0.30 — see DEFAULT_EMBEDDING_THRESHOLD).
        # text-embedding-ada-002 does NOT (bands overlap ~0.68-0.81), so it must
        # not be used here. Always re-run scripts/eval_rag_grounding.py after
        # changing AZURE_OPENAI_EMBEDDING_DEPLOYMENT. When embeddings are
        # unavailable q_vector/node_vectors are None and this loop is byte-for-
        # byte the proven fail-closed lexical+difflib retriever.
        scored: List[Tuple[float, float, float, WikiNode]] = []
        for idx, node in enumerate(self._nodes):
            if subject is not None and node.subject != subject:
                continue
            if year_group is not None and node.year_group != year_group:
                continue
            n_tokens = self._node_tokens[idx]
            overlap = _overlap_coefficient(q_tokens, n_tokens)
            cosine = 0.0
            if q_vector is not None and node_vectors is not None:
                cosine = _dot(q_vector, node_vectors[idx])
            lexical_ok = overlap >= self.similarity_threshold
            semantic_ok = cosine >= self.embedding_threshold
            if lexical_ok or semantic_ok:
                bm25 = self._bm25.score(idx, q_tokens)
                combined = max(overlap, cosine)
                scored.append((combined, overlap, bm25, node))
        scored.sort(key=lambda row: (row[0], row[2]), reverse=True)
        hits: List[RetrievalHit] = []
        for combined, _overlap, _bm25, node in scored[: self.top_k]:
            anchor = node.anchors[0] if node.anchors else ""
            if not anchor:
                # An approved node without anchors is a content bug — skip
                # rather than fabricate. The reviewer queue catches it.
                continue
            hits.append(RetrievalHit(node=node, score=combined, matched_anchor=anchor))
        return hits


def retrieve_or_refuse(
    retriever: RagRetriever,
    query: str,
    *,
    lang: str = "en",
    subject: Optional[str] = None,
    year_group: Optional[str] = None,
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


def _default_corpus_paths() -> Tuple[Path, ...]:
    """Resolve the bundled wiki seed paths without importing the heavy api module.

    Globs every ``*.json`` under ``data/learning/wiki`` so curriculum seed files
    produced by the offline ingestion pipeline are picked up automatically. The
    two hand-seeded pilot files are listed first for stable ordering, then any
    remaining seeds in sorted order.
    """
    module_path = Path(__file__).resolve()
    data_candidates = [
        module_path.parents[3] / "data" / "learning",
        module_path.parents[2] / "data" / "learning",
    ]
    learning_dir = next((c for c in data_candidates if c.exists()), data_candidates[0])
    wiki_dir = learning_dir / "wiki"
    preferred = [
        wiki_dir / "jss3_maths_wiki_seed.json",
        wiki_dir / "english_jss3_ss3_wiki_seed.json",
    ]
    ordered: List[Path] = [p for p in preferred if p.exists()]
    if wiki_dir.exists():
        for path in sorted(wiki_dir.glob("*.json")):
            if path not in ordered:
                ordered.append(path)
    return tuple(ordered) if ordered else tuple(preferred)


def build_azure_embedder(settings: "Mapping[str, Any]") -> Optional[EmbedFn]:
    """Build an Azure OpenAI embedding function, or None when unavailable.

    Reuses the project's shared :func:`build_openai_client` (key or managed
    identity) so the dense stage authenticates exactly like the chat path. The
    returned callable batches a list of texts into one ``embeddings.create``
    call and returns row-aligned vectors; on any error it returns None so the
    retriever degrades to lexical-only rather than raising on the request path.
    """
    try:
        from src.services.azure_openai_auth import build_openai_client
    except Exception:  # noqa: BLE001
        return None
    client = build_openai_client(settings)
    if client is None:
        return None
    deployment = (
        str(settings.get("azure_openai_embedding_deployment") or "").strip()
        or os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "").strip()
        or "text-embedding-3-small"
    )

    def _embed(texts: List[str]) -> Optional[List[List[float]]]:
        if not texts:
            return []
        try:
            resp = client.embeddings.create(model=deployment, input=texts)
        except Exception:  # noqa: BLE001
            logger.warning("Azure embedding call failed", exc_info=True)
            return None
        # The SDK preserves input order; sort by index defensively anyway.
        rows = sorted(resp.data, key=lambda d: d.index)
        return [list(r.embedding) for r in rows]

    return _embed


def build_default_embedder() -> Optional[EmbedFn]:
    """Return the configured embedder when the dense stage is enabled, else None.

    Opt-in: requires ``PATHFINDER_RAG_EMBEDDINGS_ENABLED`` truthy AND Azure
    OpenAI configured. Off by default so offline runs and the test-suite keep
    the deterministic, zero-network lexical behaviour unless explicitly turned
    on for an environment that has embedding capacity.
    """
    flag = os.getenv("PATHFINDER_RAG_EMBEDDINGS_ENABLED", "").strip().lower()
    if flag not in {"1", "true", "yes", "on"}:
        return None
    try:
        from src.config import get_config

        return build_azure_embedder(get_config())
    except Exception:  # noqa: BLE001
        logger.warning("RAG embedder construction failed; using lexical-only", exc_info=True)
        return None


def build_default_retriever(
    *,
    similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
    top_k: int = DEFAULT_TOP_K,
    embedder: Optional[EmbedFn] = None,
) -> RagRetriever:
    """Build a :class:`RagRetriever` over the bundled maths + english seeds.

    Shared by the REST tutor (``LearningApi``) and the realtime learner voice
    profile so both ground on the same corpus without duplicating the loading
    logic. Missing seed files are skipped — an empty corpus simply yields no
    grounding (callers fall back to the item rationale / deterministic path).

    When ``embedder`` is omitted the default Azure embedder is attempted (it is
    a no-op returning None unless ``PATHFINDER_RAG_EMBEDDINGS_ENABLED`` is set
    and Azure OpenAI is configured), so the dense stage activates by config
    without callers changing.
    """
    merged_nodes: List[WikiNode] = []
    for path in _default_corpus_paths():
        if path.exists():
            merged_nodes.extend(load_wiki_corpus(path).nodes())
    return RagRetriever(
        WikiCorpus(merged_nodes),
        similarity_threshold=similarity_threshold,
        top_k=top_k,
        embedder=embedder if embedder is not None else build_default_embedder(),
    )

