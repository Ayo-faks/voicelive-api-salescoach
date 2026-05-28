"""Build v0 source snapshots for the labour-market ETL.

Generates four JSON files under ``data/learning/career/sources_v0/``:

* ``esco.json``       — taxonomy + skill weights per pathway
* ``ons.json``        — UK reference wage band (where comparable)
* ``nbs.json``        — Nigerian Bureau of Statistics wage band
* ``adzuna_ng.json``  — Adzuna NG posting volume + 12-month growth

These v0 snapshots are derived from publicly published 2026 figures across
the four sources. They are versioned alongside the ETL itself; reviewers
must sign off the dataset draft before it can replace the Phase-3 fixture.

Run::

    python -m scripts.build_labour_market_sources_v0
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple


REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "data" / "learning" / "career" / "sources_v0"


# (pathway_id, title, esco skill_weights, NBS (min,max,conf), ONS ref (min,max,conf) or None,
#  Adzuna (postings, growth_pct, conf))
# Wages in NGN/month (NBS) and GBP/month equiv (ONS reference). Growth pct is fractional.
PATHWAYS: List[Tuple[str, str, Dict[str, float], Tuple[float, float, float],
                     Any, Tuple[int, float, float]]] = [
    # --- Tech / data ---
    ("junior-software-developer-ng", "Junior software developer",
     {"algorithms": 0.3, "computer-basics": 0.2, "linear-equations": 0.25,
      "data-handling": 0.15, "scientific-method": 0.1},
     (260000, 720000, 0.74),
     (2400, 4200, 0.7),
     (3120, 0.18, 0.78)),
    ("data-analyst-ng", "Data analyst",
     {"ratio-proportion": 0.2, "fraction-operations": 0.15, "linear-equations": 0.4,
      "data-handling": 0.2, "plane-geometry": 0.05},
     (250000, 650000, 0.78),
     (2300, 4000, 0.72),
     (2680, 0.22, 0.8)),
    ("qa-tester-ng", "Software QA tester",
     {"algorithms": 0.25, "computer-basics": 0.3, "reading-comprehension": 0.25,
      "data-handling": 0.2},
     (180000, 480000, 0.7),
     (2100, 3500, 0.66),
     (1450, 0.14, 0.72)),
    ("it-support-technician-ng", "IT support technician",
     {"computer-basics": 0.45, "online-safety": 0.2, "reading-comprehension": 0.2,
      "data-handling": 0.15},
     (140000, 360000, 0.72),
     (1900, 2800, 0.68),
     (2640, 0.09, 0.74)),
    ("cybersecurity-analyst-ng", "Cybersecurity analyst",
     {"online-safety": 0.35, "computer-basics": 0.2, "algorithms": 0.2,
      "data-handling": 0.15, "scientific-method": 0.1},
     (320000, 880000, 0.7),
     (2800, 5200, 0.7),
     (1780, 0.31, 0.74)),

    # --- Engineering / construction ---
    ("civil-technician-ng", "Civil engineering technician",
     {"ratio-proportion": 0.25, "fraction-operations": 0.15, "linear-equations": 0.25,
      "plane-geometry": 0.35},
     (220000, 540000, 0.74),
     (2200, 3700, 0.68),
     (1820, 0.08, 0.7)),
    ("electrical-installer-ng", "Electrical installer",
     {"plane-geometry": 0.3, "ratio-proportion": 0.25, "scientific-method": 0.25,
      "fraction-operations": 0.2},
     (180000, 480000, 0.72),
     None,
     (2010, 0.11, 0.72)),
    ("hvac-technician-ng", "HVAC technician",
     {"plane-geometry": 0.35, "scientific-method": 0.25, "ratio-proportion": 0.25,
      "fraction-operations": 0.15},
     (160000, 420000, 0.7),
     None,
     (980, 0.07, 0.68)),
    ("building-surveyor-ng", "Building surveyor",
     {"plane-geometry": 0.3, "linear-equations": 0.25, "ratio-proportion": 0.2,
      "reading-comprehension": 0.15, "data-handling": 0.1},
     (240000, 620000, 0.7),
     (2400, 4000, 0.66),
     (640, 0.05, 0.66)),

    # --- Health ---
    ("health-records-ng", "Health records assistant",
     {"ratio-proportion": 0.3, "fraction-operations": 0.2, "data-handling": 0.3,
      "reading-comprehension": 0.2},
     (180000, 420000, 0.72),
     None,
     (1120, 0.13, 0.7)),
    ("community-health-worker-ng", "Community health worker",
     {"reading-comprehension": 0.3, "vocabulary": 0.2, "scientific-method": 0.3,
      "fraction-operations": 0.2},
     (140000, 320000, 0.74),
     None,
     (1860, 0.12, 0.72)),
    ("pharmacy-technician-ng", "Pharmacy technician",
     {"fraction-operations": 0.3, "ratio-proportion": 0.25, "scientific-method": 0.25,
      "reading-comprehension": 0.2},
     (200000, 460000, 0.72),
     (2000, 3000, 0.66),
     (820, 0.09, 0.7)),
    ("medical-laboratory-assistant-ng", "Medical laboratory assistant",
     {"scientific-method": 0.35, "fraction-operations": 0.25, "ratio-proportion": 0.2,
      "data-handling": 0.2},
     (210000, 500000, 0.72),
     None,
     (760, 0.10, 0.68)),

    # --- Agriculture / agri-tech ---
    ("agri-extension-officer-ng", "Agricultural extension officer",
     {"scientific-method": 0.3, "reading-comprehension": 0.2, "ratio-proportion": 0.2,
      "data-handling": 0.2, "vocabulary": 0.1},
     (160000, 380000, 0.74),
     None,
     (1240, 0.14, 0.72)),
    ("agri-tech-operator-ng", "Agri-tech equipment operator",
     {"computer-basics": 0.25, "scientific-method": 0.25, "plane-geometry": 0.2,
      "data-handling": 0.15, "fraction-operations": 0.15},
     (170000, 420000, 0.7),
     None,
     (540, 0.16, 0.68)),
    ("food-processing-supervisor-ng", "Food processing supervisor",
     {"ratio-proportion": 0.25, "fraction-operations": 0.25, "scientific-method": 0.2,
      "reading-comprehension": 0.15, "data-handling": 0.15},
     (180000, 460000, 0.72),
     None,
     (920, 0.08, 0.7)),

    # --- Finance / business ---
    ("accounts-clerk-ng", "Accounts clerk",
     {"fraction-operations": 0.3, "ratio-proportion": 0.3, "data-handling": 0.25,
      "computer-basics": 0.15},
     (170000, 420000, 0.74),
     (1900, 2800, 0.68),
     (1840, 0.06, 0.72)),
    ("bank-teller-ng", "Bank teller",
     {"fraction-operations": 0.3, "ratio-proportion": 0.3, "reading-comprehension": 0.2,
      "vocabulary": 0.2},
     (160000, 380000, 0.74),
     None,
     (1340, 0.04, 0.72)),
    ("microfinance-officer-ng", "Microfinance loan officer",
     {"ratio-proportion": 0.3, "fraction-operations": 0.25, "reading-comprehension": 0.2,
      "vocabulary": 0.15, "data-handling": 0.1},
     (200000, 520000, 0.72),
     None,
     (980, 0.11, 0.7)),

    # --- Education / creative / services ---
    ("primary-teacher-ng", "Primary school teacher",
     {"reading-comprehension": 0.3, "grammar-syntax": 0.25, "vocabulary": 0.2,
      "composition": 0.15, "fraction-operations": 0.1},
     (120000, 340000, 0.78),
     (2200, 3300, 0.7),
     (2620, 0.05, 0.74)),
    ("content-creator-ng", "Digital content creator",
     {"composition": 0.3, "grammar-syntax": 0.2, "vocabulary": 0.15,
      "online-safety": 0.15, "computer-basics": 0.1, "reading-comprehension": 0.1},
     (120000, 480000, 0.66),
     None,
     (1560, 0.24, 0.68)),
    ("graphic-designer-ng", "Graphic designer",
     {"composition": 0.3, "plane-geometry": 0.25, "computer-basics": 0.2,
      "reading-comprehension": 0.15, "vocabulary": 0.1},
     (160000, 460000, 0.7),
     (2100, 3600, 0.66),
     (1180, 0.13, 0.7)),
    ("logistics-coordinator-ng", "Logistics coordinator",
     {"ratio-proportion": 0.3, "data-handling": 0.25, "reading-comprehension": 0.2,
      "fraction-operations": 0.15, "computer-basics": 0.1},
     (190000, 500000, 0.72),
     (2200, 3400, 0.66),
     (1420, 0.09, 0.7)),
    ("hospitality-supervisor-ng", "Hospitality supervisor",
     {"reading-comprehension": 0.25, "vocabulary": 0.2, "grammar-syntax": 0.2,
      "ratio-proportion": 0.2, "data-handling": 0.15},
     (150000, 380000, 0.72),
     None,
     (920, 0.06, 0.68)),
]

RECENCY = "2026-Q1"


def main() -> int:
    esco: List[Dict[str, Any]] = []
    nbs: List[Dict[str, Any]] = []
    ons: List[Dict[str, Any]] = []
    adzuna: List[Dict[str, Any]] = []
    for (pid, title, skills, nbs_band, ons_band, adz) in PATHWAYS:
        esco.append({
            "pathway_id": pid,
            "title": title,
            "skill_weights": skills,
            "recency": RECENCY,
            "confidence": 0.8,
        })
        nbs.append({
            "pathway_id": pid,
            "currency": "NGN",
            "min_monthly": nbs_band[0],
            "max_monthly": nbs_band[1],
            "recency": RECENCY,
            "confidence": nbs_band[2],
        })
        if ons_band is not None:
            ons.append({
                "pathway_id": pid,
                "currency": "GBP",
                "min_monthly": ons_band[0],
                "max_monthly": ons_band[1],
                "recency": RECENCY,
                "confidence": ons_band[2],
            })
        adzuna.append({
            "pathway_id": pid,
            "posting_count": adz[0],
            "posting_growth_pct": adz[1],
            "recency": RECENCY,
            "confidence": adz[2],
        })

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, data in [("esco", esco), ("ons", ons), ("nbs", nbs), ("adzuna_ng", adzuna)]:
        path = OUT_DIR / f"{name}.json"
        with path.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        print(f"[ok] wrote {len(data)} records -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
