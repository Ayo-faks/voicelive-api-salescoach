"""Offline ingestion pipeline for the Pathfinder explanation wiki (RAG corpus).

This package is a BUILD-TIME tool only. Nothing here may be imported by the
request hot path (``src.learning.api`` / ``rag.py`` / ``assistant_llm.py``). It
turns licensed/open source material + the curriculum map into validated
``WikiNode`` seed files under ``data/learning/wiki/``.

Pipeline stages:
    sources  -> raw blocks (+ license + url)
    chunker  -> subtopic-sized candidate chunks keyed to a curriculum entry
    safety   -> age-appropriateness + topical-scope gate (quarantines rejects)
    emit     -> WikiNode dicts (constructed through WikiNode(**payload))
    build    -> per-subject seed files in the loader's {version,lang,...} shape

See ``build_corpus.py`` for the CLI entry point.
"""
