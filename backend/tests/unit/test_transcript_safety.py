"""Unit tests for transcript_safety deterministic redactor."""

from __future__ import annotations

import pytest

from src.services.transcript_safety import (
    CATEGORY_CHILD_NAME,
    CATEGORY_EMAIL,
    CATEGORY_GUARDIAN_NAME,
    CATEGORY_NHS_NUMBER,
    CATEGORY_NI_NUMBER,
    CATEGORY_PHONE,
    CATEGORY_UK_POSTCODE,
    CATEGORY_URL,
    DeterministicTranscriptSafetyProvider,
    redact_transcript,
    summarise_for_storage,
)


def test_redacts_email_and_url():
    text = "Email me at jane.doe@example.com or visit https://wulo.example/login."
    report = redact_transcript(text)
    assert "jane.doe@example.com" not in report.redacted_text
    assert "https://wulo.example/login" not in report.redacted_text
    assert report.counts.get(CATEGORY_EMAIL) == 1
    assert report.counts.get(CATEGORY_URL) == 1
    assert not report.is_clean


def test_redacts_uk_postcode_and_phone():
    text = "We live near SW1A 1AA, call 020 7946 0958 if needed."
    report = redact_transcript(text)
    assert "SW1A 1AA" not in report.redacted_text
    assert "020 7946 0958" not in report.redacted_text
    assert report.counts.get(CATEGORY_UK_POSTCODE) == 1
    assert report.counts.get(CATEGORY_PHONE) == 1


def test_redacts_nhs_and_ni_numbers():
    # AB123456C is a syntactically valid UK NI number (Q is not a permitted prefix letter).
    text = "NHS 943 476 5919 and NI AB123456C are sensitive."
    report = redact_transcript(text)
    assert "943 476 5919" not in report.redacted_text
    assert "AB123456C" not in report.redacted_text
    assert report.counts.get(CATEGORY_NHS_NUMBER) == 1
    assert report.counts.get(CATEGORY_NI_NUMBER) == 1


def test_redacts_name_hints_case_insensitive_word_boundary():
    text = "Asha said hello. Asha's friend ASHA is nine. Crash and dashboard stay."
    report = redact_transcript(text, name_hints=["Asha"])
    # word-boundary match: "Asha" tokens redacted, "crash"/"dashboard" preserved
    assert "Asha" not in report.redacted_text
    assert "ASHA" not in report.redacted_text
    assert "crash" in report.redacted_text.lower()
    assert "dashboard" in report.redacted_text.lower()
    assert report.counts.get(CATEGORY_CHILD_NAME, 0) >= 2


def test_guardian_hints_tagged_separately():
    text = "Maya helped me. Mum Maya signed the form."
    report = redact_transcript(text, guardian_hints=["Maya"])
    assert "Maya" not in report.redacted_text
    assert report.counts.get(CATEGORY_GUARDIAN_NAME, 0) >= 2
    assert report.counts.get(CATEGORY_CHILD_NAME, 0) == 0


def test_clean_text_returns_is_clean():
    text = "We practised adding two and three to make five."
    report = redact_transcript(text)
    assert report.is_clean
    assert report.redacted_text == text
    assert report.counts == {}


def test_handles_none_and_empty_input():
    none_report = redact_transcript(None)
    assert none_report.redacted_text == ""
    assert none_report.is_clean
    empty_report = redact_transcript("")
    assert empty_report.redacted_text == ""
    assert empty_report.is_clean


def test_summarise_for_storage_does_not_leak_text():
    text = "Reach me at parent@example.co.uk."
    report = redact_transcript(text)
    summary = summarise_for_storage(report)
    serialised = repr(summary)
    assert "parent@example.co.uk" not in serialised
    assert summary["clean"] is False
    assert summary["total_matches"] == 1
    assert summary["provider"] == "deterministic-v1"


def test_provider_seam_can_be_swapped():
    class StubProvider:
        name = "stub"

        def redact(self, text, *, name_hints=()):
            from src.services.transcript_safety import RedactionReport

            return RedactionReport(redacted_text="STUB", provider=self.name)

    report = redact_transcript("anything", provider=StubProvider())
    assert report.redacted_text == "STUB"
    assert report.provider == "stub"


def test_deterministic_provider_is_idempotent():
    provider = DeterministicTranscriptSafetyProvider()
    text = "Email a@b.com twice: a@b.com."
    first = provider.redact(text)
    second = provider.redact(first.redacted_text)
    # second pass finds nothing new
    assert second.is_clean
    assert "a@b.com" not in first.redacted_text


@pytest.mark.parametrize(
    "postcode",
    ["SW1A 1AA", "M1 1AE", "B33 8TH", "CR2 6XH", "DN55 1PT"],
)
def test_postcode_variants(postcode: str):
    report = redact_transcript(f"address: {postcode}.")
    assert postcode not in report.redacted_text
    assert report.counts.get(CATEGORY_UK_POSTCODE) == 1
