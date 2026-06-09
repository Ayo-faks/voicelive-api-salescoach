#!/usr/bin/env python3
"""Stage-1 prose scraper for the Wulo Academy / Pathfinder Learn RAG wiki corpus.

Sibling of ``scrape_schoolngr.py``. That script mines MCQs; this one mines
**prose paragraphs** for the explanation wiki the "Ask Wulo" assistant grounds
on. It REUSES the proven scaffolding (urllib + UA + DELAY throttle and a
``clean_text`` HTML->voice-safe-prose sanitiser) but parses article/section
*prose* into ``WikiNode`` bodies instead of question/option blocks.

It emits files in the schema auto-discovered by
``backend/src/learning/rag.py`` (`load_wiki_corpus` / `_default_corpus_paths`):
``data/learning/wiki/<subject>_<source>_wiki.json`` with ``status:"approved"``.

Two content paths:
  1. Scraped — Siyavula (CC-BY) open textbooks: mathematics (Gr7-12),
     physical-sciences (Gr10-12, routed to physics/chemistry), life-sciences
     (Gr10, biology); and Wikibooks (CC-BY-SA-4.0) collections, e.g. A-level
     Physics (Advancing Physics) -> physics SS3. Real third-party prose; source
     URL + license recorded per node so we can audit/purge before any
     commercial launch.
  2. Clean-room — for the Nigeria-specific subjects with no clean open book
     (computer_science, data_processing, economics, government, history,
     literature, agricultural_science, plus english deepening) we author short
     prose from the NERDC scheme-of-work topic list, exactly as the existing
     biology nodes were produced (see their provenance note). Content lives in
     ``wiki_cleanroom_content.py``.

THIS IS FOR TESTING ONLY. Licensing is recorded but not yet cleared; do not
publish/deploy the NC-tagged content. Local files only.

Usage:
    python scrape_wiki_content.py                 # scrape + clean-room, all
    python scrape_wiki_content.py --only physics  # one subject
    python scrape_wiki_content.py --cleanroom-only --no-net   # offline, authored only
    python scrape_wiki_content.py --cap 30        # max sections per Siyavula book
"""
from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import os
import re
import sys
import time
import urllib.request as u
from pathlib import Path
from typing import Dict, Iterable, List, Optional

# ---------------------------------------------------------------------------
# Reused HTTP + cleaning scaffolding (mirrors scrape_schoolngr.py).
# ---------------------------------------------------------------------------
UA = "Mozilla/5.0 (compatible; PathfinderWikiScraper/1.0; +pathfinder-learn)"
DELAY = 0.8  # polite throttle between requests

REPO_ROOT = Path(__file__).resolve().parents[3]
WIKI_DIR = REPO_ROOT / "data" / "learning" / "wiki"

# Word-count window for a single wiki body (voice-readable explanation).
MIN_WORDS = 60
MAX_WORDS = 250


