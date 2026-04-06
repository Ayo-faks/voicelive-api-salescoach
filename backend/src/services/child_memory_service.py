"""Domain service for governed child memory workflows."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional
import re


ACTIVE_MEMORY_ITEM_STATUSES = {"approved", "active"}
PENDING_PROPOSAL_STATUS = "pending"
APPROVED_PROPOSAL_STATUS = "approved"
REJECTED_PROPOSAL_STATUS = "rejected"
LOW_RISK_AUTO_APPROVAL_RULES = {("targets", "constraint")}
SUMMARY_CATEGORY_ORDER = (
    "targets",
    "effective_cues",
    "ineffective_cues",
    "preferences",
    "constraints",
    "blockers",
    "general",
)
MAX_RUNTIME_PERSONALIZATION_ITEMS = 3


class ChildMemoryService:
    """Coordinates proposal lifecycle rules and summary compilation."""

    def __init__(self, storage_service: Any):
        self.storage_service = storage_service

    def get_active_child_memory(
        self,
        child_id: str,
        category: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        items = self.storage_service.list_child_memory_items(child_id, category=category)
        return [item for item in items if str(item.get("status") or "") in ACTIVE_MEMORY_ITEM_STATUSES]

    def get_child_memory_summary(self, child_id: str) -> Dict[str, Any]:
        summary = self.storage_service.get_child_memory_summary(child_id)
        if summary is not None:
            return summary

        return self.rebuild_summary(child_id)

    def list_child_memory_items(
        self,
        child_id: str,
        status: Optional[str] = None,
        category: Optional[str] = None,
        include_evidence: bool = False,
    ) -> List[Dict[str, Any]]:
        items = self.storage_service.list_child_memory_items(child_id, status=status, category=category)
        if not include_evidence:
            return items

        return [self._attach_evidence_links(item, subject_type="item") for item in items]

    def list_child_memory_proposals(
        self,
        child_id: str,
        status: Optional[str] = None,
        category: Optional[str] = None,
        include_evidence: bool = False,
    ) -> List[Dict[str, Any]]:
        proposals = self.storage_service.list_child_memory_proposals(child_id, status=status, category=category)
        if not include_evidence:
            return proposals

        return [self._attach_evidence_links(proposal, subject_type="proposal") for proposal in proposals]

    def list_evidence_links(self, subject_type: str, subject_id: str) -> List[Dict[str, Any]]:
        return self.storage_service.list_child_memory_evidence_links(subject_type, subject_id)

    def create_manual_item(
        self,
        *,
        child_id: str,
        category: str,
        statement: str,
        therapist_user_id: str,
        memory_type: str = "fact",
        detail: Optional[Dict[str, Any]] = None,
        confidence: Optional[float] = None,
    ) -> Dict[str, Any]:
        normalized_statement = statement.strip()
        if not child_id:
            raise ValueError("child_id is required")
        if not normalized_statement:
            raise ValueError("statement is required")

        item = self.storage_service.save_child_memory_item(
            {
                "child_id": child_id,
                "category": category or "general",
                "memory_type": memory_type or "fact",
                "status": "approved",
                "statement": normalized_statement,
                "detail": detail or {},
                "confidence": confidence,
                "provenance": {"source": "therapist_manual_entry"},
                "author_type": "therapist",
                "author_user_id": therapist_user_id,
            }
        )
        summary = self.rebuild_summary(child_id)
        return {
            "item": self._attach_evidence_links(item, subject_type="item"),
            "summary": summary,
        }

    def synthesize_session_memory(self, session_id: str) -> Dict[str, Any]:
        session = self.storage_service.get_session(session_id)
        if session is None:
            raise ValueError("Session not found")

        child = session.get("child") or {}
        child_id = str(child.get("id") or "").strip()
        if not child_id:
            raise ValueError("Saved session is missing child context")

        proposals: List[Dict[str, Any]] = []
        auto_applied_items: List[Dict[str, Any]] = []
        for proposal_payload in self._build_session_proposals(session):
            if self._proposal_or_item_exists(child_id, proposal_payload["statement"], proposal_payload["category"]):
                continue

            if self._should_auto_approve_proposal(proposal_payload):
                approved_item = self.storage_service.save_child_memory_item(
                    {
                        "child_id": proposal_payload["child_id"],
                        "category": proposal_payload["category"],
                        "memory_type": proposal_payload["memory_type"],
                        "status": "approved",
                        "statement": proposal_payload["statement"],
                        "detail": proposal_payload.get("detail") or {},
                        "confidence": proposal_payload.get("confidence"),
                        "provenance": {
                            **cast_dict(proposal_payload.get("provenance")),
                            "auto_approved": True,
                        },
                        "author_type": "system",
                    }
                )
                self._link_session_evidence(approved_item, session, subject_type="item")
                auto_applied_items.append(self._attach_evidence_links(approved_item, subject_type="item"))
                continue

            proposal = self.storage_service.save_child_memory_proposal(proposal_payload)
            self._link_session_evidence(proposal, session, subject_type="proposal")
            proposals.append(self._attach_evidence_links(proposal, subject_type="proposal"))

        summary = self.rebuild_summary(child_id)
        return {
            "child_id": child_id,
            "session_id": session_id,
            "proposals": proposals,
            "auto_applied_items": auto_applied_items,
            "summary": summary,
        }

    def approve_proposal(
        self,
        proposal_id: str,
        reviewer_user_id: str,
        review_note: Optional[str] = None,
    ) -> Dict[str, Any]:
        proposal = self.storage_service.get_child_memory_proposal(proposal_id)
        if proposal is None:
            raise ValueError("Child memory proposal not found")
        if proposal.get("status") != PENDING_PROPOSAL_STATUS:
            raise ValueError("Only pending child memory proposals can be approved")

        approved_item = self.storage_service.save_child_memory_item(
            {
                "child_id": proposal["child_id"],
                "category": proposal["category"],
                "memory_type": proposal["memory_type"],
                "status": "approved",
                "statement": proposal["statement"],
                "detail": proposal.get("detail") or {},
                "confidence": proposal.get("confidence"),
                "provenance": proposal.get("provenance") or {},
                "author_type": "therapist",
                "author_user_id": reviewer_user_id,
                "source_proposal_id": proposal["id"],
            }
        )
        self._copy_evidence_links(proposal["id"], approved_item["id"], proposal["child_id"])

        reviewed_proposal = self.storage_service.review_child_memory_proposal(
            proposal_id,
            APPROVED_PROPOSAL_STATUS,
            reviewer_user_id=reviewer_user_id,
            review_note=review_note,
            approved_item_id=approved_item["id"],
        )
        summary = self.rebuild_summary(proposal["child_id"])
        return {
            "proposal": reviewed_proposal,
            "approved_item": approved_item,
            "summary": summary,
        }

    def reject_proposal(
        self,
        proposal_id: str,
        reviewer_user_id: str,
        review_note: Optional[str] = None,
    ) -> Dict[str, Any]:
        proposal = self.storage_service.get_child_memory_proposal(proposal_id)
        if proposal is None:
            raise ValueError("Child memory proposal not found")
        if proposal.get("status") != PENDING_PROPOSAL_STATUS:
            raise ValueError("Only pending child memory proposals can be rejected")

        reviewed_proposal = self.storage_service.review_child_memory_proposal(
            proposal_id,
            REJECTED_PROPOSAL_STATUS,
            reviewer_user_id=reviewer_user_id,
            review_note=review_note,
        )
        summary = self.rebuild_summary(proposal["child_id"])
        return {
            "proposal": reviewed_proposal,
            "summary": summary,
        }

    def rebuild_summary(self, child_id: str) -> Dict[str, Any]:
        approved_items = self.get_active_child_memory(child_id)
        grouped = self._group_items_for_summary(approved_items)
        summary_text = self._build_summary_text(grouped)
        return self.storage_service.upsert_child_memory_summary(
            child_id,
            grouped,
            summary_text=summary_text,
            source_item_count=len(approved_items),
        )

    def get_recommendation_provenance_inputs(self, child_id: str) -> Dict[str, Any]:
        return {
            "summary": self.get_child_memory_summary(child_id),
            "active_items": self.get_active_child_memory(child_id),
        }

    def build_live_session_personalization(self, child_id: str) -> Dict[str, Any]:
        active_items = self.get_active_child_memory(child_id)
        summary = self.storage_service.get_child_memory_summary(child_id) or {}
        targets = [
            self._summarize_runtime_memory_item(item)
            for item in active_items
            if str(item.get("category") or "") == "targets"
        ][:MAX_RUNTIME_PERSONALIZATION_ITEMS]
        constraints = [
            self._summarize_runtime_memory_item(item)
            for item in active_items
            if str(item.get("category") or "") == "constraints"
        ][:MAX_RUNTIME_PERSONALIZATION_ITEMS]
        effective_cues = [
            self._summarize_runtime_memory_item(item)
            for item in active_items
            if str(item.get("category") or "") == "effective_cues"
        ][:MAX_RUNTIME_PERSONALIZATION_ITEMS]

        return {
            "child_id": child_id,
            "active_target_sound": self._resolve_active_target_sound(targets),
            "approved_targets": targets,
            "approved_constraints": constraints,
            "approved_effective_cues": effective_cues,
            "used_item_ids": [str(item.get("id")) for item in active_items if item.get("id")],
            "summary_text": summary.get("summary_text"),
            "summary_last_compiled_at": summary.get("last_compiled_at"),
            "source_item_count": summary.get("source_item_count", len(active_items)),
        }

    def _attach_evidence_links(self, subject: Dict[str, Any], *, subject_type: str) -> Dict[str, Any]:
        return {
            **subject,
            "evidence_links": self.list_evidence_links(subject_type, str(subject.get("id") or "")),
        }

    def _proposal_or_item_exists(self, child_id: str, statement: str, category: str) -> bool:
        normalized = self._normalize_statement(statement)
        if not normalized:
            return True

        existing_items = self.storage_service.list_child_memory_items(child_id, category=category)
        for item in existing_items:
            if self._normalize_statement(item.get("statement")) == normalized:
                return True

        existing_proposals = self.storage_service.list_child_memory_proposals(child_id, category=category)
        for proposal in existing_proposals:
            if self._normalize_statement(proposal.get("statement")) == normalized:
                return True

        return False

    def _group_items_for_summary(self, items: Iterable[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        grouped: Dict[str, List[Dict[str, Any]]] = {category: [] for category in SUMMARY_CATEGORY_ORDER}

        for item in items:
            category = str(item.get("category") or "general")
            if category not in grouped:
                grouped["general"].append(self._build_summary_item(item))
                continue
            grouped[category].append(self._build_summary_item(item))

        return grouped

    def _build_summary_item(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": item.get("id"),
            "statement": item.get("statement"),
            "memory_type": item.get("memory_type"),
            "confidence": item.get("confidence"),
            "updated_at": item.get("updated_at"),
            "detail": item.get("detail") or {},
            "source_proposal_id": item.get("source_proposal_id"),
        }

    def _summarize_runtime_memory_item(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": item.get("id"),
            "category": item.get("category"),
            "memory_type": item.get("memory_type"),
            "statement": item.get("statement"),
            "confidence": item.get("confidence"),
            "updated_at": item.get("updated_at"),
            "detail": item.get("detail") or {},
            "source_proposal_id": item.get("source_proposal_id"),
        }

    def _resolve_active_target_sound(self, targets: List[Dict[str, Any]]) -> Optional[str]:
        for target in targets:
            detail = target.get("detail") or {}
            target_sound = self._first_non_empty(detail.get("target_sound"), detail.get("targetSound"))
            if target_sound:
                return str(target_sound).strip().lower()

            statement = str(target.get("statement") or "")
            match = re.search(r"/([^/]+)/", statement)
            if match:
                return match.group(1).strip().lower()

        return None

    def _build_summary_text(self, grouped: Dict[str, List[Dict[str, Any]]]) -> str:
        parts: List[str] = []
        labels = {
            "targets": "Active targets",
            "effective_cues": "Effective cues",
            "ineffective_cues": "Ineffective cues",
            "preferences": "Preferences",
            "constraints": "Constraints",
            "blockers": "Blockers",
            "general": "Other notes",
        }

        for category in SUMMARY_CATEGORY_ORDER:
            statements = [str(item.get("statement") or "").strip() for item in grouped.get(category, [])]
            statements = [statement for statement in statements if statement]
            if not statements:
                continue
            parts.append(f"{labels[category]}: {'; '.join(statements)}.")

        return " ".join(parts)

    def _build_session_proposals(self, session: Dict[str, Any]) -> List[Dict[str, Any]]:
        child = session.get("child") or {}
        child_id = str(child.get("id") or "").strip()
        if not child_id:
            return []

        exercise_metadata = session.get("exercise_metadata") or {}
        assessment = session.get("assessment") or {}
        ai_assessment = assessment.get("ai_assessment") or {}
        pronunciation = assessment.get("pronunciation_assessment") or {}
        therapist_feedback = session.get("therapist_feedback") or {}
        feedback_rating = str(therapist_feedback.get("rating") or "").strip().lower()
        feedback_note = str(therapist_feedback.get("note") or "").strip()
        session_id = str(session.get("id") or "").strip()
        target_sound = self._first_non_empty(
            exercise_metadata.get("targetSound"),
            exercise_metadata.get("target_sound"),
            (session.get("exercise") or {}).get("exerciseMetadata", {}).get("targetSound"),
        )
        proposals: List[Dict[str, Any]] = []

        if target_sound:
            proposals.append(
                self._proposal_payload(
                    child_id=child_id,
                    category="targets",
                    memory_type="constraint",
                    statement=f"Keep /{target_sound}/ as an active therapy target.",
                    detail={
                        "target_sound": target_sound,
                        "signal": "exercise_target_sound",
                        **self._build_feedback_detail(feedback_rating, feedback_note),
                    },
                    confidence=0.86,
                    provenance={
                        "session_ids": [session_id],
                        "source": "post_session_analysis",
                        **self._build_feedback_provenance(feedback_rating, feedback_note),
                    },
                )
            )

        willingness_to_retry = self._coerce_number(
            (ai_assessment.get("engagement_and_effort") or {}).get("willingness_to_retry")
        )
        if willingness_to_retry is not None and willingness_to_retry >= 7:
            cue_confidence = self._adjust_confidence(0.68, feedback_rating, supports_positive_signal=True)
            proposals.append(
                self._proposal_payload(
                    child_id=child_id,
                    category="effective_cues",
                    memory_type="inference",
                    statement="Encouragement and retry prompts appear to help the child stay engaged.",
                    detail={
                        "signal": "willingness_to_retry",
                        "value": willingness_to_retry,
                        **self._build_feedback_detail(feedback_rating, feedback_note),
                    },
                    confidence=cue_confidence,
                    provenance={
                        "session_ids": [session_id],
                        "source": "ai_assessment.engagement_and_effort",
                        **self._build_feedback_provenance(feedback_rating, feedback_note),
                    },
                )
            )

        accuracy_score = self._coerce_number(pronunciation.get("accuracy_score"))
        if target_sound and accuracy_score is not None and accuracy_score < 70:
            blocker_confidence = self._adjust_confidence(0.7, feedback_rating, supports_positive_signal=False)
            proposals.append(
                self._proposal_payload(
                    child_id=child_id,
                    category="blockers",
                    memory_type="inference",
                    statement=f"The child still needs high-support practice for /{target_sound}/ productions.",
                    detail={
                        "target_sound": target_sound,
                        "accuracy_score": accuracy_score,
                        **self._build_feedback_detail(feedback_rating, feedback_note),
                    },
                    confidence=blocker_confidence,
                    provenance={
                        "session_ids": [session_id],
                        "source": "pronunciation_assessment",
                        **self._build_feedback_provenance(feedback_rating, feedback_note),
                    },
                )
            )

        return [proposal for proposal in proposals if self._normalize_statement(proposal.get("statement"))]

    def _should_auto_approve_proposal(self, proposal_payload: Dict[str, Any]) -> bool:
        category = str(proposal_payload.get("category") or "")
        memory_type = str(proposal_payload.get("memory_type") or "")
        confidence = self._coerce_number(proposal_payload.get("confidence")) or 0.0
        return (category, memory_type) in LOW_RISK_AUTO_APPROVAL_RULES and confidence >= 0.8

    def _proposal_payload(
        self,
        *,
        child_id: str,
        category: str,
        memory_type: str,
        statement: str,
        detail: Dict[str, Any],
        confidence: float,
        provenance: Dict[str, Any],
    ) -> Dict[str, Any]:
        return {
            "child_id": child_id,
            "category": category,
            "memory_type": memory_type,
            "status": PENDING_PROPOSAL_STATUS,
            "statement": statement,
            "detail": detail,
            "confidence": confidence,
            "provenance": provenance,
            "author_type": "system",
        }

    def _link_session_evidence(self, subject: Dict[str, Any], session: Dict[str, Any], *, subject_type: str) -> None:
        session_id = str(session.get("id") or "").strip()
        if not session_id:
            return

        statement = str(subject.get("statement") or "").strip()
        snippet = statement if len(statement) <= 240 else f"{statement[:237]}..."
        self.storage_service.save_child_memory_evidence_link(
            {
                "child_id": subject["child_id"],
                "subject_type": subject_type,
                "subject_id": subject["id"],
                "session_id": session_id,
                "evidence_kind": "session",
                "snippet": snippet,
                "metadata": {
                    "source": "post_session_analysis",
                    "session_timestamp": session.get("timestamp"),
                },
            }
        )

    def _copy_evidence_links(self, source_proposal_id: str, approved_item_id: str, child_id: str) -> None:
        links = self.storage_service.list_child_memory_evidence_links("proposal", source_proposal_id)
        for link in links:
            self.storage_service.save_child_memory_evidence_link(
                {
                    "child_id": child_id,
                    "subject_type": "item",
                    "subject_id": approved_item_id,
                    "session_id": link.get("session_id"),
                    "practice_plan_id": link.get("practice_plan_id"),
                    "evidence_kind": link.get("evidence_kind") or "session",
                    "snippet": link.get("snippet"),
                    "metadata": link.get("metadata") or {},
                }
            )

    def _normalize_statement(self, value: Any) -> str:
        return " ".join(str(value or "").strip().lower().split())

    def _adjust_confidence(self, value: float, feedback_rating: str, *, supports_positive_signal: bool) -> float:
        adjusted = value
        if feedback_rating == "up":
            adjusted += 0.08 if supports_positive_signal else -0.04
        elif feedback_rating == "down":
            adjusted += -0.08 if supports_positive_signal else 0.08
        return min(max(adjusted, 0.0), 0.98)

    def _build_feedback_detail(self, feedback_rating: str, feedback_note: str) -> Dict[str, Any]:
        if not feedback_rating and not feedback_note:
            return {}

        return {
            "therapist_feedback": {
                "rating": feedback_rating or None,
                "note": feedback_note or None,
            }
        }

    def _build_feedback_provenance(self, feedback_rating: str, feedback_note: str) -> Dict[str, Any]:
        if not feedback_rating and not feedback_note:
            return {}

        return {
            "therapist_feedback": {
                "rating": feedback_rating or None,
                "noted": bool(feedback_note),
            }
        }

    def _first_non_empty(self, *values: Any) -> str:
        for value in values:
            text = str(value or "").strip()
            if text:
                return text
        return ""

    def _coerce_number(self, value: Any) -> Optional[float]:
        try:
            if value is None or value == "":
                return None
            return float(value)
        except (TypeError, ValueError):
            return None


def cast_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}