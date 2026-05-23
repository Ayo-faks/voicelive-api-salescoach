"""Persistence contracts for Pathfinder Learn Phase 1."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Protocol
from uuid import uuid4

from src.learning.models import (
    ContentPackManifest,
    InterventionPlan,
    MasteryEvent,
    OfflineQueuedEvent,
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
                    lang, provenance_json, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                ),
            )

        self.storage._execute_write(persist)
        return {"id": plan.plan_id, "tenant_id": tenant_id, "status": status, "created_at": created_at}

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
