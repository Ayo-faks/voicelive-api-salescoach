#!/usr/bin/env python3
"""Phase 0 — build the Nigerian curriculum taxonomy map (coverage oracle).

OFFLINE build tool. Emits ``ng_curriculum_map.json`` — a structured topic
taxonomy that is BOTH the coverage target for the ingestion pipeline (Phase 1)
and the retrieval test oracle (Phase 3).

Sources (topic names only — these are factual scheme-of-work headings, not
copyrightable prose):

* Maths + English JSS1-SS3: authored from the NERDC 9-Year Basic Education
  Curriculum (Junior Secondary) and the NERDC Senior Secondary Education
  Curriculum, cross-checked against the WAEC/NECO SSCE and BECE/JSSCE syllabus
  topic lists. Each entry carries a ``source_ref`` naming the scheme.
* SS3 content subjects (Government, History, Literature-in-English, Economics,
  Data Processing, Computer Science, Agricultural Science, Biology, Chemistry,
  Physics): the topic/subtopic taxonomy already curated in the staging
  diagnostic banks (``data/learning/diagnostics/<subject>_ss_v1.json``), which
  themselves cite the WAEC/NECO SSCE standard. We reuse ONLY the topic taxonomy
  (skill names), never the question text.

Output entry shape (per the Phase 0 spec):
    {subject, year_group, topic, subtopics:[...], exam_tags:[...], source_ref}

Re-runnable / idempotent.
"""
from __future__ import annotations

import json
from collections import OrderedDict
from pathlib import Path
from typing import Dict, List

HERE = Path(__file__).resolve().parent
DIAGNOSTICS = HERE.parent / "diagnostics"
OUT = HERE / "ng_curriculum_map.json"

JUNIOR_TAGS = ["JSSCE", "BECE"]
SENIOR_TAGS = ["WAEC", "NECO"]

SRC_MATHS_JSS = "NERDC 9-Year Basic Education Curriculum — Mathematics (Junior Secondary)"
SRC_MATHS_SSS = "NERDC Senior Secondary Education Curriculum — Mathematics; WAEC/NECO SSCE Mathematics syllabus"
SRC_ENG_JSS = "NERDC 9-Year Basic Education Curriculum — English Studies (Junior Secondary)"
SRC_ENG_SSS = "NERDC Senior Secondary Education Curriculum — English Language; WAEC/NECO SSCE English syllabus"


# ---------------------------------------------------------------------------
# Authored Maths taxonomy, JSS1 -> SS3.
# topic -> [subtopics]. Topic/subtopic names are NERDC/WAEC scheme headings.
# ---------------------------------------------------------------------------
MATHS: "OrderedDict[str, OrderedDict[str, List[str]]]" = OrderedDict()

MATHS["JSS1"] = OrderedDict([
    ("whole-numbers", ["counting and place value", "rounding and estimation", "factors and multiples", "LCM and HCF", "prime numbers"]),
    ("fractions", ["proper and improper fractions", "equivalent fractions", "addition and subtraction of fractions", "multiplication and division of fractions"]),
    ("decimals", ["place value in decimals", "converting fractions to decimals", "operations with decimals"]),
    ("number-bases", ["counting in base two", "conversion between base two and base ten"]),
    ("basic-operations", ["addition and subtraction", "multiplication and division", "order of operations"]),
    ("approximation", ["rounding to decimal places", "significant figures"]),
    ("algebraic-processes", ["use of symbols", "simplification of algebraic expressions"]),
    ("basic-geometry", ["points lines and planes", "angles", "types of triangles"]),
    ("measurement", ["length", "perimeter of plane shapes", "area of rectangles and squares"]),
    ("statistics", ["data collection", "pictograms and bar charts"]),
])

MATHS["JSS2"] = OrderedDict([
    ("whole-numbers-and-operations", ["multiples and factors", "squares and square roots", "standard form"]),
    ("fractions-and-decimals", ["operations with fractions", "decimals and percentages", "ratio"]),
    ("percentages", ["percentage of a quantity", "percentage increase and decrease", "simple interest"]),
    ("number-bases", ["conversion between bases", "operations in base two"]),
    ("algebraic-expressions", ["expansion of expressions", "factorisation by common factor", "substitution"]),
    ("simple-equations", ["linear equations in one variable", "word problems with equations"]),
    ("geometry-angles", ["angles on a straight line", "angles at a point", "angles in parallel lines"]),
    ("plane-shapes", ["properties of quadrilaterals", "perimeter and area of triangles", "area of parallelogram and trapezium"]),
    ("scale-drawing", ["scales and ratios", "interpreting scale drawings"]),
    ("statistics", ["frequency tables", "mean median and mode", "pie charts"]),
    ("probability", ["chance and likelihood", "simple probability"]),
])

