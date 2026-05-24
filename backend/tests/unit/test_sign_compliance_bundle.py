"""Tests for ``scripts/sign_compliance_bundle.py`` (F4 compliance pack).

Covers the happy path (build → detached manifest → verify), determinism
(rebuilding produces a byte-identical bundle), and tamper detection (any
change to an evidence file causes ``--verify`` to fail).
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "sign_compliance_bundle.py"


@pytest.fixture(scope="module")
def sign_module():
    spec = importlib.util.spec_from_file_location("sign_compliance_bundle", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _seed_evidence(tmp_path: Path) -> Path:
    evidence = tmp_path / "compliance"
    (evidence / "nested").mkdir(parents=True)
    (evidence / "dpia.md").write_text("# DPIA\nstub\n", encoding="utf-8")
    (evidence / "nested" / "roster.csv").write_text("sourcedId,status\norg-1,active\n", encoding="utf-8")
    return evidence


def test_build_and_verify_roundtrip(tmp_path: Path, sign_module) -> None:
    evidence = _seed_evidence(tmp_path)
    bundle = tmp_path / "bundle.zip"
    key = b"unit-test-signing-key-0123456789"

    manifest = sign_module.build_bundle(evidence_dir=evidence, bundle_path=bundle, key=key)

    assert bundle.is_file()
    detached = bundle.with_name("bundle.zip.manifest.json")
    assert detached.is_file()
    assert manifest["file_count"] == 2
    assert manifest["algorithm"] == "HMAC-SHA256"
    assert len(manifest["signature"]) == 64
    detached_payload = json.loads(detached.read_text(encoding="utf-8"))
    assert detached_payload["signature"] == manifest["signature"]

    sign_module.verify_bundle(evidence_dir=evidence, bundle_path=bundle, key=key)


def test_build_is_deterministic(tmp_path: Path, sign_module) -> None:
    evidence = _seed_evidence(tmp_path)
    bundle = tmp_path / "bundle.zip"
    key = b"unit-test-signing-key-0123456789"

    sign_module.build_bundle(evidence_dir=evidence, bundle_path=bundle, key=key)
    first = bundle.read_bytes()
    first_manifest = bundle.with_name("bundle.zip.manifest.json").read_bytes()

    sign_module.build_bundle(evidence_dir=evidence, bundle_path=bundle, key=key)
    second = bundle.read_bytes()
    second_manifest = bundle.with_name("bundle.zip.manifest.json").read_bytes()

    assert first == second
    assert first_manifest == second_manifest


def test_verify_detects_tampering(tmp_path: Path, sign_module) -> None:
    evidence = _seed_evidence(tmp_path)
    bundle = tmp_path / "bundle.zip"
    key = b"unit-test-signing-key-0123456789"

    sign_module.build_bundle(evidence_dir=evidence, bundle_path=bundle, key=key)
    (evidence / "dpia.md").write_text("# DPIA\nTAMPERED\n", encoding="utf-8")

    with pytest.raises(SystemExit, match="evidence drift"):
        sign_module.verify_bundle(evidence_dir=evidence, bundle_path=bundle, key=key)


def test_verify_detects_wrong_key(tmp_path: Path, sign_module) -> None:
    evidence = _seed_evidence(tmp_path)
    bundle = tmp_path / "bundle.zip"
    key = b"unit-test-signing-key-0123456789"

    sign_module.build_bundle(evidence_dir=evidence, bundle_path=bundle, key=key)

    with pytest.raises(SystemExit, match="signature mismatch"):
        sign_module.verify_bundle(
            evidence_dir=evidence, bundle_path=bundle, key=b"different-key"
        )


def test_main_requires_signing_key(monkeypatch, tmp_path: Path, sign_module) -> None:
    evidence = _seed_evidence(tmp_path)
    bundle = tmp_path / "bundle.zip"
    monkeypatch.delenv(sign_module.SIGNING_ENV, raising=False)

    with pytest.raises(SystemExit, match="missing signing key"):
        sign_module.main(
            [
                "--evidence-dir",
                str(evidence),
                "--out",
                str(bundle),
            ]
        )
