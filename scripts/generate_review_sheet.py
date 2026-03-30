#!/usr/bin/env python3

"""Generate an HTML review sheet for therapy image assets."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from html import escape
from pathlib import Path

IMAGE_ROOT = Path(__file__).resolve().parents[1] / "data" / "images"
MANIFEST_PATH = IMAGE_ROOT / "manifest.json"
OUTPUT_PATH = IMAGE_ROOT / "review.html"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default=str(MANIFEST_PATH), help="Path to manifest.json")
    parser.add_argument("--output", default=str(OUTPUT_PATH), help="Path to generated HTML file")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).resolve()
    output_path = Path(args.output).resolve()

    with manifest_path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)

    grouped = defaultdict(list)
    for asset in manifest.get("assets", []):
        key = f"{asset.get('category', 'uncategorized')} · {asset.get('sound', 'shared')}"
        grouped[key].append(asset)

    sections = []
    for heading, assets in sorted(grouped.items()):
        cards = []
        for asset in sorted(assets, key=lambda item: item["id"]):
            status = "approved" if asset.get("approved") else asset.get("status", "pending")
            cards.append(
                f"""
                <article class=\"card\">
                  <img src=\"./{escape(asset['imagePath'])}\" alt=\"{escape(asset['word'])}\" loading=\"lazy\" />
                  <div class=\"meta\">
                    <strong>{escape(asset['word'])}</strong>
                    <span>{escape(asset['id'])}</span>
                    <span>{escape(status)}</span>
                  </div>
                </article>
                """
            )
        sections.append(f"<section><h2>{escape(heading)}</h2><div class=\"grid\">{''.join(cards)}</div></section>")

    html = f"""<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>Therapy Image Review</title>
    <style>
      :root {{ color-scheme: light; --teal: #0f766e; --bg: #f0fdfa; --card: #ffffff; --line: #99f6e4; }}
      body {{ margin: 0; font-family: system-ui, sans-serif; background: var(--bg); color: #123; }}
      main {{ max-width: 1200px; margin: 0 auto; padding: 32px 20px 64px; }}
      h1, h2 {{ color: var(--teal); }}
      .grid {{ display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }}
      .card {{ background: var(--card); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; box-shadow: 0 14px 30px rgba(15,118,110,.08); }}
      img {{ display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: #b2dfdb; }}
      .meta {{ display: grid; gap: 4px; padding: 12px; font-size: 14px; }}
    </style>
  </head>
  <body>
    <main>
      <h1>Therapy Image Review</h1>
      <p>Review generated assets for naming agreement and style consistency before setting <code>approved</code> to true in <code>manifest.json</code>.</p>
      {''.join(sections)}
    </main>
  </body>
</html>
"""

    output_path.write_text(html, encoding="utf-8")
    print(f"Wrote review sheet to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())