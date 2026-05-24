"""Persistence contracts for Pathfinder Learn Phase 1."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Protocol
from uuid import uuid4

from src.learning.models import (
    CatalogueSkill,
    ContentPackManifest,
    InterventionPlan,
    MasteryEvent,
    OfflineQueuedEvent,
    Provenance,
    SkillSearchResult,
    StudentResponse,
)
from src.learning.xapi import ApprovalEvent, XAPIStatement


LEARNING_RLS_PROTECTED_TABLES = (
    "learning_classes",
    "learning_students",
    "learning_teachers",
    "learning_teacher_classes",
    "learning_cohorts",
    "learning_cohort_classes",
    "learning_standards",
    "learning_skills",
    "learning_diagnostic_items",
    "learning_student_responses",
    "learning_mastery_events",
    "learning_intervention_plans",
    "learning_approvals",
    "learning_xapi_statements",
    "learning_offline_queue",
    "learning_content_pack_manifests",
)
LEARNING_REQUEST_GUCS = ("app.tenant_id", "app.class_id", "app.user_id", "app.role")
APPROVAL_STATUSES = ("draft", "pending", "approved", "edited_approved", "rejected")


class LearningRepository(Protocol):
    def save_student_response(self, response: StudentResponse, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        raise NotImplementedError

    def save_mastery_event(self, event: MasteryEvent, statement: XAPIStatement) -> Dict[str, Any]:
        raise NotImplementedError

    def save_intervention_plan(
        self,
        plan: InterventionPlan,
        tenant_id: str,
        actor_id: str,
        status: str = "pending",
    ) -> Dict[str, Any]:
        raise NotImplementedError

    def record_approval(self, event: ApprovalEvent, statement: XAPIStatement) -> Dict[str, Any]:
        raise NotImplementedError

    def emit_xapi_statement(
        self, tenant_id: str, actor_id: str, statement: XAPIStatement, sink_status: str
    ) -> Dict[str, Any]:
        raise NotImplementedError

    def queue_offline_event(self, event: OfflineQueuedEvent) -> Dict[str, Any]:
        raise NotImplementedError

    def save_content_pack_manifest(self, manifest: ContentPackManifest) -> Dict[str, Any]:
        raise NotImplementedError

    def list_class_ids_for_teacher(self, tenant_id: str, user_id: str) -> set[str]:
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Phase 1 — Workstream B: skills catalogue
    # ------------------------------------------------------------------
    def list_skills(
        self,
        tenant_id: str,
        *,
        query: Optional[str] = None,
        subject: Optional[str] = None,
        status: str = "active",
        limit: int = 50,
        offset: int = 0,
    ) -> SkillSearchResult:
        raise NotImplementedError

    def get_skill(self, tenant_id: str, skill_id: str) -> Optional[CatalogueSkill]:
        raise NotImplementedError

    def create_tenant_skill(self, skill: CatalogueSkill) -> CatalogueSkill:
        raise NotImplementedError

    def archive_skill(self, tenant_id: str, skill_id: str) -> Optional[CatalogueSkill]:
        raise NotImplementedError


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def assert_learning_rls_contract_active(table_names: tuple[str, ...] = LEARNING_RLS_PROTECTED_TABLES) -> None:
    missing = sorted(set(LEARNING_RLS_PROTECTED_TABLES).difference(table_names))
    if missing:
        raise RuntimeError(f"learning_rls_contract_missing_tables:{','.join(missing)}")


class InMemoryLearningRepository:
    """Offline repository used by trace evidence and contract tests."""

    def __init__(self) -> None:
        self.student_responses: List[Dict[str, Any]] = []
        self.mastery_events: List[Dict[str, Any]] = []
        self.intervention_plans: List[Dict[str, Any]] = []
        self.approvals: List[Dict[str, Any]] = []
        self.xapi_statements: List[Dict[str, Any]] = []
        self.offline_queue: List[Dict[str, Any]] = []
        self.content_pack_manifests: List[Dict[str, Any]] = []
        self.teacher_classes: Dict[tuple[str, str], set[str]] = {}
        self.skills: Dict[tuple[str, str], CatalogueSkill] = {}

    def save_student_response(self, response: StudentResponse, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        record = response.model_dump()
        record["id"] = response.response_id
        record["idempotency_key"] = idempotency_key
        record["created_at"] = utc_now()
        self.student_responses.append(record)
        return record

    def save_mastery_event(self, event: MasteryEvent, statement: XAPIStatement) -> Dict[str, Any]:
        record = event.model_dump()
        record["id"] = event.event_id
        record["xapi_statement"] = statement.model_dump()
        record["created_at"] = utc_now()
        self.mastery_events.append(record)
        return record

    def save_intervention_plan(
        self,
        plan: InterventionPlan,
        tenant_id: str,
        actor_id: str,
        status: str = "pending",
    ) -> Dict[str, Any]:
        if status not in APPROVAL_STATUSES:
            raise ValueError(f"unknown intervention status: {status}")
        record = {
            "id": plan.plan_id,
            "tenant_id": tenant_id,
            "created_by_user_id": actor_id,
            "status": status,
            "plan": plan.model_dump(),
            "lang": plan.lang,
            "provenance": [item.model_dump() for item in plan.provenance],
            "created_at": utc_now(),
            "updated_at": utc_now(),
        }
        self.intervention_plans.append(record)
        return record

    def record_approval(self, event: ApprovalEvent, statement: XAPIStatement) -> Dict[str, Any]:
        record = event.model_dump()
        record["id"] = event.event_id
        record["xapi_statement"] = statement.model_dump()
        record["created_at"] = utc_now()
        self.approvals.append(record)
        for plan in self.intervention_plans:
            if plan["id"] == event.plan_id and plan["tenant_id"] == event.tenant_id:
                plan["status"] = event.action
                plan["updated_at"] = record["created_at"]
                plan["approved_at"] = record["created_at"] if event.action != "rejected" else None
        return record

    def emit_xapi_statement(
        self, tenant_id: str, actor_id: str, statement: XAPIStatement, sink_status: str
    ) -> Dict[str, Any]:
        record = {
            "id": statement.id,
            "tenant_id": tenant_id,
            "actor_id": actor_id,
            "verb_id": str(statement.verb.get("id", "")),
            "object_id": str(statement.object.get("id", "")),
            "statement": statement.model_dump(),
            "sink_status": sink_status,
            "created_at": utc_now(),
        }
        self.xapi_statements.append(record)
        return record

    def queue_offline_event(self, event: OfflineQueuedEvent) -> Dict[str, Any]:
        record = event.model_dump()
        record["id"] = event.queue_id
        record["created_at"] = utc_now()
        record["updated_at"] = record["created_at"]
        self.offline_queue.append(record)
        return record

    def save_content_pack_manifest(self, manifest: ContentPackManifest) -> Dict[str, Any]:
        record = manifest.model_dump()
        record["id"] = manifest.manifest_id
        record["created_at"] = utc_now()
        self.content_pack_manifests.append(record)
        return record

    def list_student_responses_for_tenant(self, tenant_id: str) -> List[Dict[str, Any]]:
        return [record for record in self.student_responses if record["tenant_id"] == tenant_id]

    def seed_teacher_class(self, tenant_id: str, user_id: str, class_id: str) -> None:
        self.teacher_classes.setdefault((tenant_id, user_id), set()).add(class_id)

    def list_class_ids_for_teacher(self, tenant_id: str, user_id: str) -> set[str]:
        return set(self.teacher_classes.get((tenant_id, user_id), set()))

    # ------------------------------------------------------------------
    # Phase 1 — Workstream B: skills catalogue
    # ------------------------------------------------------------------
    def list_skills(
        self,
        tenant_id: str,
        *,
        query: Optional[str] = None,
        subject: Optional[str] = None,
        status: str = "active",
        limit: int = 50,
        offset: int = 0,
    ) -> SkillSearchResult:
        if limit < 1 or limit > 200:
            raise ValueError("limit must be between 1 and 200")
        if offset < 0:
            raise ValueError("offset must be non-negative")
        needle = (query or "").strip().lower()
        rows: List[CatalogueSkill] = []
        for (tid, _sid), skill in self.skills.items():
            if tid != tenant_id:
                continue
            if status and skill.status != status:
                continue
            if subject and (skill.subject or "") != subject:
                continue
            if needle:
                hay = " ".join(
                    filter(
                        None,
                        [
                            skill.name.lower(),
                            (skill.description or "").lower(),
                            " ".join(skill.kc_tags).lower(),
                        ],
                    )
                )
                if needle not in hay:
                    continue
            rows.append(skill)
        rows.sort(key=lambda s: (s.subject or "", s.name.lower(), s.skill_id))
        page = rows[offset : offset + limit]
        # Inherit lang/provenance from the first matching skill so the
        # SkillSearchResult satisfies LanguageAndProvenanceModel even
        # when the page is empty.
        lang = page[0].lang if page else (rows[0].lang if rows else "en-NG")
        provenance: List[Provenance] = (
            page[0].provenance
            if page
            else (
                rows[0].provenance
                if rows
                else [
                    Provenance(
                        source="InMemoryLearningRepository.list_skills",
                        rule_id="empty_skill_catalogue",
                        confidence=1.0,
                        evidence_count=1,
                    )
                ]
            )
        )
        return SkillSearchResult(
            tenant_id=tenant_id,
            query=query or "",
            skills=page,
            total=len(rows),
            limit=limit,
            offset=offset,
            lang=lang,
            provenance=provenance,
        )

    def get_skill(self, tenant_id: str, skill_id: str) -> Optional[CatalogueSkill]:
        return self.skills.get((tenant_id, skill_id))

    def create_tenant_skill(self, skill: CatalogueSkill) -> CatalogueSkill:
        key = (skill.tenant_id, skill.skill_id)
        if key in self.skills:
            raise ValueError(f"skill {skill.skill_id} already exists for tenant {skill.tenant_id}")
        self.skills[key] = skill
        return skill

    def archive_skill(self, tenant_id: str, skill_id: str) -> Optional[CatalogueSkill]:
        key = (tenant_id, skill_id)
        existing = self.skills.get(key)
        if existing is None:
            return None
        archived = existing.model_copy(update={"status": "archived"})
        self.skills[key] = archived
        return archived


class LearningPostgresRepository:
    """Postgres repository using the retained storage service connection/GUC path."""

    def __init__(self, storage: Any) -> None:
        self.storage = storage

    def save_student_response(self, response: StudentResponse, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        created_at = self.storage._utc_now()

        def persist(connection: Any) -> None:
            connection.execute(
                """
                INSERT INTO learning_student_responses (
                    id, tenant_id, student_id, item_id, skill_id, response_text,
                    correct, lang, provenance_json, idempotency_key, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
                """,
                (
                    response.response_id,
                    response.tenant_id,
                    response.student_id,
                    response.item_id,
                    response.skill_id,
                    response.response_text,
                    response.correct,
                    response.lang,
                    self.storage._dumps_json([item.model_dump() for item in response.provenance]),
                    idempotency_key,
                    created_at,
                ),
            )

        self.storage._execute_write(persist)
        return {"id": response.response_id, "tenant_id": response.tenant_id, "created_at": created_at}

    def save_mastery_event(self, event: MasteryEvent, statement: XAPIStatement) -> Dict[str, Any]:
        created_at = self.storage._utc_now()

        def persist(connection: Any) -> None:
            connection.execute(
                """
                INSERT INTO learning_mastery_events (
                    id, tenant_id, student_id, skill_id, response_id, estimate_json,
                    lang, provenance_json, xapi_statement_json, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    event.event_id,
                    event.tenant_id,
                    event.student_id,
                    event.skill_id,
                    event.response_id,
                    self.storage._dumps_json(event.estimate.model_dump()),
                    event.lang,
                    self.storage._dumps_json([item.model_dump() for item in event.provenance]),
                    self.storage._dumps_json(statement.model_dump()),
                    created_at,
                ),
            )

        self.storage._execute_write(persist)
        return {"id": event.event_id, "tenant_id": event.tenant_id, "created_at": created_at}

    def save_intervention_plan(
        self,
        plan: InterventionPlan,
        tenant_id: str,
        actor_id: str,
        status: str = "pending",
    ) -> Dict[str, Any]:
        if status not in APPROVAL_STATUSES:
            raise ValueError(f"unknown intervention status: {status}")
        created_at = self.storage._utc_now()

        def persist(connection: Any) -> None:
            connection.execute(
                """
                INSERT INTO learning_intervention_plans (
                    id, tenant_id, created_by_user_id, status, plan_json,
                    lang, provenance_json, created_at, updated_at, parent_plan_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    plan.plan_id,
                    tenant_id,
                    actor_id,
                    status,
                    self.storage._dumps_json(plan.model_dump()),
                    plan.lang,
                    self.storage._dumps_json([item.model_dump() for item in plan.provenance]),
                    created_at,
                    created_at,
                    plan.parent_plan_id,
                ),
            )

        self.storage._execute_write(persist)
        return {
            "id": plan.plan_id,
            "tenant_id": tenant_id,
            "created_by_user_id": actor_id,
            "status": status,
            "plan": plan.model_dump(),
            "lang": plan.lang,
            "provenance": [item.model_dump() for item in plan.provenance],
            "created_at": created_at,
            "updated_at": created_at,
        }

    def record_approval(self, event: ApprovalEvent, statement: XAPIStatement) -> Dict[str, Any]:
        created_at = self.storage._utc_now()

        def persist(connection: Any) -> None:
            connection.execute(
                """
                INSERT INTO learning_approvals (
                    id, tenant_id, plan_id, actor_id, action, reason,
                    xapi_statement_json, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    event.event_id,
                    event.tenant_id,
                    event.plan_id,
                    event.actor_id,
                    event.action,
                    event.reason,
                    self.storage._dumps_json(statement.model_dump()),
                    created_at,
                ),
            )
            connection.execute(
                """
                UPDATE learning_intervention_plans
                SET status = %s, updated_at = %s, approved_at = CASE WHEN %s = 'rejected' THEN approved_at ELSE %s END
                WHERE id = %s AND tenant_id = %s
                """,
                (event.action, created_at, event.action, created_at, event.plan_id, event.tenant_id),
            )

        self.storage._execute_write(persist)
        return {"id": event.event_id, "tenant_id": event.tenant_id, "created_at": created_at}

    def emit_xapi_statement(
        self, tenant_id: str, actor_id: str, statement: XAPIStatement, sink_status: str
    ) -> Dict[str, Any]:
        created_at = self.storage._utc_now()

        def persist(connection: Any) -> None:
            connection.execute(
                """
                INSERT INTO learning_xapi_statements (
                    id, tenant_id, actor_id, verb_id, object_id, statement_json,
                    sink_status, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    statement.id,
                    tenant_id,
                    actor_id,
                    str(statement.verb.get("id", "")),
                    str(statement.object.get("id", "")),
                    self.storage._dumps_json(statement.model_dump()),
                    sink_status,
                    created_at,
                ),
            )

        self.storage._execute_write(persist)
        return {"id": statement.id, "tenant_id": tenant_id, "sink_status": sink_status, "created_at": created_at}

    def queue_offline_event(self, event: OfflineQueuedEvent) -> Dict[str, Any]:
        created_at = self.storage._utc_now()

        def persist(connection: Any) -> None:
            connection.execute(
                """
                INSERT INTO learning_offline_queue (
                    id, tenant_id, actor_id, idempotency_key, event_type,
                    payload_json, status, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
                """,
                (
                    event.queue_id,
                    event.tenant_id,
                    event.actor_id,
                    event.idempotency_key,
                    event.event_type,
                    self.storage._dumps_json(event.payload),
                    event.status,
                    created_at,
                    created_at,
                ),
            )

        self.storage._execute_write(persist)
        return {"id": event.queue_id, "tenant_id": event.tenant_id, "status": event.status, "created_at": created_at}

    def save_content_pack_manifest(self, manifest: ContentPackManifest) -> Dict[str, Any]:
        created_at = self.storage._utc_now()
        manifest_id = manifest.manifest_id or f"content-pack-{uuid4().hex[:12]}"

        def persist(connection: Any) -> None:
            connection.execute(
                """
                INSERT INTO learning_content_pack_manifests (
                    id, tenant_id, pack_key, version, source_uri, sha256,
                    payload_json, created_at, activated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (tenant_id, pack_key, version) DO UPDATE SET
                    source_uri = EXCLUDED.source_uri,
                    sha256 = EXCLUDED.sha256,
                    payload_json = EXCLUDED.payload_json
                """,
                (
                    manifest_id,
                    manifest.tenant_id,
                    manifest.pack_key,
                    manifest.version,
                    manifest.source_uri,
                    manifest.sha256,
                    self.storage._dumps_json(manifest.payload),
                    created_at,
                    created_at,
                ),
            )

        self.storage._execute_write(persist)
        return {"id": manifest_id, "tenant_id": manifest.tenant_id, "created_at": created_at}

    def list_class_ids_for_teacher(self, tenant_id: str, user_id: str) -> set[str]:
        result: Dict[str, Any] = {"class_ids": set()}

        def fetch(connection: Any) -> None:
            rows = connection.execute(
                """
                SELECT tc.class_id
                FROM learning_teacher_classes AS tc
                INNER JOIN learning_teachers AS t
                    ON t.id = tc.teacher_id
                   AND t.tenant_id = tc.tenant_id
                WHERE tc.tenant_id = %s
                  AND t.user_id = %s
                ORDER BY tc.class_id
                """,
                (tenant_id, user_id),
            ).fetchall()
            result["class_ids"] = {str(row["class_id"]) for row in rows if row.get("class_id")}

        self.storage._execute_write(fetch)
        return set(result["class_ids"])

    # ------------------------------------------------------------------
    # Phase 1 — Workstream B: skills catalogue
    # ------------------------------------------------------------------
    def _row_to_catalogue_skill(self, row: Dict[str, Any]) -> CatalogueSkill:
        provenance_raw = self.storage._loads_json(row.get("provenance_json"), [])
        if not provenance_raw:
            provenance_raw = [
                {
                    "source": "LearningPostgresRepository.get_skill",
                    "rule_id": "legacy_skill_no_provenance",
                    "confidence": 1.0,
                    "evidence_count": 1,
                }
            ]
        prerequisites = self.storage._loads_json(row.get("prerequisites_json"), [])
        kc_tags = self.storage._loads_json(row.get("kc_tags_json"), [])
        localisations = self.storage._loads_json(row.get("localisations_json"), {})
        return CatalogueSkill(
            skill_id=row["id"],
            tenant_id=row["tenant_id"],
            standard_id=row["standard_id"],
            name=row["name"],
            description=row.get("description"),
            subject=row.get("subject"),
            parent_skill_id=row.get("parent_skill_id"),
            prerequisites=list(prerequisites or []),
            kc_tags=list(kc_tags or []),
            localisations=dict(localisations or {}),
            year_group_min=row.get("year_group_min"),
            year_group_max=row.get("year_group_max"),
            status=row.get("status") or "active",
            lang=row.get("lang") or "en-NG",
            provenance=[Provenance.model_validate(item) for item in provenance_raw],
        )

    def list_skills(
        self,
        tenant_id: str,
        *,
        query: Optional[str] = None,
        subject: Optional[str] = None,
        status: str = "active",
        limit: int = 50,
        offset: int = 0,
    ) -> SkillSearchResult:
        if limit < 1 or limit > 200:
            raise ValueError("limit must be between 1 and 200")
        if offset < 0:
            raise ValueError("offset must be non-negative")

        needle = f"%{(query or '').strip().lower()}%" if query else None
        clauses: List[str] = ["tenant_id = %s"]
        params: List[Any] = [tenant_id]
        if status:
            clauses.append("status = %s")
            params.append(status)
        if subject:
            clauses.append("subject = %s")
            params.append(subject)
        if needle:
            clauses.append(
                "("
                "lower(name) LIKE %s OR lower(coalesce(description, '')) LIKE %s "
                "OR lower(coalesce(kc_tags_json::text, '')) LIKE %s"
                ")"
            )
            params.extend([needle, needle, needle])
        where_sql = " AND ".join(clauses)

        select_sql = (
            "SELECT id, tenant_id, standard_id, name, description, parent_skill_id, "
            "prerequisites_json, kc_tags_json, localisations_json, subject, "
            "year_group_min, year_group_max, status, lang, provenance_json "
            f"FROM learning_skills WHERE {where_sql} "
            "ORDER BY coalesce(subject, ''), lower(name), id "
            "LIMIT %s OFFSET %s"
        )
        count_sql = f"SELECT count(*) AS total FROM learning_skills WHERE {where_sql}"

        result: Dict[str, Any] = {"rows": [], "total": 0}

        def fetch(connection: Any) -> None:
            rows = connection.execute(select_sql, (*params, limit, offset)).fetchall()
            total_row = connection.execute(count_sql, tuple(params)).fetchone()
            result["rows"] = [dict(row) for row in rows]
            result["total"] = int(total_row["total"] if total_row else 0)

        self.storage._execute_write(fetch)
        skills = [self._row_to_catalogue_skill(row) for row in result["rows"]]
        lang = skills[0].lang if skills else "en-NG"
        provenance = (
            skills[0].provenance
            if skills
            else [
                Provenance(
                    source="LearningPostgresRepository.list_skills",
                    rule_id="empty_skill_catalogue",
                    confidence=1.0,
                    evidence_count=1,
                )
            ]
        )
        return SkillSearchResult(
            tenant_id=tenant_id,
            query=query or "",
            skills=skills,
            total=result["total"],
            limit=limit,
            offset=offset,
            lang=lang,
            provenance=provenance,
        )

    def get_skill(self, tenant_id: str, skill_id: str) -> Optional[CatalogueSkill]:
        result: Dict[str, Any] = {"row": None}

        def fetch(connection: Any) -> None:
            row = connection.execute(
                """
                SELECT id, tenant_id, standard_id, name, description, parent_skill_id,
                       prerequisites_json, kc_tags_json, localisations_json, subject,
                       year_group_min, year_group_max, status, lang, provenance_json
                FROM learning_skills
                WHERE tenant_id = %s AND id = %s
                """,
                (tenant_id, skill_id),
            ).fetchone()
            result["row"] = dict(row) if row else None

        self.storage._execute_write(fetch)
        if result["row"] is None:
            return None
        return self._row_to_catalogue_skill(result["row"])

    def create_tenant_skill(self, skill: CatalogueSkill) -> CatalogueSkill:
        created_at = self.storage._utc_now()

        def persist(connection: Any) -> None:
            connection.execute(
                """
                INSERT INTO learning_skills (
                    id, tenant_id, standard_id, name, description, parent_skill_id,
                    prerequisites_json, kc_tags_json, localisations_json, subject,
                    year_group_min, year_group_max, status, lang, provenance_json,
                    created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    skill.skill_id,
                    skill.tenant_id,
                    skill.standard_id,
                    skill.name,
                    skill.description,
                    skill.parent_skill_id,
                    self.storage._dumps_json(list(skill.prerequisites)),
                    self.storage._dumps_json(list(skill.kc_tags)),
                    self.storage._dumps_json(dict(skill.localisations)),
                    skill.subject,
                    skill.year_group_min,
                    skill.year_group_max,
                    skill.status,
                    skill.lang,
                    self.storage._dumps_json([p.model_dump() for p in skill.provenance]),
                    created_at,
                    created_at,
                ),
            )

        self.storage._execute_write(persist)
        return skill

    def archive_skill(self, tenant_id: str, skill_id: str) -> Optional[CatalogueSkill]:
        updated_at = self.storage._utc_now()

        def persist(connection: Any) -> None:
            connection.execute(
                """
                UPDATE learning_skills
                SET status = 'archived', updated_at = %s
                WHERE tenant_id = %s AND id = %s
                """,
                (updated_at, tenant_id, skill_id),
            )

        self.storage._execute_write(persist)
        return self.get_skill(tenant_id, skill_id)
