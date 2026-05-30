#!/usr/bin/env python3
"""Verify scraped MCQ items and additively promote them into the SERVED
(underscore) DiagnosticItem banks so they can be exercised in staging via the
offline pack.

HONESTY: This performs only AUTOMATED checks (arithmetic recompute where the
stem is unambiguously parseable + structural well-formedness). It does NOT
constitute the human subject-lead / safeguarding review the gate represents.
review_state stays 'pending_two_reviewer_signoff'; subject_lead_approved and
safeguarding_reviewed stay False. metadata.verification_status records the
automated outcome only.
"""
import json, re
from decimal import Decimal, InvalidOperation
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = {"maths": "maths-jss3-ss3-mcq-v1.json", "english": "english-jss3-ss3-mcq-v1.json"}
DST = {"maths": "maths_jss3_ss3_v1.json", "english": "english_jss3_ss3_v1.json"}
LETTERS = ["A", "B", "C", "D"]


def norm(t):
    return re.sub(r"\s+", " ", str(t).lower()).strip()


def is_scraped(item):
    prov = item.get("provenance") or []
    return bool(prov) and str(prov[0].get("source", "")).startswith("scrape:")


# ---- conservative arithmetic recompute (maths only) ----------------------
NUM = r"-?\d+(?:\.\d+)?"
BIN_PATTERNS = [
    (re.compile(rf"^\s*(?:what is|evaluate|simplify|find|calculate)?\s*({NUM})\s*\+\s*({NUM})\s*[=?\.]?\s*$", re.I), lambda a, b: a + b),
    (re.compile(rf"^\s*(?:what is|evaluate|find|calculate)?\s*({NUM})\s*[-\u2212]\s*({NUM})\s*[=?\.]?\s*$", re.I), lambda a, b: a - b),
    (re.compile(rf"^\s*(?:what is|evaluate|find|calculate)?\s*({NUM})\s*(?:[x\u00d7*])\s*({NUM})\s*[=?\.]?\s*$", re.I), lambda a, b: a * b),
]


def try_recompute(stem):
    s = stem.strip()
    for pat, fn in BIN_PATTERNS:
        m = pat.match(s)
        if m:
            try:
                a, b = Decimal(m.group(1)), Decimal(m.group(2))
                return fn(a, b)
            except (InvalidOperation, ValueError):
                return None
    return None


def opt_as_decimal(text):
    t = text.strip().replace(",", "")
    if re.fullmatch(NUM, t):
        try:
            return Decimal(t)
        except InvalidOperation:
            return None
    return None


def verify(subject, item):
    """Return (status, reason). status in {recomputed, wellformed, QUARANTINE}."""
    opts = item.get("options") or []
    if len(opts) != 4:
        return "QUARANTINE", "not_4_options"
    texts = [o.get("text", "") for o in opts]
    if any(not t.strip() for t in texts):
        return "QUARANTINE", "blank_option"
    if len({norm(t) for t in texts}) != 4:
        return "QUARANTINE", "duplicate_option"
    cid = item.get("correct_option_id")
    ids = [o.get("id") for o in opts]
    if cid not in ids:
        return "QUARANTINE", "bad_correct_id"
    correct_text = next(o["text"] for o in opts if o["id"] == cid)
    if subject == "maths":
        expected = try_recompute(item.get("stem", ""))
        if expected is not None:
            matches = [o for o in opts if opt_as_decimal(o["text"]) == expected]
            if matches:
                if matches[0]["id"] == cid:
                    return "recomputed", "arithmetic_match"
                return "QUARANTINE", f"arithmetic_mismatch_expected_{expected}"
    return "wellformed", "structural_ok"


def to_diagnostic(item, status):
    opts = item["options"]
    cid = item["correct_option_id"]
    id_to_letter = {o["id"]: LETTERS[i] for i, o in enumerate(opts)}
    lines = [item["stem"], ""]
    for i, o in enumerate(opts):
        lines.append(f"{LETTERS[i]}) {o['text']}")
    prompt = "\n".join(lines)
    correct_text = next(o["text"] for o in opts if o["id"] == cid)
    correct_answer = f"{id_to_letter[cid]}) {correct_text}"
    prov = [dict(p) for p in item["provenance"]]
    md = dict(prov[0].get("metadata") or {})
    md.update({
        "review_state": "pending_two_reviewer_signoff",
        "subject_lead_approved": False,
        "safeguarding_reviewed": False,
        "verification_status": "auto_" + status,
        "answer_verified": False,
        "mcq_options": [{"letter": LETTERS[i], "text": o["text"]} for i, o in enumerate(opts)],
        "mcq_correct_letter": id_to_letter[cid],
    })
    prov[0]["metadata"] = md
    out = {
        "lang": item.get("lang", "en"),
        "provenance": prov,
        "item_id": item["item_id"],
        "skill_id": item["skill_id"],
        "prompt": prompt,
        "item_type": "mcq_single",
        "difficulty": float(max(-5.0, min(5.0, float(item.get("difficulty", 0.0))))),
        "correct_answer": correct_answer,
        "subject": item["subject"],
        "year_group": item["year_group"],
        "topic": item.get("topic"),
        "subtopic": item.get("subtopic"),
        "misconception_codes": list(item.get("misconception_codes") or []),
        "taxonomy_version": item.get("taxonomy_version", "1.0.0"),
    }
    return out


report = {}
for subject in ("maths", "english"):
    src = json.loads((HERE / SRC[subject]).read_text("utf-8"))
    scraped = [it for it in src["items"] if is_scraped(it)]
    dst = json.loads((HERE / DST[subject]).read_text("utf-8"))
    existing_ids = {it["item_id"] for it in dst["items"]}
    existing_stems = {norm(it.get("prompt", "").split("\n")[0]) for it in dst["items"]}

    counts = {"recomputed": 0, "wellformed": 0, "QUARANTINE": 0, "dup_skipped": 0, "id_collision": 0}
    quarantine = []
    promoted = []
    for it in scraped:
        status, reason = verify(subject, it)
        if status == "QUARANTINE":
            counts["QUARANTINE"] += 1
            quarantine.append({"item_id": it.get("item_id"), "reason": reason, "stem": it.get("stem", "")[:120]})
            continue
        if it["item_id"] in existing_ids:
            counts["id_collision"] += 1
            continue
        if norm(it.get("stem", "")) in existing_stems:
            counts["dup_skipped"] += 1
            continue
        counts[status] += 1
        promoted.append(to_diagnostic(it, status))
        existing_ids.add(it["item_id"])
        existing_stems.add(norm(it.get("stem", "")))

    dst["items"].extend(promoted)
    (HERE / DST[subject]).write_text(json.dumps(dst, ensure_ascii=False, indent=2) + "\n", "utf-8")
    if quarantine:
        (HERE / f"_quarantine_{subject}.json").write_text(json.dumps(quarantine, ensure_ascii=False, indent=2) + "\n", "utf-8")
    report[subject] = {"scraped_seen": len(scraped), "promoted": len(promoted),
                       "new_total_served": len(dst["items"]), **counts}

print(json.dumps(report, indent=2))
