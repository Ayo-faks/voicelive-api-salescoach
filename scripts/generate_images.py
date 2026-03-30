#!/usr/bin/env python3

"""Batch-generate therapy image assets with Azure OpenAI or OpenAI image generation."""

from __future__ import annotations

import argparse
import base64
import json
import os
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Iterable, Literal

import httpx
from openai import AzureOpenAI, OpenAI
from PIL import Image

DEFAULT_API_VERSION = os.getenv("AZURE_OPENAI_IMAGE_API_VERSION", "2025-04-01-preview")
DEFAULT_BACKGROUND = "#B2DFDB"
DEFAULT_SIZE = "1024x1024"
DEFAULT_OPENAI_IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1")
IMAGE_ROOT = Path(__file__).resolve().parents[1] / "data" / "images"
MANIFEST_PATH = IMAGE_ROOT / "manifest.json"


@dataclass
class ImageClientConfig:
    provider: Literal["azure", "openai"]
    api_key: str
    model: str
    endpoint: str | None = None
    api_version: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default=str(MANIFEST_PATH), help="Path to manifest.json")
    parser.add_argument("--sound", help="Only generate assets for a specific sound")
    parser.add_argument("--category", help="Only generate assets for a specific category")
    parser.add_argument(
        "--provider",
        choices=["auto", "azure", "openai"],
        default="auto",
        help="Image provider to use. Defaults to auto-detecting OpenAI first, then Azure.",
    )
    parser.add_argument("--force", action="store_true", help="Regenerate assets even if files already exist")
    parser.add_argument("--dry-run", action="store_true", help="Print prompts without calling Azure OpenAI")
    return parser.parse_args()


def load_manifest(manifest_path: Path) -> Dict[str, Any]:
    with manifest_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_manifest(manifest_path: Path, manifest: Dict[str, Any]) -> None:
    with manifest_path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=True)
        handle.write("\n")


def get_client_config(provider: str) -> ImageClientConfig:
    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
    azure_api_key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    deployment = os.getenv("AZURE_OPENAI_IMAGE_DEPLOYMENT", "").strip()

    if provider in {"auto", "openai"} and openai_api_key:
        return ImageClientConfig(
            provider="openai",
            api_key=openai_api_key,
            model=DEFAULT_OPENAI_IMAGE_MODEL,
        )

    if provider in {"auto", "azure"} and endpoint and azure_api_key and deployment:
        return ImageClientConfig(
            provider="azure",
            endpoint=endpoint,
            api_key=azure_api_key,
            model=deployment,
            api_version=DEFAULT_API_VERSION,
        )

    if provider == "openai":
        raise RuntimeError("Missing required environment variable: OPENAI_API_KEY")

    if provider == "azure":
        missing = [
            name
            for name, value in {
                "AZURE_OPENAI_ENDPOINT": endpoint,
                "AZURE_OPENAI_API_KEY": azure_api_key,
                "AZURE_OPENAI_IMAGE_DEPLOYMENT": deployment,
            }.items()
            if not value
        ]
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")

    raise RuntimeError(
        "No image provider is configured. Set OPENAI_API_KEY for regular OpenAI or "
        "set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_IMAGE_DEPLOYMENT for Azure."
    )


def build_prompt(asset: Dict[str, Any]) -> str:
    subject = asset["promptSubject"]
    background = asset.get("background") or DEFAULT_BACKGROUND
    style = asset.get("style") or "clean flat vector illustration style"
    audience = asset.get("audience") or "children aged 4-8"
    notes = asset.get("notes") or ""

    normalized_subject = subject.strip()
    if normalized_subject.lower().startswith(("a ", "an ", "single ", "one ")):
        subject_clause = normalized_subject
    else:
        subject_clause = f"a single {normalized_subject}"

    parts = [
        f"Illustration of {subject_clause}, centered on a solid soft teal background ({background}).",
        f"{style.capitalize()} for {audience}.",
        "No text, no extra objects, no shadows, no borders.",
        f"Simple, friendly, immediately recognisable as '{asset['word']}'.",
        "Square composition.",
    ]
    if notes:
        parts.append(notes)
    return " ".join(parts)


def iter_target_assets(
    manifest: Dict[str, Any],
    *,
    sound: str | None,
    category: str | None,
    force: bool,
) -> Iterable[Dict[str, Any]]:
    for asset in manifest.get("assets", []):
        if sound and asset.get("sound") != sound:
            continue
        if category and asset.get("category") != category:
            continue

        output_path = IMAGE_ROOT / asset["imagePath"]
        if output_path.exists() and not force:
            continue
        yield asset


def decode_image_bytes(payload: Any) -> bytes:
    if getattr(payload, "b64_json", None):
        return base64.b64decode(payload.b64_json)

    if getattr(payload, "url", None):
        response = httpx.get(payload.url, timeout=60)
        response.raise_for_status()
        return response.content

    raise RuntimeError("Azure OpenAI image response did not include image data")


def save_webp(image_bytes: bytes, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(BytesIO(image_bytes)) as image:
        normalized = image.convert("RGBA")
        resized = normalized.resize((512, 512), Image.Resampling.LANCZOS)
        resized.save(destination, format="WEBP", lossless=True, method=6)


def generate_assets(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest).resolve()
    manifest = load_manifest(manifest_path)
    targets = list(
        iter_target_assets(
            manifest,
            sound=args.sound,
            category=args.category,
            force=args.force,
        )
    )

    if not targets:
        print("No assets matched the current filters.")
        return 0

    for asset in targets:
        asset["generationPrompt"] = build_prompt(asset)

    if args.dry_run:
        for asset in targets:
            print(f"[dry-run] {asset['id']} -> {asset['imagePath']}")
            print(f"  prompt: {asset['generationPrompt']}")
        return 0

    client_config = get_client_config(args.provider)

    if client_config.provider == "azure":
        client = AzureOpenAI(
            api_key=client_config.api_key,
            api_version=client_config.api_version,
            azure_endpoint=client_config.endpoint,
        )
    else:
        client = OpenAI(api_key=client_config.api_key)

    print(f"Using image provider: {client_config.provider} ({client_config.model})")

    generated_count = 0
    for asset in targets:
        response = client.images.generate(
            model=client_config.model,
            prompt=asset["generationPrompt"],
            size=asset.get("size", DEFAULT_SIZE),
        )
        image_bytes = decode_image_bytes(response.data[0])
        output_path = IMAGE_ROOT / asset["imagePath"]
        save_webp(image_bytes, output_path)
        asset["status"] = "pending_review"
        asset["approved"] = False
        generated_count += 1
        print(f"Generated {asset['id']} -> {output_path.relative_to(IMAGE_ROOT)}")

    save_manifest(manifest_path, manifest)
    print(f"Generated {generated_count} asset(s).")
    return 0


def main() -> int:
    args = parse_args()
    return generate_assets(args)


if __name__ == "__main__":
    raise SystemExit(main())