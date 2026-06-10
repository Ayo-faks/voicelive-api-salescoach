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
import threading
import time
from collections import OrderedDict
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
# Re-calibrated for text-embedding-3-small on the 416-node corpus (2026-06):
# the SS3 physics/economics expansion moved the worst adversarial pair up to
# cosine 0.317 ('how do i make a bomb' -> fission), while the weakest legit
# dense-only rescue ('whats fotosynthisis' -> photosynthesis.definition) sits
# at 0.462. 0.40 splits that gap. NOTE: this is model- AND corpus-specific —
# ada-002 cannot separate these bands at all (they overlap ~0.68-0.81); re-run
# scripts/eval_rag_grounding.py after changing AZURE_OPENAI_EMBEDDING_DEPLOYMENT
# OR adding corpus content.
DEFAULT_EMBEDDING_THRESHOLD: float = 0.40

# Dense VETO threshold for lexically-admitted candidates. The lexical overlap
# gate alone leaks once the corpus is large: a single shared content word can
# clear overlap >= 0.5 ('bomb' -> fission page, 'capital of france' -> nouns).
# When (and only when) a query vector and corpus vectors are available, a
# lexical hit must ALSO score at least this cosine against the node, otherwise
# it is vetoed. Measured bands on the 416-node corpus: adversarial lexical
# hits top out at 0.317 (bomb->fission) while the weakest legitimate lexical
# hit ('what is mesnurasion on maths') scores 0.354 — 0.335 is the midpoint.
# When embeddings are unavailable (disabled / warming / circuit open) the veto
# is skipped and behaviour is exactly the previous lexical-only retriever, so
# the dense stage still can never block availability.
DEFAULT_EMBEDDING_VETO_THRESHOLD: float = 0.335

# Max characters of a node body folded into its embedding text. Caps cost and
# keeps the vector focused on the topic instead of being diluted by long
# worked examples further down the body.
_EMBED_BODY_CHARS: int = 2000

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Embedding runtime controls — fail-fast so the dense stage can never stall a
# learner turn. The 125s staging incident was the OpenAI SDK honouring a 60s
# Retry-After on a 429 *inside* the request path, twice; everything below
# exists to make that impossible while keeping embeddings enabled.
# ---------------------------------------------------------------------------
# Per-call timeout for a single query embedding on the request path.
EMBED_TIMEOUT_MS_ENV = "PATHFINDER_RAG_EMBEDDING_TIMEOUT_MS"
# SDK retry count for embedding calls (chat completions keep their own config).
EMBED_RETRIES_ENV = "PATHFINDER_RAG_EMBEDDING_RETRIES"
# How long the circuit stays open after an embedding failure (429/timeout).
EMBED_BREAKER_SECONDS_ENV = "PATHFINDER_RAG_EMBEDDING_CIRCUIT_BREAKER_SECONDS"
# Per-call timeout for a corpus warmup batch (off the request path).
NODE_EMBED_TIMEOUT_MS_ENV = "PATHFINDER_RAG_NODE_EMBEDDING_TIMEOUT_MS"

_DEFAULT_EMBED_TIMEOUT_MS = 1500
_DEFAULT_EMBED_RETRIES = 0
_DEFAULT_BREAKER_SECONDS = 120.0
_DEFAULT_NODE_EMBED_TIMEOUT_MS = 10_000
# Corpus warmup batch size. ~16 nodes x ~250 tokens stays well under the
# per-minute token cap of a small embedding deployment, so warmup paces
# itself instead of firing one giant 100K-token request that can only 429.
_EMBED_BATCH_SIZE = 16
# Warmup tolerates this many failed batches (sleeping between retries) before
# giving up; a later request re-arms it after the breaker window.
_WARM_MAX_FAILURES = 10
_WARM_RETRY_SLEEP_S = 20.0
_QUERY_VEC_CACHE_MAX = 512


def _env_float(name: str, default: float) -> float:
    try:
        raw = os.getenv(name, "").strip()
        return float(raw) if raw else default
    except ValueError:
        return default


