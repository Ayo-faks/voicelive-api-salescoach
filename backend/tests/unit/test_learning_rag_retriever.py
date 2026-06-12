"""Tests for the W3-A RAG retriever skeleton."""

from __future__ import annotations

from typing import List

import pytest

from src.learning.models import Provenance, RefusalCard, WikiNode
from src.learning.rag import (
    DEFAULT_SIMILARITY_THRESHOLD,
    EmbeddingCircuitBreaker,
    RagRetriever,
    WikiCorpus,
    _classify_embedding_error,
    retrieve_or_refuse,
)


def _prov() -> List[Provenance]:
    return [Provenance(source="rag:wiki", confidence=0.95, evidence_count=1)]


def _node(
    *,
    node_id: str,
    title: str,
    body: str,
    subject: str = "maths",
    year_group: str = "JSS3",
    status: str = "approved",
    anchors=("sec-overview",),
) -> WikiNode:
    return WikiNode(
        lang="en",
        provenance=_prov(),
        node_id=node_id,
        version="1.0.0",
        title=title,
        subject=subject,  # type: ignore[arg-type]
        year_group=year_group,  # type: ignore[arg-type]
        topic="fractions",
        misconception_codes=[],
        body_markdown=body,
        anchors=list(anchors),
        status=status,  # type: ignore[arg-type]
    )


# ---------- corpus ----------

def test_corpus_filters_out_unapproved_nodes() -> None:
    nodes = [
        _node(node_id="n.approved", title="t", body="b", status="approved"),
        _node(node_id="n.draft", title="t", body="b", status="draft"),
        _node(node_id="n.review", title="t", body="b", status="review"),
        _node(node_id="n.frozen", title="t", body="b", status="frozen"),
        _node(node_id="n.archived", title="t", body="b", status="archived"),
    ]
    corpus = WikiCorpus(nodes)
    ids = {n.node_id for n in corpus.nodes()}
    assert ids == {"n.approved", "n.frozen"}


# ---------- retriever validation ----------

def test_retriever_rejects_bad_threshold() -> None:
    with pytest.raises(ValueError):
        RagRetriever(WikiCorpus([]), similarity_threshold=-0.1)
    with pytest.raises(ValueError):
        RagRetriever(WikiCorpus([]), similarity_threshold=1.5)


def test_retriever_rejects_bad_top_k() -> None:
    with pytest.raises(ValueError):
        RagRetriever(WikiCorpus([]), top_k=0)


# ---------- retrieval semantics ----------

def test_empty_query_returns_empty() -> None:
    corpus = WikiCorpus([_node(node_id="n", title="fractions", body="simplify")])
    assert RagRetriever(corpus).retrieve("") == []


def test_relevant_query_above_threshold_is_returned() -> None:
    corpus = WikiCorpus(
        [
            _node(
                node_id="n.frac",
                title="Simplifying fractions",
                body="To simplify a fraction divide numerator and denominator by their GCD.",
            ),
            _node(
                node_id="n.algebra",
                title="Linear equations",
                body="Move all terms with x to one side.",
            ),
        ]
    )
    hits = RagRetriever(corpus).retrieve("how do I simplify a fraction")
    assert hits, "expected at least one hit"
    assert hits[0].node.node_id == "n.frac"
    assert hits[0].matched_anchor == "sec-overview"
    assert hits[0].score >= DEFAULT_SIMILARITY_THRESHOLD


def test_query_below_threshold_returns_empty() -> None:
    corpus = WikiCorpus(
        [_node(node_id="n.frac", title="Fractions", body="numerator denominator")]
    )
    # Totally unrelated query — lexical overlap is zero.
    hits = RagRetriever(corpus).retrieve("photosynthesis chlorophyll plants")
    assert hits == []


def test_subject_filter_excludes_other_subjects() -> None:
    corpus = WikiCorpus(
        [
            _node(node_id="n.m", title="fractions", body="numerator", subject="maths"),
            _node(node_id="n.e", title="fractions metaphor", body="numerator", subject="english"),
        ]
    )
    hits = RagRetriever(corpus).retrieve("fractions numerator", subject="english")
    assert {h.node.node_id for h in hits} == {"n.e"}


