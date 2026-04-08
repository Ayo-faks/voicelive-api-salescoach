"""Clinic-level institutional memory derived from approved evidence."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from statistics import mean
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ACTIVE_CHILD_MEMORY_STATUSES = {"approved", "active"}
REVIEWED_FEEDBACK_RATINGS = {"up", "down"}
TARGET_MEMORY_CATEGORY = "targets"
POSITIVE_CUE_CATEGORY = "effective_cues"
NEGATIVE_CUE_CATEGORY = "ineffective_cues"
INSIGHT_TYPE_STRATEGY = "strategy_insight"
INSIGHT_TYPE_PATTERN = "reviewed_pattern"
INSIGHT_TYPE_TUNING = "recommendation_tuning"
INSIGHT_STATUS_ACTIVE = "active"


class InstitutionalMemoryService:
    """Build de-identified clinic-level insights from approved child memory and reviewed outcomes."""

    def __init__(self, storage_service: Any):
        self.storage_service = storage_service

    def get_snapshot(self, owner_user_id: str, *, refresh: bool = False) -> Dict[str, Any]:
        if refresh:
            return self.rebuild_insights(owner_user_id)

        insights = self.storage_service.list_institutional_memory_insights(
            owner_user_id=owner_user_id,
            status=INSIGHT_STATUS_ACTIVE,
        )
        if not insights:
            return self.rebuild_insights(owner_user_id)

        return self._build_snapshot(insights)

    def list_insights(
        self,
        owner_user_id: str,
        *,
        refresh: bool = False,
        insight_type: Optional[str] = None,
        target_sound: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        snapshot = self.get_snapshot(owner_user_id, refresh=refresh)
        insights = list(snapshot.get("insights") or [])
        if insight_type:
            insights = [insight for insight in insights if str(insight.get("insight_type") or "") == insight_type]
        if target_sound:
            insights = [
                insight
                for insight in insights
                if str(insight.get("target_sound") or "").strip().lower() == target_sound.strip().lower()
            ]
        return insights

    def get_recommendation_snapshot(self, owner_user_id: str, target_sound: Optional[str]) -> Dict[str, Any]:
        normalized_target = str(target_sound or "").strip().lower()
        snapshot = self.get_snapshot(owner_user_id, refresh=True)
        all_insights = list(snapshot.get("insights") or [])
        relevant = [
            insight
            for insight in all_insights
            if str(insight.get("insight_type") or "") == INSIGHT_TYPE_STRATEGY
            or (normalized_target and str(insight.get("target_sound") or "").strip().lower() == normalized_target)
        ]
        relevant = relevant[:4]

        if not relevant:
            return {
                "generated_at": snapshot.get("generated_at"),
                "summary_text": "No de-identified clinic-level insight is active for this target yet.",
                "insights": [],
            }

        return {
            "generated_at": snapshot.get("generated_at"),
            "summary_text": self._build_recommendation_summary_text(normalized_target, relevant),
            "insights": relevant,
        }

    def rebuild_insights(self, owner_user_id: str) -> Dict[str, Any]:
        cue_aggregates: Dict[str, Dict[str, Any]] = {}
        target_memory_counts: Dict[str, Dict[str, Any]] = {}
        target_session_aggregates: Dict[Tuple[str, str], Dict[str, Any]] = {}
        reviewed_child_ids: set[str] = set()

        for child in self.storage_service.list_children_for_user(owner_user_id):
            child_id = str(child.get("id") or "").strip()
            if not child_id:
                continue

            approved_items = self._get_approved_memory_items(child_id)
            reviewed_sessions = self._get_reviewed_sessions(child_id)
            if reviewed_sessions:
                reviewed_child_ids.add(child_id)

            for item in approved_items:
                target_sound = self._extract_target_sound_from_memory_item(item)
                category = str(item.get("category") or "")

                if category == TARGET_MEMORY_CATEGORY and target_sound:
                    aggregate = target_memory_counts.setdefault(
                        target_sound,
                        {
                            "child_ids": set(),
                            "approved_memory_item_count": 0,
                        },
                    )
                    aggregate["child_ids"].add(child_id)
                    aggregate["approved_memory_item_count"] += 1

                cue_key = self._extract_cue_key(item)
                if cue_key and category in {POSITIVE_CUE_CATEGORY, NEGATIVE_CUE_CATEGORY}:
                    aggregate = cue_aggregates.setdefault(
                        cue_key,
                        {
                            "cue": cue_key,
                            "positive_count": 0,
                            "negative_count": 0,
                            "approved_memory_item_count": 0,
                            "child_ids": set(),
                            "target_sounds": set(),
                        },
                    )
                    aggregate["approved_memory_item_count"] += 1
                    aggregate["child_ids"].add(child_id)
                    if category == POSITIVE_CUE_CATEGORY:
                        aggregate["positive_count"] += 1
                    else:
                        aggregate["negative_count"] += 1
                    if target_sound:
                        aggregate["target_sounds"].add(target_sound)

            for session in reviewed_sessions:
                target_sound = self._extract_target_sound_from_session(session)
                exercise_type = self._extract_exercise_type_from_session(session)
                if not target_sound or not exercise_type:
                    continue

                aggregate = target_session_aggregates.setdefault(
                    (target_sound, exercise_type),
                    {
                        "target_sound": target_sound,
                        "exercise_type": exercise_type,
                        "child_ids": set(),
                        "reviewed_session_count": 0,
                        "helpful_review_count": 0,
                        "follow_up_review_count": 0,
                        "overall_scores": [],
                        "difficulty_counts": defaultdict(int),
                    },
                )
                aggregate["child_ids"].add(child_id)
                aggregate["reviewed_session_count"] += 1
                rating = self._review_rating(session)
                if rating == "up":
                    aggregate["helpful_review_count"] += 1
                elif rating == "down":
                    aggregate["follow_up_review_count"] += 1

                overall_score = self._session_overall_score(session)
                if overall_score is not None:
                    aggregate["overall_scores"].append(overall_score)

                difficulty = self._extract_difficulty_from_session(session)
                if difficulty:
                    aggregate["difficulty_counts"][difficulty] += 1

        insights = [
            *self._build_strategy_insights(cue_aggregates.values()),
            *self._build_target_insights(target_session_aggregates.values(), target_memory_counts),
        ]
        saved_insights = self.storage_service.replace_institutional_memory_insights(owner_user_id, insights)
        snapshot = self._build_snapshot(saved_insights)
        snapshot["reviewed_child_count"] = len(reviewed_child_ids)
        return snapshot

    def _get_approved_memory_items(self, child_id: str) -> List[Dict[str, Any]]:
        return [
            item
            for item in self.storage_service.list_child_memory_items(child_id)
            if str(item.get("status") or "") in ACTIVE_CHILD_MEMORY_STATUSES
        ]

    def _get_reviewed_sessions(self, child_id: str) -> List[Dict[str, Any]]:
        sessions = self.storage_service.list_sessions_for_child(child_id)
        return [session for session in sessions if self._is_reviewed_session(session)]

    def _is_reviewed_session(self, session: Dict[str, Any]) -> bool:
        therapist_feedback = session.get("therapist_feedback") or {}
        rating = str(therapist_feedback.get("rating") or "").strip().lower()
        note = str(therapist_feedback.get("note") or "").strip()
        return rating in REVIEWED_FEEDBACK_RATINGS or bool(note)

    def _build_strategy_insights(self, aggregates: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        insights: List[Dict[str, Any]] = []
        created_at = self._utc_now()
        for aggregate in aggregates:
            child_ids = set(aggregate["child_ids"])
            approved_memory_item_count = int(aggregate["approved_memory_item_count"])
            if len(child_ids) < 2 and approved_memory_item_count < 2:
                continue

            cue = str(aggregate["cue"])
            positive_count = int(aggregate["positive_count"])
            negative_count = int(aggregate["negative_count"])
            signal = "effective" if positive_count >= negative_count else "mixed"
            target_sounds = sorted(str(sound) for sound in aggregate["target_sounds"] if str(sound).strip())
            insight_id = f"institutional-cue-{self._slugify(cue)}"
            title = f"De-identified cue pattern: {cue}"
            if signal == "effective":
                summary = (
                    f"Approved memory across {len(child_ids)} children repeatedly marks {cue} as useful support. "
                    f"This remains clinic-level guidance, not a child-specific fact."
                )
            else:
                summary = (
                    f"Approved memory shows mixed cross-child signal for {cue}. "
                    f"Treat it as a low-confidence clinic pattern rather than a default child recommendation."
                )

            insights.append(
                {
                    "id": insight_id,
                    "insight_type": INSIGHT_TYPE_STRATEGY,
                    "status": INSIGHT_STATUS_ACTIVE,
                    "target_sound": None,
                    "title": title,
                    "summary": summary,
                    "detail": {
                        "cue": cue,
                        "signal": signal,
                        "effective_item_count": positive_count,
                        "ineffective_item_count": negative_count,
                        "target_sounds": target_sounds,
                    },
                    "provenance": {
                        "evidence_basis": "approved_child_memory",
                        "deidentified_child_count": len(child_ids),
                        "approved_memory_item_count": approved_memory_item_count,
                        "reviewed_session_count": 0,
                    },
                    "source_child_count": len(child_ids),
                    "source_session_count": 0,
                    "source_memory_item_count": approved_memory_item_count,
                    "created_at": created_at,
                    "updated_at": created_at,
                }
            )

        return insights

    def _build_target_insights(
        self,
        aggregates: Iterable[Dict[str, Any]],
        target_memory_counts: Dict[str, Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        insights: List[Dict[str, Any]] = []
        patterns_by_target: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        created_at = self._utc_now()

        for aggregate in aggregates:
            exercise_type = str(aggregate["exercise_type"])
            target_sound = str(aggregate["target_sound"])
            reviewed_session_count = int(aggregate["reviewed_session_count"])
            helpful_review_count = int(aggregate["helpful_review_count"])
            follow_up_review_count = int(aggregate["follow_up_review_count"])
            average_overall_score = self._safe_average(aggregate["overall_scores"])
            dominant_difficulty = self._dominant_key(aggregate["difficulty_counts"])
            helpful_review_rate = round(helpful_review_count / reviewed_session_count, 2) if reviewed_session_count else 0.0

            patterns_by_target[target_sound].append(
                {
                    "target_sound": target_sound,
                    "exercise_type": exercise_type,
                    "reviewed_session_count": reviewed_session_count,
                    "helpful_review_count": helpful_review_count,
                    "follow_up_review_count": follow_up_review_count,
                    "helpful_review_rate": helpful_review_rate,
                    "average_overall_score": average_overall_score,
                    "dominant_difficulty": dominant_difficulty,
                    "child_ids": set(aggregate["child_ids"]),
                }
            )

        for target_sound, patterns in patterns_by_target.items():
            patterns.sort(
                key=lambda pattern: (
                    float(pattern.get("helpful_review_rate") or 0),
                    float(pattern.get("average_overall_score") or 0),
                    int(pattern.get("reviewed_session_count") or 0),
                ),
                reverse=True,
            )
            if not patterns:
                continue

            target_memory = target_memory_counts.get(target_sound, {})
            supporting_child_ids = set(target_memory.get("child_ids") or set())
            for pattern in patterns:
                supporting_child_ids.update(pattern["child_ids"])

            approved_memory_item_count = int(target_memory.get("approved_memory_item_count") or 0)
            reviewed_session_count = sum(int(pattern["reviewed_session_count"]) for pattern in patterns)
            ranked_exercise_types = [str(pattern["exercise_type"]) for pattern in patterns[:3]]
            top_pattern = patterns[0]
            recommended_exercise_types = [
                str(pattern["exercise_type"])
                for pattern in patterns
                if float(pattern["helpful_review_rate"] or 0) >= 0.5
            ] or ranked_exercise_types[:1]
            recommended_exercise_types = recommended_exercise_types[:2]
            top_exercise_label = self._label_exercise_type(str(top_pattern["exercise_type"]))
            confidence_label = self._confidence_label(
                deidentified_child_count=len(supporting_child_ids),
                reviewed_session_count=reviewed_session_count,
            )

            pattern_id = f"institutional-pattern-{target_sound}"
            tuning_id = f"institutional-tuning-{target_sound}"
            pattern_summary = (
                f"Across {reviewed_session_count} reviewed sessions from {len(supporting_child_ids)} children, "
                f"{top_exercise_label} currently shows the strongest de-identified outcome pattern for /{target_sound}/."
            )
            tuning_summary = (
                f"For /{target_sound}/, clinic-level tuning favours {', '.join(self._label_exercise_type(exercise_type) for exercise_type in recommended_exercise_types)} "
                f"when child-specific approved memory and recent evidence do not conflict."
            )

            pattern_breakdown = [
                {
                    "exercise_type": pattern["exercise_type"],
                    "reviewed_session_count": pattern["reviewed_session_count"],
                    "helpful_review_count": pattern["helpful_review_count"],
                    "follow_up_review_count": pattern["follow_up_review_count"],
                    "helpful_review_rate": pattern["helpful_review_rate"],
                    "average_overall_score": pattern["average_overall_score"],
                    "dominant_difficulty": pattern["dominant_difficulty"],
                    "deidentified_child_count": len(pattern["child_ids"]),
                }
                for pattern in patterns[:3]
            ]

            insights.append(
                {
                    "id": pattern_id,
                    "insight_type": INSIGHT_TYPE_PATTERN,
                    "status": INSIGHT_STATUS_ACTIVE,
                    "target_sound": target_sound,
                    "title": f"Reviewed pattern summary for /{target_sound}/",
                    "summary": pattern_summary,
                    "detail": {
                        "target_sound": target_sound,
                        "top_exercise_type": top_pattern["exercise_type"],
                        "ranked_exercise_types": ranked_exercise_types,
                        "pattern_breakdown": pattern_breakdown,
                        "confidence_label": confidence_label,
                    },
                    "provenance": {
                        "evidence_basis": "reviewed_sessions",
                        "deidentified_child_count": len(supporting_child_ids),
                        "reviewed_session_count": reviewed_session_count,
                        "approved_memory_item_count": approved_memory_item_count,
                    },
                    "source_child_count": len(supporting_child_ids),
                    "source_session_count": reviewed_session_count,
                    "source_memory_item_count": approved_memory_item_count,
                    "created_at": created_at,
                    "updated_at": created_at,
                }
            )
            insights.append(
                {
                    "id": tuning_id,
                    "insight_type": INSIGHT_TYPE_TUNING,
                    "status": INSIGHT_STATUS_ACTIVE,
                    "target_sound": target_sound,
                    "title": f"Recommendation tuning input for /{target_sound}/",
                    "summary": tuning_summary,
                    "detail": {
                        "target_sound": target_sound,
                        "recommended_exercise_types": recommended_exercise_types,
                        "preferred_difficulty": top_pattern["dominant_difficulty"],
                        "confidence_label": confidence_label,
                        "pattern_breakdown": pattern_breakdown,
                    },
                    "provenance": {
                        "evidence_basis": "approved_child_memory_and_reviewed_sessions",
                        "deidentified_child_count": len(supporting_child_ids),
                        "reviewed_session_count": reviewed_session_count,
                        "approved_memory_item_count": approved_memory_item_count,
                    },
                    "source_child_count": len(supporting_child_ids),
                    "source_session_count": reviewed_session_count,
                    "source_memory_item_count": approved_memory_item_count,
                    "created_at": created_at,
                    "updated_at": created_at,
                }
            )

        return insights

    def _build_snapshot(self, insights: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
        generated_at = max((str(insight.get("updated_at") or "") for insight in insights), default=self._utc_now())
        reviewed_session_count = max((int(insight.get("source_session_count") or 0) for insight in insights), default=0)
        source_child_count = max((int(insight.get("source_child_count") or 0) for insight in insights), default=0)
        summary_text = (
            f"{len(insights)} active clinic-level insights derived from approved child memory and reviewed outcomes, "
            f"covering up to {source_child_count} children and {reviewed_session_count} reviewed sessions."
            if insights
            else "No clinic-level institutional insight has been compiled yet."
        )
        return {
            "generated_at": generated_at,
            "summary_text": summary_text,
            "insights": list(insights),
        }

    def _build_recommendation_summary_text(
        self,
        target_sound: str,
        insights: Sequence[Dict[str, Any]],
    ) -> str:
        deidentified_child_count = max(int((insight.get("provenance") or {}).get("deidentified_child_count") or 0) for insight in insights)
        reviewed_session_count = max(int((insight.get("provenance") or {}).get("reviewed_session_count") or 0) for insight in insights)
        if target_sound:
            return (
                f"De-identified clinic-level patterns for /{target_sound}/ are available from {deidentified_child_count} children "
                f"and {reviewed_session_count} reviewed sessions. These tune ranking only after child-specific approved memory."
            )
        return (
            f"De-identified clinic-level strategy patterns are available from {deidentified_child_count} children. "
            "These remain clinic guidance, not child facts."
        )

    def _extract_target_sound_from_memory_item(self, item: Dict[str, Any]) -> str:
        detail = item.get("detail") or {}
        for key in ("target_sound", "targetSound"):
            value = str(detail.get(key) or "").strip().lower()
            if value:
                return value

        statement = str(item.get("statement") or "")
        match = re.search(r"/([^/]+)/", statement)
        if match:
            return match.group(1).strip().lower()
        return ""

    def _extract_cue_key(self, item: Dict[str, Any]) -> str:
        detail = item.get("detail") or {}
        for key in ("cue", "strategy", "prompt_style"):
            value = str(detail.get(key) or "").strip().lower()
            if value:
                return value
        return ""

    def _extract_target_sound_from_session(self, session: Dict[str, Any]) -> str:
        metadata = session.get("exercise_metadata") or {}
        return str(metadata.get("targetSound") or metadata.get("target_sound") or "").strip().lower()

    def _extract_exercise_type_from_session(self, session: Dict[str, Any]) -> str:
        metadata = session.get("exercise_metadata") or {}
        return str(metadata.get("type") or metadata.get("exercise_type") or "").strip().lower()

    def _extract_difficulty_from_session(self, session: Dict[str, Any]) -> str:
        metadata = session.get("exercise_metadata") or {}
        return str(metadata.get("difficulty") or "").strip().lower()

    def _review_rating(self, session: Dict[str, Any]) -> str:
        therapist_feedback = session.get("therapist_feedback") or {}
        return str(therapist_feedback.get("rating") or "").strip().lower()

    def _session_overall_score(self, session: Dict[str, Any]) -> Optional[float]:
        value = session.get("overall_score")
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _safe_average(self, values: Sequence[Any]) -> Optional[float]:
        numeric_values: List[float] = []
        for value in values:
            try:
                numeric_values.append(float(value))
            except (TypeError, ValueError):
                continue
        if not numeric_values:
            return None
        return round(mean(numeric_values), 2)

    def _dominant_key(self, counts: Dict[str, int]) -> Optional[str]:
        if not counts:
            return None
        return max(counts.items(), key=lambda item: (item[1], item[0]))[0]

    def _label_exercise_type(self, exercise_type: str) -> str:
        if not exercise_type:
            return "guided practice"
        return exercise_type.replace("_", " ")

    def _confidence_label(self, *, deidentified_child_count: int, reviewed_session_count: int) -> str:
        if deidentified_child_count >= 3 and reviewed_session_count >= 4:
            return "emerging"
        if deidentified_child_count >= 2 and reviewed_session_count >= 2:
            return "limited"
        return "early"

    def _slugify(self, value: str) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
        return normalized.strip("-") or "insight"

    def _utc_now(self) -> str:
        return datetime.now(timezone.utc).isoformat()