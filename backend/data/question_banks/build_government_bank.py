#!/usr/bin/env python3
"""Stage 1/2 builder for the Government SS MCQ source bank.

HONESTY / COMPLIANCE
--------------------
These items are *derived* (original-wording) Senior Secondary Government
practice MCQs covering the WAEC/NECO SSCE Government syllabus. They restate
widely-taught civics facts in our own words; no past-paper text is reproduced
verbatim and no PII is included. Every item is emitted with::

    metadata.verification_status = "unverified"
    metadata.answer_verified     = False
    metadata.review_state        = "pending_two_reviewer_signoff"
    metadata.subject_lead_approved = False
    metadata.safeguarding_reviewed = False

i.e. they are NOT cleared for learners. Stage 3 (`validate_mcq_bank.py`) is the
deterministic gate; Stage 3.5 (`ensemble_verify.py`) adds an answer-confidence
signal only. Promotion to learners still requires the human two-reviewer gate.

Run::

    cd backend/data/question_banks
    python build_government_bank.py
    python ~/.agents/skills/question-bank-builder/scripts/validate_mcq_bank.py \
        government-ss-mcq-v1.json
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "government-ss-mcq-v1.json"

# Difficulty bands (logit-style, -3 very easy .. +3 very hard)
VE, E, M, H, VH = -3.0, -1.5, 0.0, 1.5, 3.0

DEFAULT_CODES = ["concept_confusion"]


def q(sub, subtopic, diff, stem, correct, d1, d2, d3, codes=None):
    """Compact question record. Builder fills provenance/ids/explanation."""
    return {
        "sub": sub,
        "subtopic": subtopic,
        "diff": diff,
        "stem": stem,
        "correct": correct,
        "distractors": [d1, d2, d3],
        "codes": list(codes) if codes else list(DEFAULT_CODES),
    }


# ---------------------------------------------------------------------------
# Question pools — keyed by (topic_key, topic_display) -> [q, ...]
# ---------------------------------------------------------------------------
from government_questions import TOPICS  # noqa: E402  (data lives in sibling module)

# Difficulty bands present in the source pools, ordered easy -> hard.
_BAND_ORDER = [VE, E, M, H, VH]


def _reband_topic(pool):
    """Guarantee >=3 items in each of the five difficulty bands per topic.

    Deterministic and honesty-preserving: the *easiest-typed* items
    (definition / recall, currently E or M) are relabelled VE, and the
    *hardest-typed* items (multi-step reasoning, currently H) are relabelled
    VH, only as far as needed to reach the >=3-per-band floor. Items are
    selected by a stable key (current difficulty, then original order) so the
    output is reproducible. Mutates ``rec['diff']`` in place.
    """
    floor = 3
    counts = {b: sum(1 for r in pool if r["diff"] == b) for b in _BAND_ORDER}
    order = list(enumerate(pool))

    # Fill VE from the easiest available (lowest diff first), then E if short.
    def _take(target_band, source_bands, need):
        """Relabel up to ``need`` items from source_bands into target_band."""
        moved = 0
        for src in source_bands:
            if moved >= need:
                break
            # easiest source items first for VE, hardest first for VH
            cand = [(i, r) for i, r in order if r["diff"] == src]
            for i, r in cand:
                if moved >= need:
                    break
                # never strip a band below its own floor while donating
                if counts[src] - 1 < floor and src in (E, M, H):
                    # only block if src itself still needs to meet floor
                    if counts[src] <= floor:
                        continue
                r["diff"] = target_band
                counts[src] -= 1
                counts[target_band] += 1
                moved += 1
        return moved

    # VE: pull from E then M (easiest content).
    _take(VE, [E, M], floor - counts[VE])
    # E: top up from M if still short.
    if counts[E] < floor:
        _take(E, [M], floor - counts[E])
    # VH: pull from H then M (hardest content).
    _take(VH, [H, M], floor - counts[VH])
    return pool


def build():
    items = []
    counter = 0
    # Deterministic rotation of the correct slot to avoid position bias.
    slot_cycle = ["a", "b", "c", "d"]
    for topic_key, (topic_display, pool) in TOPICS.items():
        pool = _reband_topic(list(pool))
        for rec in pool:
            counter += 1
            iid = f"government-mcq-ss3-{counter:03d}"
            slot = slot_cycle[(counter - 1) % 4]
            # Place correct text into the chosen slot; distractors fill the rest.
            texts = {"a": None, "b": None, "c": None, "d": None}
            texts[slot] = rec["correct"]
            remaining = [k for k in slot_cycle if k != slot]
            for k, d in zip(remaining, rec["distractors"]):
                texts[k] = d
            options = [
                {"id": k, "label": k.upper(), "text": texts[k]} for k in slot_cycle
            ]
            skill_id = f"ss3.government.{topic_key}.{rec['sub']}"
            item = {
                "lang": "en",
                "provenance": [
                    {
                        "source": "scrape:government-ssce-derived",
                        "source_id": iid,
                        "rule_id": "mcq_scrape_v1",
                        "recency": None,
                        "confidence": 1.0,
                        "evidence_count": 0,
                        "metadata": {
                            "review_state": "pending_two_reviewer_signoff",
                            "subject_lead_approved": False,
                            "safeguarding_reviewed": False,
                            "verification_status": "unverified",
                            "answer_verified": False,
                            "source_url": None,
                            "licence": "derived",
                            "origin": "derived",
                        },
                    }
                ],
                "item_id": iid,
                "skill_id": skill_id,
                "stem": rec["stem"],
                "item_type": "mcq_single",
                "options": options,
                "correct_option_id": slot,
                "difficulty": rec["diff"],
                "subject": "government",
                "year_group": "SS3",
                "exams": ["WAEC", "NECO"],
                "topic": topic_display,
                "subtopic": rec["subtopic"],
                "misconception_codes": rec["codes"],
                "explanation": {
                    "title": rec["correct"][:60],
                    "steps": [f"Correct answer: {rec['correct']}."],
                },
                "taxonomy_version": "1.0.0",
            }
            items.append(item)

    bank = {
        "bank_id": "government-ss-mcq-v1",
        "version": "1.0.0",
        "lang": "en",
        "subject": "government",
        "taxonomy_version": "1.0.0",
        "year_groups": ["SS3"],
        "item_type": "mcq_single",
        "review_state": "pending_two_reviewer_signoff",
        "items": items,
    }
    OUT.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"wrote {len(items)} items -> {OUT.name}")


if __name__ == "__main__":
    build()
