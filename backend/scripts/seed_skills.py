"""Seed the Pathfinder Learn skills catalogue from diagnostic fixtures."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.learning.api import PILOT_TENANT_ID  # noqa: E402
from src.learning.diagnostic import DiagnosticItemBank, load_item_bank  # noqa: E402
from src.learning.models import CatalogueSkill  # noqa: E402
from src.learning.repository import LearningRepository  # noqa: E402
from src.learning.repository_factory import make_repository  # noqa: E402
from src.learning.skills import SkillsCatalogueService  # noqa: E402


DEFAULT_DATA_DIR = REPO_ROOT / "data" / "learning"
PRIMARY_DIAGNOSTIC_FILENAME = "jss2_maths_diagnostic_phase_2.json"


@dataclass(frozen=True)
class SeedSkillsResult:
    tenant_id: str
    source_count: int
    total: int
    created: int
    skipped_existing: int
    dry_run: bool = False

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def diagnostic_source_paths(data_dir: Path = DEFAULT_DATA_DIR) -> List[Path]:
    paths: List[Path] = []
    primary = data_dir / PRIMARY_DIAGNOSTIC_FILENAME
    if primary.exists():
        paths.append(primary)
    diagnostics_dir = data_dir / "diagnostics"
    if diagnostics_dir.exists():
        paths.extend(sorted(diagnostics_dir.glob("*.json")))
    return paths


def load_catalogue_skills(paths: Iterable[Path], *, tenant_id: str) -> List[CatalogueSkill]:
    skills_by_id: dict[str, CatalogueSkill] = {}
    for path in paths:
        bank = load_item_bank(Path(path))
        for skill in _bank_to_catalogue_skills(bank, tenant_id=tenant_id):
            existing = skills_by_id.get(skill.skill_id)
            if existing is not None and existing.model_dump() != skill.model_dump():
                raise ValueError(f"conflicting skill seed for {skill.skill_id!r} in {path}")
            skills_by_id[skill.skill_id] = skill
    return [skills_by_id[skill_id] for skill_id in sorted(skills_by_id)]


def seed_skills(
    repository: LearningRepository,
    skills: Sequence[CatalogueSkill],
    *,
    dry_run: bool = False,
    source_count: int = 0,
) -> SeedSkillsResult:
    service = SkillsCatalogueService(repository)
    created = 0
    skipped = 0
    tenant_id = skills[0].tenant_id if skills else os.environ.get("PILOT_TENANT_ID", PILOT_TENANT_ID)

    for skill in skills:
        if repository.get_skill(skill.tenant_id, skill.skill_id) is not None:
            skipped += 1
            continue
        if not dry_run:
            service.create(skill)
        created += 1

    return SeedSkillsResult(
        tenant_id=tenant_id,
        source_count=source_count,
        total=len(skills),
        created=created,
        skipped_existing=skipped,
        dry_run=dry_run,
    )


def build_repository(
    backend: str,
    *,
    database_url: Optional[str],
    tenant_id: str,
    actor_id: str,
    actor_email: str,
) -> LearningRepository:
    selected = backend.strip().lower()
    if selected != "postgres":
        return make_repository(selected)

    if not database_url:
        raise RuntimeError("--database-url or DATABASE_URL is required when --backend postgres")

    from src.services.storage_postgres import PostgresStorageService  # noqa: WPS433

    storage = PostgresStorageService(database_url, allow_system_bypass=True)
    storage.set_request_actor(
        user_id=actor_id,
        role="admin",
        email=actor_email,
        tenant_id=tenant_id,
    )
    return make_repository("postgres", storage_service=storage)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tenant-id",
        default=os.environ.get("PILOT_TENANT_ID", PILOT_TENANT_ID),
        help="Tenant id to seed. Defaults to PILOT_TENANT_ID / tenant-phase-2.",
    )
    parser.add_argument(
        "--backend",
        default=os.environ.get("LEARNING_REPOSITORY_BACKEND") or os.environ.get("DATABASE_BACKEND") or "memory",
        choices=["memory", "sqlite", "postgres"],
        help="Learning repository backend. sqlite currently resolves to the in-memory learning adapter.",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="Postgres connection string used when --backend postgres.",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DEFAULT_DATA_DIR,
        help="Directory containing data/learning diagnostic fixtures.",
    )
    parser.add_argument(
        "--source",
        action="append",
        type=Path,
        default=[],
        help="Specific diagnostic JSON file to seed. May be provided multiple times.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Validate and report without writing.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable summary JSON.")
    parser.add_argument("--actor-id", default="pathfinder-skill-seeder", help="Actor id for Postgres RLS context.")
    parser.add_argument(
        "--actor-email",
        default="pathfinder-skill-seeder@local",
        help="Actor email for Postgres RLS context.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    sources = list(args.source) if args.source else diagnostic_source_paths(args.data_dir)
    if not sources:
        raise RuntimeError(f"no diagnostic source files found under {args.data_dir}")

    skills = load_catalogue_skills(sources, tenant_id=args.tenant_id)
    repository = build_repository(
        args.backend,
        database_url=args.database_url,
        tenant_id=args.tenant_id,
        actor_id=args.actor_id,
        actor_email=args.actor_email,
    )
    result = seed_skills(repository, skills, dry_run=args.dry_run, source_count=len(sources))
    if args.json:
        print(json.dumps(result.as_dict(), sort_keys=True))
    else:
        mode = "validated" if args.dry_run else "seeded"
        print(
            f"{mode} {result.created} of {result.total} skills "
            f"for tenant {result.tenant_id}; skipped {result.skipped_existing} existing "
            f"from {result.source_count} source files"
        )
    return 0


def _bank_to_catalogue_skills(bank: DiagnosticItemBank, *, tenant_id: str) -> List[CatalogueSkill]:
    subject = bank.subject or _subject_from_bank(bank)
    return [
        CatalogueSkill(
            skill_id=skill.skill_id,
            tenant_id=tenant_id,
            standard_id=skill.standard_id,
            name=skill.name,
            description=skill.description,
            subject=subject,
            parent_skill_id=None,
            prerequisites=[],
            kc_tags=[subject, bank.diagnostic_id],
            localisations={},
            status="active",
            lang=bank.lang,
            provenance=bank.provenance,
        )
        for skill in bank.skills
    ]


def _subject_from_bank(bank: DiagnosticItemBank) -> str:
    text = f"{bank.diagnostic_id} {bank.title}".lower()
    if "math" in text:
        return "maths"
    if "english" in text:
        return "english"
    if "science" in text:
        return "basic-science"
    if "social" in text:
        return "social-studies"
    if "ict" in text:
        return "ict"
    return "general"


if __name__ == "__main__":
    raise SystemExit(main())