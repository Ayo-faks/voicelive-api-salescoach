#!/usr/bin/env python3
"""Stage-1 scraper for schoolngr.com BECE (Junior WAEC / JSS3 level).

BECE listings live at /classroom/bece/<subject>?page=N (exam in PATH).
The correct answer is marked inline on the listing via li[data-correct="true"],
so no detail-page fetch is needed. Writes _staging_scraped_bece_<subject>.json.
"""
import html
import json
import re
import sys
import time
import urllib.request as u

UA = "Mozilla/5.0 (compatible; PathfinderScraper/1.0; +pathfinder-learn)"
DELAY = 0.8
BASE = "https://www.schoolngr.com/classroom/bece"
SUBJECTS = {"maths": "mathematics", "english": "english-language"}

BLOCK_RE = re.compile(r'<div class="question-block">(.*?)</ul>', re.S)
STEM_RE = re.compile(r'<div class="question-text">(.*?)</div>', re.S)
BADGE_RE = re.compile(r'class="question-year"><a[^>]*>([^<]+)</a>')
LI_RE = re.compile(
    r'<li data-option="([A-E])"(\s+data-correct="true")?[^>]*>'
    r'\s*<span class="option-label">[A-E]</span>(.*?)</li>', re.S)


def fetch(url):
    req = u.Request(url, headers={"User-Agent": UA})
    with u.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", "replace")


def clean_text(raw):
    raw = re.sub(r"<sup>(.*?)</sup>", lambda m: "^" + re.sub(r"<[^>]+>", "", m.group(1)), raw, flags=re.S)
    raw = re.sub(r"<sub>(.*?)</sub>", lambda m: re.sub(r"<[^>]+>", "", m.group(1)), raw, flags=re.S)
    raw = re.sub(r"\\\((.*?)\\\)", r"\1", raw)
    raw = re.sub(r"\\frac\{(.*?)\}\{(.*?)\}", r"(\1)/(\2)", raw)
    raw = raw.replace("\\times", "×").replace("\\div", "÷")
    raw = raw.replace("\\sqrt", "√").replace("\\pi", "π")
    if "<img" in raw.lower():
        return None
    txt = re.sub(r"<[^>]+>", "", raw)
    txt = html.unescape(txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    if not txt:
        return None
    if re.search(r"[\\{}]|\$", txt):
        return None
    return txt


def norm(t):
    return re.sub(r"\s+", " ", str(t).lower()).strip()


REJECT_STEM = re.compile(
    r"passage|underlined|diagram|figure|the table|frequency table|table below|"
    r"table above|chart|venn|graph above|graph below|shown above|shown below|"
    r"the following information|use the (?:diagram|graph|table|figure)|read the|"
    r"comprehension|numbered\s+\d+\s+above|question\s+above|\babove\b|"
    r"stress pattern|the other\.|from the words lettered|sentence below", re.I)


def parse_block(seg):
    sm = STEM_RE.search(seg)
    if not sm:
        return None
    stem = clean_text(sm.group(1))
    if not stem or len(stem) < 8 or REJECT_STEM.search(stem):
        return None
    bm = BADGE_RE.search(seg)
    badge = html.unescape(bm.group(1).strip()) if bm else ""
    opts = []
    correct_key = None
    for key, corr, body in LI_RE.findall(seg):
        txt = clean_text(body)
        if txt is None:
            return None
        opts.append((key, txt))
        if corr:
            correct_key = key
    if correct_key is None or len(opts) not in (4, 5):
        return None
    # reduce 5 -> 4 keeping correct + first 3 distractors
    if len(opts) == 5:
        correct = [o for o in opts if o[0] == correct_key][0]
        distractors = [o for o in opts if o[0] != correct_key][:3]
        chosen = distractors + [correct]
    else:
        chosen = opts
    texts = [t for _, t in chosen]
    if len({norm(t) for t in texts}) != 4:
        return None
    # deterministic correct slot
    slot = sum(ord(c) for c in correct_key + stem) % 4
    final = texts[:]
    correct_text = [t for k, t in chosen if k == correct_key][0]
    final.remove(correct_text)
    final.insert(slot, correct_text)
    if len({norm(t) for t in final}) != 4:
        return None
    return {"stem": stem, "opt_texts": final, "correct_idx": slot, "badge": badge}


def scrape_subject(subject, max_keep):
    slug = SUBJECTS[subject]
    kept = []
    seen = set()
    page = 1
    empty_streak = 0
    while len(kept) < max_keep and page <= 400:
        url = f"{BASE}/{slug}?page={page}"
        try:
            body = fetch(url)
        except Exception as e:
            print(f"  {subject} p{page}: ERR {e}")
            break
        blocks = BLOCK_RE.findall(body)
        added = 0
        for seg in blocks:
            row = parse_block(seg)
            if not row:
                continue
            k = norm(row["stem"])
            if k in seen:
                continue
            seen.add(k)
            kept.append(row)
            added += 1
            if len(kept) >= max_keep:
                break
        print(f"  {subject} p{page}: +{added} (total {len(kept)})")
        empty_streak = empty_streak + 1 if added == 0 else 0
        if empty_streak >= 8:
            print(f"  {subject}: stopping (8 empty pages)")
            break
        page += 1
        time.sleep(DELAY)
    return kept


def main():
    cap = int(sys.argv[1]) if len(sys.argv) > 1 else 160
    for subject in SUBJECTS:
        rows = scrape_subject(subject, cap)
        out = f"_staging_scraped_bece_{subject}.json"
        with open(out, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)
        print(f"  wrote {len(rows)} rows -> {out}")


if __name__ == "__main__":
    main()
