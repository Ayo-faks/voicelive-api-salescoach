#!/usr/bin/env python3
"""Phase 3 — build the SERVED Government diagnostic bank from the verified
source MCQ bank.

Reads ``government-ss-mcq-v1.json`` (the Stage-1 source bank, post Stage-3.5
ensemble verification) and emits two served ``DiagnosticItemBank`` files into
``backend/data/learning/diagnostics/``:

* ``government_ss_v1.json``          — only ``machine_verified`` items (active)
* ``government_ss_v1_flagged.json``  — only ``flagged_for_human`` items (held)

ENCODING (Option A — Government is NOT a maths/english subject)
---------------------------------------------------------------
The served ``DiagnosticItem`` model constrains ``subject`` to
``maths|english`` and validates ``misconception_codes`` against the
maths/english enum. Government content does not fit that enum, so served items
**omit** ``subject``, ``year_group``, ``topic``, ``subtopic``,
``misconception_codes`` and ``taxonomy_version`` entirely. The MCQ options are
rendered into the ``prompt`` and preserved structurally in
``provenance[0].metadata.mcq_options`` / ``mcq_correct_letter`` so the offline
selector and scorer work unchanged.

HONESTY / GATE
--------------
``machine_verified`` is the ensemble *answer-confidence* signal only. It is
strictly BELOW the human two-reviewer gate. Every served item keeps
``review_state = "pending_two_reviewer_signoff"`` and
``subject_lead_approved = safeguarding_reviewed = False``. This bank is for
staging exercise only; it must not be promoted to learners without the human
sign-off.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "government-ss-mcq-v1.json"

# Served diagnostics dir resolves the same way as api.LEARNING_DATA_DIR, which
# in this repo points at the REPO-ROOT data/learning (not backend/data/learning).
# Import the resolved path from the app so the two never drift.
def _resolve_served_dir() -> Path:
    import sys

    backend_root = HERE.parents[1]  # backend/
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))
    from src.learning.api import DIAGNOSTICS_DIR  # type: ignore

    return DIAGNOSTICS_DIR


SERVED_DIR = _resolve_served_dir()
ACTIVE_OUT = SERVED_DIR / "government_ss_v1.json"
FLAGGED_OUT = SERVED_DIR / "government_ss_v1_flagged.json"

DIAGNOSTIC_ID = "ss3-government-v1"
TENANT_ID = "pilot-tenant"
STANDARD_ID = "ss3.government.waec-neco"


def _consensus(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return the model_consensus provenance metadata, or None if unverified."""
    for prov in item.get("provenance", []):
        if prov.get("source") == "model_consensus":
            return prov.get("metadata") or {}
    return None


def _render_prompt(item: Dict[str, Any]) -> str:
    lines = [item["stem"], ""]
    for opt in item["options"]:
        lines.append(f"{opt['label']}) {opt['text']}")
    return "\n".join(lines)


def _to_served_item(item: Dict[str, Any], status: str) -> Dict[str, Any]:
    opts = item["options"]
    cid = item["correct_option_id"]
    correct = next(o for o in opts if o["id"] == cid)
    correct_letter = correct["label"]
    correct_answer = f"{correct_letter}) {correct['text']}"

    # Carry source provenance forward, recording the served verification status
    # on the primary entry's metadata WITHOUT mutating the source file.
    prov: List[Dict[str, Any]] = [dict(p) for p in item["provenance"]]
    md = dict(prov[0].get("metadata") or {})
    md.update(
        {
            "review_state": "pending_two_reviewer_signoff",
            "subject_lead_approved": False,
            "safeguarding_reviewed": False,
            "answer_verified": False,
            "verification_status": status,  # machine_verified | flagged_for_human
            "mcq_options": [
                {"letter": o["label"], "text": o["text"]} for o in opts
            ],
            "mcq_correct_letter": correct_letter,
        }
    )
    prov[0]["metadata"] = md

    # Option A: OMIT subject/year_group/topic/subtopic/misconception_codes/
    # taxonomy_version — they would trip the maths|english DiagnosticItem
    # validators. Skill identity is preserved via skill_id.
    return {
        "lang": item.get("lang", "en"),
        "provenance": prov,
        "item_id": item["item_id"],
        "skill_id": item["skill_id"],
        "prompt": _render_prompt(item),
        "item_type": "mcq_single",
        "difficulty": float(max(-5.0, min(5.0, float(item.get("difficulty", 0.0))))),
        "correct_answer": correct_answer,
    }


