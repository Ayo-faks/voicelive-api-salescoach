"""Screenshot every slide of the Wulo deck at 1920x1080 and 1366x768.

Toggles `.active` on each <section class="slide">, waits briefly, then captures
a PNG. No framework runtime — just Playwright + a static HTML file.
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DECK_DIR = ROOT / "docs" / "wulo-deck"
INDEX = DECK_DIR / "index.html"
OUT_1920 = DECK_DIR / "exports" / "1920x1080"
OUT_1366 = DECK_DIR / "exports" / "1366x768"

VIEWPORTS = [
    ("1920x1080", 1920, 1080, OUT_1920),
    ("1366x768", 1366, 768, OUT_1366),
]


def shoot(only: list[str] | None = None) -> None:
    OUT_1920.mkdir(parents=True, exist_ok=True)
    OUT_1366.mkdir(parents=True, exist_ok=True)
    url = INDEX.as_uri()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for label, w, h, out_dir in VIEWPORTS:
            context = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2)
            page = context.new_page()
            page.goto(url)
            page.evaluate("document.body.classList.add('export')")
            page.wait_for_selector(".slide")
            slide_count = page.evaluate("document.querySelectorAll('.slide').length")
            for idx in range(slide_count):
                meta = page.evaluate(
                    """(i) => {
                        const slides = document.querySelectorAll('.slide');
                        slides.forEach(s => s.classList.remove('active'));
                        const s = slides[i];
                        s.classList.add('active');
                        return { slide: s.dataset.slide, name: s.dataset.name };
                    }""",
                    idx,
                )
                name = f"{meta['slide']}-{meta['name']}.png"
                if only and meta["name"] not in only and meta["slide"] not in only:
                    continue
                page.wait_for_timeout(180)
                page.screenshot(path=str(out_dir / name), full_page=False)
                print(f"[{label}] wrote {out_dir / name}")
            context.close()
        browser.close()


if __name__ == "__main__":
    targets = sys.argv[1:] or None
    shoot(targets)
