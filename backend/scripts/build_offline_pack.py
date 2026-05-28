"""Build a signed offline content pack (W5).

Usage::

    python -m scripts.build_offline_pack \
        --pack-type micro \
        --tenant-id pathfinder-pilot \
        --pack-key pathfinder.learn \
        --version 1.0.0 \
        --signing-key /path/to/ed25519.seed \
        --public-key-id pathfinder-prod-2026q1 \
        --out backend/data/offline_packs/pathfinder.learn-1.0.0-micro.pack

The signing key is the raw 32-byte Ed25519 seed (binary). For test/dev,
omit ``--signing-key`` and the script will generate an ephemeral keypair
and print both the public key (base64) and the resulting public_key_id.

This script is gated by ``LEARNING_OFFLINE_PACK_V1`` unless ``--force`` is
passed; the same flag gates the loader.
"""

from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

# Allow running as ``python scripts/build_offline_pack.py`` from backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.learning.offline_pack import (  # noqa: E402
    PACK_TYPES,
    build_pack,
    collect_payload_files,
    generate_keypair,
    public_key_bytes,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DATA = REPO_ROOT / "voicelive-api-salescoach" / "backend" / "data"
LEARNING_DATA = REPO_ROOT / "voicelive-api-salescoach" / "data" / "learning"


def _load_signing_key(path: Path) -> Ed25519PrivateKey:
    raw = path.read_bytes()
    if len(raw) != 32:
        raise SystemExit(
            f"signing key at {path} must be a raw 32-byte Ed25519 seed (got {len(raw)} bytes)"
        )
    return Ed25519PrivateKey.from_private_bytes(raw)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a signed offline content pack")
    parser.add_argument("--pack-type", required=True, choices=sorted(PACK_TYPES))
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--pack-key", default="pathfinder.learn")
    parser.add_argument("--version", required=True)
    parser.add_argument("--source-uri", default="pathfinder://offline-pack")
    parser.add_argument("--public-key-id", default="pathfinder-dev-ephemeral")
    parser.add_argument("--signing-key", type=Path, default=None)
    parser.add_argument("--bank-root", type=Path, default=BACKEND_DATA)
    parser.add_argument("--learning-data-root", type=Path, default=LEARNING_DATA)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--force",
        action="store_true",
        help="bypass the LEARNING_OFFLINE_PACK_V1 kill switch",
    )
    args = parser.parse_args()

    if args.signing_key is None:
        priv, pub = generate_keypair()
        print(
            "[info] no --signing-key given; generated ephemeral Ed25519 keypair.",
            file=sys.stderr,
        )
        print(
            f"[info] public_key (base64): {base64.b64encode(public_key_bytes(pub)).decode()}",
            file=sys.stderr,
        )
    else:
        priv = _load_signing_key(args.signing_key)

    payload = collect_payload_files(
        args.pack_type,
        bank_root=args.bank_root,
        learning_data_root=args.learning_data_root,
    )

    pack_bytes = build_pack(
        tenant_id=args.tenant_id,
        pack_key=args.pack_key,
        pack_type=args.pack_type,
        version=args.version,
        source_uri=args.source_uri,
        payload_files=payload,
        signing_key=priv,
        public_key_id=args.public_key_id,
        require_flag=not args.force,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(pack_bytes)
    print(
        f"[ok] wrote {len(payload)} payload files ({len(pack_bytes)} bytes) -> {args.out}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
