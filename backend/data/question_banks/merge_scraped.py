#!/usr/bin/env python3
"""Self-contained Stage-1 merge: fold scraped MCQs into existing banks.
Additive. Dedups by normalised stem. Continues SS3 item_id numbering.
Items stay unverified / pending_two_reviewer_signoff.
"""
import hashlib, json, re
from pathlib import Path
HERE = Path(__file__).resolve().parent

def norm(t): return re.sub(r"\s+", " ", str(t).lower()).strip()
def key(t): return re.sub(r"[^a-z0-9]+", "_", t.lower()).strip("_")

MATHS_TOPICS = [
    (r"\bA\.?P\.?\b|arithmetic progression|\bG\.?P\.?\b|geometric progression|nth term|common difference|common ratio", "Sequences and series", "Progressions"),
    (r"indices|index|\^|exponent|standard form|\* ?10\^", "Indices", "Laws of indices"),
    (r"logarithm|log ?\d|log_|antilog", "Logarithms", "Log laws"),
    (r"matrix|matrices|determinant", "Matrices", "Operations"),
    (r"probability|dice|coin|at random|likely", "Probability", "Single events"),
    (r"mean|median|mode|frequency|standard deviation|variance|histogram", "Statistics", "Measures"),
    (r"sin |cos |tan |sine|cosine|tangent|bearing|angle of elevation|trigonom", "Trigonometry", "Ratios"),
    (r"differentiat|integrat|\bdy/dx\b|derivative|gradient of the curve", "Calculus", "Differentiation"),
    (r"quadratic|roots of|factoris|factorize|simultaneous|equation|expand|simplify|expression", "Algebra", "Equations and expressions"),
    (r"circle|triangle|polygon|area|perimeter|volume|cylinder|sphere|radius|diameter|parallel|locus", "Geometry", "Mensuration"),
    (r"set|union|intersection|venn|subset|complement", "Sets", "Operations"),
    (r"ratio|proportion|percentage|percent|interest|discount|profit|loss", "Number and numeration", "Ratio and percentage"),
    (r"fraction|decimal|\bL\.?C\.?M\.?\b|\bH\.?C\.?F\.?\b|prime|factor|round|approximate|significant", "Number and numeration", "Fractions and approximation"),
]
ENGLISH_TOPICS = [
    (r"closest in meaning|opposite in meaning|nearly the same|synonym|antonym|interpretation|means|figurative", "Lexis and structure", "Vocabulary and meaning"),
    (r"completes the sentence|best completes|fill|gap|appropriate option", "Lexis and structure", "Sentence completion"),
    (r"stress|syllable|pronounc|/.*?/|sound|rhyme|emphasis", "Oral English", "Phonology and stress"),
    (r"plural|tense|concord|agreement|preposition|article|grammatical|correct form", "Lexis and structure", "Grammar"),
    (r"passage|comprehension|according to the|author|writer|the writer", "Comprehension", "Reading"),
    (r"register|antithesis|oxymoron|euphemism|idiom|proverb|phrasal", "Lexis and structure", "Idiom and register"),
]
def classify(subject, stem):
    table = MATHS_TOPICS if subject == "maths" else ENGLISH_TOPICS
    for pat, topic, sub in table:
        if re.search(pat, stem, re.I):
            return topic, sub
    return ("Algebra", "General") if subject == "maths" else ("Lexis and structure", "Usage")

MISCON = {"maths": ["calc_error", "prerequisite_gap"],
          "english": ["language_comprehension", "prerequisite_gap"]}
BANDS = [-1.5, -0.5, 0.0, 1.0, 2.0]

def build(subject, rows, start_n):
    out = []
    n = start_n
    for r in rows:
        stem = r["stem"]; opts = r["opt_texts"]; cidx = r["correct_idx"]
        topic, sub = classify(subject, stem)
        n += 1
        item_id = f"{subject}-mcq-ss3-{n:03d}"
        options = [{"id": "abcd"[i], "label": "ABCD"[i], "text": opts[i]} for i in range(4)]
        h = int(hashlib.sha256(stem.encode()).hexdigest(), 16)
        steps = []
        if r.get("explanation"): steps.append(str(r["explanation"])[:300])
        steps.append(f"The correct answer is: {opts[cidx]}.")
        prov = [{
            "source": "scrape:myschool-ng",
            "source_id": hashlib.sha1(r["detail_url"].encode()).hexdigest()[:12],
            "rule_id": "mcq_scrape_v1", "recency": None, "confidence": 1.0,
            "evidence_count": 0,
            "metadata": {
                "review_state": "pending_two_reviewer_signoff",
                "subject_lead_approved": False, "safeguarding_reviewed": False,
                "verification_status": "unverified", "answer_verified": False,
                "source_url": r["detail_url"],
                "licence": "third-party-republished (WAEC/NECO past question; rights uncleared)",
                "origin": "verbatim", "exam_label": r.get("badge", ""),
                "stage": "stage1_scrape",
            }}]
        out.append({
            "lang": "en", "provenance": prov, "item_id": item_id,
            "skill_id": f"ss3.{key(topic)}.{key(sub)}", "stem": stem,
            "item_type": "mcq_single", "options": options,
            "correct_option_id": "abcd"[cidx], "difficulty": float(BANDS[h % 5]),
            "subject": subject, "year_group": "SS3", "exams": ["WAEC", "NECO"],
            "topic": topic, "subtopic": sub,
            "misconception_codes": list(MISCON[subject]),
            "explanation": {"title": sub, "steps": steps[:4]},
            "taxonomy_version": "1.0.0",
        })
    return out

summary = {}
for subject in ("maths", "english"):
    bp = HERE / f"{subject}-jss3-ss3-mcq-v1.json"
    bank = json.loads(bp.read_text("utf-8"))
    existing = bank["items"]
    seen = {norm(i["stem"]) for i in existing}
    ss3 = [int(i["item_id"].rsplit("-", 1)[-1]) for i in existing if i["year_group"] == "SS3"]
    start_n = max(ss3) if ss3 else 0
    rows = json.loads((HERE / f"_staging_scraped_{subject}.json").read_text("utf-8"))
    fresh = [r for r in rows if norm(r["stem"]) not in seen]
    dup = len(rows) - len(fresh)
    built = build(subject, fresh, start_n)
    clean = [it for it in built if len({norm(o["text"]) for o in it["options"]}) == 4]
    dropped = len(built) - len(clean)
    bank["items"] = existing + clean
    bp.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", "utf-8")
    summary[subject] = {"existing": len(existing), "rows": len(rows), "dup_skipped": dup,
                        "distinct_dropped": dropped, "added": len(clean), "new_total": len(bank["items"])}
print(json.dumps(summary, indent=2))
