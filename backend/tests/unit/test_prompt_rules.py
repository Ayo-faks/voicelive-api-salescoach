"""Unit tests for :mod:`src.services.prompt_rules`."""

from __future__ import annotations

from src.services.prompt_rules import PHONEME_CITATION_RULE, append_phoneme_rule


class TestAppendPhonemeRule:
    def test_appends_to_non_empty_base(self):
        result = append_phoneme_rule("BASE INSTRUCTIONS")
        assert result.startswith("BASE INSTRUCTIONS")
        assert PHONEME_CITATION_RULE in result

    def test_returns_rule_alone_when_base_empty(self):
        assert append_phoneme_rule("") == PHONEME_CITATION_RULE
        assert append_phoneme_rule(None) == PHONEME_CITATION_RULE
        assert append_phoneme_rule("   ") == PHONEME_CITATION_RULE

    def test_idempotent(self):
        once = append_phoneme_rule("BASE")
        twice = append_phoneme_rule(once)
        assert once == twice
        assert twice.count(PHONEME_CITATION_RULE) == 1


class TestPhonemeCitationRule:
    def test_rule_is_phoneme_agnostic(self):
        """The rule must mention multiple target sounds, not only /th/."""
        rule = PHONEME_CITATION_RULE
        for phrase in ("/th/", "/sh/", "/ch/", "/w/", "/k/", "/zh/", "/ng/"):
            assert phrase in rule, f"missing {phrase} example in rule"

    def test_forbids_letter_name_examples(self):
        rule = PHONEME_CITATION_RULE
        assert "tee aitch" in rule
        assert "ess aitch" in rule

    def test_requires_ipa_phoneme_ssml(self):
        assert 'alphabet="ipa"' in PHONEME_CITATION_RULE
