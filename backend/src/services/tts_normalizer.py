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

# --- Math / LaTeX speech normalisation -------------------------------------
# Spoken-text only: keep displayed card content untouched. The goal is that
# Azure TTS never voices literal control sequences ("back slash times") or
# raw caret / Unicode exponents, and that simple maths reads naturally
# (``3x^2 + 4x`` -> "3x squared + 4x").

# LaTeX command tokens that do not read as their own English word. Anything not
# listed simply has its leading backslash stripped so the bare word is spoken
# (``\alpha`` -> "alpha"); the literal word "backslash" is never voiced.
_LATEX_WORD_MAP: Dict[str, str] = {
    "times": "times",
    "cdot": "times",
    "div": "divided by",
    "pm": "plus or minus",
    "mp": "minus or plus",
    "leq": "less than or equal to",
    "le": "less than or equal to",
    "geq": "greater than or equal to",
    "ge": "greater than or equal to",
    "neq": "not equal to",
    "ne": "not equal to",
    "approx": "approximately",
    "equiv": "is equivalent to",
    "infty": "infinity",
    "sum": "the sum of",
    "prod": "the product of",
    "int": "the integral of",
    "deg": "degrees",
    "circ": "degrees",
    "ldots": "and so on",
    "dots": "and so on",
    "cdots": "and so on",
}

# Unicode superscript characters -> their plain-digit equivalents.
_SUPERSCRIPT_DIGITS: Dict[str, str] = {
    "\u2070": "0",
    "\u00b9": "1",
    "\u00b2": "2",
    "\u00b3": "3",
    "\u2074": "4",
    "\u2075": "5",
    "\u2076": "6",
    "\u2077": "7",
    "\u2078": "8",
    "\u2079": "9",
    "\u207f": "n",
}

# Unicode maths operators -> spoken words (Azure can voice these inconsistently).
_UNICODE_MATH_OPERATORS: Dict[str, str] = {
    "\u00d7": " times ",  # ×
    "\u00f7": " divided by ",  # ÷
    "\u2212": " minus ",  # −
    "\u00b7": " times ",  # ·
    "\u2264": " less than or equal to ",  # ≤
    "\u2265": " greater than or equal to ",  # ≥
    "\u2260": " not equal to ",  # ≠
    "\u2248": " approximately ",  # ≈
}

_FRAC_PATTERN = re.compile(r"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}")
_SQRT_PATTERN = re.compile(r"\\sqrt\s*\{([^{}]*)\}")
_CARET_BRACED = re.compile(r"\^\{([^{}]+)\}")
_CARET_SIMPLE = re.compile(r"\^(-?\w+)")
_LATEX_COMMAND_PATTERN = re.compile(r"\\([A-Za-z]+)")
_SUPERSCRIPT_RUN = re.compile("[" + "".join(_SUPERSCRIPT_DIGITS) + "]+")
_BACKSLASH_RUN = re.compile(r"\\+")
_MULTISPACE = re.compile(r"[ \t]{2,}")


def _spoken_exponent(exp: str) -> str:
    """Return a natural-language rendering of an exponent token."""
    exp = exp.strip()
    if exp == "2":
        return " squared"
    if exp == "3":
        return " cubed"
    return f" to the power of {exp}"


def _normalize_math_for_speech(text: str) -> str:
    """Rewrite maths / LaTeX fragments into naturally spoken English.

    Applied only to spoken-bound text. Leaves prose without maths untouched so
    instruction prompts are never mangled.
    """
    if not text:
        return text
    if (
        "\\" not in text
        and "^" not in text
        and not any(ch in text for ch in _SUPERSCRIPT_DIGITS)
        and not any(ch in text for ch in _UNICODE_MATH_OPERATORS)
    ):
        return text

    # \frac{a}{b} -> "a over b"; \sqrt{x} -> "the square root of x".
    text = _FRAC_PATTERN.sub(lambda m: f" {m.group(1)} over {m.group(2)} ", text)
    text = _SQRT_PATTERN.sub(lambda m: f" the square root of {m.group(1)} ", text)

    # Caret exponents: x^2 -> "x squared", x^{10} -> "to the power of 10".
    text = _CARET_BRACED.sub(lambda m: _spoken_exponent(m.group(1)), text)
    text = _CARET_SIMPLE.sub(lambda m: _spoken_exponent(m.group(1)), text)

    # Unicode superscript runs: x² -> "x squared".
    text = _SUPERSCRIPT_RUN.sub(
        lambda m: _spoken_exponent("".join(_SUPERSCRIPT_DIGITS[ch] for ch in m.group(0))),
        text,
    )

    # Remaining LaTeX commands: mapped phrase, else strip the backslash.
    def _command(match: re.Match[str]) -> str:
        name = match.group(1)
        word = _LATEX_WORD_MAP.get(name.lower())
        return f" {word} " if word else f" {name} "

    text = _LATEX_COMMAND_PATTERN.sub(_command, text)

    # Unicode maths operators.
    for symbol, word in _UNICODE_MATH_OPERATORS.items():
        if symbol in text:
            text = text.replace(symbol, word)

    # Drop any stray backslashes so the word "backslash" is never voiced.
    text = _BACKSLASH_RUN.sub(" ", text)
    return _MULTISPACE.sub(" ", text)


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
    return f'<phoneme alphabet="ipa" ph="{_escape_xml(ipa)}">' f"{_escape_xml(fallback_text)}" "</phoneme>"


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

    # Third sweep: make maths / LaTeX fragments speakable so Azure never voices
    # literal control sequences ("back slash times") or caret/Unicode exponents.
    rewritten = _normalize_math_for_speech(rewritten)

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
    lexicon_fragment = f'<lexicon uri="{_escape_xml(lexicon_uri)}"/>' if lexicon_uri else ""
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