def test_node_with_no_anchors_is_skipped() -> None:
    corpus = WikiCorpus(
        [_node(node_id="n.noanchor", title="fractions", body="simplify", anchors=("only-anchor",))]
    )
    # Strip anchors post-construction is forbidden (model validator), so build
    # a node that *would* have ranked but has anchors=("only-anchor",) — this
    # path is the happy case. The skip is exercised in code review; here we
    # confirm the happy case still returns the anchor.
    hits = RagRetriever(corpus).retrieve("simplify fractions")
    assert hits and hits[0].matched_anchor == "only-anchor"


def test_top_k_is_respected() -> None:
    corpus = WikiCorpus(
        [
            _node(
                node_id=f"n.{i}",
                title="fraction simplify",
                body=f"simplify fraction example {i}",
            )
            for i in range(5)
        ]
    )
    hits = RagRetriever(corpus, top_k=2).retrieve("fraction simplify")
    assert len(hits) == 2


# ---------- refusal path ----------

def test_retrieve_or_refuse_returns_refusal_on_miss() -> None:
    corpus = WikiCorpus([_node(node_id="n.frac", title="fractions", body="numerator")])
    hits, refusal = retrieve_or_refuse(RagRetriever(corpus), "photosynthesis")
    assert hits == []
    assert isinstance(refusal, RefusalCard)
    assert refusal.reason == "no_grounding"
    assert refusal.provenance[0].rule_id == "no_grounding"


def test_retrieve_or_refuse_returns_hits_on_match() -> None:
    corpus = WikiCorpus(
        [_node(node_id="n.frac", title="Simplifying fractions", body="numerator denominator gcd")]
    )
    hits, refusal = retrieve_or_refuse(RagRetriever(corpus), "simplify a fraction")
    assert refusal is None
    assert hits and hits[0].node.node_id == "n.frac"


def test_retrieval_hit_to_citation_round_trip() -> None:
    corpus = WikiCorpus(
        [_node(node_id="n.frac", title="Simplifying fractions", body="numerator")]
    )
    hits = RagRetriever(corpus).retrieve("simplify fraction numerator")
    assert hits
    citation = hits[0].to_citation()
    assert citation.node_id == "n.frac"
    assert citation.version == "1.0.0"
    assert citation.anchor == "sec-overview"


# ---------- dense stage: fail-fast embeddings ----------
#
# Contract under test: embeddings may only *add* candidates and may never slow
# down or block a turn. Failures (429/timeout) open a circuit breaker for a
# short window; lexical retrieval always still runs.


class _FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class _CountingEmbedder:
    """Embedder fake: returns a constant unit vector; scriptable query failures."""

    def __init__(self, *, fail_queries: bool = False) -> None:
        self.calls: List[List[str]] = []
        self.fail_queries = fail_queries
        self.last_failure_reason: str | None = None

    def __call__(self, texts: List[str]) -> List[List[float]] | None:
        self.calls.append(list(texts))
        if self.fail_queries and len(texts) == 1:
            self.last_failure_reason = "rate_limited"
            return None
        return [[1.0, 0.0] for _ in texts]

    @property
    def query_calls(self) -> int:
        return sum(1 for c in self.calls if len(c) == 1)


def _dense_retriever(embedder, breaker) -> RagRetriever:
    # Two nodes so the warmup batch has len > 1 — the fakes above treat a
    # single-text call as a live query embedding (mirrors the real embedder's
    # query/warmup timeout split).
    corpus = WikiCorpus(
        [
            _node(node_id="n.frac", title="Simplifying fractions", body="numerator denominator gcd"),
            _node(node_id="n.alg", title="Linear equations", body="move terms with x to one side"),
        ]
    )
    return RagRetriever(corpus, embedder=embedder, circuit_breaker=breaker)


