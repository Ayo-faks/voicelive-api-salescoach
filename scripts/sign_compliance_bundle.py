#!/usr/bin/env python3
"""Build and sign the Pathfinder Learn compliance evidence bundle.

The script walks ``--evidence-dir`` (default ``evidence/compliance``),
computes per-file SHA-256 digests, writes a canonical manifest JSON, signs
that manifest with HMAC-SHA256 using ``COMPLIANCE_SIGNING_KEY`` from the
environment, and emits both ``bundle.zip`` and a detached
``bundle.zip.manifest.json``. The output is deterministic: identical inputs
plus key always produce byte-identical bundles (fixed mtime, sorted entries,
sorted JSON keys, no compression).
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import zipfile
from pathlib import Path
from typing import Iterable, List, Tuple


SIGNING_ENV = "COMPLIANCE_SIGNING_KEY"
# Deterministic ZIP mtime: 2020-01-01 00:00:00 UTC.
FIXED_ZIP_DATE = (2020, 1, 1, 0, 0, 0)
EXCLUDE_NAMES = {".DS_Store"}


def _iter_evidence_files(evidence_dir: Path, bundle_path: Path) -> List[Path]:
    files: List[Path] = []
    for path in sorted(evidence_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.name in EXCLUDE_NAMES:
            continue
        if path.resolve() == bundle_path.resolve():
            continue
        if path.name == f"{bundle_path.name}.manifest.json":
            continue
        files.append(path)
    return files


def _file_digest(path: Path) -> Tuple[str, int]:
    raw = path.read_bytes()
    return hashlib.sha256(raw).hexdigest(), len(raw)


def _build_manifest(evidence_dir: Path, files: Iterable[Path], bundle_name: str) -> dict:
    entries = []
    for path in files:
        digest, size = _file_digest(path)
        entries.append(
            {
                "path": path.relative_to(evidence_dir).as_posix(),
                "sha256": digest,
                "size": size,
            }
        )
    entries.sort(key=lambda entry: entry["path"])
    return {
        "manifest_version": 1,
        "bundle": bundle_name,
        "algorithm": "HMAC-SHA256",
        "file_count": len(entries),
        "files": entries,
    }


def _canonical_json(manifest: dict) -> bytes:
    return json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _hmac_signature(manifest: dict, key: bytes) -> str:
    return hmac.new(key, _canonical_json(manifest), hashlib.sha256).hexdigest()


def _resolve_key(provided: str | None) -> bytes:
    key = provided if provided is not None else os.environ.get(SIGNING_ENV)
    if not key:
        raise SystemExit(
            f"missing signing key: set {SIGNING_ENV} env var or pass --key (32+ bytes recommended)"
        )
    return key.encode("utf-8")


def build_bundle(
    *,
    evidence_dir: Path,
    bundle_path: Path,
    key: bytes,
) -> dict:
    files = _iter_evidence_files(evidence_dir, bundle_path)
    if not files:
        raise SystemExit(f"no evidence files found under {evidence_dir}")

    manifest = _build_manifest(evidence_dir, files, bundle_path.name)
    manifest["signature"] = _hmac_signature(
        {k: v for k, v in manifest.items() if k != "signature"}, key
    )

    bundle_path.parent.mkdir(parents=True, exist_ok=True)
    detached_path = bundle_path.with_name(f"{bundle_path.name}.manifest.json")

    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_STORED) as archive:
        for path in files:
            arcname = path.relative_to(evidence_dir).as_posix()
            info = zipfile.ZipInfo(filename=arcname, date_time=FIXED_ZIP_DATE)
            info.external_attr = (0o644 & 0xFFFF) << 16
            archive.writestr(info, path.read_bytes())
        manifest_bytes = _canonical_json(manifest)
        info = zipfile.ZipInfo(filename="manifest.json", date_time=FIXED_ZIP_DATE)
        info.external_attr = (0o644 & 0xFFFF) << 16
        archive.writestr(info, manifest_bytes)

    detached_path.write_bytes(_canonical_json(manifest) + b"\n")
    return manifest


def verify_bundle(*, evidence_dir: Path, bundle_path: Path, key: bytes) -> dict:
    detached_path = bundle_path.with_name(f"{bundle_path.name}.manifest.json")
    if not detached_path.exists():
        raise SystemExit(f"detached manifest not found: {detached_path}")
    manifest = json.loads(detached_path.read_text(encoding="utf-8"))
    signature = manifest.get("signature")
    if not signature:
        raise SystemExit("manifest missing signature")
    body = {k: v for k, v in manifest.items() if k != "signature"}
    expected = _hmac_signature(body, key)
    if not hmac.compare_digest(signature, expected):
        raise SystemExit("manifest signature mismatch")

    expected_files = {entry["path"]: entry["sha256"] for entry in manifest["files"]}
    actual_files = _iter_evidence_files(evidence_dir, bundle_path)
    actual_map: dict = {}
    for path in actual_files:
        digest, _ = _file_digest(path)
        actual_map[path.relative_to(evidence_dir).as_posix()] = digest
    if expected_files != actual_map:
        diff_missing = sorted(set(expected_files) - set(actual_map))
        diff_extra = sorted(set(actual_map) - set(expected_files))
        diff_changed = sorted(p for p in expected_files if p in actual_map and expected_files[p] != actual_map[p])
        raise SystemExit(
            f"evidence drift: missing={diff_missing} extra={diff_extra} changed={diff_changed}"
        )
    return manifest


def _parse_args(argv: List[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", default="evidence/compliance", type=Path)
    parser.add_argument("--out", default="evidence/compliance/bundle.zip", type=Path)
    parser.add_argument("--key", default=None, help=f"HMAC signing key (else {SIGNING_ENV})")
    parser.add_argument("--verify", action="store_true", help="verify an existing bundle and exit")
    return parser.parse_args(argv)


def main(argv: List[str] | None = None) -> int:
    args = _parse_args(argv)
    key = _resolve_key(args.key)
    evidence_dir = args.evidence_dir.resolve()
    bundle_path = args.out.resolve()
    if args.verify:
        manifest = verify_bundle(evidence_dir=evidence_dir, bundle_path=bundle_path, key=key)
        print(f"verified {bundle_path} ({manifest['file_count']} files)")
        return 0
    manifest = build_bundle(evidence_dir=evidence_dir, bundle_path=bundle_path, key=key)
    print(f"signed {bundle_path} ({manifest['file_count']} files, signature={manifest['signature'][:16]}\u2026)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
