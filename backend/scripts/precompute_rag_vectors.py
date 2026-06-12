"""Precompute and persist the RAG corpus embeddings — the "index once" step.

Corpus vectors are a pure function of (embedding deployment, corpus text), so
they should be computed once and loaded forever, not re-embedded on every
container cold start. This script embeds the bundled wiki corpus with the real
Azure embedder and writes the L2-normalised vectors to the on-disk cache that
``RagRetriever.warm()`` loads at boot.

Run it offline (CI/build, or by hand) whenever curriculum content or the
embedding deployment changes — the same trigger that requires re-running
``scripts/eval_rag_grounding.py``. The written file is keyed by a stable
fingerprint over the deployment name and the exact embedded text, so a stale
file is simply ignored by a retriever whose corpus has moved on.

Usage (needs Azure OpenAI creds + embeddings enabled in env):
    PATHFINDER_RAG_EMBEDDINGS_ENABLED=1 python -m scripts.precompute_rag_vectors

    # write to a specific directory (e.g. baked into the container image):
    PATHFINDER_RAG_EMBEDDINGS_ENABLED=1 \
        PATHFINDER_RAG_VECTOR_CACHE_DIR=/app/data/learning/wiki_vectors \
        python -m scripts.precompute_rag_vectors

Exit code is non-zero if embeddings are disabled/unavailable or the warmup
could not embed the whole corpus, so a build step can fail loudly.
"""

from __future__ import annotations

import argparse
import sys
from typing import List

from src.learning.models import WikiNode
from src.learning.rag import (
    RagRetriever,
    WikiCorpus,
    _corpus_fingerprint,
    _default_corpus_paths,
    _vector_cache_path,
    build_default_embedder,
    load_wiki_corpus,
)


def _load_corpus_nodes() -> List[WikiNode]:
    merged: List[WikiNode] = []
    for path in _default_corpus_paths():
        if path.exists():
            merged.extend(load_wiki_corpus(path).nodes())
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--max-failures",
        type=int,
        default=60,
        help="Failed warmup batches tolerated (patient budget for a tight TPM cap).",
    )
    parser.add_argument(
        "--retry-sleep",
        type=float,
        default=10.0,
        help="Seconds to sleep between failed warmup batches.",
    )
    args = parser.parse_args()

    embedder = build_default_embedder()
    if embedder is None:
        print(
            "ERROR: no embedder. Set PATHFINDER_RAG_EMBEDDINGS_ENABLED=1 and configure "
            "Azure OpenAI (deployment + creds) before precomputing vectors.",
            file=sys.stderr,
        )
        return 2
    namespace = getattr(embedder, "cache_namespace", None)
    if not namespace:
        print("ERROR: embedder has no cache_namespace; cannot persist.", file=sys.stderr)
        return 2

    nodes = _load_corpus_nodes()
    if not nodes:
        print("ERROR: corpus is empty; nothing to embed.", file=sys.stderr)
        return 2

    retriever = RagRetriever(WikiCorpus(nodes), embedder=embedder)
    texts = retriever._node_embed_texts()  # noqa: SLF001 — same texts warm() embeds
    fingerprint = _corpus_fingerprint(str(namespace), texts)
    cache_path = _vector_cache_path(str(namespace), fingerprint)

    print(
        f"Embedding {len(nodes)} nodes with deployment '{namespace}' "
        f"(fingerprint {fingerprint[:16]}…)\n  -> {cache_path}"
    )
    # warm() embeds in paced batches and writes the cache file on success.
    ok = retriever.warm(max_failures=args.max_failures, retry_sleep_s=args.retry_sleep)
    if not ok:
        print("ERROR: warmup did not complete; vectors not written.", file=sys.stderr)
        return 1
    if not cache_path.exists():
        print(
            "ERROR: warmup completed but no cache file at the expected path "
            "(loaded from an in-memory/shared cache instead?).",
            file=sys.stderr,
        )
        return 1
    size_kb = cache_path.stat().st_size / 1024
    print(f"OK: wrote {len(nodes)} vectors ({size_kb:.0f} KiB) to {cache_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