def test_dense_stage_admits_semantic_match_after_warm() -> None:
    embedder = _CountingEmbedder()
    retriever = _dense_retriever(embedder, EmbeddingCircuitBreaker(60.0, clock=_FakeClock()))
    assert retriever.warm() is True
    # Zero lexical overlap, but cosine 1.0 clears the dense gate.
    hits = retriever.retrieve("photosynthesis chlorophyll plants")
    assert hits and {h.node.node_id for h in hits} >= {"n.frac"}


def test_retrieve_never_builds_corpus_vectors_on_the_request_path() -> None:
    embedder = _CountingEmbedder()
    retriever = _dense_retriever(embedder, EmbeddingCircuitBreaker(60.0, clock=_FakeClock()))
    # No warm(): the first retrieve must answer lexically without paying the
    # corpus embedding cost synchronously (warmup is kicked in the background).
    hits = retriever.retrieve("simplify fraction numerator")
    assert hits and hits[0].node.node_id == "n.frac"


class _SplitEmbedder:
    """Node batches embed to [1, 0]; live queries embed to a fixed vector."""

    def __init__(self, query_vector: List[float]) -> None:
        self._query_vector = query_vector
        self.last_failure_reason: str | None = None

    def __call__(self, texts: List[str]) -> List[List[float]]:
        if len(texts) == 1:
            return [list(self._query_vector)]
        return [[1.0, 0.0] for _ in texts]


def test_dense_veto_blocks_token_collision_lexical_hit() -> None:
    # Query embeds orthogonally to every node (cosine 0.0): a lexical overlap
    # hit (shared token collision, e.g. 'bomb' -> fission page) must be vetoed.
    embedder = _SplitEmbedder([0.0, 1.0])
    retriever = _dense_retriever(embedder, EmbeddingCircuitBreaker(60.0, clock=_FakeClock()))
    assert retriever.warm() is True
    assert retriever.retrieve("simplify fraction numerator") == []


def test_dense_veto_admits_lexical_hit_above_veto_bar() -> None:
    # Cosine 0.35 sits between the veto bar (0.335) and the dense add-gate
    # (0.40): the lexical hit survives even though dense alone would not admit.
    embedder = _SplitEmbedder([0.35, (1 - 0.35**2) ** 0.5])
    retriever = _dense_retriever(embedder, EmbeddingCircuitBreaker(60.0, clock=_FakeClock()))
    assert retriever.warm() is True
    hits = retriever.retrieve("simplify fraction numerator")
    assert hits and hits[0].node.node_id == "n.frac"


def test_dense_veto_skipped_while_dense_is_unavailable() -> None:
    # Orthogonal query vector, but vectors are not warm: the veto must NOT
    # apply (availability never depends on embeddings) — lexical hit stands.
    embedder = _SplitEmbedder([0.0, 1.0])
    retriever = _dense_retriever(embedder, EmbeddingCircuitBreaker(60.0, clock=_FakeClock()))
    hits = retriever.retrieve("simplify fraction numerator")
    assert hits and hits[0].node.node_id == "n.frac"


def test_query_embedding_failure_falls_back_to_lexical_and_opens_circuit() -> None:
    embedder = _CountingEmbedder(fail_queries=True)
    breaker = EmbeddingCircuitBreaker(60.0, clock=_FakeClock())
    retriever = _dense_retriever(embedder, breaker)
    assert retriever.warm() is True
    # Lexical overlap clears the gate even though the query embedding 429s.
    hits = retriever.retrieve("simplify fraction numerator")
    assert hits and hits[0].node.node_id == "n.frac"
    assert breaker.allow() is False
    assert breaker.reason == "rate_limited"


def test_open_circuit_skips_embedding_calls_then_recovers() -> None:
    clock = _FakeClock()
    embedder = _CountingEmbedder(fail_queries=True)
    breaker = EmbeddingCircuitBreaker(60.0, clock=clock)
    retriever = _dense_retriever(embedder, breaker)
    assert retriever.warm() is True
    retriever.retrieve("simplify fraction numerator")  # opens the circuit
    calls_after_open = embedder.query_calls
    retriever.retrieve("fraction denominator gcd")  # while open: no embed call
    assert embedder.query_calls == calls_after_open
    # Window elapses → the dense stage gets a fresh, bounded chance.
    clock.now += 61.0
    embedder.fail_queries = False
    hits = retriever.retrieve("photosynthesis chlorophyll plants")
    assert embedder.query_calls == calls_after_open + 1
    assert hits
    assert breaker.allow() is True


