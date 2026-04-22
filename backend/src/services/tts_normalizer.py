# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Pre-synthesis text normaliser for TTS-bound assistant text.

This module rewrites graphemic phoneme citations such as ``/th/``, ``/sh/``,
``/k/`` into SSML ``<phoneme alphabet="ipa" ph="…">`` tags so Azure Speech /
Voice Live never resorts to letter-name pronunciation ("tee-aitch",
"ess-aitch", "kay"). The canonical phoneme map covers the full target-sound
inventory used across Wulo exercises plus conversational phonemes that may be
referenced in free text.

The normaliser is pure, side-effect-free, and safe to apply to any text prior
to SSML synthesis. Applying it twice is a no-op (already-wrapped ``<phoneme>``
blocks are masked during processing).

Conventions
-----------
* ``/th/`` always maps to voiceless ``θ``.
* ``/dh/`` always maps to voiced ``ð`` (preferred).
* ``/TH/`` (uppercase) is accepted as a deprecated legacy spelling for ``ð``
  and counted via :func:`count_deprecated_uppercase_th` for observability.
* Every other phoneme key is case-insensitive.
* No length marks are emitted in the map; callers that need a held sound
  should wrap the output in ``<prosody rate="x-slow">`` at the call site.
"""

from __future__ import annotations

import re
from typing import Dict, List, Literal, Tuple

# Canonical IPA mapping. Covers the full Wulo phoneme inventory:
#   - Primary targets with exercise suites: r, s, sh, th, k, f.
#   - Contrast / substitution partners: t, w, l, d, dh (voiced th).
#   - Voicing complements: v, z.
#   - Conversational phonemes: g, zh, ch, j, ng, y, h.
# Keys are lowercase; ``th`` is voiceless, ``dh`` is voiced. The ``TH``
# uppercase alias is handled separately as a deprecated legacy form.
PHONEME_MAP: Dict[str, str] = {
    "r": "ɹ",
    "s": "s",
    "sh": "ʃ",
    "th": "θ",
    "dh": "ð",
    "k": "k",
    "g": "ɡ",
    "f": "f",
    "v": "v",
    "z": "z",
    "zh": "ʒ",
    "t": "t",
    "d": "d",
    "l": "l",
    "w": "w",
    "ch": "tʃ",
    "j": "dʒ",
    "ng": "ŋ",
    "y": "j",
    "h": "h",
}

# Anchor words for the plain-text fallback ("the sound at the start of *think*").
# Only populated for sounds where an intuitive anchor exists; others fall back
# to "the X sound".
ANCHOR_WORDS: Dict[str, str] = {
    "r": "rabbit",
    "s": "sun",
    "sh": "sheep",
    "th": "think",
    "dh": "this",
    "k": "key",
    "g": "goat",
    "f": "fish",
    "v": "van",
    "z": "zebra",
    "zh": "measure",
    "t": "toy",
    "d": "dog",
    "l": "lion",
    "w": "water",
    "ch": "chair",
    "j": "jump",
    "ng": "ring",
    "y": "yes",
    "h": "hat",
}

# Keys ordered longest-first so multi-character tokens like ``sh``/``ch``/``ng``
# win against their single-character prefixes in the regex alternation.
_SORTED_KEYS: List[str] = sorted(PHONEME_MAP.keys(), key=len, reverse=True)

# Bounded graphemic phoneme pattern: ``/<key>/`` not adjacent to an alphanumeric
# character on either side, so URLs like ``http://`` are never matched.
# The capturing group preserves case so we can detect the legacy ``/TH/``
# spelling. Every other key is matched case-insensitively via the alternation.
#
# ``/TH/`` is listed as a literal (case-preserving) alternative first so it
# wins over the case-insensitive ``th`` match.
_GRAPHEME_ALTERNATION = "|".join(re.escape(k) for k in _SORTED_KEYS)
_GRAPHEME_PATTERN = re.compile(
    rf"(?<![A-Za-z0-9])/(TH|{_GRAPHEME_ALTERNATION})/(?![A-Za-z0-9])",
    flags=re.IGNORECASE,
)

# Mask for text that is already inside a ``<phoneme …>…</phoneme>`` block so we
# do not double-wrap on a second pass.
_EXISTING_PHONEME = re.compile(
    r"<phoneme\b[^>]*>.*?</phoneme>",
    flags=re.IGNORECASE | re.DOTALL,
)

# Second-sweep patterns for common spoken letter-name approximations a model
# might produce in its own response text. Each entry maps a case-insensitive
# phrase to the canonical phoneme key (looked up in ``PHONEME_MAP``).
_LETTER_NAME_PATTERNS: List[Tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(?:slash\s+)?tee[\s-]?aitch\b", re.IGNORECASE), "th"),
    (re.compile(r"\b(?:slash\s+)?ess[\s-]?aitch\b", re.IGNORECASE), "sh"),
    (re.compile(r"\b(?:slash\s+)?see[\s-]?aitch\b", re.IGNORECASE), "ch"),
    (re.compile(r"\b(?:slash\s+)?dee[\s-]?aitch\b", re.IGNORECASE), "dh"),
    (re.compile(r"\b(?:slash\s+)?zee[\s-]?aitch\b", re.IGNORECASE), "zh"),
    (re.compile(r"\b(?:slash\s+)?en[\s-]?gee\b", re.IGNORECASE), "ng"),
    (re.compile(r"\bdouble[\s-]?you\b", re.IGNORECASE), "w"),
]

_DEPRECATED_UPPERCASE_TH = re.compile(r"(?<![A-Za-z0-9])/TH/(?![A-Za-z0-9])")


def _escape_xml(value: str) -> str:
    """XML-escape text destined for SSML attribute values or text nodes."""
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _wrap_ssml_phoneme(key: str, *, fallback: str | None = None) -> str:
    """Return an SSML ``<phoneme>`` element for the given canonical key."""
    ipa = PHONEME_MAP[key]
    fallback_text = fallback if fallback is not None else "sound"
    return (
        f'<phoneme alphabet="ipa" ph="{_escape_xml(ipa)}">'
        f"{_escape_xml(fallback_text)}"
        "</phoneme>"
    )


def _wrap_anchor_phrase(key: str) -> str:
    """Return a plain-text fallback phrase for the given canonical key."""
    anchor = ANCHOR_WORDS.get(key)
    if anchor:
        return f"the sound at the start of {anchor}"
    return f"the {key} sound"


def _resolve_key(raw_match: str) -> str | None:
    """Resolve a matched phoneme token to its canonical lowercase key.

    ``/TH/`` (uppercase only) is interpreted as voiced ``dh``. Every other
    token is lower-cased before lookup.
    """
    if raw_match == "TH":
        return "dh"
    lowered = raw_match.lower()
    return lowered if lowered in PHONEME_MAP else None


def normalize_for_tts(
    text: str,
    *,
    mode: Literal["ssml", "plain"] = "ssml",
) -> str:
    """Rewrite graphemic phoneme citations in ``text``.

    Parameters
    ----------
    text:
        Free-form text that may contain ``/th/``-style phoneme citations.
    mode:
        ``"ssml"`` (default) emits ``<phoneme>`` elements suitable for Azure
        Speech SSML. ``"plain"`` emits a human-readable anchor-word phrase
        (``"the sound at the start of think"``) — used as a safety fallback
        when the consumer cannot accept SSML.

    The function is idempotent: any existing ``<phoneme …>…</phoneme>`` block
    in ``text`` is preserved verbatim.
    """
    if not text:
        return text

    # Mask existing SSML phoneme blocks so we never double-wrap them.
    masked_blocks: List[str] = []

    def _mask(match: re.Match[str]) -> str:
        masked_blocks.append(match.group(0))
        return f"\x00PHONEME_MASK_{len(masked_blocks) - 1}\x00"

    masked = _EXISTING_PHONEME.sub(_mask, text)

    def _rewrite_grapheme(match: re.Match[str]) -> str:
        raw = match.group(1)
        key = _resolve_key(raw)
        if key is None:
            return match.group(0)
        if mode == "plain":
            return _wrap_anchor_phrase(key)
        return _wrap_ssml_phoneme(key)

    rewritten = _GRAPHEME_PATTERN.sub(_rewrite_grapheme, masked)

    # Second sweep: spoken letter-name approximations.
    for pattern, key in _LETTER_NAME_PATTERNS:
        if mode == "plain":
            replacement = _wrap_anchor_phrase(key)
        else:
            replacement = _wrap_ssml_phoneme(key)
        rewritten = pattern.sub(replacement, rewritten)

    # Restore masked SSML phoneme blocks.
    def _unmask(match: re.Match[str]) -> str:
        index = int(match.group(1))
        return masked_blocks[index]

    return re.sub(r"\x00PHONEME_MASK_(\d+)\x00", _unmask, rewritten)


def wrap_as_ssml(
    body: str,
    *,
    voice: str,
    lang: str = "en-GB",
    lexicon_uri: str | None = None,
) -> str:
    """Wrap normalised ``body`` in a complete SSML document.

    The caller is responsible for passing already-normalised ``body`` produced
    by :func:`normalize_for_tts`. ``body`` may contain mixed plain text and
    SSML phoneme elements.
    """
    lexicon_fragment = (
        f'<lexicon uri="{_escape_xml(lexicon_uri)}"/>' if lexicon_uri else ""
    )
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xml:lang="{_escape_xml(lang)}">'
        f'<voice name="{_escape_xml(voice)}">'
        f"{lexicon_fragment}{body}"
        "</voice>"
        "</speak>"
    )


def contains_graphemic_phoneme(text: str) -> bool:
    """Return ``True`` if ``text`` still contains any residual ``/x/`` form.

    Useful for observability (counting slippage after normalisation).
    """
    if not text:
        return False
    return _GRAPHEME_PATTERN.search(text) is not None


def count_deprecated_uppercase_th(text: str) -> int:
    """Return the number of deprecated ``/TH/`` occurrences in ``text``."""
    if not text:
        return 0
    return len(_DEPRECATED_UPPERCASE_TH.findall(text))


__all__ = [
    "PHONEME_MAP",
    "ANCHOR_WORDS",
    "normalize_for_tts",
    "wrap_as_ssml",
    "contains_graphemic_phoneme",
    "count_deprecated_uppercase_th",
]
