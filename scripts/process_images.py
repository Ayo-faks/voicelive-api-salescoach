#!/usr/bin/env python3

"""Normalize locally stored therapy images into 512x512 WebP assets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageOps

IMAGE_ROOT = Path(__file__).resolve().parents[1] / "data" / "images"
MANIFEST_PATH = IMAGE_ROOT / "manifest.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default=str(MANIFEST_PATH), help="Path to manifest.json")
    parser.add_argument("--source-root", default=str(IMAGE_ROOT), help="Root folder for local source images")
    parser.add_argument("--force", action="store_true", help="Reprocess existing destination files")
    return parser.parse_args()


def process_image(source_path: Path, destination_path: Path) -> None:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source_path) as image:
        fitted = ImageOps.fit(image.convert("RGBA"), (512, 512), Image.Resampling.LANCZOS)
        fitted.save(destination_path, format="WEBP", lossless=True, method=6)


def main() -> int:
    args = parse_args()
    source_root = Path(args.source_root).resolve()
    manifest_path = Path(args.manifest).resolve()
    with manifest_path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)

    processed = 0
    for asset in manifest.get("assets", []):
        source_rel = asset.get("sourcePath")
        if not source_rel:
            continue

        source_path = source_root / source_rel
        destination_path = IMAGE_ROOT / asset["imagePath"]
        if not source_path.exists():
            continue
        if destination_path.exists() and not args.force:
            continue

        process_image(source_path, destination_path)
        asset["status"] = asset.get("status") or "pending_review"
        processed += 1
        print(f"Processed {asset['id']} -> {destination_path.relative_to(IMAGE_ROOT)}")

    with manifest_path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=True)
        handle.write("\n")

    print(f"Processed {processed} asset(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())