MATHS["JSS3"] = OrderedDict([
    ("number-and-numeration", ["place value", "decimals", "fractions", "percentages", "ratio", "proportion", "indices", "standard form"]),
    ("algebra", ["simplification", "expansion and factorisation", "linear equations", "inequalities", "change of subject of formula"]),
    ("indices", ["laws of indices"]),
    ("geometry", ["angles", "plane shapes and angles", "construction", "similar shapes", "Pythagoras theorem"]),
    ("measurement", ["area", "volume of solids"]),
    ("mensuration", ["perimeter and area", "surface area"]),
    ("statistics", ["frequency tables", "mean median and mode", "bar and pie charts", "cumulative frequency"]),
    ("probability", ["simple probability", "experimental probability"]),
])

MATHS["SS1"] = OrderedDict([
    ("number-bases", ["conversion between bases", "arithmetic in number bases"]),
    ("indices", ["laws of indices", "fractional and negative indices"]),
    ("logarithms", ["logarithms in base ten", "laws of logarithms"]),
    ("sets", ["set notation", "Venn diagrams", "two-set problems"]),
    ("simple-equations-and-variation", ["change of subject", "direct and inverse variation"]),
    ("quadratic-equations", ["factorisation method", "completing the square"]),
    ("logical-reasoning", ["simple and compound statements", "truth tables"]),
    ("geometry", ["properties of polygons", "angles of polygons"]),
    ("trigonometry", ["sine cosine and tangent", "trigonometric ratios of special angles"]),
    ("mensuration", ["length of arc and area of sector", "surface area and volume of solids"]),
    ("statistics", ["collection and presentation of data", "measures of central tendency"]),
])

MATHS["SS2"] = OrderedDict([
    ("logarithms", ["logarithms of numbers greater than one", "antilogarithms", "calculations using logarithm tables"]),
    ("approximation", ["significant figures and decimal places", "percentage error"]),
    ("sequences-and-series", ["arithmetic progression", "geometric progression", "sum of a series"]),
    ("quadratic-functions", ["graphs of quadratic functions", "roots of quadratic equations", "quadratic inequalities"]),
    ("simultaneous-equations", ["linear and quadratic simultaneous equations"]),
    ("trigonometry", ["sine rule", "cosine rule", "bearings"]),
    ("circle-geometry", ["angles in a circle", "cyclic quadrilaterals", "tangents to a circle"]),
    ("coordinate-geometry", ["gradient and intercept", "distance between two points", "equation of a straight line"]),
    ("probability", ["addition and multiplication rules", "mutually exclusive and independent events"]),
    ("statistics", ["cumulative frequency", "measures of dispersion", "ogive"]),
])

MATHS["SS3"] = OrderedDict([
    ("number-and-numeration", ["surds", "number bases"]),
    ("surds", ["simplification of surds", "rationalisation of surds"]),
    ("indices", ["laws of indices", "indicial equations"]),
    ("logarithms", ["laws of logarithms", "change of base", "logarithmic equations"]),
    ("sets", ["set operations", "Venn diagram problems"]),
    ("algebra", ["algebraic fractions", "factor theorem", "partial fractions"]),
    ("quadratics", ["factorisation", "completing the square", "quadratic formula", "sum and product of roots"]),
    ("variation", ["direct variation", "inverse variation", "joint and partial variation"]),
    ("sequences-and-series", ["arithmetic progression", "geometric progression"]),
    ("coordinate-geometry", ["straight line", "midpoint and distance", "gradient", "equation of a line"]),
    ("trigonometry", ["trigonometric ratios", "right triangle", "sine rule", "cosine rule", "identities"]),
    ("mensuration", ["areas and volumes", "latitude and longitude"]),
    ("calculus", ["differentiation", "integration"]),
    ("statistics", ["measures of central tendency", "measures of dispersion", "cumulative frequency"]),
    ("probability", ["simple probability", "addition and multiplication rules", "probability of combined events"]),
])