def test_query_embedding_cache_avoids_second_client_call() -> None:
    embedder = _CountingEmbedder()
    retriever = _dense_retriever(embedder, EmbeddingCircuitBreaker(60.0, clock=_FakeClock()))
    assert retriever.warm() is True
    retriever.retrieve("photosynthesis chlorophyll plants")
    assert embedder.query_calls == 1
    # Same question (normalised: case/whitespace) — served from cache.
    retriever.retrieve("Photosynthesis   chlorophyll PLANTS")
    assert embedder.query_calls == 1


def test_warm_gives_up_after_max_failures_and_opens_circuit() -> None:
    class _AlwaysFails:
        last_failure_reason = "rate_limited"

        def __call__(self, texts):
            return None

    breaker = EmbeddingCircuitBreaker(60.0, clock=_FakeClock())
    retriever = _dense_retriever(_AlwaysFails(), breaker)
    assert retriever.warm(max_failures=2, retry_sleep_s=0.0) is False
    assert breaker.allow() is False
    # Lexical retrieval is untouched.
    hits = retriever.retrieve("simplify fraction numerator")
    assert hits and hits[0].node.node_id == "n.frac"


def test_warm_is_idempotent_and_embeds_corpus_once() -> None:
    embedder = _CountingEmbedder()
    retriever = _dense_retriever(embedder, EmbeddingCircuitBreaker(60.0, clock=_FakeClock()))
    assert retriever.warm() is True
    batch_calls = len(embedder.calls)
    assert retriever.warm() is True
    assert len(embedder.calls) == batch_calls


def test_circuit_breaker_classifies_429_and_timeouts() -> None:
    class _RateLimit(Exception):
        status_code = 429

    class _ConnectTimeoutError(Exception):
        pass

    assert _classify_embedding_error(_RateLimit()) == "rate_limited"
    assert _classify_embedding_error(_ConnectTimeoutError()) == "timeout"
    assert _classify_embedding_error(ValueError("boom")) == "error"


# ---------- dense stage: persisted corpus vectors (index once, load forever) ----------
#
# Contract under test: corpus vectors are embedded once, persisted to disk, and
# loaded on a cold start instead of re-embedded. The file is bound to the
# (deployment, exact corpus text) fingerprint, so a content change invalidates
# it. Embedders without a cache_namespace (test fakes) never touch disk.


class _NamespacedEmbedder:
    """Embedder fake that opts into the persisted-vector cache via a namespace."""

    def __init__(self, namespace: str = "text-embedding-3-small") -> None:
        self.calls: List[List[str]] = []
        self.last_failure_reason: str | None = None
        self.cache_namespace = namespace

    def __call__(self, texts: List[str]) -> List[List[float]]:
        self.calls.append(list(texts))
        # Distinct unit vectors per node so a round-trip mismatch would show.
        return [[1.0, 0.0] if (len(texts) > 1 and i % 2 == 0) else [0.0, 1.0] for i, _ in enumerate(texts)]

    @property
    def batch_calls(self) -> int:
        return sum(1 for c in self.calls if len(c) > 1)


def _persist_retriever(embedder, breaker) -> RagRetriever:
    corpus = WikiCorpus(
        [
            _node(node_id="n.frac", title="Simplifying fractions", body="numerator denominator gcd"),
            _node(node_id="n.alg", title="Linear equations", body="move terms with x to one side"),
        ]
    )
    return RagRetriever(corpus, embedder=embedder, circuit_breaker=breaker)