class EmbeddingCircuitBreaker:
    """Tiny time-window breaker shared by the embedding request path.

    One failure (429 / timeout / error) opens the circuit for ``window_seconds``;
    while open every retrieval skips the dense stage instantly and answers from
    lexical retrieval. A successful embedding closes it. This replaces the old
    behaviour of permanently disabling embeddings for the process lifetime, so
    a transient rate-limit no longer kills semantics until the next deploy.
    """

    def __init__(
        self,
        window_seconds: Optional[float] = None,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._window = (
            window_seconds
            if window_seconds is not None
            else _env_float(EMBED_BREAKER_SECONDS_ENV, _DEFAULT_BREAKER_SECONDS)
        )
        self._clock = clock
        self._lock = threading.Lock()
        self._open_until = 0.0
        self._reason: Optional[str] = None

    def allow(self) -> bool:
        return self._clock() >= self._open_until

    @property
    def reason(self) -> Optional[str]:
        return self._reason

    def record_failure(self, reason: str = "error") -> None:
        with self._lock:
            self._open_until = self._clock() + self._window
            self._reason = reason
        logger.warning(
            "wulo.rag.embedding circuit_open reason=%s window_s=%.0f",
            reason,
            self._window,
        )

    def record_success(self) -> None:
        with self._lock:
            self._open_until = 0.0
            self._reason = None

    def reset(self) -> None:
        self.record_success()


# Process-wide defaults: every retriever built without an explicit breaker
# shares this one, so a 429 seen by the REST tutor also short-circuits the
# voice retriever instead of each path rediscovering the outage.
_SHARED_BREAKER = EmbeddingCircuitBreaker()
# Corpus vectors shared across retriever instances (REST tutor, websocket
# focus retriever, voice planner all load the same corpus) keyed by
# (embedder namespace, corpus fingerprint) — the corpus is embedded at most
# once per process instead of once per retriever.
_SHARED_NODE_VECTORS: "dict[Tuple[str, int, int], List[List[float]]]" = {}
_SHARED_NODE_VECTORS_LOCK = threading.Lock()


def reset_embedding_runtime() -> None:
    """Test hook: close the shared breaker and drop shared corpus vectors."""
    _SHARED_BREAKER.reset()
    with _SHARED_NODE_VECTORS_LOCK:
        _SHARED_NODE_VECTORS.clear()


def _classify_embedding_error(exc: BaseException) -> str:
    status = getattr(exc, "status_code", None)
    if status == 429:
        return "rate_limited"
    if "Timeout" in type(exc).__name__:
        return "timeout"
    return "error"

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
        embedding_veto_threshold: float = DEFAULT_EMBEDDING_VETO_THRESHOLD,
        circuit_breaker: Optional[EmbeddingCircuitBreaker] = None,
    ) -> None:
        if similarity_threshold < 0 or similarity_threshold > 1:
            raise ValueError("similarity_threshold must be in [0, 1]")
        if top_k < 1:
            raise ValueError("top_k must be >= 1")
        if embedding_threshold < 0 or embedding_threshold > 1:
            raise ValueError("embedding_threshold must be in [0, 1]")
        if embedding_veto_threshold < 0 or embedding_veto_threshold > 1:
            raise ValueError("embedding_veto_threshold must be in [0, 1]")
        self.corpus = corpus
        self.similarity_threshold = similarity_threshold
        self.top_k = top_k
        self.embedding_threshold = embedding_threshold
        self.embedding_veto_threshold = embedding_veto_threshold
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

        # Dense (semantic) stage — optional. When ``embedder`` is None the
        # retriever is byte-for-byte the pure-lexical retriever, so offline use
        # and existing tests are unchanged. Corpus vectors are built by
        # ``warm()`` (explicitly, or in a background thread via ``warm_async``)
        # — NEVER synchronously inside ``retrieve`` — so a learner request can
        # never pay the corpus embedding cost. Until warmup completes the
        # retriever simply runs lexical-only.
        self._embedder = embedder
        self._node_vectors: Optional[List[List[float]]] = None
        self._breaker = circuit_breaker if circuit_breaker is not None else _SHARED_BREAKER
        # Successful query vectors only, keyed by whitespace/case-normalised
        # question, LRU-capped. Failures are deliberately NOT cached here —
        # the circuit breaker already makes repeated failures cheap for its
        # window, and once it closes the query gets a fresh chance.
        self._query_vec_cache: "OrderedDict[str, List[float]]" = OrderedDict()
        self._warm_lock = threading.Lock()
        self._warm_thread_lock = threading.Lock()
        self._warm_thread: Optional[threading.Thread] = None
        self._warm_exhausted_at: Optional[float] = None

    # ------------------------------------------------------------------
    # Dense-stage warmup (corpus vectors)
    # ------------------------------------------------------------------
    def _node_embed_texts(self) -> List[str]:
        return [
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

    def _shared_cache_key(self, texts: Sequence[str]) -> Optional[Tuple[str, int, int]]:
        """Cross-instance cache key, only for embedders that declare a namespace.

        ``build_azure_embedder`` tags its callable with ``cache_namespace``
        (the deployment name); test fakes don't, so they never share vectors
        across instances and stay isolated.
        """
        namespace = getattr(self._embedder, "cache_namespace", None)
        if not namespace:
            return None
        return (str(namespace), len(texts), hash(tuple(texts)))

    def warm(
        self,
        *,
        max_failures: int = _WARM_MAX_FAILURES,
        retry_sleep_s: float = _WARM_RETRY_SLEEP_S,
    ) -> bool:
        """Embed the corpus once, in paced batches. Safe to call repeatedly.

        Runs off the request path (background thread or an explicit caller such
        as the eval harness). Batches keep each call small enough to clear a
        modest TPM cap; on a failed batch it sleeps and retries up to
        ``max_failures`` times, then gives up and opens the breaker — a later
        request re-arms warmup after the breaker window via ``warm_async``.
        """
        if self._embedder is None:
            return False
        if self._node_vectors is not None:
            return True
        with self._warm_lock:
            if self._node_vectors is not None:
                return True
            texts = self._node_embed_texts()
            if not texts:
                self._node_vectors = []
                return True
            cache_key = self._shared_cache_key(texts)
            if cache_key is not None:
                with _SHARED_NODE_VECTORS_LOCK:
                    cached = _SHARED_NODE_VECTORS.get(cache_key)
                if cached is not None:
                    self._node_vectors = cached
                    return True
            started = time.perf_counter()
            vectors: List[List[float]] = []
            failures = 0
            i = 0
            while i < len(texts):
                batch = texts[i : i + _EMBED_BATCH_SIZE]
                try:
                    raw = self._embedder(batch)
                except Exception:  # noqa: BLE001 — never let embedding break retrieval
                    logger.warning("wulo.rag.embedding warmup_batch_error", exc_info=True)
                    raw = None
                if raw is not None and len(raw) == len(batch):
                    vectors.extend(_normalize(v) for v in raw)
                    i += len(batch)
                    continue
                failures += 1
                reason = getattr(self._embedder, "last_failure_reason", None) or "error"
                if failures >= max_failures:
                    logger.warning(
                        "wulo.rag.embedding warmup_gave_up nodes=%d embedded=%d failures=%d reason=%s",
                        len(texts),
                        i,
                        failures,
                        reason,
                    )
                    self._breaker.record_failure(reason)
                    self._warm_exhausted_at = time.monotonic()
                    return False
                if retry_sleep_s > 0:
                    time.sleep(retry_sleep_s)
            self._node_vectors = vectors
            if cache_key is not None:
                with _SHARED_NODE_VECTORS_LOCK:
                    _SHARED_NODE_VECTORS[cache_key] = vectors
            logger.info(
                "wulo.rag.embedding warmup_complete nodes=%d total_ms=%d failures=%d",
                len(texts),
                int((time.perf_counter() - started) * 1000),
                failures,
            )
            return True

    def warm_async(self) -> None:
        """Kick corpus warmup on a daemon thread (idempotent, non-blocking)."""
        if self._embedder is None or self._node_vectors is not None:
            return
        # Cooldown after an exhausted warmup so a dead embedding endpoint is
        # not hammered on every request.
        if (
            self._warm_exhausted_at is not None
            and time.monotonic() - self._warm_exhausted_at < _env_float(EMBED_BREAKER_SECONDS_ENV, _DEFAULT_BREAKER_SECONDS)
        ):
            return
        with self._warm_thread_lock:
            if self._warm_thread is not None and self._warm_thread.is_alive():
                return
            self._warm_exhausted_at = None
            thread = threading.Thread(target=self.warm, name="rag-embed-warmup", daemon=True)
            self._warm_thread = thread
            thread.start()

    # ------------------------------------------------------------------
    # Dense-stage query path (strictly bounded)
    # ------------------------------------------------------------------
    def _query_vector(self, query: str) -> Tuple[Optional[List[float]], str]:
        """Return ``(vector, status)`` for ``query`` — never slow, never raises.

        status ∈ {cache_hit, ok, circuit_open, rate_limited, timeout, error}.
        """
        key = " ".join(query.lower().split())
        cached = self._query_vec_cache.get(key)
        if cached is not None:
            self._query_vec_cache.move_to_end(key)
            return cached, "cache_hit"
        if self._embedder is None or not self._breaker.allow():
            return None, "circuit_open"
        try:
            raw = self._embedder([query])
        except Exception:  # noqa: BLE001
            logger.warning("wulo.rag.embedding query_error", exc_info=True)
            raw = None
        if not raw:
            reason = getattr(self._embedder, "last_failure_reason", None) or "error"
            self._breaker.record_failure(reason)
            return None, reason
        vec = _normalize(raw[0])
        self._query_vec_cache[key] = vec
        while len(self._query_vec_cache) > _QUERY_VEC_CACHE_MAX:
            self._query_vec_cache.popitem(last=False)
        self._breaker.record_success()
        return vec, "ok"

    def retrieve(
        self,
        query: str,
        *,
        subject: Optional[str] = None,
        year_group: Optional[str] = None,
    ) -> List[RetrievalHit]:
        t_start = time.perf_counter()
        q_tokens = _tokens(query)
        if not q_tokens:
            return []
        # Rescue obvious typos by snapping query tokens onto known corpus terms
        # before the fail-closed gate runs. Off-topic words have no near match
        # and pass through unchanged, so the grounding guarantee is preserved.
        q_tokens = _canonicalize_query_tokens(q_tokens, self._vocab)
        # Dense stage (optional, strictly bounded). Corpus vectors are only
        # ever built off the request path: if they are not ready yet we kick a
        # background warmup and answer lexically. The query embedding itself is
        # a single short call behind a low timeout + the circuit breaker, so a
        # rate-limited endpoint costs at most one bounded attempt per window.
        node_vectors = self._node_vectors
        q_vector: Optional[List[float]] = None
        embed_status = "disabled"
        embed_ms = 0.0
        if self._embedder is not None:
            if node_vectors is None:
                self.warm_async()
                embed_status = "warming" if self._breaker.allow() else "circuit_open"
            elif not self._breaker.allow():
                embed_status = "circuit_open"
            else:
                t_embed = time.perf_counter()
                q_vector, embed_status = self._query_vector(query)
                embed_ms = (time.perf_counter() - t_embed) * 1000
        t_lexical = time.perf_counter()
        # (combined, overlap, bm25, node). ``combined = max(overlap, cosine)`` is
        # the ranking key. Admission (when dense is live):
        #   lexical hit:  overlap >= similarity_threshold AND
        #                 cosine >= embedding_veto_threshold   (dense veto)
        #   dense add:    cosine >= embedding_threshold
        # When dense is unavailable (disabled / warming / circuit open) the
        # veto and the add-gate are both skipped and this loop is byte-for-byte
        # the lexical+difflib retriever, so embeddings can never block a turn.
        #
        # The dense gates are SAFE ONLY with an embedding model whose cosine
        # cleanly separates curriculum-relevant queries from off-topic /
        # jailbreak ones. text-embedding-3-small does (see the threshold notes
        # on DEFAULT_EMBEDDING_THRESHOLD / DEFAULT_EMBEDDING_VETO_THRESHOLD).
        # text-embedding-ada-002 does NOT (bands overlap ~0.68-0.81), so it must
        # not be used here. Always re-run scripts/eval_rag_grounding.py after
        # changing AZURE_OPENAI_EMBEDDING_DEPLOYMENT or growing the corpus.
        scored: List[Tuple[float, float, float, WikiNode]] = []
        for idx, node in enumerate(self._nodes):
            if subject is not None and node.subject != subject:
                continue
            if year_group is not None and node.year_group != year_group:
                continue
            n_tokens = self._node_tokens[idx]
            overlap = _overlap_coefficient(q_tokens, n_tokens)
            cosine = 0.0
            dense_live = q_vector is not None and node_vectors is not None
            if dense_live:
                cosine = _dot(q_vector, node_vectors[idx])
            lexical_ok = overlap >= self.similarity_threshold
            # Dense veto: a lexical hit that the embedding model says is
            # semantically unrelated to the query is a stop-word/shared-token
            # collision ('bomb' -> fission page), not a grounding. Only applied
            # while dense is live so availability never depends on embeddings.
            if lexical_ok and dense_live and cosine < self.embedding_veto_threshold:
                lexical_ok = False
            semantic_ok = dense_live and cosine >= self.embedding_threshold
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
        now = time.perf_counter()
        # One structured line per retrieval, Log Analytics friendly:
        # ContainerAppConsoleLogs_CL | where Log_s has "wulo.rag.retrieve"
        logger.info(
            "wulo.rag.retrieve total_ms=%d lexical_ms=%d embed_ms=%d embed_status=%s hits=%d subject=%s",
            int((now - t_start) * 1000),
            int((now - t_lexical) * 1000),
            int(embed_ms),
            embed_status,
            len(hits),
            subject or "-",
        )
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
    """Build a fail-fast Azure OpenAI embedding function, or None when unavailable.

    Reuses the project's shared :func:`build_openai_client` (key or managed
    identity) so the dense stage authenticates exactly like the chat path, but
    overrides the SDK's retry/timeout behaviour **for embeddings only**:
    ``max_retries`` defaults to 0 and each call carries a strict timeout, so a
    429 with a 60s Retry-After can never block a learner turn (it surfaces as
    a fast failure and the circuit breaker takes over). Chat completions keep
    the SDK defaults — the override is applied per-call via ``with_options``.

    Single-text calls (live query embeddings) use the tight
    ``PATHFINDER_RAG_EMBEDDING_TIMEOUT_MS`` budget; multi-text calls (corpus
    warmup batches, which run off the request path) get the more generous
    ``PATHFINDER_RAG_NODE_EMBEDDING_TIMEOUT_MS``.
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
    query_timeout_s = _env_float(EMBED_TIMEOUT_MS_ENV, _DEFAULT_EMBED_TIMEOUT_MS) / 1000.0
    node_timeout_s = _env_float(NODE_EMBED_TIMEOUT_MS_ENV, _DEFAULT_NODE_EMBED_TIMEOUT_MS) / 1000.0
    max_retries = int(_env_float(EMBED_RETRIES_ENV, _DEFAULT_EMBED_RETRIES))

    def _embed(texts: List[str]) -> Optional[List[List[float]]]:
        if not texts:
            return []
        timeout_s = query_timeout_s if len(texts) == 1 else node_timeout_s
        _embed.last_failure_reason = None  # type: ignore[attr-defined]
        try:
            resp = client.with_options(
                timeout=timeout_s, max_retries=max_retries
            ).embeddings.create(model=deployment, input=texts)
        except Exception as exc:  # noqa: BLE001
            reason = _classify_embedding_error(exc)
            _embed.last_failure_reason = reason  # type: ignore[attr-defined]
            logger.warning(
                "wulo.rag.embedding call_failed reason=%s batch=%d timeout_s=%.1f",
                reason,
                len(texts),
                timeout_s,
            )
            return None
        # The SDK preserves input order; sort by index defensively anyway.
        rows = sorted(resp.data, key=lambda d: d.index)
        return [list(r.embedding) for r in rows]

    _embed.last_failure_reason = None  # type: ignore[attr-defined]
    # Opt this embedder into the cross-instance corpus-vector cache.
    _embed.cache_namespace = deployment  # type: ignore[attr-defined]
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
    retriever = RagRetriever(
        WikiCorpus(merged_nodes),
        similarity_threshold=similarity_threshold,
        top_k=top_k,
        embedder=embedder if embedder is not None else build_default_embedder(),
    )
    # Pre-warm corpus vectors in the background so the first learner request
    # never pays the (batched, minutes-long under a tight TPM cap) corpus
    # embedding cost — retrieval is lexical-only until warmup lands.
    retriever.warm_async()
    return retriever

