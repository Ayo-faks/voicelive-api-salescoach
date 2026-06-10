"""Unit tests for :mod:`src.services.tts_normalizer`."""

from __future__ import annotations

from src.services.tts_normalizer import (
    ANCHOR_WORDS,
    PHONEME_MAP,
    contains_graphemic_phoneme,
    count_deprecated_uppercase_th,
    normalize_for_tts,
    wrap_as_ssml,
)


class TestPhonemeMap:
    def test_full_target_inventory_present(self):
        """Every primary target sound must be in the canonical map."""
        required = {"r", "s", "sh", "th", "dh", "k", "f"}
        assert required.issubset(set(PHONEME_MAP.keys()))

    def test_voiceless_and_voiced_th_distinct(self):
        assert PHONEME_MAP["th"] == "θ"
        assert PHONEME_MAP["dh"] == "ð"

    def test_every_key_has_anchor_word(self):
        missing = [key for key in PHONEME_MAP if key not in ANCHOR_WORDS]
        assert missing == []

    def test_no_length_marks(self):
        for key, value in PHONEME_MAP.items():
            assert "ː" not in value, f"{key} has length mark: {value!r}"


class TestNormalizeGraphemes:
    def test_voiceless_th_maps_to_theta(self):
        assert '<phoneme alphabet="ipa" ph="θ">' in normalize_for_tts("say /th/ again")

    def test_voiced_dh_maps_to_eth(self):
        assert '<phoneme alphabet="ipa" ph="ð">' in normalize_for_tts("say /dh/ again")

    def test_uppercase_th_maps_to_eth_legacy(self):
        out = normalize_for_tts("legacy /TH/ spelling")
        assert '<phoneme alphabet="ipa" ph="ð">' in out

    def test_all_primary_sounds_rewritten(self):
        cases = {
            "r": "ɹ",
            "s": "s",
            "sh": "ʃ",
            "k": "k",
            "f": "f",
            "g": "ɡ",
            "v": "v",
            "z": "z",
            "zh": "ʒ",
            "ch": "tʃ",
            "j": "dʒ",
            "ng": "ŋ",
            "w": "w",
            "l": "l",
            "t": "t",
            "d": "d",
            "y": "j",
            "h": "h",
        }
        for key, ipa in cases.items():
            out = normalize_for_tts(f"practise /{key}/ now")
            assert f'ph="{ipa}"' in out, f"failed for /{key}/ → expected ph={ipa!r}, got {out!r}"

    def test_longest_match_wins(self):
        """Ensure ``/sh/`` is not greedily split into ``/s/`` + ``h/``."""
        out = normalize_for_tts("/sh/")
        assert 'ph="ʃ"' in out
        assert 'ph="s"' not in out

    def test_url_is_not_rewritten(self):
        out = normalize_for_tts("see http://example.com/th/page for details")
        # ``/th/`` embedded in a URL path should NOT be wrapped because
        # adjacent alphanumerics disqualify the match.
        assert "<phoneme" not in out

    def test_idempotent_on_existing_phoneme(self):
        text = 'make <phoneme alphabet="ipa" ph="θ">sound</phoneme> twice'
        assert normalize_for_tts(text) == text
        assert normalize_for_tts(normalize_for_tts(text)) == text

    def test_letter_name_approximation_tee_aitch(self):
        assert 'ph="θ"' in normalize_for_tts("say the tee aitch sound")
        assert 'ph="θ"' in normalize_for_tts("say the tee-aitch sound")
        assert 'ph="θ"' in normalize_for_tts("say the TEE AITCH sound")

    def test_letter_name_approximation_ess_aitch(self):
        assert 'ph="ʃ"' in normalize_for_tts("ess aitch")

    def test_letter_name_approximation_doubleyou(self):
        assert 'ph="w"' in normalize_for_tts("doubleyou sound")

    def test_plain_mode_uses_anchor_word(self):
        out = normalize_for_tts("say /th/ please", mode="plain")
        assert "think" in out
        assert "<phoneme" not in out

    def test_empty_input(self):
        assert normalize_for_tts("") == ""

    def test_unknown_slash_token_preserved(self):
        out = normalize_for_tts("directory /usr/ is not a phoneme")
        assert "/usr/" in out


