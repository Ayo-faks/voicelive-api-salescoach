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
    StudentFactProposal,
    StudentResponse,
)
from src.learning.xapi import ApprovalEvent, StudentFactDecisionEvent, XAPIStatement


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
    "learning_student_facts",
    "learning_student_fact_decisions",
)
LEARNING_REQUEST_GUCS = ("app.tenant_id", "app.class_id", "app.user_id", "app.role")
APPROVAL_STATUSES = ("draft", "pending", "approved", "edited_approved", "rejected", "deferred", "auto_approved")


class LearningRepository(Protocol):
    def save_student_response(self, response: StudentResponse, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        raise NotImplementedError

    def save_mastery_event(self, event: MasteryEvent, statement: XAPIStatement) -> Dict[str, Any]:
        raise NotImplementedError

    def ensure_learner_voice_score_prerequisites(
        self,
        *,
        tenant_id: str,
        class_id: str,
        student_id: str,
        skill_id: str,
        item_id: str,
        prompt: str,
        item_type: str,
        difficulty: float,
        lang: str,
        provenance: List[Provenance],
        skill_name: Optional[str] = None,
        subject: Optional[str] = None,
        year_group: Optional[str] = None,
    ) -> Dict[str, Any]:
        raise NotImplementedError

    def list_mastery_events_for_student(
        self, tenant_id: str, student_id: str, *, limit: int = 200
    ) -> List[Dict[str, Any]]:
        """Return persisted mastery events for a learner, newest first.

        Each record carries at least ``skill_id``, ``estimate`` (a serialized
        :class:`MasteryEstimate`) and ``created_at`` so callers can rebuild the
        latest mastery picture per skill.
        """
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

    def save_student_fact(
        self,
        fact: StudentFactProposal,
        actor_id: str,
        status: str = "pending",
        *,
        expires_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        raise NotImplementedError

    def list_student_facts(
        self,
        tenant_id: str,
        *,
        class_id: Optional[str] = None,
        student_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def record_student_fact_decision(
        self,
        event: StudentFactDecisionEvent,
        statement: XAPIStatement,
        edited_fact: Optional[StudentFactProposal] = None,
    ) -> Dict[str, Any]:
        raise NotImplementedError

    def delete_student_fact(
        self,
        tenant_id: str,
        fact_id: str,
        *,
        actor_id: str,
        reason: str = "learner_deleted",
    ) -> bool:
        raise NotImplementedError

    def expire_due_student_facts(
        self,
        *,
        now: Optional[str] = None,
        actor_id: str = "system-memory-sweep",
        reason: str = "expired",
    ) -> int:
        raise NotImplementedError

    def mark_student_fact_stale(
        self,
        tenant_id: str,
        fact_id: str,
        *,
        reason: str,
        actor_id: str = "system-memory-sweep",
    ) -> bool:
        raise NotImplementedError

    def get_memory_consent(self, learner_user_id: str) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

    def upsert_memory_consent(
        self,
        learner_user_id: str,
        *,
        accepted: bool,
        policy_version: str = "v1",
    ) -> Dict[str, Any]:
        raise NotImplementedError

    def record_misconception_attempts(
        self,
        tenant_id: str,
        student_id: str,
        *,
        item_id: str,
        skill_id: str,
        topic: Optional[str],
        misconception_codes: List[str],
        occurred_at: Optional[str] = None,
    ) -> int:
        """Persist one episodic record per misconception code on a wrong attempt.

        Returns the number of rows written (0 when ``misconception_codes`` is
        empty). Episodic recall (Phase 5) reads these back, consent-gated, to
        build cross-session ``the X trap caught you`` callbacks.
        """
        raise NotImplementedError

    def list_misconception_attempts(
        self, tenant_id: str, student_id: str, *, limit: int = 200
    ) -> List[Dict[str, Any]]:
        """Return episodic misconception attempts for a learner, newest first.

        Each record carries ``misconception_code``, ``topic``, ``correct``
        (always ``False``) and ``occurred_at`` so callers can feed them to
        ``episodic_memory.build_memory_callback`` directly.
        """
        raise NotImplementedError

    def emit_xapi_statement(
        self, tenant_id: str, actor_id: str, statement: XAPIStatement, sink_status: str
    ) -> Dict[str, Any]:
        raise NotImplementedError

    def queue_offline_event(self, event: OfflineQueuedEvent) -> Dict[str, Any]:
        raise NotImplementedError

    def list_replayable_offline_events(
        self, *, limit: int = 100, max_attempts: int = 5
    ) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def mark_offline_event_replayed(self, queue_id: str) -> bool:
        raise NotImplementedError

    def mark_offline_event_failed(
        self, queue_id: str, *, error: str, max_attempts: int = 5
    ) -> Dict[str, Any]:
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
        self.student_facts: List[Dict[str, Any]] = []
        self.student_fact_decisions: List[Dict[str, Any]] = []
        self.xapi_statements: List[Dict[str, Any]] = []
        self.offline_queue: List[Dict[str, Any]] = []
        self.content_pack_manifests: List[Dict[str, Any]] = []
        self.teacher_classes: Dict[tuple[str, str], set[str]] = {}
        self.skills: Dict[tuple[str, str], CatalogueSkill] = {}
        self.memory_consents: Dict[str, Dict[str, Any]] = {}
        self.misconception_attempts: List[Dict[str, Any]] = []
        self.learner_voice_prerequisites: List[Dict[str, Any]] = []

    def ensure_learner_voice_score_prerequisites(
        self,
        *,
        tenant_id: str,
        class_id: str,
        student_id: str,
        skill_id: str,
        item_id: str,
        prompt: str,
        item_type: str,
        difficulty: float,
        lang: str,
        provenance: List[Provenance],
        skill_name: Optional[str] = None,
        subject: Optional[str] = None,
        year_group: Optional[str] = None,
    ) -> Dict[str, Any]:
        record = {
            "tenant_id": tenant_id,
            "class_id": class_id,
            "student_id": student_id,
            "skill_id": skill_id,
            "item_id": item_id,
            "prompt": prompt,
            "item_type": item_type,
            "difficulty": difficulty,
            "lang": lang,
            "provenance": [item.model_dump() for item in provenance],
            "skill_name": skill_name,
            "subject": subject,
            "year_group": year_group,
        }
        self.learner_voice_prerequisites.append(record)
        return record

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

    def list_mastery_events_for_student(
        self, tenant_id: str, student_id: str, *, limit: int = 200
    ) -> List[Dict[str, Any]]:
        matches = [
            rec
            for rec in self.mastery_events
            if rec.get("tenant_id") == tenant_id and rec.get("student_id") == student_id
        ]
        # Newest first; the in-memory list is append-ordered (oldest first).
        ordered = list(reversed(matches))
        return ordered[: max(0, limit)]

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
                if event.action in {"approved", "edited_approved"}:
                    plan["approved_at"] = record["created_at"]
        return record

    def save_student_fact(
        self,
        fact: StudentFactProposal,
        actor_id: str,
        status: str = "pending",
        *,
        expires_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        if status not in APPROVAL_STATUSES:
            raise ValueError(f"unknown student fact status: {status}")
        now = utc_now()
        record = {
            "id": fact.fact_id,
            "tenant_id": fact.tenant_id,
            "class_id": fact.class_id,
            "student_id": fact.student_id,
            "created_by_user_id": actor_id,
            "status": status,
            "fact": fact.model_dump(),
            "lang": fact.lang,
            "provenance": [item.model_dump() for item in fact.provenance],
            "created_at": now,
            "updated_at": now,
            "approved_at": now if status in ("approved", "edited_approved", "auto_approved") else None,
            "expires_at": expires_at,
            "decided_by": actor_id if status == "auto_approved" else None,
            "decision_reason": "auto:allowlist+consent" if status == "auto_approved" else None,
        }
        for index, existing in enumerate(self.student_facts):
            if existing["id"] == fact.fact_id and existing["tenant_id"] == fact.tenant_id:
                self.student_facts[index] = record
                return record
        self.student_facts.append(record)
        return record

    def list_student_facts(
        self,
        tenant_id: str,
        *,
        class_id: Optional[str] = None,
        student_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return [
            record
            for record in self.student_facts
            if record["tenant_id"] == tenant_id
            and (class_id is None or record.get("class_id") == class_id)
            and (student_id is None or record.get("student_id") == student_id)
            and (status is None or record.get("status") == status)
        ]

    def record_student_fact_decision(
        self,
        event: StudentFactDecisionEvent,
        statement: XAPIStatement,
        edited_fact: Optional[StudentFactProposal] = None,
    ) -> Dict[str, Any]:
        record = event.model_dump()
        record["id"] = event.event_id
        record["xapi_statement"] = statement.model_dump()
        record["created_at"] = utc_now()
        self.student_fact_decisions.append(record)
        for fact_record in self.student_facts:
            if fact_record["id"] == event.fact_id and fact_record["tenant_id"] == event.tenant_id:
                if edited_fact is not None:
                    fact_record["fact"] = edited_fact.model_dump()
                    fact_record["lang"] = edited_fact.lang
                    fact_record["provenance"] = [item.model_dump() for item in edited_fact.provenance]
                fact_record["status"] = event.action
                fact_record["updated_at"] = record["created_at"]
                fact_record["decided_by"] = event.actor_id
                fact_record["decision_reason"] = event.reason
                fact_record["approved_at"] = record["created_at"] if event.action != "rejected" else None
                record["fact"] = fact_record["fact"]
                break
        return record

    def delete_student_fact(
        self,
        tenant_id: str,
        fact_id: str,
        *,
        actor_id: str,
        reason: str = "learner_deleted",
    ) -> bool:
        for fact_record in self.student_facts:
            if fact_record["id"] == fact_id and fact_record["tenant_id"] == tenant_id:
                if fact_record["status"] == "rejected":
                    return False
                fact_record["status"] = "rejected"
                fact_record["updated_at"] = utc_now()
                fact_record["decided_by"] = actor_id
                fact_record["decision_reason"] = reason
                return True
        return False

    def expire_due_student_facts(
        self,
        *,
        now: Optional[str] = None,
        actor_id: str = "system-memory-sweep",
        reason: str = "expired",
    ) -> int:
        cutoff = now or utc_now()
        expired = 0
        for fact_record in self.student_facts:
            exp = fact_record.get("expires_at")
            if not exp or fact_record["status"] in ("rejected",):
                continue
            if exp <= cutoff:
                fact_record["status"] = "rejected"
                fact_record["updated_at"] = utc_now()
                fact_record["decided_by"] = actor_id
                fact_record["decision_reason"] = reason
                expired += 1
        return expired

    def mark_student_fact_stale(
        self,
        tenant_id: str,
        fact_id: str,
        *,
        reason: str,
        actor_id: str = "system-memory-sweep",
    ) -> bool:
        for fact_record in self.student_facts:
            if fact_record["id"] == fact_id and fact_record["tenant_id"] == tenant_id:
                if fact_record["status"] in ("rejected", "pending"):
                    return False
                fact = dict(fact_record.get("fact") or {})
                if fact.get("staleness_reason") == reason and fact_record["status"] == "pending":
                    return False
                fact["staleness_reason"] = reason
                fact_record["fact"] = fact
                fact_record["status"] = "pending"
                fact_record["updated_at"] = utc_now()
                fact_record["decided_by"] = actor_id
                fact_record["decision_reason"] = f"stale:{reason}"
                return True
        return False

    def get_memory_consent(self, learner_user_id: str) -> Optional[Dict[str, Any]]:
        record = self.memory_consents.get(learner_user_id)
        return dict(record) if record else None

    def upsert_memory_consent(
        self,
        learner_user_id: str,
        *,
        accepted: bool,
        policy_version: str = "v1",
    ) -> Dict[str, Any]:
        now_iso = utc_now()
        existing = self.memory_consents.get(learner_user_id, {})
        record = {
            "id": existing.get("id") or str(uuid4()),
            "learner_user_id": learner_user_id,
            "accepted_at": now_iso if accepted else existing.get("accepted_at"),
            "withdrawn_at": None if accepted else now_iso,
            "policy_version": policy_version or existing.get("policy_version") or "v1",
            "created_at": existing.get("created_at") or now_iso,
            "updated_at": now_iso,
        }
        self.memory_consents[learner_user_id] = record
        return dict(record)

    def record_misconception_attempts(
        self,
        tenant_id: str,
        student_id: str,
        *,
        item_id: str,
        skill_id: str,
        topic: Optional[str],
        misconception_codes: List[str],
        occurred_at: Optional[str] = None,
    ) -> int:
        when = occurred_at or utc_now()
        written = 0
        for code in misconception_codes:
            if not code:
                continue
            self.misconception_attempts.append(
                {
                    "id": str(uuid4()),
                    "tenant_id": tenant_id,
                    "student_id": student_id,
                    "item_id": item_id,
                    "skill_id": skill_id,
                    "misconception_code": code,
                    "topic": topic,
                    "correct": False,
                    "occurred_at": when,
                    "created_at": utc_now(),
                }
            )
            written += 1
        return written

    def list_misconception_attempts(
        self, tenant_id: str, student_id: str, *, limit: int = 200
    ) -> List[Dict[str, Any]]:
        matches = [
            dict(rec)
            for rec in self.misconception_attempts
            if rec.get("tenant_id") == tenant_id and rec.get("student_id") == student_id
        ]
        ordered = list(reversed(matches))
        return ordered[: max(0, limit)]

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
        record["attempts"] = 0
        record["last_error"] = None
        record["replayed_at"] = None
        existing = next(
            (
                item
                for item in self.offline_queue
                if item["tenant_id"] == record["tenant_id"]
                and item["idempotency_key"] == record["idempotency_key"]
            ),
            None,
        )
        if existing is not None:
            # Mirror the Postgres ``ON CONFLICT (tenant_id, idempotency_key)
            # DO NOTHING`` semantics so re-enqueues are idempotent.
            return existing
        self.offline_queue.append(record)
        return record

    def list_replayable_offline_events(
        self, *, limit: int = 100, max_attempts: int = 5
    ) -> List[Dict[str, Any]]:
        candidates = [
            record
            for record in self.offline_queue
            if record.get("status") == "queued"
            and int(record.get("attempts", 0)) < max_attempts
        ]
        candidates.sort(key=lambda record: str(record.get("updated_at", "")))
        return [dict(record) for record in candidates[: max(0, limit)]]

    def mark_offline_event_replayed(self, queue_id: str) -> bool:
        for record in self.offline_queue:
            if record["id"] == queue_id:
                record["status"] = "replayed"
                now = utc_now()
                record["updated_at"] = now
                record["replayed_at"] = now
                record["last_error"] = None
                return True
        return False

    def mark_offline_event_failed(
        self, queue_id: str, *, error: str, max_attempts: int = 5
    ) -> Dict[str, Any]:
        for record in self.offline_queue:
            if record["id"] == queue_id:
                attempts = int(record.get("attempts", 0)) + 1
                status = "manual_review" if attempts >= max_attempts else "queued"
                record["attempts"] = attempts
                record["status"] = status
                record["last_error"] = error
                record["updated_at"] = utc_now()
                return {"attempts": attempts, "status": status}
        return {"attempts": 0, "status": "queued"}

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

    def ensure_learner_voice_score_prerequisites(
        self,
        *,
        tenant_id: str,
        class_id: str,
        student_id: str,
        skill_id: str,
        item_id: str,
        prompt: str,
        item_type: str,
        difficulty: float,
        lang: str,
        provenance: List[Provenance],
        skill_name: Optional[str] = None,
        subject: Optional[str] = None,
        year_group: Optional[str] = None,
    ) -> Dict[str, Any]:
        created_at = self.storage._utc_now()
        standard_id = f"learner-voice-standard:{tenant_id}"
        resolved_year_group = (year_group or "learner-voice").strip() or "learner-voice"
        resolved_prompt = prompt.strip() or f"Learner voice item {item_id}"
        resolved_item_type = item_type.strip() or "learner_voice"
        resolved_skill_name = (skill_name or skill_id).strip() or skill_id
        provenance_json = self.storage._dumps_json([item.model_dump() for item in provenance])

        def persist(connection: Any) -> None:
            connection.execute(
                """
                INSERT INTO learning_classes (
                    id, tenant_id, name, year_group, created_by_user_id,
                    created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    year_group = EXCLUDED.year_group,
                    updated_at = EXCLUDED.updated_at
                WHERE learning_classes.tenant_id = EXCLUDED.tenant_id
                """,
                (
                    class_id,
                    tenant_id,
                    f"Learner Voice {resolved_year_group}",
                    resolved_year_group,
                    "learner-voice-score",
                    created_at,
                    created_at,
                ),
            )
            connection.execute(
                """
                INSERT INTO learning_students (
                    id, tenant_id, class_id, display_name, year_group,
                    created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    class_id = EXCLUDED.class_id,
                    display_name = EXCLUDED.display_name,
                    year_group = EXCLUDED.year_group,
                    updated_at = EXCLUDED.updated_at
                WHERE learning_students.tenant_id = EXCLUDED.tenant_id
                """,
                (
                    student_id,
                    tenant_id,
                    class_id,
                    f"Learner {student_id}",
                    resolved_year_group,
                    created_at,
                    created_at,
                ),
            )
            connection.execute(
                """
                INSERT INTO learning_standards (
                    id, tenant_id, source, name, version, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    updated_at = EXCLUDED.updated_at
                WHERE learning_standards.tenant_id = EXCLUDED.tenant_id
                """,
                (
                    standard_id,
                    tenant_id,
                    "learner_voice",
                    "Learner Voice Embedded Catalogue",
                    "v1",
                    created_at,
                    created_at,
                ),
            )
            connection.execute(
                """
                INSERT INTO learning_skills (
                    id, tenant_id, standard_id, name, description,
                    created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    standard_id = EXCLUDED.standard_id,
                    name = EXCLUDED.name,
                    description = COALESCE(learning_skills.description, EXCLUDED.description),
                    updated_at = EXCLUDED.updated_at
                WHERE learning_skills.tenant_id = EXCLUDED.tenant_id
                """,
                (
                    skill_id,
                    tenant_id,
                    standard_id,
                    resolved_skill_name,
                    subject,
                    created_at,
                    created_at,
                ),
            )
            connection.execute(
                """
                INSERT INTO learning_diagnostic_items (
                    id, tenant_id, skill_id, prompt, item_type, difficulty,
                    correct_answer, lang, provenance_json, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    skill_id = EXCLUDED.skill_id,
                    prompt = EXCLUDED.prompt,
                    item_type = EXCLUDED.item_type,
                    difficulty = EXCLUDED.difficulty,
                    lang = EXCLUDED.lang,
                    provenance_json = EXCLUDED.provenance_json,
                    updated_at = EXCLUDED.updated_at
                WHERE learning_diagnostic_items.tenant_id = EXCLUDED.tenant_id
                """,
                (
                    item_id,
                    tenant_id,
                    skill_id,
                    resolved_prompt,
                    resolved_item_type,
                    difficulty,
                    None,
                    lang,
                    provenance_json,
                    created_at,
                    created_at,
                ),
            )

        self.storage._execute_write(persist)
        return {
            "tenant_id": tenant_id,
            "class_id": class_id,
            "student_id": student_id,
            "skill_id": skill_id,
            "item_id": item_id,
            "created_at": created_at,
        }

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

    def list_mastery_events_for_student(
        self, tenant_id: str, student_id: str, *, limit: int = 200
    ) -> List[Dict[str, Any]]:
        result: Dict[str, Any] = {"rows": []}

        def fetch(connection: Any) -> None:
            rows = connection.execute(
                """
                SELECT id, tenant_id, student_id, skill_id, response_id,
                       estimate_json, lang, created_at
                FROM learning_mastery_events
                WHERE tenant_id = %s AND student_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (tenant_id, student_id, max(0, limit)),
            ).fetchall()
            result["rows"] = [dict(row) for row in rows]

        self.storage._execute_write(fetch)
        return [
            {
                "id": row.get("id"),
                "tenant_id": row.get("tenant_id"),
                "student_id": row.get("student_id"),
                "skill_id": row.get("skill_id"),
                "response_id": row.get("response_id"),
                "estimate": self.storage._loads_json(row.get("estimate_json"), {}),
                "lang": row.get("lang"),
                "created_at": row.get("created_at"),
            }
            for row in result["rows"]
        ]

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
                SET status = %s, updated_at = %s,
                    approved_at = CASE WHEN %s IN ('approved', 'edited_approved') THEN %s ELSE approved_at END
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

    def _row_to_offline_event(self, row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": row.get("id"),
            "tenant_id": row.get("tenant_id"),
            "actor_id": row.get("actor_id"),
            "idempotency_key": row.get("idempotency_key"),
            "event_type": row.get("event_type"),
            "payload": self.storage._loads_json(row.get("payload_json"), {}),
            "status": row.get("status"),
            "attempts": int(row.get("attempts") or 0),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "last_error": row.get("last_error"),
        }

    def list_replayable_offline_events(
        self, *, limit: int = 100, max_attempts: int = 5
    ) -> List[Dict[str, Any]]:
        result: Dict[str, Any] = {"rows": []}

        def fetch(connection: Any) -> None:
            rows = connection.execute(
                """
                SELECT id, tenant_id, actor_id, idempotency_key, event_type,
                       payload_json, status, attempts, created_at, updated_at,
                       last_error
                FROM learning_offline_queue
                WHERE status = 'queued' AND attempts < %s
                ORDER BY updated_at ASC, created_at ASC
                LIMIT %s
                """,
                (max_attempts, max(0, limit)),
            ).fetchall()
            result["rows"] = [dict(row) for row in rows]

        self.storage._execute_write(fetch)
        return [self._row_to_offline_event(row) for row in result["rows"]]

    def mark_offline_event_replayed(self, queue_id: str) -> bool:
        now = self.storage._utc_now()
        result: Dict[str, Any] = {"rowcount": 0}

        def persist(connection: Any) -> None:
            cur = connection.execute(
                """
                UPDATE learning_offline_queue
                SET status = 'replayed',
                    updated_at = %s,
                    replayed_at = %s,
                    last_error = NULL
                WHERE id = %s
                """,
                (now, now, queue_id),
            )
            result["rowcount"] = getattr(cur, "rowcount", 0) or 0

        self.storage._execute_write(persist)
        return result["rowcount"] > 0

    def mark_offline_event_failed(
        self, queue_id: str, *, error: str, max_attempts: int = 5
    ) -> Dict[str, Any]:
        now = self.storage._utc_now()
        result: Dict[str, Any] = {"attempts": 0, "status": "queued"}

        def persist(connection: Any) -> None:
            row = connection.execute(
                """
                UPDATE learning_offline_queue
                SET attempts = attempts + 1,
                    last_error = %s,
                    updated_at = %s,
                    status = CASE
                        WHEN attempts + 1 >= %s THEN 'manual_review'
                        ELSE 'queued'
                    END
                WHERE id = %s
                RETURNING attempts, status
                """,
                (error, now, max_attempts, queue_id),
            ).fetchone()
            if row is not None:
                result["attempts"] = int(row["attempts"])
                result["status"] = row["status"]

        self.storage._execute_write(persist)
        return result

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

    def _row_to_student_fact_record(self, row: Dict[str, Any]) -> Dict[str, Any]:
        fact_raw = self.storage._loads_json(row.get("fact_json"), {})
        provenance_raw = self.storage._loads_json(row.get("provenance_json"), [])
        if provenance_raw and isinstance(fact_raw, dict):
            fact_raw = {**fact_raw, "provenance": provenance_raw}
        fact = StudentFactProposal.model_validate(fact_raw)
        return {
            "id": row["id"],
            "tenant_id": row["tenant_id"],
            "class_id": row["class_id"],
            "student_id": row["student_id"],
            "created_by_user_id": row["created_by_user_id"],
            "status": row["status"],
            "fact": fact.model_dump(),
            "lang": fact.lang,
            "provenance": [item.model_dump() for item in fact.provenance],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "approved_at": row.get("approved_at"),
            "decided_by": row.get("decided_by"),
            "decision_reason": row.get("decision_reason"),
            "expires_at": row.get("expires_at"),
        }

    def save_student_fact(
        self,
        fact: StudentFactProposal,
        actor_id: str,
        status: str = "pending",
        *,
        expires_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        if status not in APPROVAL_STATUSES:
            raise ValueError(f"unknown student fact status: {status}")
        created_at = self.storage._utc_now()
        approved_at = created_at if status in ("approved", "edited_approved", "auto_approved") else None
        decided_by = actor_id if status == "auto_approved" else None
        decision_reason = "auto:allowlist+consent" if status == "auto_approved" else None

        def persist(connection: Any) -> None:
            connection.execute(
                """
                INSERT INTO learning_student_facts (
                    id, tenant_id, class_id, student_id, created_by_user_id,
                    status, fact_json, lang, provenance_json, created_at, updated_at,
                    approved_at, decided_by, decision_reason, expires_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    fact.fact_id,
                    fact.tenant_id,
                    fact.class_id,
                    fact.student_id,
                    actor_id,
                    status,
                    self.storage._dumps_json(fact.model_dump()),
                    fact.lang,
                    self.storage._dumps_json([item.model_dump() for item in fact.provenance]),
                    created_at,
                    created_at,
                    approved_at,
                    decided_by,
                    decision_reason,
                    expires_at,
                ),
            )

        self.storage._execute_write(persist)
        return {
            "id": fact.fact_id,
            "tenant_id": fact.tenant_id,
            "class_id": fact.class_id,
            "student_id": fact.student_id,
            "created_by_user_id": actor_id,
            "status": status,
            "fact": fact.model_dump(),
            "lang": fact.lang,
            "provenance": [item.model_dump() for item in fact.provenance],
            "created_at": created_at,
            "updated_at": created_at,
            "approved_at": approved_at,
            "decided_by": decided_by,
            "decision_reason": decision_reason,
            "expires_at": expires_at,
        }

    def list_student_facts(
        self,
        tenant_id: str,
        *,
        class_id: Optional[str] = None,
        student_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        clauses = ["tenant_id = %s"]
        params: List[Any] = [tenant_id]
        if class_id is not None:
            clauses.append("class_id = %s")
            params.append(class_id)
        if student_id is not None:
            clauses.append("student_id = %s")
            params.append(student_id)
        if status is not None:
            clauses.append("status = %s")
            params.append(status)
        where_sql = " AND ".join(clauses)
        result: Dict[str, Any] = {"rows": []}

        def fetch(connection: Any) -> None:
            rows = connection.execute(
                f"""
                SELECT id, tenant_id, class_id, student_id, created_by_user_id,
                       status, fact_json, lang, provenance_json, created_at,
                       updated_at, approved_at, decided_by, decision_reason, expires_at
                FROM learning_student_facts
                WHERE {where_sql}
                ORDER BY updated_at DESC, created_at DESC
                """,
                tuple(params),
            ).fetchall()
            result["rows"] = [dict(row) for row in rows]

        self.storage._execute_write(fetch)
        return [self._row_to_student_fact_record(row) for row in result["rows"]]

    def record_student_fact_decision(
        self,
        event: StudentFactDecisionEvent,
        statement: XAPIStatement,
        edited_fact: Optional[StudentFactProposal] = None,
    ) -> Dict[str, Any]:
        created_at = self.storage._utc_now()
        decision_id = event.event_id
        updated_fact = edited_fact.model_dump() if edited_fact is not None else None
        class_id_result: Dict[str, Any] = {"class_id": ""}

        def persist(connection: Any) -> None:
            row = connection.execute(
                """
                SELECT class_id FROM learning_student_facts
                WHERE id = %s AND tenant_id = %s
                """,
                (event.fact_id, event.tenant_id),
            ).fetchone()
            class_id_result["class_id"] = row["class_id"] if row else ""
            connection.execute(
                """
                INSERT INTO learning_student_fact_decisions (
                    id, tenant_id, class_id, fact_id, actor_id, action, reason,
                    edited_fact_json, xapi_statement_json, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    decision_id,
                    event.tenant_id,
                    class_id_result["class_id"],
                    event.fact_id,
                    event.actor_id,
                    event.action,
                    event.reason,
                    self.storage._dumps_json(updated_fact) if updated_fact is not None else None,
                    self.storage._dumps_json(statement.model_dump()),
                    created_at,
                ),
            )
            connection.execute(
                """
                UPDATE learning_student_facts
                SET status = %s,
                    fact_json = COALESCE(%s, fact_json),
                    lang = COALESCE(%s, lang),
                    provenance_json = COALESCE(%s, provenance_json),
                    updated_at = %s,
                    approved_at = CASE WHEN %s = 'rejected' THEN approved_at ELSE %s END,
                    decided_by = %s,
                    decision_reason = %s
                WHERE id = %s AND tenant_id = %s
                """,
                (
                    event.action,
                    self.storage._dumps_json(updated_fact) if updated_fact is not None else None,
                    edited_fact.lang if edited_fact is not None else None,
                    self.storage._dumps_json([item.model_dump() for item in edited_fact.provenance])
                    if edited_fact is not None else None,
                    created_at,
                    event.action,
                    created_at,
                    event.actor_id,
                    event.reason,
                    event.fact_id,
                    event.tenant_id,
                ),
            )

        self.storage._execute_write(persist)
        return {"id": decision_id, "tenant_id": event.tenant_id, "class_id": class_id_result["class_id"], "created_at": created_at}

    def delete_student_fact(
        self,
        tenant_id: str,
        fact_id: str,
        *,
        actor_id: str,
        reason: str = "learner_deleted",
    ) -> bool:
        updated_at = self.storage._utc_now()
        result: Dict[str, Any] = {"rowcount": 0}

        def persist(connection: Any) -> None:
            cur = connection.execute(
                """
                UPDATE learning_student_facts
                SET status = 'rejected',
                    updated_at = %s,
                    decided_by = %s,
                    decision_reason = %s
                WHERE id = %s AND tenant_id = %s AND status <> 'rejected'
                """,
                (updated_at, actor_id, reason, fact_id, tenant_id),
            )
            result["rowcount"] = getattr(cur, "rowcount", 0) or 0

        self.storage._execute_write(persist)
        return result["rowcount"] > 0

    def expire_due_student_facts(
        self,
        *,
        now: Optional[str] = None,
        actor_id: str = "system-memory-sweep",
        reason: str = "expired",
    ) -> int:
        cutoff = now or self.storage._utc_now()
        updated_at = self.storage._utc_now()
        result: Dict[str, Any] = {"rowcount": 0}

        def persist(connection: Any) -> None:
            cur = connection.execute(
                """
                UPDATE learning_student_facts
                SET status = 'rejected',
                    updated_at = %s,
                    decided_by = %s,
                    decision_reason = %s
                WHERE expires_at IS NOT NULL
                  AND expires_at <= %s
                  AND status <> 'rejected'
                """,
                (updated_at, actor_id, reason, cutoff),
            )
            result["rowcount"] = getattr(cur, "rowcount", 0) or 0

        self.storage._execute_write(persist)
        return result["rowcount"]

    def mark_student_fact_stale(
        self,
        tenant_id: str,
        fact_id: str,
        *,
        reason: str,
        actor_id: str = "system-memory-sweep",
    ) -> bool:
        updated_at = self.storage._utc_now()
        result: Dict[str, Any] = {"rowcount": 0}

        def persist(connection: Any) -> None:
            row = connection.execute(
                """
                SELECT fact_json, status
                FROM learning_student_facts
                WHERE id = %s AND tenant_id = %s
                """,
                (fact_id, tenant_id),
            ).fetchone()
            if row is None:
                return
            row_dict = dict(row)
            if row_dict.get("status") in ("rejected", "pending"):
                return
            fact_raw = self.storage._loads_json(row_dict.get("fact_json"), {})
            if not isinstance(fact_raw, dict):
                fact_raw = {}
            fact_raw["staleness_reason"] = reason
            cur = connection.execute(
                """
                UPDATE learning_student_facts
                SET status = 'pending',
                    fact_json = %s,
                    updated_at = %s,
                    decided_by = %s,
                    decision_reason = %s
                WHERE id = %s AND tenant_id = %s AND status NOT IN ('rejected', 'pending')
                """,
                (
                    self.storage._dumps_json(fact_raw),
                    updated_at,
                    actor_id,
                    f"stale:{reason}",
                    fact_id,
                    tenant_id,
                ),
            )
            result["rowcount"] = getattr(cur, "rowcount", 0) or 0

        self.storage._execute_write(persist)
        return result["rowcount"] > 0

    def get_memory_consent(self, learner_user_id: str) -> Optional[Dict[str, Any]]:
        result: Dict[str, Any] = {"row": None}

        def fetch(connection: Any) -> None:
            row = connection.execute(
                """
                SELECT id, learner_user_id, accepted_at, withdrawn_at,
                       policy_version, created_at, updated_at
                FROM learner_memory_consent
                WHERE learner_user_id = %s
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (learner_user_id,),
            ).fetchone()
            result["row"] = dict(row) if row else None

        self.storage._execute_write(fetch)
        return result["row"]

    def upsert_memory_consent(
        self,
        learner_user_id: str,
        *,
        accepted: bool,
        policy_version: str = "v1",
    ) -> Dict[str, Any]:
        now_iso = self.storage._utc_now()
        existing = self.get_memory_consent(learner_user_id)
        record_id = (existing or {}).get("id") or str(uuid4())
        created_at = (existing or {}).get("created_at") or now_iso
        accepted_at = now_iso if accepted else (existing or {}).get("accepted_at")
        withdrawn_at = None if accepted else now_iso
        version = policy_version or (existing or {}).get("policy_version") or "v1"
        result: Dict[str, Any] = {"row": None}

        def persist(connection: Any) -> None:
            row = connection.execute(
                """
                INSERT INTO learner_memory_consent (
                    id, learner_user_id, accepted_at, withdrawn_at,
                    policy_version, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    accepted_at = EXCLUDED.accepted_at,
                    withdrawn_at = EXCLUDED.withdrawn_at,
                    policy_version = EXCLUDED.policy_version,
                    updated_at = EXCLUDED.updated_at
                RETURNING id, learner_user_id, accepted_at, withdrawn_at,
                          policy_version, created_at, updated_at
                """,
                (
                    record_id,
                    learner_user_id,
                    accepted_at,
                    withdrawn_at,
                    version,
                    created_at,
                    now_iso,
                ),
            ).fetchone()
            result["row"] = dict(row) if row else None

        self.storage._execute_write(persist)
        return result["row"] or {
            "id": record_id,
            "learner_user_id": learner_user_id,
            "accepted_at": accepted_at,
            "withdrawn_at": withdrawn_at,
            "policy_version": version,
            "created_at": created_at,
            "updated_at": now_iso,
        }

    def record_misconception_attempts(
        self,
        tenant_id: str,
        student_id: str,
        *,
        item_id: str,
        skill_id: str,
        topic: Optional[str],
        misconception_codes: List[str],
        occurred_at: Optional[str] = None,
    ) -> int:
        codes = [code for code in misconception_codes if code]
        if not codes:
            return 0
        when = occurred_at or self.storage._utc_now()
        now_iso = self.storage._utc_now()
        rows = [
            (str(uuid4()), tenant_id, student_id, item_id, skill_id, code, topic, when, now_iso)
            for code in codes
        ]
        result: Dict[str, Any] = {"rowcount": 0}

        def persist(connection: Any) -> None:
            written = 0
            for params in rows:
                connection.execute(
                    """
                    INSERT INTO learner_misconception_attempts (
                        id, tenant_id, student_id, item_id, skill_id,
                        misconception_code, topic, occurred_at, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    params,
                )
                written += 1
            result["rowcount"] = written

        self.storage._execute_write(persist)
        return result["rowcount"]

    def list_misconception_attempts(
        self, tenant_id: str, student_id: str, *, limit: int = 200
    ) -> List[Dict[str, Any]]:
        result: Dict[str, Any] = {"rows": []}

        def fetch(connection: Any) -> None:
            rows = connection.execute(
                """
                SELECT id, tenant_id, student_id, item_id, skill_id,
                       misconception_code, topic, occurred_at, created_at
                FROM learner_misconception_attempts
                WHERE tenant_id = %s AND student_id = %s
                ORDER BY occurred_at DESC, created_at DESC
                LIMIT %s
                """,
                (tenant_id, student_id, max(0, limit)),
            ).fetchall()
            result["rows"] = [
                {**dict(row), "correct": False} for row in rows
            ]

        self.storage._execute_write(fetch)
        return result["rows"]

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
