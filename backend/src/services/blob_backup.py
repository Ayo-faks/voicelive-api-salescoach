"""Azure Blob Storage backup / restore for the local SQLite database.

This module is deliberately defensive: backups run as best-effort side
effects of user-triggered writes, so transient auth or network errors must
never raise into the request path. Key invariants:

* ``BlobClient`` is used as a context manager so the underlying HTTP
  transport is released even on failure. This avoids ``Unclosed client
  session`` log spam when the upload 403s.
* ``DefaultAzureCredential`` is memoized at module scope so we don't
  rebuild the token chain (and its underlying aiohttp session) on every
  call.
* A lightweight circuit breaker short-circuits further attempts after an
  auth / permission failure, so a misconfigured MI doesn't flood logs or
  add latency to every write while the operator is fixing RBAC.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Optional

from azure.identity import DefaultAzureCredential

logger = logging.getLogger(__name__)

_upload_lock = threading.Lock()

# Lazily-created shared managed-identity credential. ``DefaultAzureCredential``
# is documented as thread-safe; sharing one instance avoids rebuilding the
# token chain on every write.
_shared_credential: Optional[DefaultAzureCredential] = None
_credential_lock = threading.Lock()

# Circuit breaker: after an auth/permission failure, short-circuit further
# calls for this many seconds so we don't spam the log or add latency to
# every write while RBAC is being fixed.
_AUTH_FAILURE_COOLDOWN_SECONDS = 60.0
_auth_failure_until: float = 0.0
_auth_failure_logged_at: float = 0.0


def _shared_default_credential() -> DefaultAzureCredential:
    global _shared_credential
    if _shared_credential is None:
        with _credential_lock:
            if _shared_credential is None:
                _shared_credential = DefaultAzureCredential()
    return _shared_credential


def _is_configured(account_name: str, account_key: str) -> bool:
    return bool(account_name) and (bool(account_key) or bool(os.environ.get("AZURE_CLIENT_ID")))


def _blob_client(account_name: str, account_key: str, container: str, blob_name: str):
    """Create a BlobClient using account key auth or managed identity.

    The returned client should be used as a context manager so its HTTP
    transport is closed on exit.
    """
    from azure.storage.blob import BlobClient

    account_url = f"https://{account_name}.blob.core.windows.net"
    credential = account_key or _shared_default_credential()
    return BlobClient(
        account_url=account_url,
        container_name=container,
        blob_name=blob_name,
        credential=credential,
    )


def _is_auth_failure(exc: BaseException) -> bool:
    """Return True when the exception looks like an RBAC/auth failure.

    We match on class name and message substrings rather than importing
    concrete ``azure.core.exceptions`` types so the circuit-breaker keeps
    working if the SDK wraps the failure differently across versions.
    """
    name = type(exc).__name__
    if name in {"ClientAuthenticationError", "HttpResponseError"}:
        message = str(exc)
        if (
            "AuthorizationPermissionMismatch" in message
            or "AuthenticationFailed" in message
            or "AuthorizationFailed" in message
            or " 403" in message
            or " 401" in message
        ):
            return True
    return False


def _auth_cooldown_active() -> bool:
    return time.monotonic() < _auth_failure_until


def _record_auth_failure(exc: BaseException) -> None:
    global _auth_failure_until, _auth_failure_logged_at
    now = time.monotonic()
    _auth_failure_until = now + _AUTH_FAILURE_COOLDOWN_SECONDS
    # Rate-limit the warning to once per cooldown window so the log doesn't flood.
    if now - _auth_failure_logged_at >= _AUTH_FAILURE_COOLDOWN_SECONDS:
        _auth_failure_logged_at = now
        logger.warning(
            "Blob backup auth failure — suppressing attempts for %.0fs: %s",
            _AUTH_FAILURE_COOLDOWN_SECONDS,
            exc,
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
        with _blob_client(account_name, account_key, container, blob_name) as client:
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

    Best-effort: never raises. Uses a threading lock so concurrent writes
    don't overlap uploads, and a circuit breaker to suppress attempts for
    a short cooldown after an auth failure.
    """
    if not _is_configured(account_name, account_key):
        return False

    if _auth_cooldown_active():
        return False

    source = Path(source_path)
    if not source.exists():
        return False

    acquired = _upload_lock.acquire(blocking=False)
    if not acquired:
        logger.debug("Blob backup skipped — upload already in progress")
        return False

    try:
        with _blob_client(account_name, account_key, container, blob_name) as client:
            with open(source, "rb") as fh:
                client.upload_blob(fh, overwrite=True)
        logger.info("Backed up database to blob %s/%s (%d bytes)", container, blob_name, source.stat().st_size)
        return True
    except Exception as exc:
        if _is_auth_failure(exc):
            _record_auth_failure(exc)
        else:
            logger.warning("Blob backup failed: %s", exc)
        return False
    finally:
        _upload_lock.release()


def reset_circuit_breaker_for_tests() -> None:
    """Reset the auth-failure cooldown. Used by unit tests only."""
    global _auth_failure_until, _auth_failure_logged_at
    _auth_failure_until = 0.0
    _auth_failure_logged_at = 0.0
