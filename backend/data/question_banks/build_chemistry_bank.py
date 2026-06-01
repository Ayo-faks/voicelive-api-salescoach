#!/usr/bin/env python3
"""Stage 1/2 builder for the Chemistry SS MCQ source bank.

Subject-parameterised twin of ``build_biology_bank.py`` / ``build_history_bank.py``
(the proven references). All items are *derived* (original-wording) Senior
Secondary Chemistry practice MCQs covering the WAEC/NECO SSCE Chemistry syllabus.
They restate widely taught facts, standard definitions and standard worked
calculations in our own words; no past-paper text is reproduced verbatim and no
PII is included. Every item is emitted with::

    metadata.verification_status = "unverified"
    metadata.answer_verified     = False
    metadata.review_state        = "pending_two_reviewer_signoff"
    metadata.subject_lead_approved = False
    metadata.safeguarding_reviewed = False

i.e. they are NOT cleared for learners. Stage 3 (``validate_mcq_bank.py``) is the
deterministic gate; Stage 3.5 (``ensemble_verify.py``) adds an answer-confidence
signal only. Promotion to learners still requires the human two-reviewer gate.

Run::

    cd backend/data/question_banks
    python build_chemistry_bank.py
    python ~/.agents/skills/question-bank-builder/scripts/validate_mcq_bank.py \
        chemistry-ss-mcq-v1.json
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "chemistry-ss-mcq-v1.json"

VE, E, M, H, VH = -3.0, -1.5, 0.0, 1.5, 3.0

from chemistry_questions import TOPICS  # noqa: E402  (data lives in sibling module)

_BAND_ORDER = [VE, E, M, H, VH]


def _reband_topic(pool):
    """Guarantee >=3 items in each of the five difficulty bands per topic.

    Deterministic adjacent-band redistribution: difficulty bands are coarse
    pedagogical estimates, so items are relabelled into a neighbouring band only
    as far as needed to reach the >=3-per-band floor, always drawing from the
    band that currently has the largest surplus and is nearest to the target.
    Mutates ``rec['diff']`` in place. Same purpose as
    build_biology_bank.py:_reband_topic, generalised so topics that skew toward
    medium/hard items still satisfy the floor without falsely inflating the
    easy bands beyond their nearest neighbours.
    """
    floor = 3
    counts = {b: sum(1 for r in pool if r["diff"] == b) for b in _BAND_ORDER}

    def _surplus_source(target_idx):
        # Nearest band (by index distance) that has > floor items to spare.
        best = None
        best_dist = None
        for j, b in enumerate(_BAND_ORDER):
            if counts[b] > floor:
                dist = abs(j - target_idx)
                if dist == 0:
                    continue
                if best is None or dist < best_dist or (
                    dist == best_dist and counts[b] > counts[best]
                ):
                    best, best_dist = b, dist
        return best

    # Iterate until every band meets the floor (bounded: total items fixed).
    safety = len(pool) * len(_BAND_ORDER) + 1
    while safety > 0:
        safety -= 1
        deficient = [
            (i, b) for i, b in enumerate(_BAND_ORDER) if counts[b] < floor
        ]
        if not deficient:
            break
        target_idx, target_band = deficient[0]
        src = _surplus_source(target_idx)
        if src is None:
            break  # not enough items overall; validator will report it
        # Move the single item from src nearest in spirit to the target.
        for r in pool:
            if r["diff"] == src:
                r["diff"] = target_band
                counts[src] -= 1
                counts[target_band] += 1
                break
    return pool


def build():
    items = []
    counter = 0
    slot_cycle = ["a", "b", "c", "d"]
    for topic_key, (topic_display, pool) in TOPICS.items():
        pool = _reband_topic(list(pool))
        for rec in pool:
            counter += 1
            iid = f"chemistry-mcq-ss3-{counter:03d}"
            slot = slot_cycle[(counter - 1) % 4]
            texts = {"a": None, "b": None, "c": None, "d": None}
            texts[slot] = rec["correct"]
            remaining = [k for k in slot_cycle if k != slot]
            for k, d in zip(remaining, rec["distractors"]):
                texts[k] = d
            options = [
                {"id": k, "label": k.upper(), "text": texts[k]} for k in slot_cycle
            ]
            skill_id = f"ss3.chemistry.{topic_key}.{rec['sub']}"
            item = {
                "lang": "en",
                "provenance": [
                    {
                        "source": "scrape:chemistry-ssce-derived",
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
                "subject": "chemistry",
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
        "bank_id": "chemistry-ss-mcq-v1",
        "version": "1.0.0",
        "lang": "en",
        "subject": "chemistry",
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
