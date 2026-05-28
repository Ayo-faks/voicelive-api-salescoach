"""W5 — offline pack format, signing, and verification contract tests.

Frozen-surface guarantee: this module touches no learner-facing route. It
validates the build/verify primitives plus the ``micro``/``standard``
content-curation helper end-to-end.
"""

from __future__ import annotations

import io
import json
import os
import zipfile
from pathlib import Path
from typing import Dict

import pytest

from src.learning.offline_pack import (
    OFFLINE_PACK_FLAG,
    OfflinePackUnavailableError,
    OfflinePackVerificationError,
    PACK_FORMAT_VERSION,
    PACK_TYPES,
    PayloadFile,
    build_pack,
    canonical_json,
    collect_payload_files,
    generate_keypair,
    public_key_bytes,
    verify_pack,
)


BACKEND_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DATA = BACKEND_ROOT / "data"
LEARNING_DATA = BACKEND_ROOT.parent / "data" / "learning"

# Most tests want the kill switch disabled at the API level (require_flag=False).
# A couple of tests explicitly exercise the gate by toggling the env var.


def _payload(name: str, body: bytes) -> PayloadFile:
    return PayloadFile(path=name, content=body)


def _trivial_payload() -> list[PayloadFile]:
    return [
        _payload("question_banks/maths_jss3_ss3_v1.json", b'{"items":[]}'),
        _payload("wiki/jss3_maths_wiki_seed.json", b'{"nodes":[]}'),
    ]


_SENTINEL = object()


def _build(payload=_SENTINEL, **overrides):
    priv, pub = generate_keypair()
    args = dict(
        tenant_id="pilot-tenant",
        pack_key="pathfinder.learn",
        pack_type="micro",
        version="1.0.0",
        source_uri="pathfinder://test",
        payload_files=_trivial_payload() if payload is _SENTINEL else payload,
        signing_key=priv,
        public_key_id="kid-test",
        require_flag=False,
    )
    args.update(overrides)
    pack_bytes = build_pack(**args)
    trusted: Dict[str, bytes] = {"kid-test": public_key_bytes(pub)}
    return pack_bytes, trusted


# ---------------------------------------------------------------------------
# Format constants and basic round-trip
# ---------------------------------------------------------------------------


def test_pack_format_constants_are_stable() -> None:
    assert PACK_FORMAT_VERSION == "1.0.0"
    assert PACK_TYPES == frozenset({"micro", "standard"})


def test_build_then_verify_round_trip() -> None:
    pack, trusted = _build()
    result = verify_pack(pack, trusted_public_keys=trusted, require_flag=False)
    assert result.pack_type == "micro"
    assert result.pack_format_version == PACK_FORMAT_VERSION
    assert result.public_key_id == "kid-test"
    assert set(result.payload.keys()) == {
        "payload/question_banks/maths_jss3_ss3_v1.json",
        "payload/wiki/jss3_maths_wiki_seed.json",
    }
    assert result.content_pack_manifest.pack_key == "pathfinder.learn"
    assert result.content_pack_manifest.sha256 == result.payload_digest


def test_canonical_json_is_deterministic() -> None:
    a = canonical_json({"b": 2, "a": 1})
    b = canonical_json({"a": 1, "b": 2})
    assert a == b
    assert a == b'{"a":1,"b":2}'


# ---------------------------------------------------------------------------
# Verification fail-closed scenarios
# ---------------------------------------------------------------------------


def test_unknown_public_key_id_fails_closed() -> None:
    pack, _ = _build()
    with pytest.raises(OfflinePackVerificationError, match="unknown public_key_id"):
        verify_pack(pack, trusted_public_keys={"other-kid": b"\0" * 32}, require_flag=False)


def test_tampered_payload_byte_fails_digest_check() -> None:
    pack, trusted = _build()
    # Rewrite one payload entry to flip a byte.
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(pack), "r") as src, zipfile.ZipFile(buf, "w") as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "payload/question_banks/maths_jss3_ss3_v1.json":
                data = data + b" "  # mutate
            dst.writestr(info, data)
    with pytest.raises(OfflinePackVerificationError, match="content hash mismatch"):
        verify_pack(buf.getvalue(), trusted_public_keys=trusted, require_flag=False)


def test_tampered_manifest_version_breaks_signature() -> None:
    pack, trusted = _build()
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(pack), "r") as src, zipfile.ZipFile(buf, "w") as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "manifest.json":
                m = json.loads(data)
                m["version"] = "9.9.9"  # mutate signed field
                data = canonical_json(m)
            dst.writestr(info, data)
    with pytest.raises(OfflinePackVerificationError, match="signature does not verify"):
        verify_pack(buf.getvalue(), trusted_public_keys=trusted, require_flag=False)


def test_payload_index_mutation_breaks_digest() -> None:
    pack, trusted = _build()
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(pack), "r") as src, zipfile.ZipFile(buf, "w") as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "manifest.json":
                m = json.loads(data)
                # Flip one hash in the index but keep the same signature.
                first = next(iter(m["payload_index"]))
                m["payload_index"][first] = "0" * 64
                data = canonical_json(m)
            dst.writestr(info, data)
    # Manifest mutation breaks signature first (we recompute signing bytes),
    # so we expect a signature error.
    with pytest.raises(OfflinePackVerificationError, match="signature does not verify"):
        verify_pack(buf.getvalue(), trusted_public_keys=trusted, require_flag=False)