# ---------------------------------------------------------------------------
# Authored English taxonomy, JSS1 -> SS3.
# ---------------------------------------------------------------------------
ENGLISH: "OrderedDict[str, OrderedDict[str, List[str]]]" = OrderedDict()

ENGLISH["JSS1"] = OrderedDict([
    ("vocabulary", ["word meaning", "synonyms", "antonyms", "everyday vocabulary"]),
    ("grammar", ["nouns", "pronouns", "verbs", "articles", "simple sentences"]),
    ("comprehension", ["reading for detail", "main idea"]),
    ("composition", ["narrative writing", "informal letter"]),
    ("speech-work", ["vowel sounds", "consonant sounds"]),
])

ENGLISH["JSS2"] = OrderedDict([
    ("vocabulary", ["synonyms and antonyms", "word formation", "collocations"]),
    ("grammar", ["tenses", "adjectives and adverbs", "prepositions", "conjunctions", "question tags"]),
    ("comprehension", ["reading for detail", "inference", "vocabulary in context"]),
    ("composition", ["descriptive writing", "formal letter", "article writing"]),
    ("speech-work", ["word stress", "rhymes"]),
    ("summary", ["identifying key points"]),
])

ENGLISH["JSS3"] = OrderedDict([
    ("vocab", ["synonyms", "antonyms", "word meaning", "collocations"]),
    ("grammar", ["tense", "tense agreement", "parts of speech", "concord", "active and passive voice"]),
    ("comprehension", ["detail", "inference", "main idea", "vocabulary in context"]),
    ("figurative", ["similes and metaphors", "basic figures of speech"]),
    ("composition", ["narrative essay", "formal and informal letters", "report writing"]),
    ("summary", ["compressing a passage"]),
    ("speech-work", ["vowel and consonant sounds", "stress and intonation"]),
])

ENGLISH["SS1"] = OrderedDict([
    ("lexis-and-structure", ["vocabulary development", "word classes", "sentence patterns"]),
    ("grammar", ["concord", "tenses", "phrases and clauses", "voice and mood"]),
    ("comprehension", ["reading for detail", "inference", "author's purpose"]),
    ("composition", ["expository essay", "argumentative essay", "letter writing"]),
    ("oral-english", ["vowels", "consonants", "stress"]),
    ("summary", ["summarising in continuous prose"]),
])

ENGLISH["SS2"] = OrderedDict([
    ("lexis-and-structure", ["vocabulary in context", "sentence completion", "usage"]),
    ("grammar", ["concord", "tense sequence", "reported speech", "conditional sentences"]),
    ("comprehension", ["detail", "inference", "tone and attitude"]),
    ("composition", ["argumentative essay", "speech writing", "article writing"]),
    ("oral-english", ["stress and intonation", "rhymes and homophones"]),
    ("summary", ["compressing multiple paragraphs"]),
])

ENGLISH["SS3"] = OrderedDict([
    ("lexis-and-structure", ["sentence completion", "usage", "vocabulary and meaning"]),
    ("grammar", ["concord", "tense and aspect", "transformation of sentences"]),
    ("comprehension", ["detail", "inference", "main idea", "vocabulary in context"]),
    ("mechanics", ["spelling", "punctuation"]),
    ("sentence", ["transformation", "rewriting in another structure"]),
    ("summary", ["compressing a passage in continuous prose"]),
    ("composition", ["argumentative essay", "narrative essay", "formal letter"]),
    ("oral-english", ["vowel and consonant contrasts", "stress and intonation"]),
])


# ---------------------------------------------------------------------------
# SS3 content subjects — extracted from the staging diagnostic banks.
# Bank skill_id shape: ss3.<subject>.<topic>.<subtopic> (clean 4-part).
# We reuse only the topic taxonomy, citing the WAEC/NECO SSCE standard.
# ---------------------------------------------------------------------------
CONTENT_SUBJECTS = OrderedDict([
    ("government", "government_ss_v1.json"),
    ("history", "history_ss_v1.json"),
    ("literature", "literature_ss_v1.json"),
    ("economics", "economics_ss_v1.json"),
    ("data_processing", "data_processing_ss_v1.json"),
    ("computer_science", "computer_science_ss_v1.json"),
    ("agricultural_science", "agricultural_science_ss_v1.json"),
    ("biology", "biology_ss_v1.json"),
    ("chemistry", "chemistry_ss_v1.json"),
    ("physics", "physics_ss_v1.json"),
])


