# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Startup + runtime health check for the PLS pronunciation lexicon.

The Azure Speech / Voice Live stack resolves drill tokens (``TH_THIN_MODEL``
etc.) through a remote PLS lexicon URL specified by
``AZURE_CUSTOM_LEXICON_URL``. Silent drift between the local repo copy and the
hosted blob is the most common source of "the avatar said tee-aitch" bug
reports, so we fail loud in production and warn in dev when:

* the remote PLS document cannot be fetched;
* the remote XML is malformed or missing the PLS root element;
* a ``_MODEL`` token known to the frontend has no entry in the remote lexicon.

The module exposes:

* :func:`check_lexicon` — pure, returns a structured :class:`LexiconHealth`
  dataclass. Used by tests.
* :func:`run_startup_check` — best-effort wrapper that emits log lines and
  raises on prod-critical failure.
* :func:`register_health_route` — attaches a ``/api/health/lexicon`` Flask
  route exposing the same structured report.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import URLError
from urllib.request import Request, urlopen

from flask import Flask, jsonify

# ``defusedxml`` is the safe XML parser used across the stack; fall back to the
# stdlib parser when it is not installed so the health check still runs in
# minimal environments (the PLS files we consume are first-party).
try:  # pragma: no cover - trivial import guard
    from defusedxml import ElementTree as _ET  # pyright: ignore[reportMissingImports]
    _USING_DEFUSED = True
except ImportError:  # pragma: no cover
    import xml.etree.ElementTree as _ET  # type: ignore[assignment]
    _USING_DEFUSED = False

from src.services.drill_tokens import DRILL_TOKEN_DISPLAY_MAP

logger = logging.getLogger(__name__)

PLS_NAMESPACE = "{http://www.w3.org/2005/01/pronunciation-lexicon}"
_FETCH_TIMEOUT_SECONDS = 5.0
_MAX_LEXICON_BYTES = 2 * 1024 * 1024  # 2 MiB hard cap — PLS documents are tiny.


@dataclass
class LexiconHealth:
    """Structured result of a single lexicon health check."""

    ok: bool
    source: str
    fetched_bytes: int = 0
    graphemes_found: int = 0
    missing_tokens: List[str] = field(default_factory=list)
    per_sound_coverage: Dict[str, Dict[str, int]] = field(default_factory=dict)
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "source": self.source,
            "fetched_bytes": self.fetched_bytes,
            "graphemes_found": self.graphemes_found,
            "missing_tokens": list(self.missing_tokens),
            "per_sound_coverage": dict(self.per_sound_coverage),
            "error": self.error,
        }


def _extract_sound_prefix(token: str) -> str:
    return token.split("_", 1)[0].lower() if "_" in token else token.lower()


def _fetch_bytes(source: str) -> Tuple[bytes, str]:
    """Fetch PLS bytes from either an ``http(s)://`` URL or local path.

    Returns a tuple ``(raw_bytes, resolved_source)`` where ``resolved_source``
    echoes the scheme used. Raises :class:`RuntimeError` on any failure.
    """
    if source.startswith(("http://", "https://")):
        try:
            request = Request(source, headers={"User-Agent": "wulo-lexicon-healthcheck/1.0"})
            with urlopen(request, timeout=_FETCH_TIMEOUT_SECONDS) as response:  # nosec B310 - URL is operator-controlled config
                raw = response.read(_MAX_LEXICON_BYTES + 1)
        except (URLError, TimeoutError, OSError) as exc:
            raise RuntimeError(f"lexicon fetch failed: {exc}") from exc
        if len(raw) > _MAX_LEXICON_BYTES:
            raise RuntimeError("lexicon exceeds 2 MiB size cap")
        return raw, source

    path = Path(source)
    if not path.exists():
        raise RuntimeError(f"lexicon path does not exist: {source}")
    raw = path.read_bytes()
    if len(raw) > _MAX_LEXICON_BYTES:
        raise RuntimeError("lexicon exceeds 2 MiB size cap")
    return raw, str(path)


def _parse_pls_graphemes(raw: bytes) -> List[str]:
    """Return the list of ``<grapheme>`` text nodes in a PLS document.

    Raises :class:`RuntimeError` if the document is not a PLS lexicon or is
    malformed.
    """
    try:
        root = _ET.fromstring(raw)
    except _ET.ParseError as exc:
        raise RuntimeError(f"PLS parse error: {exc}") from exc

    tag = getattr(root, "tag", "")
    if tag != f"{PLS_NAMESPACE}lexicon" and tag != "lexicon":
        raise RuntimeError(f"not a PLS document (root tag: {tag!r})")

    graphemes: List[str] = []
    # Support both namespaced and non-namespaced PLS (some older tooling omits xmlns).
    for candidate in (f".//{PLS_NAMESPACE}grapheme", ".//grapheme"):
        for element in root.findall(candidate):
            text = (element.text or "").strip()
            if text:
                graphemes.append(text)
        if graphemes:
            break
    return graphemes