def _skills_from_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """One Skill per distinct skill_id, deterministic order."""
    skills: Dict[str, Dict[str, Any]] = {}
    for it in items:
        sid = it["skill_id"]
        if sid in skills:
            continue
        # ss3.government.<topic_key>.<subtopic> -> readable name
        parts = sid.split(".")
        leaf = parts[-1].replace("_", " ").strip().title() if parts else sid
        topic_key = parts[2].replace("_", " ").title() if len(parts) > 2 else "Government"
        skills[sid] = {
            "skill_id": sid,
            "standard_id": STANDARD_ID,
            "name": f"{topic_key}: {leaf}",
            "description": f"SS3 Government — {topic_key.lower()} ({leaf.lower()}).",
        }
    return [skills[k] for k in sorted(skills)]


def _build_bank(
    suffix: str, title: str, items: List[Dict[str, Any]]
) -> Dict[str, Any]:
    return {
        "diagnostic_id": DIAGNOSTIC_ID + suffix,
        "tenant_id": TENANT_ID,
        "title": title,
        "subject": "government",
        "lang": "en",
        "provenance": [
            {
                "source": "scrape:government-ssce-derived",
                "source_id": "government-ss-mcq-v1",
                "rule_id": "served_promote_v1",
                "recency": None,
                "confidence": 1.0,
                "evidence_count": len(items),
                "metadata": {
                    "review_state": "pending_two_reviewer_signoff",
                    "subject_lead_approved": False,
                    "safeguarding_reviewed": False,
                    "note": (
                        "Derived SSCE-style questions; ensemble machine-verified "
                        "only; below the human two-reviewer gate; staging exercise "
                        "only; rights for child-facing reuse not cleared."
                    ),
                },
            }
        ],
        "skills": _skills_from_items(items),
        "items": items,
    }


def build() -> Tuple[int, int, int]:
    bank = json.loads(SOURCE.read_text("utf-8"))
    active: List[Dict[str, Any]] = []
    flagged: List[Dict[str, Any]] = []
    unverified = 0

    for item in bank["items"]:
        meta = _consensus(item)
        if not meta:
            unverified += 1
            continue
        status = meta.get("verification_status")
        if status == "machine_verified":
            active.append(_to_served_item(item, "machine_verified"))
        elif status == "flagged_for_human":
            flagged.append(_to_served_item(item, "flagged_for_human"))
        else:
            unverified += 1

    SERVED_DIR.mkdir(parents=True, exist_ok=True)

    active_bank = _build_bank(
        "",
        "SS3 Government — Diagnostic (machine-verified, pre-sign-off)",
        active,
    )
    ACTIVE_OUT.write_text(
        json.dumps(active_bank, ensure_ascii=False, indent=2) + "\n", "utf-8"
    )

    if flagged:
        flagged_bank = _build_bank(
            "-flagged",
            "SS3 Government — Flagged for human review",
            flagged,
        )
        FLAGGED_OUT.write_text(
            json.dumps(flagged_bank, ensure_ascii=False, indent=2) + "\n", "utf-8"
        )

    return len(active), len(flagged), unverified


if __name__ == "__main__":
    n_active, n_flagged, n_unverified = build()
    print(
        json.dumps(
            {
                "active_machine_verified": n_active,
                "flagged_for_human": n_flagged,
                "skipped_unverified": n_unverified,
                "active_out": str(ACTIVE_OUT),
                "flagged_out": str(FLAGGED_OUT) if n_flagged else None,
            },
            indent=2,
        )
    )