def _humanise(slug: str) -> str:
    return slug.replace("_", " ").strip()


def _extract_content_subject(subject: str, bank_file: str) -> "OrderedDict[str, List[str]]":
    """Return topic -> [subtopics] from a content-subject bank's skills."""
    path = DIAGNOSTICS / bank_file
    data = json.loads(path.read_text(encoding="utf-8"))
    topics: "OrderedDict[str, List[str]]" = OrderedDict()
    for skill in data.get("skills", []):
        sid = skill.get("skill_id", "")
        parts = sid.split(".")
        # Expect ss3.<subject>.<topic>.<subtopic>; tolerate deeper/shorter.
        if len(parts) < 4 or parts[1] != subject:
            continue
        topic = parts[2]
        subtopic = ".".join(parts[3:])
        bucket = topics.setdefault(topic, [])
        human_sub = _humanise(subtopic)
        if human_sub and human_sub not in bucket:
            bucket.append(human_sub)
    return topics


def _entries_from_authored(
    subject: str,
    by_year: "OrderedDict[str, OrderedDict[str, List[str]]]",
    jss_src: str,
    sss_src: str,
) -> List[dict]:
    out: List[dict] = []
    for year, topics in by_year.items():
        tags = JUNIOR_TAGS if year.startswith("JSS") else SENIOR_TAGS
        src = jss_src if year.startswith("JSS") else sss_src
        for topic, subtopics in topics.items():
            out.append(OrderedDict([
                ("subject", subject),
                ("year_group", year),
                ("topic", topic),
                ("subtopics", list(subtopics)),
                ("exam_tags", list(tags)),
                ("source_ref", src),
            ]))
    return out


def main() -> None:
    entries: List[dict] = []
    entries += _entries_from_authored("maths", MATHS, SRC_MATHS_JSS, SRC_MATHS_SSS)
    entries += _entries_from_authored("english", ENGLISH, SRC_ENG_JSS, SRC_ENG_SSS)

    for subject, bank_file in CONTENT_SUBJECTS.items():
        topics = _extract_content_subject(subject, bank_file)
        src = (
            f"WAEC/NECO SSCE syllabus — {_humanise(subject).title()}; "
            f"NERDC Senior Secondary Education Curriculum "
            f"(topic taxonomy via staging bank {bank_file})"
        )
        for topic, subtopics in topics.items():
            entries.append(OrderedDict([
                ("subject", subject),
                ("year_group", "SS3"),
                ("topic", topic),
                ("subtopics", subtopics),
                ("exam_tags", list(SENIOR_TAGS)),
                ("source_ref", src),
            ]))

    doc = OrderedDict([
        ("schema_version", "1.0.0"),
        ("description",
         "Nigerian curriculum topic taxonomy (JSS1-SS3) for the Pathfinder "
         "tutor RAG corpus. Coverage target and retrieval oracle. Topic names "
         "are factual NERDC/WAEC/NECO scheme-of-work headings; no copyrighted "
         "prose is stored here."),
        ("exam_tag_vocab", ["WAEC", "NECO", "JSSCE", "BECE"]),
        ("year_group_vocab", ["JSS1", "JSS2", "JSS3", "SS1", "SS2", "SS3"]),
        ("entries", entries),
    ])

    OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # ---- report ----
    from collections import Counter
    per = Counter((e["subject"], e["year_group"]) for e in entries)
    n_sub = Counter()
    for e in entries:
        n_sub[e["subject"]] += len(e["subtopics"])
    print(f"wrote {OUT}")
    print(f"total entries (subject x year x topic): {len(entries)}")
    print("per (subject, year_group):")
    for (subj, year), n in sorted(per.items()):
        print(f"  {subj:22} {year:5} topics={n:3}  subtopics={sum(len(e['subtopics']) for e in entries if e['subject']==subj and e['year_group']==year)}")


if __name__ == "__main__":
    main()
