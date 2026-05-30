#!/usr/bin/env python3
"""Merge BECE (JSS3) scraped MCQs into the JSS3 side of the banks.
Additive. Dedup by normalised stem. Continue JSS3 item_id numbering.
Items stay unverified / pending_two_reviewer_signoff.
"""
import hashlib, json, re
from pathlib import Path
HERE = Path(__file__).resolve().parent

def norm(t): return re.sub(r"\s+", " ", str(t).lower()).strip()
def key(t): return re.sub(r"[^a-z0-9]+", "_", t.lower()).strip("_")

MATHS_TOPICS = [
    (r"\bA\.?P\.?\b|arithmetic progression|\bG\.?P\.?\b|nth term|common difference|common ratio|sequence", "Sequences", "Patterns"),
    (r"indices|index|\^|exponent|standard form|\* ?10\^|power", "Indices", "Powers"),
    (r"logarithm|log ?\d|antilog", "Number", "Logarithms"),
    (r"probability|dice|coin|at random|likely|chance", "Probability", "Single events"),
    (r"mean|median|mode|frequency|average|bar chart|pie chart|histogram", "Statistics", "Averages and charts"),
    (r"sin |cos |tan |sine|cosine|tangent|bearing|angle of elevation|pythagoras", "Geometry", "Trigonometry and bearings"),
    (r"area|perimeter|volume|cylinder|sphere|radius|diameter|circumference|surface", "Measurement", "Mensuration"),
    (r"angle|triangle|polygon|parallel|circle|quadrilateral|locus|bisect|construction", "Geometry", "Plane shapes and angles"),
    (r"set|union|intersection|venn|subset|complement", "Number", "Sets"),
    (r"ratio|proportion|percentage|percent|interest|discount|profit|loss|rate", "Number", "Ratio and percentage"),
    (r"fraction|decimal|\bL\.?C\.?M\.?\b|\bH\.?C\.?F\.?\b|prime|factor|place value|round|approximate|significant|number base|binary", "Number", "Fractions and number"),
    (r"simplify|expand|factoris|equation|expression|simultaneous|inequality|solve for|variable", "Algebra", "Expressions and equations"),
]
ENGLISH_TOPICS = [
    (r"closest in meaning|opposite in meaning|nearly the same|synonym|antonym|means the same|word means", "Vocabulary", "Synonyms and antonyms"),
    (r"completes the sentence|best completes|fill|gap|choose the (?:word|option)|most suitable", "Grammar", "Sentence completion"),
    (r"stress|syllable|pronounc|sound|rhyme|vowel|consonant", "Oral English", "Sounds and stress"),
    (r"plural|tense|concord|agreement|preposition|article|pronoun|adjective|adverb|punctuation|spelling|grammatical|correct form", "Grammar", "Usage and mechanics"),
    (r"idiom|proverb|figure of speech|metaphor|simile|personification|register", "Vocabulary", "Idiom and figures"),
    (r"passage|according to the|the writer|the author|because|comprehension|reading|the text|in the passage", "Comprehension", "Reading"),
]
def classify(subject, stem):
    table = MATHS_TOPICS if subject == "maths" else ENGLISH_TOPICS
    for pat, topic, sub in table:
        if re.search(pat, stem, re.I):
            return topic, sub
    return ("Number", "General") if subject == "maths" else ("Comprehension", "Reading")

MISCON = {"maths": ["calc_error", "prerequisite_gap"],
          "english": ["language_comprehension", "prerequisite_gap"]}
BANDS = [-1.5, -1.0, -0.5, 0.0, 0.5]  # JSS3 skews easier than SS3

def build(subject, rows, start_n):
    out = []
    n = start_n
    for r in rows:
        stem = r["stem"]; opts = r["opt_texts"]; cidx = r["correct_idx"]
        topic, sub = classify(subject, stem)
        n += 1
        item_id = f"{subject}-mcq-jss3-{n:03d}"
        options = [{"id": "abcd"[i], "label": "ABCD"[i], "text": opts[i]} for i in range(4)]
        h = int(hashlib.sha256(stem.encode()).hexdigest(), 16)
        steps = [f"The correct answer is: {opts[cidx]}."]
        prov = [{
            "source": "scrape:schoolngr",
            "source_id": hashlib.sha1((stem[:80]).encode()).hexdigest()[:12],
            "rule_id": "mcq_scrape_v1", "recency": None, "confidence": 1.0,
            "evidence_count": 0,
            "metadata": {
                "review_state": "pending_two_reviewer_signoff",
                "subject_lead_approved": False, "safeguarding_reviewed": False,
                "verification_status": "unverified", "answer_verified": False,
                "source_url": "https://www.schoolngr.com/classroom/bece/" + ("mathematics" if subject=="maths" else "english-language"),
                "licence": "third-party-republished (BECE past question; rights uncleared)",
                "origin": "verbatim", "exam_label": r.get("badge", ""),
                "stage": "stage1_scrape",
            }}]
        out.append({
            "lang": "en", "provenance": prov, "item_id": item_id,
            "skill_id": f"jss3.{key(topic)}.{key(sub)}", "stem": stem,
            "item_type": "mcq_single", "options": options,
            "correct_option_id": "abcd"[cidx], "difficulty": float(BANDS[h % 5]),
            "subject": subject, "year_group": "JSS3", "exams": ["Junior WAEC"],
            "topic": topic, "subtopic": sub,
            "misconception_codes": list(MISCON[subject]),
            "explanation": {"title": sub, "steps": steps},
            "taxonomy_version": "1.0.0",
        })
    return out

summary = {}
for subject in ("maths", "english"):
    bp = HERE / f"{subject}-jss3-ss3-mcq-v1.json"
    bank = json.loads(bp.read_text("utf-8"))
    existing = bank["items"]
    seen = {norm(i["stem"]) for i in existing}
    jss3 = [int(i["item_id"].rsplit("-", 1)[-1]) for i in existing if i["year_group"] == "JSS3"]
    start_n = max(jss3) if jss3 else 0
    rows = json.loads((HERE / f"_staging_scraped_bece_{subject}.json").read_text("utf-8"))
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