class TestHelpers:
    def test_contains_graphemic_phoneme_true(self):
        assert contains_graphemic_phoneme("practice /th/ now") is True

    def test_contains_graphemic_phoneme_false(self):
        assert contains_graphemic_phoneme("no phoneme citation here") is False

    def test_contains_graphemic_phoneme_url_false(self):
        assert contains_graphemic_phoneme("http://x/th/y") is False

    def test_count_deprecated_uppercase_th(self):
        assert count_deprecated_uppercase_th("/TH/ and /TH/ but not /th/") == 2
        assert count_deprecated_uppercase_th("/th/") == 0

    def test_wrap_as_ssml_includes_voice_and_lexicon(self):
        body = 'hi <phoneme alphabet="ipa" ph="θ">sound</phoneme>'
        out = wrap_as_ssml(body, voice="en-GB-SoniaNeural", lexicon_uri="https://x/y.xml")
        assert 'xml:lang="en-GB"' in out
        assert 'voice name="en-GB-SoniaNeural"' in out
        assert '<lexicon uri="https://x/y.xml"/>' in out
        assert body in out

    def test_wrap_as_ssml_without_lexicon(self):
        out = wrap_as_ssml("hello", voice="en-GB-SoniaNeural")
        assert "<lexicon" not in out


class TestMathSpeechNormalisation:
    def test_markdown_formatting_removed_from_spoken_answer(self):
        out = normalize_for_tts(
            "**Photosynthesis** makes food.\n\n"
            "**Quick breakdown:**\n"
            "- Plants use **sunlight**.\n"
            "1. Memorize `carbon dioxide + water`.",
            mode="plain",
        )
        assert "**" not in out
        assert "`" not in out
        assert "- Plants" not in out
        assert "1. Memorize" not in out
        assert "Photosynthesis" in out
        assert "Quick breakdown:" in out
        assert "Plants use sunlight." in out

    def test_markdown_links_keep_label_for_speech(self):
        out = normalize_for_tts("Read [photosynthesis](https://example.test) today", mode="plain")
        assert "photosynthesis" in out
        assert "https://" not in out

    def test_source_markers_removed_from_spoken_answer(self):
        out = normalize_for_tts("Plants use light energy (S1). See also [S2].", mode="plain")
        assert "S1" not in out
        assert "S2" not in out
        assert "Plants use light energy." in out

    def test_latex_backslash_command_not_voiced_literally(self):
        out = normalize_for_tts(r"y = 3 \times x")
        assert "\\" not in out
        assert "times" in out

    def test_markdown_and_latex_are_both_speech_safe(self):
        out = normalize_for_tts(r"**Equation:** 6CO_2 + 6H_2O \to C_6H_12O_6 + 6O_2", mode="plain")
        assert "**" not in out
        assert "\\" not in out
        assert "Equation:" in out
        assert "to" in out

    def test_frac_reads_as_over(self):
        out = normalize_for_tts(r"\frac{1}{2} of the class")
        assert "1 over 2" in out
        assert "\\" not in out

    def test_sqrt_reads_naturally(self):
        out = normalize_for_tts(r"\sqrt{9} equals 3")
        assert "the square root of 9" in out
        assert "\\" not in out

    def test_caret_exponents(self):
        assert "x squared" in normalize_for_tts("x^2 + 1")
        assert "x cubed" in normalize_for_tts("x^3")
        assert "to the power of 10" in normalize_for_tts("x^{10}")

    def test_unicode_superscript(self):
        out = normalize_for_tts("y = 3x\u00b2 + 4x")
        assert "squared" in out
        assert "\u00b2" not in out

    def test_unicode_operators(self):
        out = normalize_for_tts("6 \u00f7 2 \u00d7 3")
        assert "divided by" in out
        assert "times" in out
        assert "\u00f7" not in out and "\u00d7" not in out

    def test_chemistry_equation_symbols_read_as_plain_speech(self):
        out = normalize_for_tts("6CO\u2082 + 6H\u2082O \u2192 C\u2086H\u2081\u2082O\u2086 + 6O\u2082")
        assert "\u2082" not in out
        assert "\u2192" not in out
        assert "yields" in out
        assert "CO2" in out

    def test_stray_backslash_removed(self):
        out = normalize_for_tts(r"answer is a \ b")
        assert "\\" not in out

    def test_plain_prose_untouched(self):
        text = "Explain why your answer was wrong, then encourage the learner."
        assert normalize_for_tts(text) == text

    def test_idempotent_on_math(self):
        once = normalize_for_tts(r"area = \frac{1}{2} b h, side x\u00b2")
        twice = normalize_for_tts(once)
        assert once == twice
        assert "\\" not in once

    def test_math_and_phoneme_coexist(self):
        out = normalize_for_tts(r"the /sh/ sound and \frac{1}{2}")
        assert '<phoneme alphabet="ipa" ph="\u0283">' in out
        assert "1 over 2" in out

