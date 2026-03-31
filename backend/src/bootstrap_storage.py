"""Bootstrap the mounted SQLite database before the app opens it."""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

from src.config import config
from src.services.blob_backup import restore_from_blob

logger = logging.getLogger(__name__)

SQLITE_SIDECAR_SUFFIXES = ("-journal", "-wal", "-shm")


def bootstrap_storage(target_path: str, seed_path: str) -> bool:
    """Seed the target database when the file is missing or empty.

    Priority order:
    1. If a valid DB already exists at *target_path*, do nothing.
    2. Try restoring from Azure Blob Storage backup.
    3. Fall back to copying the baked-in seed database.
    """
    target = Path(target_path)
    seed = Path(seed_path)

    if target.exists() and target.stat().st_size > 0:
        return False

    # ---------- try blob restore first ----------
    restored = restore_from_blob(
        target_path,
        account_name=str(config["blob_backup_account_name"]),
        account_key=str(config["blob_backup_account_key"]),
        container=str(config["blob_backup_container"]),
        blob_name=str(config["blob_backup_name"]),
    )
    if restored:
        logger.info("Storage bootstrap: restored from blob backup")
        return True

    # ---------- fall back to seed copy ----------
    if not seed.exists():
        logger.warning("Storage bootstrap skipped: missing seed database at %s", seed)
        return False

    target.parent.mkdir(parents=True, exist_ok=True)
    for suffix in SQLITE_SIDECAR_SUFFIXES:
        sidecar_path = Path(f"{target_path}{suffix}")
        if sidecar_path.exists():
            sidecar_path.unlink()

    temp_target = target.parent / f".{target.name}.bootstrap"
    if temp_target.exists():
        temp_target.unlink()

    try:
        shutil.copyfile(seed, temp_target)
        os.replace(temp_target, target)
    finally:
        if temp_target.exists():
            temp_target.unlink()

    logger.info("Storage bootstrap copied %s to %s", seed, target)
    return True


def main() -> None:
    """Seed the configured SQLite database when running as a standalone bootstrap step."""
    logging.basicConfig(level=logging.INFO)
    bootstrap_storage(
        str(config["storage_path"]),
        str(config["bootstrap_storage_seed_path"]),
    )


if __name__ == "__main__":
    main()