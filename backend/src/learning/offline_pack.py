"""W5 — signed offline content packs.

Distributes the learning content bundle (banks, wiki, explanations) to
low-bandwidth pilot devices. Two profiles:

* ``micro``    — Maths-only seed: smallest footprint for SBC / 2G regions.
* ``standard`` — Maths + English, both wiki seeds, all explanations.

Each pack is a ZIP containing:

* ``manifest.json`` — pack metadata with a detached Ed25519 ``signature``
  block. The signature covers the canonical JSON of the manifest **without**
  the ``signature`` field; the ``payload_digest`` is the SHA-256 of the
  canonical JSON of ``payload_index`` (``{path: sha256_hex}``).
* ``payload/<files…>`` — the content files themselves.

The verifier (``verify_pack``) is **fail-closed**: any signature failure,
unknown key id, digest mismatch, or schema violation raises
``OfflinePackVerificationError``. There is no "best effort" mode.

Both build and verify default to gating on ``LEARNING_OFFLINE_PACK_V1``;
tests and the builder script set ``require_flag=False`` to bypass the
runtime guard.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Final, Iterable, List, Mapping, Optional, Sequence, Tuple

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from src.learning.models import ContentPackManifest


PACK_FORMAT_VERSION: Final[str] = "1.0.0"
SIGNATURE_ALGORITHM: Final[str] = "ed25519"
OFFLINE_PACK_FLAG: Final[str] = "LEARNING_OFFLINE_PACK_V1"
PACK_TYPES: Final[frozenset[str]] = frozenset({"micro", "standard"})

_MANIFEST_FILENAME: Final[str] = "manifest.json"
_PAYLOAD_PREFIX: Final[str] = "payload/"
_TRUTHY: Final[frozenset[str]] = frozenset({"1", "true", "yes", "on", "enabled"})


def _flag_enabled() -> bool:
    return os.environ.get(OFFLINE_PACK_FLAG, "").strip().lower() in _TRUTHY


class OfflinePackUnavailableError(RuntimeError):
    """Raised when the kill switch is off and ``require_flag=True``."""


class OfflinePackVerificationError(RuntimeError):
    """Raised on ANY verification failure. Fail-closed by design."""


@dataclass(frozen=True)
class PayloadFile:
    """A single file inside a pack's ``payload/`` directory.

    ``path`` is a POSIX relative path (no leading slash, no ``..``); the
    ``payload/`` prefix is added at pack time.
    """

    path: str
    content: bytes


@dataclass(frozen=True)
class VerifiedPack:
    manifest: Mapping[str, Any]
    content_pack_manifest: ContentPackManifest
    payload: Mapping[str, bytes]
    pack_type: str
    pack_format_version: str
    payload_digest: str
    public_key_id: str
    payload_index: Mapping[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def generate_keypair() -> Tuple[Ed25519PrivateKey, Ed25519PublicKey]:
    """Convenience for tests and offline tooling. Not used at runtime."""
    priv = Ed25519PrivateKey.generate()
    return priv, priv.public_key()


def public_key_bytes(public_key: Ed25519PublicKey) -> bytes:
    from cryptography.hazmat.primitives import serialization

    return public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )


def load_public_key(raw: bytes) -> Ed25519PublicKey:
    return Ed25519PublicKey.from_public_bytes(raw)


def canonical_json(obj: Any) -> bytes:
    """Deterministic JSON encoding: sorted keys, tight separators, UTF-8."""
    return json.dumps(
        obj,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _validate_payload_paths(files: Sequence[PayloadFile]) -> None:
    seen: set[str] = set()
    for f in files:
        if not f.path or f.path.startswith("/"):
            raise ValueError(f"payload path must be relative and non-empty: {f.path!r}")
        if ".." in f.path.split("/"):
            raise ValueError(f"payload path may not contain '..': {f.path!r}")
        if f.path in seen:
            raise ValueError(f"duplicate payload path: {f.path!r}")
        seen.add(f.path)


def _build_payload_index(files: Sequence[PayloadFile]) -> Dict[str, str]:
    index: Dict[str, str] = {}
    for f in files:
        index[f"{_PAYLOAD_PREFIX}{f.path}"] = _sha256_hex(f.content)
    return index


def _compute_payload_digest(index: Mapping[str, str]) -> str:
    return _sha256_hex(canonical_json(index))


def _manifest_signing_bytes(manifest: Mapping[str, Any]) -> bytes:
    body = {k: v for k, v in manifest.items() if k != "signature"}
    return canonical_json(body)


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def build_pack(
    *,
    tenant_id: str,
    pack_key: str,
    pack_type: str,
    version: str,
    source_uri: str,
    payload_files: Sequence[PayloadFile],
    signing_key: Ed25519PrivateKey,
    public_key_id: str,
    lang: str = "en",
    provenance: Optional[List[Dict[str, Any]]] = None,
    generated_at: Optional[datetime] = None,
    item_count: Optional[int] = None,
    require_flag: bool = True,
) -> bytes:
    """Build a signed offline pack and return the ZIP bytes.

    The caller is responsible for assembling the ``payload_files`` for the
    requested ``pack_type``; this function does not curate content. It only
    enforces the format, signature, and Pydantic contract.
    """
    if require_flag and not _flag_enabled():
        raise OfflinePackUnavailableError(
            f"{OFFLINE_PACK_FLAG} is off; offline pack builder is gated."
        )
    if pack_type not in PACK_TYPES:
        raise ValueError(f"unknown pack_type: {pack_type!r}; expected one of {sorted(PACK_TYPES)}")
    if not payload_files:
        raise ValueError("payload_files must not be empty")
    _validate_payload_paths(payload_files)

    payload_index = _build_payload_index(payload_files)
    payload_digest = _compute_payload_digest(payload_index)
    when = (generated_at or datetime.now(timezone.utc)).astimezone(timezone.utc)

    manifest: Dict[str, Any] = {
        "pack_format_version": PACK_FORMAT_VERSION,
        "manifest_id": f"content-pack-{pack_key}-{version}",
        "tenant_id": tenant_id,
        "pack_key": pack_key,
        "pack_type": pack_type,
        "version": version,
        "source_uri": source_uri,
        "lang": lang,
        "provenance": provenance
        or [
            {
                "source": "pathfinder.offline_pack",
                "rule_id": "w5_offline_pack_v1",
                "confidence": 1.0,
                "evidence_count": 1,
            }
        ],
        "generated_at": when.isoformat().replace("+00:00", "Z"),
        "payload_digest": payload_digest,
        "payload_index": payload_index,
        "item_count": int(item_count) if item_count is not None else len(payload_files),
    }

    # Cross-validate the Pydantic contract before we sign anything.
    ContentPackManifest.model_validate(
        {
            "lang": manifest["lang"],
            "provenance": manifest["provenance"],
            "manifest_id": manifest["manifest_id"],
            "tenant_id": tenant_id,
            "pack_key": pack_key,
            "version": version,
            "source_uri": source_uri,
            "sha256": payload_digest,
            "payload": {
                "pack_type": pack_type,
                "pack_format_version": PACK_FORMAT_VERSION,
                "generated_at": manifest["generated_at"],
                "item_count": manifest["item_count"],
                "payload_index": payload_index,
            },
        }
    )

    signature = signing_key.sign(_manifest_signing_bytes(manifest))
    manifest["signature"] = {
        "algorithm": SIGNATURE_ALGORITHM,
        "public_key_id": public_key_id,
        "signature": base64.b64encode(signature).decode("ascii"),
    }

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(_MANIFEST_FILENAME, canonical_json(manifest))
        for f in payload_files:
            zf.writestr(f"{_PAYLOAD_PREFIX}{f.path}", f.content)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------


def verify_pack(
    pack_bytes: bytes,
    *,
    trusted_public_keys: Mapping[str, bytes],
    require_flag: bool = True,
) -> VerifiedPack:
    """Verify a pack end-to-end and return the parsed contents.

    Raises ``OfflinePackVerificationError`` on any failure — never returns a
    partial result. ``trusted_public_keys`` maps ``public_key_id`` to the
    raw 32-byte Ed25519 public key.
    """
    if require_flag and not _flag_enabled():
        raise OfflinePackUnavailableError(
            f"{OFFLINE_PACK_FLAG} is off; offline pack verifier is gated."
        )

    try:
        zf = zipfile.ZipFile(io.BytesIO(pack_bytes), "r")
    except zipfile.BadZipFile as exc:
        raise OfflinePackVerificationError(f"not a valid zip archive: {exc}") from exc

    with zf:
        names = set(zf.namelist())
        if _MANIFEST_FILENAME not in names:
            raise OfflinePackVerificationError("manifest.json missing from pack")

        try:
            manifest = json.loads(zf.read(_MANIFEST_FILENAME).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise OfflinePackVerificationError(f"manifest.json is not valid JSON: {exc}") from exc

        if not isinstance(manifest, dict):
            raise OfflinePackVerificationError("manifest.json must be a JSON object")

        signature_block = manifest.get("signature")
        if not isinstance(signature_block, dict):
            raise OfflinePackVerificationError("manifest has no signature block")
        algorithm = signature_block.get("algorithm")
        if algorithm != SIGNATURE_ALGORITHM:
            raise OfflinePackVerificationError(f"unsupported signature algorithm: {algorithm!r}")
        public_key_id = signature_block.get("public_key_id")
        if not isinstance(public_key_id, str) or not public_key_id:
            raise OfflinePackVerificationError("signature missing public_key_id")
        raw_key = trusted_public_keys.get(public_key_id)
        if raw_key is None:
            raise OfflinePackVerificationError(f"unknown public_key_id: {public_key_id}")
        try:
            sig_bytes = base64.b64decode(signature_block.get("signature", ""), validate=True)
        except (ValueError, TypeError) as exc:
            raise OfflinePackVerificationError(f"signature is not valid base64: {exc}") from exc

        try:
            public_key = load_public_key(raw_key)
            public_key.verify(sig_bytes, _manifest_signing_bytes(manifest))
        except InvalidSignature as exc:
            raise OfflinePackVerificationError("manifest signature does not verify") from exc
        except Exception as exc:  # noqa: BLE001
            raise OfflinePackVerificationError(f"signature verification error: {exc}") from exc

        pack_format = manifest.get("pack_format_version")
        if pack_format != PACK_FORMAT_VERSION:
            raise OfflinePackVerificationError(
                f"unsupported pack_format_version: {pack_format!r}"
            )
        pack_type = manifest.get("pack_type")
        if pack_type not in PACK_TYPES:
            raise OfflinePackVerificationError(f"unknown pack_type: {pack_type!r}")

        payload_index = manifest.get("payload_index")
        if not isinstance(payload_index, dict) or not payload_index:
            raise OfflinePackVerificationError("payload_index missing or empty")
        payload_digest_claim = manifest.get("payload_digest")
        recomputed_digest = _compute_payload_digest(payload_index)
        if payload_digest_claim != recomputed_digest:
            raise OfflinePackVerificationError("payload_digest does not match payload_index")

        # Strict file-set match between zip and payload_index.
        zip_payload_names = {n for n in names if n.startswith(_PAYLOAD_PREFIX)}
        if zip_payload_names != set(payload_index.keys()):
            raise OfflinePackVerificationError(
                "zip payload files do not match payload_index"
            )

        payload: Dict[str, bytes] = {}
        for path, expected_hash in payload_index.items():
            data = zf.read(path)
            if _sha256_hex(data) != expected_hash:
                raise OfflinePackVerificationError(
                    f"payload file content hash mismatch: {path}"
                )
            payload[path] = data

        # Re-validate the Pydantic contract.
        try:
            cpm = ContentPackManifest.model_validate(
                {
                    "lang": manifest.get("lang"),
                    "provenance": manifest.get("provenance"),
                    "manifest_id": manifest.get("manifest_id"),
                    "tenant_id": manifest.get("tenant_id"),
                    "pack_key": manifest.get("pack_key"),
                    "version": manifest.get("version"),
                    "source_uri": manifest.get("source_uri"),
                    "sha256": payload_digest_claim,
                    "payload": {
                        "pack_type": pack_type,
                        "pack_format_version": pack_format,
                        "generated_at": manifest.get("generated_at"),
                        "item_count": manifest.get("item_count"),
                        "payload_index": payload_index,
                    },
                }
            )
        except Exception as exc:  # pydantic ValidationError
            raise OfflinePackVerificationError(
                f"manifest fails ContentPackManifest contract: {exc}"
            ) from exc

    return VerifiedPack(
        manifest=manifest,
        content_pack_manifest=cpm,
        payload=payload,
        pack_type=pack_type,
        pack_format_version=pack_format,
        payload_digest=payload_digest_claim,
        public_key_id=public_key_id,
        payload_index=dict(payload_index),
    )


# ---------------------------------------------------------------------------
# Content curation: pick payload files for a given pack type
# ---------------------------------------------------------------------------


def collect_payload_files(
    pack_type: str,
    *,
    bank_root,
    learning_data_root,
) -> List[PayloadFile]:
    """Pick the source files for the given pack type.

    ``bank_root`` resolves question-bank JSON (e.g. ``backend/data``);
    ``learning_data_root`` resolves wiki/explanation JSON (the repo
    ``data/learning`` tree). Both roots are required because the W1–W4
    artefacts live in two trees today.
    """
    from pathlib import Path

    if pack_type not in PACK_TYPES:
        raise ValueError(f"unknown pack_type: {pack_type!r}")
    bank = Path(bank_root)
    learn = Path(learning_data_root)

    candidates: List[Tuple[str, Path]] = [
        ("question_banks/maths_jss3_ss3_v1.json",
         bank / "question_banks" / "maths_jss3_ss3_v1.json"),
        ("wiki/jss3_maths_wiki_seed.json",
         learn / "wiki" / "jss3_maths_wiki_seed.json"),
        ("explanations/explanation_seeds_v1.json",
         learn / "explanations" / "explanation_seeds_v1.json"),
    ]
    if pack_type == "standard":
        candidates.extend([
            ("question_banks/english_jss3_ss3_v1.json",
             bank / "question_banks" / "english_jss3_ss3_v1.json"),
            ("wiki/english_jss3_ss3_wiki_seed.json",
             learn / "wiki" / "english_jss3_ss3_wiki_seed.json"),
        ])

    out: List[PayloadFile] = []
    for rel, fs in candidates:
        if not fs.exists():
            raise FileNotFoundError(f"required source file missing: {fs}")
        out.append(PayloadFile(path=rel, content=fs.read_bytes()))
    return out
