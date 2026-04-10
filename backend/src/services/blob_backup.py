"""Azure Blob Storage backup / restore for the local SQLite database."""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

from azure.identity import DefaultAzureCredential

logger = logging.getLogger(__name__)

_upload_lock = threading.Lock()


def _is_configured(account_name: str, account_key: str) -> bool:
    return bool(account_name) and (bool(account_key) or bool(os.environ.get("AZURE_CLIENT_ID")))


def _blob_client(account_name: str, account_key: str, container: str, blob_name: str):
    """Create a BlobClient using account key auth or managed identity."""
    from azure.storage.blob import BlobClient

    account_url = f"https://{account_name}.blob.core.windows.net"
    credential = account_key or DefaultAzureCredential()
    return BlobClient(
        account_url=account_url,
        container_name=container,
        blob_name=blob_name,
        credential=credential,
    )


def restore_from_blob(
    target_path: str,
    account_name: str,
    account_key: str,
    container: str = "wulo-backup",
    blob_name: str = "wulo.db",
) -> bool:
    """Download the database blob to *target_path*.

    Returns True if the blob was downloaded, False if the blob does not
    exist or backup is not configured.
    """
    if not _is_configured(account_name, account_key):
        logger.info("Blob backup not configured — skipping restore")
        return False

    target = Path(target_path)
    target.parent.mkdir(parents=True, exist_ok=True)

    try:
        client = _blob_client(account_name, account_key, container, blob_name)
        downloader = client.download_blob()
        tmp = target.parent / f".{target.name}.blob-restore"
        with open(tmp, "wb") as fh:
            downloader.readinto(fh)
        os.replace(tmp, target)
        logger.info("Restored database from blob %s/%s (%d bytes)", container, blob_name, target.stat().st_size)
        return True
    except Exception as exc:
        # ResourceNotFoundError or network errors — fall through to seed
        logger.warning("Blob restore failed (will fall back to seed): %s", exc)
        return False


def backup_to_blob(
    source_path: str,
    account_name: str,
    account_key: str,
    container: str = "wulo-backup",
    blob_name: str = "wulo.db",
) -> bool:
    """Upload the local database to blob storage.

    Uses a threading lock so concurrent writes don't overlap uploads.
    Returns True on success, False on skip or failure.
    """
    if not _is_configured(account_name, account_key):
        return False

    source = Path(source_path)
    if not source.exists():
        return False

    acquired = _upload_lock.acquire(blocking=False)
    if not acquired:
        logger.debug("Blob backup skipped — upload already in progress")
        return False

    try:
        client = _blob_client(account_name, account_key, container, blob_name)
        with open(source, "rb") as fh:
            client.upload_blob(fh, overwrite=True)
        logger.info("Backed up database to blob %s/%s (%d bytes)", container, blob_name, source.stat().st_size)
        return True
    except Exception as exc:
        logger.warning("Blob backup failed: %s", exc)
        return False
    finally:
        _upload_lock.release()
