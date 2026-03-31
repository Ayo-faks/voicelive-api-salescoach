"""Tests for first-boot storage bootstrapping."""

import sqlite3
from pathlib import Path

from src.bootstrap_storage import bootstrap_storage
from src.services.storage import StorageService


class TestBootstrapStorage:
    """Test database seeding for fresh Azure Files mounts."""

    def test_bootstrap_copies_seed_database_when_target_is_missing(self, tmp_path: Path):
        seed_path = tmp_path / "seed.db"
        target_path = tmp_path / "mounted" / "wulo.db"
        StorageService(str(seed_path))

        changed = bootstrap_storage(str(target_path), str(seed_path))

        assert changed is True
        assert target_path.exists()
        with sqlite3.connect(target_path) as connection:
            assert connection.execute("SELECT COUNT(*) FROM children").fetchone()[0] == 3

    def test_bootstrap_replaces_empty_database_and_cleans_stale_sidecars(self, tmp_path: Path):
        seed_path = tmp_path / "seed.db"
        target_path = tmp_path / "mounted" / "wulo.db"
        journal_path = Path(f"{target_path}-journal")
        StorageService(str(seed_path))

        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.touch()
        journal_path.write_text("stale")

        changed = bootstrap_storage(str(target_path), str(seed_path))

        assert changed is True
        assert target_path.stat().st_size == seed_path.stat().st_size
        assert not journal_path.exists()

    def test_bootstrap_preserves_existing_non_empty_database(self, tmp_path: Path):
        seed_path = tmp_path / "seed.db"
        target_path = tmp_path / "mounted" / "wulo.db"
        StorageService(str(seed_path))

        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(b"existing")

        changed = bootstrap_storage(str(target_path), str(seed_path))

        assert changed is False
        assert target_path.read_bytes() == b"existing"