def test_zip_payload_set_must_match_index() -> None:
    pack, trusted = _build()
    # Add an extra file not in the index.
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(pack), "r") as src, zipfile.ZipFile(buf, "w") as dst:
        for info in src.infolist():
            dst.writestr(info, src.read(info.filename))
        dst.writestr("payload/unexpected.json", b"{}")
    with pytest.raises(OfflinePackVerificationError, match="do not match payload_index"):
        verify_pack(buf.getvalue(), trusted_public_keys=trusted, require_flag=False)


def test_missing_manifest_fails() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("payload/x.json", b"{}")
    with pytest.raises(OfflinePackVerificationError, match="manifest.json missing"):
        verify_pack(buf.getvalue(), trusted_public_keys={}, require_flag=False)


def test_non_zip_input_fails() -> None:
    with pytest.raises(OfflinePackVerificationError, match="not a valid zip"):
        verify_pack(b"not a zip", trusted_public_keys={}, require_flag=False)


# ---------------------------------------------------------------------------
# Builder input validation
# ---------------------------------------------------------------------------


def test_empty_payload_rejected() -> None:
    with pytest.raises(ValueError, match="payload_files must not be empty"):
        _build(payload=[])


def test_duplicate_payload_paths_rejected() -> None:
    with pytest.raises(ValueError, match="duplicate"):
        _build(payload=[_payload("a.json", b"1"), _payload("a.json", b"2")])


def test_path_traversal_rejected() -> None:
    with pytest.raises(ValueError, match="\\.\\."):
        _build(payload=[_payload("../escape.json", b"1")])


def test_unknown_pack_type_rejected() -> None:
    with pytest.raises(ValueError, match="unknown pack_type"):
        _build(pack_type="huge")


# ---------------------------------------------------------------------------
# Kill switch
# ---------------------------------------------------------------------------


def test_builder_gated_by_kill_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(OFFLINE_PACK_FLAG, raising=False)
    priv, _ = generate_keypair()
    with pytest.raises(OfflinePackUnavailableError):
        build_pack(
            tenant_id="t",
            pack_key="k",
            pack_type="micro",
            version="1.0.0",
            source_uri="x",
            payload_files=_trivial_payload(),
            signing_key=priv,
            public_key_id="kid",
            require_flag=True,
        )


def test_builder_enabled_when_flag_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(OFFLINE_PACK_FLAG, "1")
    priv, pub = generate_keypair()
    pack = build_pack(
        tenant_id="t",
        pack_key="k",
        pack_type="micro",
        version="1.0.0",
        source_uri="x",
        payload_files=_trivial_payload(),
        signing_key=priv,
        public_key_id="kid",
        require_flag=True,
    )
    # Round-trip must still verify under the flag.
    verify_pack(
        pack,
        trusted_public_keys={"kid": public_key_bytes(pub)},
        require_flag=True,
    )


def test_verifier_gated_by_kill_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(OFFLINE_PACK_FLAG, raising=False)
    pack, trusted = _build()  # built with require_flag=False
    with pytest.raises(OfflinePackUnavailableError):
        verify_pack(pack, trusted_public_keys=trusted, require_flag=True)


# ---------------------------------------------------------------------------
# Content curation: micro vs standard against real W1/W4 seeds
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not (BACKEND_DATA / "question_banks" / "maths_jss3_ss3_v1.json").exists(),
    reason="W1 maths seed not present in this checkout",
)
def test_micro_pack_contains_only_maths_bundle() -> None:
    files = collect_payload_files(
        "micro",
        bank_root=BACKEND_DATA,
        learning_data_root=LEARNING_DATA,
    )
    paths = {f.path for f in files}
    assert "question_banks/maths_jss3_ss3_v1.json" in paths
    assert "wiki/jss3_maths_wiki_seed.json" in paths
    assert "explanations/explanation_seeds_v1.json" in paths
    # Micro must NOT carry the English bundle.
    assert "question_banks/english_jss3_ss3_v1.json" not in paths
    assert "wiki/english_jss3_ss3_wiki_seed.json" not in paths


@pytest.mark.skipif(
    not (BACKEND_DATA / "question_banks" / "english_jss3_ss3_v1.json").exists(),
    reason="W4 english seed not present in this checkout",
)
def test_standard_pack_contains_both_subjects() -> None:
    files = collect_payload_files(
        "standard",
        bank_root=BACKEND_DATA,
        learning_data_root=LEARNING_DATA,
    )
    paths = {f.path for f in files}
    assert {
        "question_banks/maths_jss3_ss3_v1.json",
        "question_banks/english_jss3_ss3_v1.json",
        "wiki/jss3_maths_wiki_seed.json",
        "wiki/english_jss3_ss3_wiki_seed.json",
        "explanations/explanation_seeds_v1.json",
    } <= paths


@pytest.mark.skipif(
    not (BACKEND_DATA / "question_banks" / "english_jss3_ss3_v1.json").exists(),
    reason="seed data not present",
)
def test_standard_pack_round_trip_against_real_seeds() -> None:
    payload = collect_payload_files(
        "standard",
        bank_root=BACKEND_DATA,
        learning_data_root=LEARNING_DATA,
    )
    pack, trusted = _build(payload=payload, pack_type="standard")
    result = verify_pack(pack, trusted_public_keys=trusted, require_flag=False)
    assert result.pack_type == "standard"
    assert result.content_pack_manifest.payload["item_count"] == len(payload)
    # Spot-check: real maths bank decoded from the pack matches source bytes.
    src = (BACKEND_DATA / "question_banks" / "maths_jss3_ss3_v1.json").read_bytes()
    assert result.payload["payload/question_banks/maths_jss3_ss3_v1.json"] == src
