#!/usr/bin/env python3
"""Phase 3 (generalised) — build the SERVED diagnostic bank for ANY SS subject
from its verified source MCQ bank.

This is the subject-parameterised version of ``build_served_government.py``
(which remains as the proven Government reference). Pick the subject with
``--subject``; all file names / identifiers come from ``subjects_config.py`` so
two subjects never collide when run in parallel.

    cd backend/data/question_banks
    python build_served_subject.py --subject history

Reads ``<subject>-ss-mcq-v1.json`` (Stage-1 source bank, post Stage-3.5 ensemble
verification) and emits up to two served ``DiagnosticItemBank`` files into the
repo-root ``data/learning/diagnostics/`` dir:

* ``<subject>_ss_v1.json``          — only ``machine_verified`` items (active)
* ``<subject>_ss_v1_flagged.json``  — only ``flagged_for_human`` items (held)

ENCODING (Option A) — served items OMIT subject/year_group/topic/subtopic/
misconception_codes/taxonomy_version (they would trip the maths|english
DiagnosticItem validators). MCQ options are rendered into ``prompt`` and kept
structurally in ``provenance[0].metadata.mcq_options`` / ``mcq_correct_letter``.

HONESTY / GATE — ``machine_verified`` is the ensemble answer-confidence signal
only, strictly BELOW the human two-reviewer gate. Every served item keeps
``review_state = "pending_two_reviewer_signoff"`` and
``subject_lead_approved = safeguarding_reviewed = False``.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from subjects_config import TENANT_ID, SubjectConfig, get

HERE = Path(__file__).resolve().parent


def _resolve_served_dir() -> Path:
    """Resolve the served diagnostics dir the same way api.LEARNING_DATA_DIR does
    (REPO-ROOT data/learning, not backend/data/learning). Import the resolved
    path from the app so the two never drift."""
    backend_root = HERE.parents[1]  # backend/
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))
    from src.learning.api import DIAGNOSTICS_DIR  # type: ignore

    return DIAGNOSTICS_DIR


def _consensus(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
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


def _skills_from_items(
    items: List[Dict[str, Any]], cfg: SubjectConfig
) -> List[Dict[str, Any]]:
    skills: Dict[str, Dict[str, Any]] = {}
    for it in items:
        sid = it["skill_id"]
        if sid in skills:
            continue
        # ss3.<subject>.<topic_key>.<subtopic> -> readable name
        parts = sid.split(".")
        leaf = parts[-1].replace("_", " ").strip().title() if parts else sid
        topic_key = (
            parts[2].replace("_", " ").title() if len(parts) > 2 else cfg.title
        )
        skills[sid] = {
            "skill_id": sid,
            "standard_id": cfg.standard_id,
            "name": f"{topic_key}: {leaf}",
            "description": (
                f"SS3 {cfg.title} — {topic_key.lower()} ({leaf.lower()})."
            ),
        }
    return [skills[k] for k in sorted(skills)]


def _build_bank(
    cfg: SubjectConfig, suffix: str, title: str, items: List[Dict[str, Any]]
) -> Dict[str, Any]:
    return {
        "diagnostic_id": cfg.diagnostic_id + suffix,
        "tenant_id": TENANT_ID,
        "title": title,
        "subject": cfg.key,
        "lang": "en",
        "provenance": [
            {
                "source": cfg.provenance_source,
                "source_id": cfg.provenance_source_id,
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
        "skills": _skills_from_items(items, cfg),
        "items": items,
    }


def build(cfg: SubjectConfig) -> Tuple[int, int, int, Path, Optional[Path]]:
    served_dir = _resolve_served_dir()
    active_out = served_dir / cfg.served_active_name
    flagged_out = served_dir / cfg.served_flagged_name

    bank = json.loads(cfg.source_bank.read_text("utf-8"))
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

    served_dir.mkdir(parents=True, exist_ok=True)

    active_bank = _build_bank(
        cfg,
        "",
        f"SS3 {cfg.title} — Diagnostic (machine-verified, pre-sign-off)",
        active,
    )
    active_out.write_text(
        json.dumps(active_bank, ensure_ascii=False, indent=2) + "\n", "utf-8"
    )

    written_flagged: Optional[Path] = None
    if flagged:
        flagged_bank = _build_bank(
            cfg,
            "-flagged",
            f"SS3 {cfg.title} — Flagged for human review",
            flagged,
        )
        flagged_out.write_text(
            json.dumps(flagged_bank, ensure_ascii=False, indent=2) + "\n", "utf-8"
        )
        written_flagged = flagged_out

    return len(active), len(flagged), unverified, active_out, written_flagged


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--subject",
        required=True,
        help="Subject key (e.g. history). See subjects_config.py.",
    )
    args = ap.parse_args(argv)
    cfg = get(args.subject)

    n_active, n_flagged, n_unverified, active_out, flagged_out = build(cfg)
    print(
        json.dumps(
            {
                "subject": cfg.key,
                "active_machine_verified": n_active,
                "flagged_for_human": n_flagged,
                "skipped_unverified": n_unverified,
                "active_out": str(active_out),
                "flagged_out": str(flagged_out) if flagged_out else None,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