def fetch(url: str) -> str:
    req = u.Request(url, headers={"User-Agent": UA})
    with u.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def clean_text(raw: str) -> Optional[str]:
    """HTML -> voice-safe plain prose, or ``None`` if the fragment is unsafe.

    Same contract as ``scrape_schoolngr.clean_text``: unescape entities, fold
    sup/sub, strip simple LaTeX, drop anything containing images or residual
    LaTeX/markup symbols the TTS cannot read aloud (``\\``, ``{}``, ``$``).
    """
    raw = re.sub(r"<sup>(.*?)</sup>", lambda m: "^" + re.sub(r"<[^>]+>", "", m.group(1)), raw, flags=re.S)
    raw = re.sub(r"<sub>(.*?)</sub>", lambda m: re.sub(r"<[^>]+>", "", m.group(1)), raw, flags=re.S)
    raw = re.sub(r"\\\((.*?)\\\)", r"\1", raw)
    raw = re.sub(r"\\frac\{(.*?)\}\{(.*?)\}", r"(\1)/(\2)", raw)
    raw = raw.replace("\\times", "×").replace("\\div", "÷")
    raw = raw.replace("\\sqrt", "√").replace("\\pi", "π")
    if "<img" in raw.lower():
        return None
    txt = re.sub(r"<[^>]+>", " ", raw)
    txt = html.unescape(txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    if not txt:
        return None
    if re.search(r"[\\{}]|\$", txt):
        return None
    return txt


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return re.sub(r"-{2,}", "-", s)


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Schema node builder.
# ---------------------------------------------------------------------------
def build_node(
    *,
    subject: str,
    year_group: str,
    topic: str,
    subtopic: str,
    title: str,
    body: str,
    source: str,
    license_str: str,
    source_title: str,
    pipeline: str,
) -> Dict:
    topic_slug = slugify(topic)
    sub_slug = slugify(subtopic)
    year_slug = year_group.lower()
    node_id = f"wiki.{subject}.{year_slug}.{topic_slug}.{sub_slug}"
    anchor = f"sec-{subject}-{year_slug}-{topic_slug}-{sub_slug}"
    return {
        "lang": "en",
        "provenance": [
            {
                "source": source,
                "rule_id": "scrape",
                "confidence": 1.0,
                "evidence_count": 1,
                "metadata": {
                    "license": license_str,
                    "ingested_at": _now_iso(),
                    "ingest_pipeline": pipeline,
                    "source_title": source_title,
                },
            }
        ],
        "node_id": node_id,
        "version": "1.0.0",
        "title": title,
        "subject": subject,
        "year_group": year_group,
        "topic": topic,
        "subtopic": subtopic,
        "misconception_codes": [],
        "body_markdown": body,
        "anchors": [anchor],
        "status": "approved",
    }


def _assemble_body(paragraphs: Iterable[str]) -> Optional[str]:
    """Join cleaned paragraphs into a single voice-safe body in the word window."""
    out: List[str] = []
    words = 0
    for p in paragraphs:
        n = len(p.split())
        if n < 6:  # captions / stray fragments
            continue
        out.append(p)
        words += n
        if words >= MAX_WORDS:
            break
    if not out:
        return None
    body = " ".join(out)
    toks = body.split()
    if len(toks) > MAX_WORDS:
        body = " ".join(toks[:MAX_WORDS])
        # trim back to last sentence end for clean TTS
        m = re.search(r"^(.*[.!?])\s+\S+$", body)
        if m:
            body = m.group(1)
    if len(body.split()) < MIN_WORDS:
        return None
    return body


# ---------------------------------------------------------------------------
# Siyavula scraping (CC-BY).
# ---------------------------------------------------------------------------
SIYA_BASE = "https://www.siyavula.com"
SIYA_LICENSE = "CC-BY-3.0"

# Grade -> Nigerian year group. Gr7-9 ~ JSS, Gr10-12 ~ SS.
GRADE_YEAR = {7: "JSS1", 8: "JSS2", 9: "JSS3", 10: "SS1", 11: "SS2", 12: "SS3"}

# physical-sciences mixes physics + chemistry; route each chapter slug.
CHAPTER_SUBJECT = {
    # chemistry
    "chemical-bonding": "chemistry",
    "classification-of-matter": "chemistry",
    "physical-and-chemical-change": "chemistry",
    "quantitative-aspects-of-chemical-change": "chemistry",
    "reactions-in-aqueous-solution": "chemistry",
    "representing-chemical-change": "chemistry",
    "states-of-matter-and-the-kinetic-molecular-theory": "chemistry",
    "the-atom": "chemistry",
    "the-hydrosphere": "chemistry",
    "the-particles-that-substances-are-made-of": "chemistry",
    "the-periodic-table": "chemistry",
    "atomic-combinations": "chemistry",
    "energy-and-chemical-change": "chemistry",
    "ideal-gases": "chemistry",
    "intermolecular-forces": "chemistry",
    "the-lithosphere": "chemistry",
    "types-of-reactions": "chemistry",
    "acids-and-bases": "chemistry",
    "chemical-equilibrium": "chemistry",
    "electrochemical-reactions": "chemistry",
    "organic-molecules": "chemistry",
    "rate-and-extent-of-reaction": "chemistry",
    "the-chemical-industry": "chemistry",
    # physics
    "electric-circuits": "physics",
    "electromagnetic-radiation": "physics",
    "electrostatics": "physics",
    "longitudinal-waves": "physics",
    "magnetism": "physics",
    "mechanical-energy": "physics",
    "motion-in-one-dimension": "physics",
    "sound": "physics",
    "transverse-pulses": "physics",
    "transverse-waves": "physics",
    "vectors-and-scalars": "physics",
    "2d-and-3d-wavefronts": "physics",
    "electromagnetism": "physics",
    "geometrical-optics": "physics",
    "newtons-laws": "physics",
    "vectors-in-two-dimensions": "physics",
    "doppler-effect": "physics",
    "electrodynamics": "physics",
    "momentum-and-impulse": "physics",
    "optical-phenomena-and-properties-of-matter": "physics",
    "vertical-projectile-motion-in-one-dimension": "physics",
    "work-energy-and-power": "physics",
    # skip (front-matter)
    "image-attributions": None,
    "skills-for-science": None,
}

# Which Siyavula books/grades feed which taxonomy subject.
#   book -> {grade: default_subject_or_None_for_router}
SIYA_PLAN = {
    "mathematics": {g: "maths" for g in (7, 8, 9, 10, 11, 12)},
    "life-sciences": {10: "biology"},
    "physical-sciences": {10: None, 11: None, 12: None},  # router via CHAPTER_SUBJECT
}

# Boilerplate paragraphs to drop (nav, cookie, chrome).
NAV_RE = re.compile(
    r"home practice|we use this information|past papers|textbooks|sign in|"
    r"register|siyavula|previous\b|next chapter|show me all|all siyavula|"
    r"terms of|privacy|created with|to personalise|don't get left behind|"
    r"upload your|practise anywhere|your dashboard|^chapter \d", re.I)

H1_SECTION_RE = re.compile(r'<h1[^>]*>\s*(\d+\.\d+\s+[^<]+?)\s*</h1>', re.S)
H1_ANY_RE = re.compile(r'<h1[^>]*>(.*?)</h1>', re.S)
P_RE = re.compile(r"<p[^>]*>(.*?)</p>", re.S)


def _section_links(toc_html: str, book: str, grade: int) -> List[str]:
    pat = re.compile(
        r'href="(/read/za/%s/grade-%d/[a-z0-9-]+/[0-9]{2}-[a-z0-9-]+)"' % (re.escape(book), grade))
    seen: List[str] = []
    for href in pat.findall(toc_html):
        if href not in seen:
            seen.append(href)
    return seen


def _parse_section(page_html: str) -> Optional[Dict]:
    """Return {title, paragraphs[]} for a Siyavula section page, or None."""
    m = H1_SECTION_RE.search(page_html)
    if m:
        heading = clean_text(m.group(1)) or ""
        start = m.end()
    else:
        # fall back to first non-"Chapter" h1
        heading = ""
        start = 0
        for hm in H1_ANY_RE.finditer(page_html):
            h = clean_text(hm.group(1)) or ""
            if h and not h.lower().startswith("chapter"):
                heading, start = h, hm.end()
                break
    if not heading:
        return None
    # strip leading section number like "2.1 "
    title = re.sub(r"^\d+(?:\.\d+)*\s+", "", heading).strip()
    if not title:
        return None
    segment = page_html[start:]
    paras: List[str] = []
    seen = set()
    for raw in P_RE.findall(segment):
        txt = clean_text(raw)
        if not txt or len(txt) < 40:
            continue
        if NAV_RE.search(txt):
            continue
        key = txt[:60].lower()
        if key in seen:
            continue
        seen.add(key)
        paras.append(txt)
        if sum(len(p.split()) for p in paras) >= MAX_WORDS + 60:
            break
    return {"title": title, "paragraphs": paras}


def scrape_siyavula(cap: int) -> Dict[str, List[Dict]]:
    """Scrape configured Siyavula books -> {subject: [node, ...]}."""
    by_subject: Dict[str, List[Dict]] = {}
    seen_ids: set = set()
    for book, grades in SIYA_PLAN.items():
        for grade, default_subject in grades.items():
            year = GRADE_YEAR[grade]
            toc_url = f"{SIYA_BASE}/read/za/{book}/grade-{grade}"
            try:
                toc = fetch(toc_url)
            except Exception as e:  # noqa: BLE001
                print(f"  [siya] {book} g{grade}: TOC ERR {e}")
                continue
            links = _section_links(toc, book, grade)
            print(f"  [siya] {book} g{grade}: {len(links)} sections")
            kept = 0
            for href in links:
                if kept >= cap:
                    break
                chapter = href.split("/")[5]
                subject = default_subject or CHAPTER_SUBJECT.get(chapter, "skip")
                if subject in (None, "skip"):
                    continue
                try:
                    page = fetch(SIYA_BASE + href)
                except Exception as e:  # noqa: BLE001
                    print(f"    section ERR {href}: {e}")
                    time.sleep(DELAY)
                    continue
                time.sleep(DELAY)
                sec = _parse_section(page)
                if not sec:
                    continue
                body = _assemble_body(sec["paragraphs"])
                if not body:
                    continue
                topic = chapter.replace("-", " ")
                node = build_node(
                    subject=subject,
                    year_group=year,
                    topic=topic,
                    subtopic=sec["title"],
                    title=sec["title"],
                    body=body,
                    source=SIYA_BASE + href,
                    license_str=SIYA_LICENSE,
                    source_title=f"Siyavula {book.replace('-', ' ').title()} Grade {grade}",
                    pipeline="learning.scrape",
                )
                if node["node_id"] in seen_ids:
                    continue
                seen_ids.add(node["node_id"])
                by_subject.setdefault(subject, []).append(node)
                kept += 1
            print(f"    -> kept {kept} from {book} g{grade}")
    return by_subject


# ---------------------------------------------------------------------------
# Wikibooks scraping (CC-BY-SA-4.0).
# ---------------------------------------------------------------------------
WB_BASE = "https://en.wikibooks.org"
WB_LICENSE = "CC-BY-SA-4.0"

# Books to scrape: collection TOC page -> (taxonomy subject, Nigerian year group,
# human source title). A-level material is advanced senior-secondary -> SS3.
WB_PLAN = {
    "Wikibooks:Collections/A-level_Physics_(Advancing_Physics)": {
        "subject": "physics",
        "year_group": "SS3",
        "source_title": "A-level Physics (Advancing Physics), Wikibooks",
    },
}

# Article-content noise to drop (action=render still leaves a little chrome).
WB_NAV_RE = re.compile(
    r"this page was last edited|creative commons|retrieved from|jump to|"
    r"navigation menu|edit source|\[edit\]|categories\s*:|worked solutions|"
    r"this box:|see also|external links|^references$|wikibooks", re.I)


def _wb_article_links(toc_html: str) -> List[str]:
    """Article page paths from a Wikibooks collection TOC (skip worked solutions)."""
    pat = re.compile(r'href="(?://en\.wikibooks\.org)?(/wiki/[^"#]+?)"')
    seen: List[str] = []
    for href in pat.findall(toc_html):
        # only book sub-pages, not the collection/help/special pages
        if "(Advancing_Physics)/" not in href:
            continue
        if href.endswith("/Worked_Solutions"):
            continue
        if href not in seen:
            seen.append(href)
    return seen


def _wb_parse_article(page_html: str) -> List[str]:
    """Cleaned prose paragraphs from a rendered Wikibooks article page."""
    paras: List[str] = []
    seen = set()
    for raw in P_RE.findall(page_html):
        txt = clean_text(raw)
        if not txt or len(txt) < 40:
            continue
        if WB_NAV_RE.search(txt) or NAV_RE.search(txt):
            continue
        key = txt[:60].lower()
        if key in seen:
            continue
        seen.add(key)
        paras.append(txt)
        if sum(len(p.split()) for p in paras) >= MAX_WORDS + 60:
            break
    return paras


def scrape_wikibooks(cap: int) -> Dict[str, List[Dict]]:
    """Scrape configured Wikibooks collections -> {subject: [node, ...]}."""
    import urllib.parse as _up

    by_subject: Dict[str, List[Dict]] = {}
    seen_ids: set = set()
    for toc_path, meta in WB_PLAN.items():
        subject = meta["subject"]
        year = meta["year_group"]
        toc_url = f"{WB_BASE}/w/index.php?title={toc_path}&action=render"
        try:
            toc = fetch(toc_url)
        except Exception as e:  # noqa: BLE001
            print(f"  [wb] {toc_path}: TOC ERR {e}")
            continue
        links = _wb_article_links(toc)
        print(f"  [wb] {toc_path}: {len(links)} article pages")
        kept = 0
        for href in links:
            if kept >= cap:
                break
            title_path = href[len("/wiki/"):]  # URL-encoded page title
            page_url = f"{WB_BASE}/w/index.php?title={title_path}&action=render"
            try:
                page = fetch(page_url)
            except Exception as e:  # noqa: BLE001
                print(f"    page ERR {href}: {e}")
                time.sleep(DELAY)
                continue
            time.sleep(DELAY)
            paras = _wb_parse_article(page)
            body = _assemble_body(paras)
            if not body:
                continue
            title = _up.unquote(href.split("/")[-1]).replace("_", " ").strip()
            if not title:
                continue
            node = build_node(
                subject=subject,
                year_group=year,
                topic=title,
                subtopic=title,
                title=title,
                body=body,
                source=f"{WB_BASE}{href}",
                license_str=WB_LICENSE,
                source_title=meta["source_title"],
                pipeline="learning.scrape",
            )
            if node["node_id"] in seen_ids:
                continue
            seen_ids.add(node["node_id"])
            by_subject.setdefault(subject, []).append(node)
            kept += 1
        print(f"    -> kept {kept} from {toc_path}")
    return by_subject


# ---------------------------------------------------------------------------
# Clean-room authored content (NERDC scheme-of-work topics).
# ---------------------------------------------------------------------------
def build_cleanroom() -> Dict[str, List[Dict]]:
    try:
        from wiki_cleanroom_content import CLEANROOM
    except ImportError:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from wiki_cleanroom_content import CLEANROOM  # type: ignore

    by_subject: Dict[str, List[Dict]] = {}
    seen_ids: set = set()
    for subject, entries in CLEANROOM.items():
        for e in entries:
            body = clean_text(e["body"])
            if not body:
                print(f"  [clean] DROP unsafe body: {subject} {e['title']}")
                continue
            wc = len(body.split())
            if wc < MIN_WORDS or wc > MAX_WORDS:
                # authored content should already fit; warn but keep within hard cap
                body = " ".join(body.split()[:MAX_WORDS])
            node = build_node(
                subject=subject,
                year_group=e["year"],
                topic=e["topic"],
                subtopic=e["subtopic"],
                title=e["title"],
                body=body,
                source=e.get("source", "https://nerdc.gov.ng/ (NERDC scheme of work topic taxonomy; explanations authored clean-room)"),
                license_str=e.get("license", "CC0-1.0"),
                source_title=e.get("source_title", "NERDC Scheme of Work"),
                pipeline="learning.scrape",
            )
            if node["node_id"] in seen_ids:
                continue
            seen_ids.add(node["node_id"])
            by_subject.setdefault(subject, []).append(node)
    return by_subject


# ---------------------------------------------------------------------------
# Writers.
# ---------------------------------------------------------------------------
def _merge_into_file(path: Path, nodes: List[Dict]) -> int:
    """Write/merge nodes into a wiki file, deduping by node_id. Returns total."""
    WIKI_DIR.mkdir(parents=True, exist_ok=True)
    existing: Dict[str, Dict] = {}
    if path.exists():
        try:
            cur = json.loads(path.read_text(encoding="utf-8"))
            for n in cur.get("nodes", []):
                existing[n["node_id"]] = n
        except Exception:  # noqa: BLE001
            existing = {}
    for n in nodes:
        existing[n["node_id"]] = n  # idempotent: re-run overwrites same id
    doc = {
        "version": "1.0.0",
        "lang": "en",
        "provenance": [
            {
                "source": "pathfinder.ingest",
                "rule_id": "ingest",
                "confidence": 1.0,
                "evidence_count": 1,
            }
        ],
        "nodes": list(existing.values()),
    }
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(existing)


def write_outputs(
    scraped: Dict[str, List[Dict]],
    cleanroom: Dict[str, List[Dict]],
    wikibooks: Optional[Dict[str, List[Dict]]] = None,
) -> None:
    plan = [
        ("scrape", "siyavula", scraped),
        ("scrape", "wikibooks", wikibooks or {}),
        ("clean", "nerdc", cleanroom),
    ]
    for _label, tag, by_subject in plan:
        for subject, nodes in sorted(by_subject.items()):
            if not nodes:
                continue
            path = WIKI_DIR / f"{subject}_{tag}_wiki.json"
            total = _merge_into_file(path, nodes)
            print(f"  wrote {len(nodes)} new ({total} total) -> {path.relative_to(REPO_ROOT)}")


# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", help="restrict to one taxonomy subject")
    ap.add_argument("--cap", type=int, default=40, help="max sections per Siyavula book")
    ap.add_argument("--wb-cap", type=int, default=120, help="max pages per Wikibooks collection")
    ap.add_argument("--no-net", action="store_true", help="skip all network scraping")
    ap.add_argument("--cleanroom-only", action="store_true", help="authored content only")
    ap.add_argument("--scrape-only", action="store_true", help="network scrape only")
    ap.add_argument("--no-siyavula", action="store_true", help="skip Siyavula scraping")
    ap.add_argument("--no-wikibooks", action="store_true", help="skip Wikibooks scraping")
    args = ap.parse_args()

    scraped: Dict[str, List[Dict]] = {}
    wikibooks: Dict[str, List[Dict]] = {}
    cleanroom: Dict[str, List[Dict]] = {}

    if not args.no_net and not args.cleanroom_only:
        if not args.no_siyavula:
            print("== Siyavula scrape ==")
            scraped = scrape_siyavula(args.cap)
        if not args.no_wikibooks:
            print("== Wikibooks scrape ==")
            wikibooks = scrape_wikibooks(args.wb_cap)
    if not args.scrape_only:
        print("== Clean-room authoring ==")
        cleanroom = build_cleanroom()

    if args.only:
        scraped = {k: v for k, v in scraped.items() if k == args.only}
        wikibooks = {k: v for k, v in wikibooks.items() if k == args.only}
        cleanroom = {k: v for k, v in cleanroom.items() if k == args.only}

    print("== Write ==")
    write_outputs(scraped, cleanroom, wikibooks)

    # Summary
    counts: Dict[str, int] = {}
    for src in (scraped, wikibooks, cleanroom):
        for subj, nodes in src.items():
            counts[subj] = counts.get(subj, 0) + len(nodes)
    print("== Per-subject node counts (this run) ==")
    for subj in sorted(counts):
        print(f"  {subj}: {counts[subj]}")
    print(f"  TOTAL: {sum(counts.values())}")


if __name__ == "__main__":
    main()