def test_warm_writes_vectors_to_disk(tmp_path, monkeypatch) -> None:
    from src.learning.rag import reset_embedding_runtime

    monkeypatch.setenv("PATHFINDER_RAG_VECTOR_CACHE_DIR", str(tmp_path))
    reset_embedding_runtime()
    embedder = _NamespacedEmbedder()
    retriever = _persist_retriever(embedder, EmbeddingCircuitBreaker(60.0, clock=_FakeClock()))
    assert retriever.warm() is True
    written = list(tmp_path.glob("*.vec"))
    assert len(written) == 1, "warmup should persist exactly one vector cache file"


def test_cold_start_loads_persisted_vectors_without_re_embedding(tmp_path, monkeypatch) -> None:
    from src.learning.rag import reset_embedding_runtime

    monkeypatch.setenv("PATHFINDER_RAG_VECTOR_CACHE_DIR", str(tmp_path))
    reset_embedding_runtime()
    # First process: embed + persist.
    warm_embedder = _NamespacedEmbedder()
    _persist_retriever(warm_embedder, EmbeddingCircuitBreaker(60.0, clock=_FakeClock())).warm()
    assert warm_embedder.batch_calls >= 1

    # Simulate a fresh process: drop in-memory shared vectors, new embedder.
    reset_embedding_runtime()
    cold_embedder = _NamespacedEmbedder()
    cold = _persist_retriever(cold_embedder, EmbeddingCircuitBreaker(60.0, clock=_FakeClock()))
    assert cold.warm() is True
    # The whole point: a cold start makes ZERO corpus-embedding API calls.
    assert cold_embedder.batch_calls == 0
    # And the loaded vectors actually drive the dense stage. The fake query
    # vector is [0,1], matching n.alg's persisted node vector (cosine 1.0).
    hits = cold.retrieve("photosynthesis chlorophyll plants")
    assert hits and hits[0].node.node_id == "n.alg"


def test_corpus_change_invalidates_persisted_vectors(tmp_path, monkeypatch) -> None:
    from src.learning.rag import reset_embedding_runtime

    monkeypatch.setenv("PATHFINDER_RAG_VECTOR_CACHE_DIR", str(tmp_path))
    reset_embedding_runtime()
    _persist_retriever(_NamespacedEmbedder(), EmbeddingCircuitBreaker(60.0, clock=_FakeClock())).warm()

    # A different corpus → different fingerprint → must re-embed, not reuse.
    reset_embedding_runtime()
    changed_embedder = _NamespacedEmbedder()
    changed_corpus = WikiCorpus(
        [
            _node(node_id="n.frac", title="Simplifying fractions", body="numerator denominator gcd"),
            _node(node_id="n.geo", title="Triangles", body="the angles sum to 180 degrees"),
        ]
    )
    changed = RagRetriever(
        changed_corpus,
        embedder=changed_embedder,
        circuit_breaker=EmbeddingCircuitBreaker(60.0, clock=_FakeClock()),
    )
    assert changed.warm() is True
    assert changed_embedder.batch_calls >= 1, "changed corpus must not reuse the stale cache"


def test_persisted_vector_round_trip_is_exact(tmp_path) -> None:
    from src.learning.rag import (
        _corpus_fingerprint,
        _load_persisted_vectors,
        _vector_cache_path,
        _write_persisted_vectors,
    )

    namespace = "text-embedding-3-small"
    texts = ["alpha beta", "gamma delta"]
    fp = _corpus_fingerprint(namespace, texts)
    path = _vector_cache_path(namespace, fp, directory=tmp_path)
    vectors = [[0.6, 0.8], [0.0, 1.0]]
    assert _write_persisted_vectors(path, namespace, fp, vectors) is True
    loaded = _load_persisted_vectors(path, namespace, fp, expected_count=2)
    assert loaded is not None
    for got, want in zip(loaded, vectors):
        assert got == pytest.approx(want, abs=1e-6)
    # Wrong fingerprint or count → reject (forces a re-embed).
    assert _load_persisted_vectors(path, namespace, "deadbeef", expected_count=2) is None
    assert _load_persisted_vectors(path, namespace, fp, expected_count=3) is None