def check_lexicon(
    source: str,
    *,
    required_tokens: Optional[List[str]] = None,
) -> LexiconHealth:
    """Fetch ``source`` and validate it covers ``required_tokens``.

    ``source`` may be an HTTP(S) URL (typical prod) or a filesystem path
    (typical dev / CI). ``required_tokens`` defaults to the ``_MODEL`` keys
    from :data:`src.services.drill_tokens.DRILL_TOKEN_DISPLAY_MAP`.
    """
    required = required_tokens or list(DRILL_TOKEN_DISPLAY_MAP.keys())

    try:
        raw, resolved = _fetch_bytes(source)
    except RuntimeError as exc:
        return LexiconHealth(ok=False, source=source, error=str(exc))

    try:
        graphemes = _parse_pls_graphemes(raw)
    except RuntimeError as exc:
        return LexiconHealth(
            ok=False,
            source=resolved,
            fetched_bytes=len(raw),
            error=str(exc),
        )

    grapheme_set = set(graphemes)
    missing = [token for token in required if token not in grapheme_set]

    per_sound: Dict[str, Dict[str, int]] = {}
    for token in required:
        sound = _extract_sound_prefix(token)
        bucket = per_sound.setdefault(sound, {"required": 0, "covered": 0})
        bucket["required"] += 1
        if token in grapheme_set:
            bucket["covered"] += 1

    return LexiconHealth(
        ok=len(missing) == 0,
        source=resolved,
        fetched_bytes=len(raw),
        graphemes_found=len(graphemes),
        missing_tokens=missing,
        per_sound_coverage=per_sound,
    )


def run_startup_check(
    source: Optional[str],
    *,
    strict: bool = False,
) -> Optional[LexiconHealth]:
    """Run :func:`check_lexicon` at boot, logging and optionally raising.

    Parameters
    ----------
    source:
        The lexicon URL or path. When empty, the check is skipped with a
        warning (developers may not have ``AZURE_CUSTOM_LEXICON_URL`` set).
    strict:
        When ``True``, a failed check raises :class:`RuntimeError`. Production
        deployments should pass ``strict=True`` to fail the container boot.
    """
    if not source:
        logger.warning(
            "Lexicon health check skipped: AZURE_CUSTOM_LEXICON_URL not set; "
            "Voice Live will fall back to letter-name pronunciation for drill tokens."
        )
        return None

    if not _USING_DEFUSED:
        logger.warning(
            "defusedxml not installed; falling back to stdlib XML parser for PLS "
            "health check. Install defusedxml for hardened XML parsing."
        )

    result = check_lexicon(source)
    if result.ok:
        logger.info(
            "Lexicon health OK: %s graphemes, source=%s, coverage=%s",
            result.graphemes_found,
            result.source,
            result.per_sound_coverage,
        )
        return result

    message = (
        f"Lexicon health FAILED: source={result.source} error={result.error} "
        f"missing_tokens={result.missing_tokens}"
    )
    logger.error(message)
    if strict:
        raise RuntimeError(message)
    return result


def register_health_route(
    app: Flask,
    source_provider: Any,
    *,
    route: str = "/api/health/lexicon",
) -> None:
    """Attach a JSON health endpoint to ``app``.

    ``source_provider`` is a zero-arg callable returning the current lexicon
    URL (passed as a callable so tests can override the config without
    monkey-patching module state).
    """

    def _lexicon_health_view() -> Any:  # pragma: no cover - exercised via integration
        source = source_provider() or ""
        if not source:
            return jsonify({
                "ok": False,
                "source": "",
                "error": "AZURE_CUSTOM_LEXICON_URL not set",
            }), 503
        result = check_lexicon(source)
        status = 200 if result.ok else 503
        return jsonify(result.to_dict()), status

    app.add_url_rule(
        route,
        endpoint="lexicon_health",
        view_func=_lexicon_health_view,
        methods=["GET"],
    )


__all__ = [
    "LexiconHealth",
    "check_lexicon",
    "run_startup_check",
    "register_health_route",
]
