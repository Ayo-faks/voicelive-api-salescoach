"""Deterministic therapist-facing exercise recommendations with durable provenance."""

from __future__ import annotations

import re
from statistics import mean
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, cast
from uuid import uuid4

from src.services.child_memory_service import ChildMemoryService
from src.services.institutional_memory_service import InstitutionalMemoryService


DIFFICULTY_ORDER = {"easy": 0, "medium": 1, "hard": 2}
SUPPORTIVE_TYPES = {"listening_minimal_pairs", "silent_sorting", "sound_isolation", "word_repetition"}
ADVANCED_TYPES = {"sentence_repetition", "two_word_phrase", "generalisation", "cluster_blending"}
THERAPIST_HINT_TYPES = {
    "listening": {"listening_minimal_pairs"},
    "minimal pair": {"minimal_pairs", "listening_minimal_pairs"},
    "phrase": {"sentence_repetition", "two_word_phrase", "generalisation"},
    "sentence": {"sentence_repetition", "generalisation"},
    "word": {"word_repetition", "sound_isolation"},
    "sorting": {"silent_sorting"},
    "generalisation": {"generalisation"},
}
MEMORY_RULES = (
    {
        "phrases": ("phrase", "carrier phrase", "sentence"),
        "types": {"sentence_repetition", "two_word_phrase", "generalisation"},
        "score": 6,
        "reason": "aligned with phrase-level cue history",
    },
    {
        "phrases": ("minimal pair", "contrast"),
        "types": {"minimal_pairs", "listening_minimal_pairs"},
        "score": 6,
        "reason": "aligned with contrastive practice history",
    },
    {
        "phrases": ("listen", "auditory"),
        "types": {"listening_minimal_pairs", "sound_isolation"},
        "score": 5,
        "reason": "aligned with listening-first support",
    },
    {
        "phrases": ("word", "single word"),
        "types": {"word_repetition", "sound_isolation"},
        "score": 4,
        "reason": "aligned with single-word support",
    },
    {
        "phrases": ("spoken model", "verbal model", "model once", "short verbal model"),
        "types": {"word_repetition", "guided_prompt", "sentence_repetition", "two_word_phrase"},
        "score": 4,
        "reason": "matches model-friendly exercise structure",
    },
    {
        "phrases": ("sorting",),
        "types": {"silent_sorting"},
        "score": 6,
        "reason": "aligned with sorting-based support",
    },
)


class RecommendationService:
    """Generate deterministic next-exercise recommendations and durable audit logs."""

    def __init__(
        self,
        storage_service: Any,
        scenario_manager: Any,
        child_memory_service: Optional[ChildMemoryService] = None,
        institutional_memory_service: Optional[InstitutionalMemoryService] = None,
    ):
        self.storage_service = storage_service
        self.scenario_manager = scenario_manager
        self.child_memory_service = child_memory_service or ChildMemoryService(storage_service)
        self.institutional_memory_service = institutional_memory_service or InstitutionalMemoryService(storage_service)

    def generate_recommendations(
        self,
        *,
        child_id: str,
        created_by_user_id: str,
        source_session_id: Optional[str] = None,
        target_sound: Optional[str] = None,
        therapist_constraints: Optional[str] = None,
        limit: int = 5,
    ) -> Dict[str, Any]:
        recent_session_summaries = self.storage_service.list_sessions_for_child(child_id)
        if not recent_session_summaries:
            raise ValueError("At least one saved session is required before recommendations can be generated")

        recent_sessions = self._load_recent_sessions(recent_session_summaries, limit=6)
        source_session = self._resolve_source_session(source_session_id, recent_sessions)
        active_memory_items = self.child_memory_service.get_active_child_memory(child_id)
        if not active_memory_items:
            raise ValueError("Approved child memory is required before recommendations can be generated")

        parsed_constraints = self._parse_therapist_constraints(therapist_constraints)
        current_target_sound = self._resolve_target_sound(target_sound, source_session, active_memory_items)
        if not current_target_sound:
            raise ValueError("A target sound could not be determined for recommendation ranking")

        ranking_inputs = self._build_ranking_inputs(
            child_id=child_id,
            created_by_user_id=created_by_user_id,
            current_target_sound=current_target_sound,
            source_session=source_session,
            recent_sessions=recent_sessions,
            active_memory_items=active_memory_items,
            therapist_constraints=therapist_constraints,
            parsed_constraints=parsed_constraints,
        )
        ranked_candidates = self._rank_candidates(ranking_inputs, limit=limit)
        if not ranked_candidates:
            raise ValueError(f"No matching exercises were found for target sound '{current_target_sound}'")

        top_candidate = ranked_candidates[0]
        log_id = f"recommendation-log-{uuid4().hex[:12]}"
        self.storage_service.save_recommendation_log(
            {
                "id": log_id,
                "child_id": child_id,
                "source_session_id": source_session.get("id") if source_session else None,
                "target_sound": current_target_sound,
                "therapist_constraints": {
                    "note": therapist_constraints or "",
                    "parsed": parsed_constraints,
                },
                "ranking_context": ranking_inputs["snapshot"],
                "rationale": str((top_candidate.get("explanation") or {}).get("why_recommended") or top_candidate["rationale"]),
                "created_by_user_id": created_by_user_id,
                "candidate_count": len(ranked_candidates),
                "top_recommendation_score": top_candidate.get("score"),
            }
        )
        self.storage_service.replace_recommendation_candidates(log_id, ranked_candidates)
        return self.get_recommendation_detail(log_id)

    def list_recommendation_history(self, child_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        logs = self.storage_service.list_recommendation_logs_for_child(child_id, limit=limit)
        history: List[Dict[str, Any]] = []
        for log in logs:
            candidates = self.storage_service.list_recommendation_candidates(str(log.get("id") or ""))
            top_candidate = candidates[0] if candidates else None
            history.append(
                {
                    **log,
                    "top_recommendation": self._summarize_candidate(top_candidate) if top_candidate else None,
                }
            )
        return history

    def get_recommendation_detail(self, recommendation_id: str) -> Dict[str, Any]:
        log = self.storage_service.get_recommendation_log(recommendation_id)
        if log is None:
            raise ValueError("Recommendation log not found")

        candidates = self.storage_service.list_recommendation_candidates(recommendation_id)
        hydrated_candidates = [self._hydrate_candidate(candidate) for candidate in candidates]
        return {
            **log,
            "candidates": hydrated_candidates,
            "top_recommendation": self._summarize_candidate(hydrated_candidates[0]) if hydrated_candidates else None,
        }

    def _load_recent_sessions(self, session_summaries: Sequence[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
        sessions: List[Dict[str, Any]] = []
        for summary in session_summaries[:limit]:
            session_id = str(summary.get("id") or "").strip()
            if not session_id:
                continue
            detail = self.storage_service.get_session(session_id)
            if detail is not None:
                sessions.append(detail)
        return sessions

    def _resolve_source_session(
        self,
        source_session_id: Optional[str],
        recent_sessions: Sequence[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        if source_session_id:
            session = self.storage_service.get_session(source_session_id)
            if session is None:
                raise ValueError("Source session not found")
            return session
        return recent_sessions[0] if recent_sessions else None

    def _resolve_target_sound(
        self,
        requested_target_sound: Optional[str],
        source_session: Optional[Dict[str, Any]],
        active_memory_items: Sequence[Dict[str, Any]],
    ) -> str:
        if requested_target_sound and requested_target_sound.strip():
            return requested_target_sound.strip().lower()

        if source_session is not None:
            metadata = source_session.get("exercise_metadata") or {}
            target_sound = str(metadata.get("targetSound") or metadata.get("target_sound") or "").strip().lower()
            if target_sound:
                return target_sound

        for item in active_memory_items:
            if str(item.get("category") or "") != "targets":
                continue
            detail = cast(Dict[str, Any], item.get("detail") or {})
            target_sound = str(detail.get("target_sound") or detail.get("targetSound") or "").strip().lower()
            if target_sound:
                return target_sound
            statement = str(item.get("statement") or "")
            match = re.search(r"/([^/]+)/", statement)
            if match:
                return match.group(1).strip().lower()

        return ""

    def _build_ranking_inputs(
        self,
        *,
        child_id: str,
        created_by_user_id: str,
        current_target_sound: str,
        source_session: Optional[Dict[str, Any]],
        recent_sessions: Sequence[Dict[str, Any]],
        active_memory_items: Sequence[Dict[str, Any]],
        therapist_constraints: Optional[str],
        parsed_constraints: Dict[str, Any],
    ) -> Dict[str, Any]:
        grouped_memory = self._group_memory_items(active_memory_items)
        source_metadata = cast(Dict[str, Any], (source_session or {}).get("exercise_metadata") or {})
        current_difficulty = str(source_metadata.get("difficulty") or "").strip().lower() or "medium"
        target_sessions = [
            session for session in recent_sessions if self._session_target_sound(session) == current_target_sound
        ]
        engagement_scores = [
            score
            for score in [self._session_willingness_to_retry(session) for session in recent_sessions]
            if score is not None
        ]
        target_accuracy_scores = [
            score for score in [self._session_accuracy_score(session) for session in target_sessions] if score is not None
        ]
        recent_outcomes = [self._summarize_recent_session(session) for session in recent_sessions]
        desired_difficulty, difficulty_note = self._derive_desired_difficulty(
            current_difficulty=current_difficulty,
            engagement_scores=engagement_scores,
            target_accuracy_scores=target_accuracy_scores,
            parsed_constraints=parsed_constraints,
        )
        effective_cues = [self._summarize_memory_item(item) for item in grouped_memory["effective_cues"]]
        institutional_memory = self.institutional_memory_service.get_recommendation_snapshot(
            created_by_user_id,
            current_target_sound,
        )

        return {
            "child_id": child_id,
            "current_target_sound": current_target_sound,
            "desired_difficulty": desired_difficulty,
            "current_difficulty": current_difficulty,
            "difficulty_note": difficulty_note,
            "recent_sessions": list(recent_sessions),
            "target_sessions": target_sessions,
            "memory_items": list(active_memory_items),
            "grouped_memory": grouped_memory,
            "institutional_memory": institutional_memory,
            "parsed_constraints": parsed_constraints,
            "snapshot": {
                "current_target_sound": current_target_sound,
                "approved_effective_cues": effective_cues,
                "institutional_memory": institutional_memory,
                "recent_engagement_trends": {
                    "average_willingness_to_retry": round(mean(engagement_scores), 2) if engagement_scores else None,
                    "trend": self._describe_numeric_trend(engagement_scores),
                    "supporting_session_ids": [session["id"] for session in recent_sessions if session.get("id")],
                },
                "recent_exercise_outcomes": recent_outcomes,
                "difficulty_progression": {
                    "current_difficulty": current_difficulty,
                    "desired_difficulty": desired_difficulty,
                    "reason": difficulty_note,
                    "supporting_session_ids": [session["id"] for session in target_sessions if session.get("id")],
                },
                "therapist_constraints": {
                    "note": therapist_constraints or "",
                    "parsed": parsed_constraints,
                },
                "approved_memory_item_ids": [str(item.get("id")) for item in active_memory_items if item.get("id")],
            },
        }

    def _rank_candidates(self, ranking_inputs: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
        current_target_sound = str(ranking_inputs["current_target_sound"])
        desired_difficulty = str(ranking_inputs["desired_difficulty"])
        grouped_memory = cast(Dict[str, List[Dict[str, Any]]], ranking_inputs["grouped_memory"])
        institutional_memory = cast(Dict[str, Any], ranking_inputs.get("institutional_memory") or {})
        parsed_constraints = cast(Dict[str, Any], ranking_inputs["parsed_constraints"])
        recent_sessions = cast(List[Dict[str, Any]], ranking_inputs["recent_sessions"])
        target_sessions = cast(List[Dict[str, Any]], ranking_inputs["target_sessions"])
        candidates: List[Dict[str, Any]] = []

        for scenario in self.scenario_manager.list_scenarios():
            metadata = cast(Dict[str, Any], scenario.get("exerciseMetadata") or {})
            target_sound = str(metadata.get("targetSound") or metadata.get("target_sound") or "").strip().lower()
            if current_target_sound and target_sound != current_target_sound:
                continue

            factors: Dict[str, Dict[str, Any]] = {}
            support_memory_item_ids: List[str] = []
            support_session_ids: List[str] = []

            target_factor = self._make_factor(
                score=40,
                reason=f"matches the active /{current_target_sound}/ target",
                supporting_memory_item_ids=[
                    str(item.get("id"))
                    for item in grouped_memory["targets"]
                    if str((item.get("detail") or {}).get("target_sound") or "").strip().lower() == current_target_sound
                    or f"/{current_target_sound}/" in str(item.get("statement") or "")
                ],
                supporting_session_ids=[str(session.get("id")) for session in target_sessions if session.get("id")],
            )
            factors["target_sound_match"] = target_factor
            self._extend_support_lists(support_memory_item_ids, support_session_ids, target_factor)

            difficulty_factor = self._score_difficulty_progression(
                metadata=metadata,
                desired_difficulty=desired_difficulty,
                current_difficulty=str(ranking_inputs["current_difficulty"]),
                target_sessions=target_sessions,
                note=str(ranking_inputs["difficulty_note"]),
            )
            factors["difficulty_progression"] = difficulty_factor
            self._extend_support_lists(support_memory_item_ids, support_session_ids, difficulty_factor)

            engagement_factor = self._score_engagement_fit(metadata, recent_sessions)
            factors["recent_engagement"] = engagement_factor
            self._extend_support_lists(support_memory_item_ids, support_session_ids, engagement_factor)

            outcome_factor = self._score_recent_outcomes(scenario, recent_sessions)
            factors["recent_exercise_outcomes"] = outcome_factor
            self._extend_support_lists(support_memory_item_ids, support_session_ids, outcome_factor)

            cue_factor = self._score_memory_alignment(
                scenario=scenario,
                effective_items=grouped_memory["effective_cues"],
                ineffective_items=grouped_memory["ineffective_cues"] + grouped_memory["blockers"],
            )
            factors["cue_compatibility"] = cue_factor
            self._extend_support_lists(support_memory_item_ids, support_session_ids, cue_factor)

            constraints_factor = self._score_therapist_constraints(metadata, parsed_constraints, grouped_memory)
            factors["therapist_constraints"] = constraints_factor
            self._extend_support_lists(support_memory_item_ids, support_session_ids, constraints_factor)

            institutional_factor = self._score_institutional_alignment(
                metadata=metadata,
                institutional_memory=institutional_memory,
            )
            factors["institutional_alignment"] = institutional_factor

            score = sum(int(cast(Dict[str, Any], factor).get("score") or 0) for factor in factors.values())
            explanation = self._build_candidate_explanation(
                scenario=scenario,
                score=score,
                factors=factors,
                grouped_memory=grouped_memory,
                institutional_memory=institutional_memory,
                support_memory_item_ids=support_memory_item_ids,
                support_session_ids=support_session_ids,
                desired_difficulty=desired_difficulty,
            )
            candidates.append(
                {
                    "id": f"recommendation-candidate-{uuid4().hex[:12]}",
                    "rank": 0,
                    "exercise_id": str(scenario.get("id") or "custom-guided-practice"),
                    "exercise_name": str(scenario.get("name") or "Guided practice"),
                    "exercise_description": str(scenario.get("description") or ""),
                    "exercise_metadata": metadata,
                    "score": score,
                    "ranking_factors": factors,
                    "rationale": self._build_rationale_text(factors),
                    "explanation": explanation,
                    "supporting_memory_item_ids": sorted(set(support_memory_item_ids)),
                    "supporting_session_ids": sorted(set(support_session_ids)),
                }
            )

        candidates.sort(
            key=lambda item: (
                -int(item.get("score") or 0),
                str(item.get("exercise_name") or "").lower(),
                str(item.get("exercise_id") or "").lower(),
            )
        )
        for index, candidate in enumerate(candidates[:limit], start=1):
            candidate["rank"] = index
        return candidates[:limit]

    def _score_difficulty_progression(
        self,
        *,
        metadata: Dict[str, Any],
        desired_difficulty: str,
        current_difficulty: str,
        target_sessions: Sequence[Dict[str, Any]],
        note: str,
    ) -> Dict[str, Any]:
        candidate_difficulty = str(metadata.get("difficulty") or "").strip().lower() or "medium"
        score = 0
        if candidate_difficulty == desired_difficulty:
            score = 16
        elif abs(DIFFICULTY_ORDER.get(candidate_difficulty, 1) - DIFFICULTY_ORDER.get(desired_difficulty, 1)) == 1:
            score = 9
        else:
            score = 2
        return self._make_factor(
            score=score,
            reason=f"{note}; candidate difficulty is {candidate_difficulty or current_difficulty}",
            supporting_session_ids=[str(session.get("id")) for session in target_sessions if session.get("id")],
        )

    def _score_engagement_fit(
        self,
        metadata: Dict[str, Any],
        recent_sessions: Sequence[Dict[str, Any]],
    ) -> Dict[str, Any]:
        engagement_scores = [
            score
            for score in [self._session_willingness_to_retry(session) for session in recent_sessions]
            if score is not None
        ]
        if not engagement_scores:
            return self._make_factor(score=4, reason="recent engagement data is limited")

        avg_engagement = mean(engagement_scores)
        exercise_type = str(metadata.get("type") or "").strip().lower()
        score = 0
        reason = ""
        if avg_engagement < 5:
            if exercise_type in SUPPORTIVE_TYPES:
                score = 10
                reason = "recent willingness to retry is low, so a more supportive exercise format is favoured"
            elif exercise_type in ADVANCED_TYPES:
                score = -4
                reason = "recent willingness to retry is low, so this more demanding format is deprioritised"
            else:
                score = 3
                reason = "recent willingness to retry is low and this format is neutral"
        elif avg_engagement >= 7:
            if exercise_type in ADVANCED_TYPES:
                score = 8
                reason = "recent willingness to retry is strong, so a more demanding format is supported"
            else:
                score = 5
                reason = "recent willingness to retry is strong"
        else:
            score = 5
            reason = "recent willingness to retry is steady"

        return self._make_factor(
            score=score,
            reason=reason,
            supporting_session_ids=[str(session.get("id")) for session in recent_sessions if session.get("id")],
        )

    def _score_recent_outcomes(
        self,
        scenario: Dict[str, Any],
        recent_sessions: Sequence[Dict[str, Any]],
    ) -> Dict[str, Any]:
        exercise_id = str(scenario.get("id") or "")
        same_exercise_sessions = [
            session for session in recent_sessions if str((session.get("exercise") or {}).get("id") or "") == exercise_id
        ]
        if not same_exercise_sessions:
            most_recent = recent_sessions[0] if recent_sessions else None
            same_type_recent = None
            candidate_type = str((scenario.get("exerciseMetadata") or {}).get("type") or "").strip().lower()
            for session in recent_sessions:
                session_type = str(((session.get("exercise_metadata") or {}).get("type") or "")).strip().lower()
                if session_type and session_type == candidate_type:
                    same_type_recent = session
                    break
            if same_type_recent is not None:
                accuracy = self._session_accuracy_score(same_type_recent)
                score = 6 if accuracy is None or accuracy >= 70 else -2
                reason = "recent outcomes support this exercise family" if score >= 0 else "recent outcomes suggest rotating away from this exercise family"
                return self._make_factor(score=score, reason=reason, supporting_session_ids=[str(same_type_recent.get("id"))])
            if most_recent is not None:
                return self._make_factor(score=4, reason="introduces a fresh exercise while staying on the active target")
            return self._make_factor(score=4, reason="recent outcome data is limited")

        accuracies = [score for score in [self._session_accuracy_score(session) for session in same_exercise_sessions] if score is not None]
        avg_accuracy = mean(accuracies) if accuracies else None
        if avg_accuracy is None:
            score = 4
            reason = "this exercise has been used before, but outcome detail is limited"
        elif avg_accuracy >= 75:
            score = 8
            reason = "recent outcomes on this exercise were positive enough to justify continuing it"
        elif avg_accuracy < 65:
            score = -6
            reason = "recent outcomes on this exercise were weaker, so immediate repetition is deprioritised"
        else:
            score = 3
            reason = "recent outcomes on this exercise were mixed"

        return self._make_factor(
            score=score,
            reason=reason,
            supporting_session_ids=[str(session.get("id")) for session in same_exercise_sessions if session.get("id")],
        )

    def _score_memory_alignment(
        self,
        *,
        scenario: Dict[str, Any],
        effective_items: Sequence[Dict[str, Any]],
        ineffective_items: Sequence[Dict[str, Any]],
    ) -> Dict[str, Any]:
        scenario_text = self._scenario_match_text(scenario)
        scenario_type = str((scenario.get("exerciseMetadata") or {}).get("type") or "").strip().lower()
        score = 0
        reasons: List[str] = []
        support_memory_ids: List[str] = []
        support_session_ids: List[str] = []

        for item in effective_items:
            item_score, item_reason = self._memory_rule_score(item, scenario_text, scenario_type)
            if item_score <= 0:
                continue
            score += item_score
            reasons.append(item_reason)
            if item.get("id"):
                support_memory_ids.append(str(item["id"]))
            support_session_ids.extend(self._memory_evidence_session_ids(item))

        for item in ineffective_items:
            item_score, item_reason = self._memory_rule_score(item, scenario_text, scenario_type)
            if item_score <= 0:
                continue
            score -= item_score
            reasons.append(f"penalised because {item_reason}")
            if item.get("id"):
                support_memory_ids.append(str(item["id"]))
            support_session_ids.extend(self._memory_evidence_session_ids(item))

        if not reasons:
            return self._make_factor(score=0, reason="no approved cue memory matched this exercise")

        return self._make_factor(
            score=score,
            reason="; ".join(reasons[:3]),
            supporting_memory_item_ids=support_memory_ids,
            supporting_session_ids=support_session_ids,
        )

    def _score_therapist_constraints(
        self,
        metadata: Dict[str, Any],
        parsed_constraints: Dict[str, Any],
        grouped_memory: Dict[str, List[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        scenario_type = str(metadata.get("type") or "").strip().lower()
        candidate_difficulty = str(metadata.get("difficulty") or "").strip().lower() or "medium"
        score = 0
        reasons: List[str] = []
        memory_ids = [str(item.get("id")) for item in grouped_memory["constraints"] if item.get("id")]
        memory_ids.extend(str(item.get("id")) for item in grouped_memory["preferences"] if item.get("id"))
        memory_ids.extend(str(item.get("id")) for item in grouped_memory["blockers"] if item.get("id"))
        supporting_session_ids: List[str] = []
        for item in grouped_memory["constraints"] + grouped_memory["preferences"] + grouped_memory["blockers"]:
            supporting_session_ids.extend(self._memory_evidence_session_ids(item))

        difficulty_hint = str(parsed_constraints.get("difficulty") or "")
        if difficulty_hint:
            if candidate_difficulty == difficulty_hint:
                score += 6
                reasons.append(f"matches the therapist's {difficulty_hint} difficulty request")
            else:
                score -= 3
                reasons.append(f"does not match the therapist's {difficulty_hint} difficulty request")

        preferred_types = cast(List[str], parsed_constraints.get("preferred_types") or [])
        avoided_types = cast(List[str], parsed_constraints.get("avoided_types") or [])
        if scenario_type in preferred_types:
            score += 6
            reasons.append("matches the therapist's requested exercise format")
        if scenario_type in avoided_types:
            score -= 8
            reasons.append("conflicts with the therapist's avoid instruction")

        if parsed_constraints.get("short"):
            if candidate_difficulty == "hard":
                score -= 2
                reasons.append("hard tasks are less aligned with a short session request")
            else:
                score += 2
                reasons.append("fits a shorter session request")

        if parsed_constraints.get("playful") and scenario_type in {"guided_prompt", "listening_minimal_pairs", "silent_sorting"}:
            score += 2
            reasons.append("fits a more playful session tone")

        if not reasons and not memory_ids:
            return self._make_factor(score=0, reason="no explicit therapist constraints changed ranking")

        return self._make_factor(
            score=score,
            reason="; ".join(reasons[:3]) or "approved constraints and preferences were considered",
            supporting_memory_item_ids=memory_ids,
            supporting_session_ids=supporting_session_ids,
        )

    def _score_institutional_alignment(
        self,
        *,
        metadata: Dict[str, Any],
        institutional_memory: Dict[str, Any],
    ) -> Dict[str, Any]:
        scenario_type = str(metadata.get("type") or "").strip().lower()
        if not scenario_type:
            return self._make_factor(score=0, reason="no clinic-level exercise pattern matched this candidate")

        for insight in cast(List[Dict[str, Any]], institutional_memory.get("insights") or []):
            if str(insight.get("insight_type") or "") != "recommendation_tuning":
                continue

            detail = cast(Dict[str, Any], insight.get("detail") or {})
            recommended_types = [
                str(exercise_type).strip().lower()
                for exercise_type in cast(List[str], detail.get("recommended_exercise_types") or [])
                if str(exercise_type).strip()
            ]
            if scenario_type not in recommended_types:
                continue

            provenance = cast(Dict[str, Any], insight.get("provenance") or {})
            child_count = int(provenance.get("deidentified_child_count") or 0)
            reviewed_sessions = int(provenance.get("reviewed_session_count") or 0)
            return self._make_factor(
                score=4,
                reason=(
                    f"aligned with de-identified clinic-level reviewed patterns across {child_count} children "
                    f"and {reviewed_sessions} reviewed sessions"
                ),
            )

        return self._make_factor(score=0, reason="no clinic-level exercise pattern matched this candidate")

    def _build_candidate_explanation(
        self,
        *,
        scenario: Dict[str, Any],
        score: int,
        factors: Dict[str, Dict[str, Any]],
        grouped_memory: Dict[str, List[Dict[str, Any]]],
        institutional_memory: Dict[str, Any],
        support_memory_item_ids: Sequence[str],
        support_session_ids: Sequence[str],
        desired_difficulty: str,
    ) -> Dict[str, Any]:
        supporting_memory_items = self._select_memory_items(grouped_memory, support_memory_item_ids)
        supporting_sessions = self._select_sessions(support_session_ids)
        institutional_insights = self._select_institutional_insights(scenario, institutional_memory)
        top_positive_reasons = [
            factor["reason"]
            for factor in factors.values()
            if int(factor.get("score") or 0) > 0 and str(factor.get("reason") or "").strip()
        ][:3]
        caution_reasons = [
            factor["reason"]
            for factor in factors.values()
            if int(factor.get("score") or 0) < 0 and str(factor.get("reason") or "").strip()
        ][:2]
        why_recommended = "; ".join(top_positive_reasons) or "it best fit the approved memory and recent evidence"
        comparison = (
            f"This recommendation stays aligned with {len(supporting_memory_items)} approved memory item"
            f"{'s' if len(supporting_memory_items) != 1 else ''} and aims for {desired_difficulty} difficulty work."
        )
        if institutional_insights:
            comparison = (
                f"{comparison} A separate de-identified clinic-level pattern also supported this format without becoming child memory."
            )
        evidence_shift = (
            f"If the next sessions show lower engagement or weaker accuracy on {scenario.get('name')}, re-rank toward a simpler format; "
            f"if accuracy stays high, consider moving beyond {desired_difficulty} work."
        )
        if caution_reasons:
            evidence_shift = f"Watch for these signals: {'; '.join(caution_reasons)}. {evidence_shift}"

        return {
            "why_recommended": why_recommended,
            "comparison_to_approved_memory": comparison,
            "evidence_that_could_change_recommendation": evidence_shift,
            "supporting_memory_items": supporting_memory_items,
            "supporting_sessions": supporting_sessions,
            "institutional_insights": institutional_insights,
            "score_summary": f"Deterministic score {score}",
        }

    def _build_rationale_text(self, factors: Dict[str, Dict[str, Any]]) -> str:
        ordered_keys = [
            "target_sound_match",
            "difficulty_progression",
            "recent_engagement",
            "recent_exercise_outcomes",
            "cue_compatibility",
            "therapist_constraints",
            "institutional_alignment",
        ]
        reasons = [
            str(factors[key].get("reason") or "").strip()
            for key in ordered_keys
            if key in factors and int(factors[key].get("score") or 0) > 0 and str(factors[key].get("reason") or "").strip()
        ]
        return "; ".join(reasons[:3]) or "Ranked from approved memory and recent session evidence."

    def _hydrate_candidate(self, candidate: Dict[str, Any]) -> Dict[str, Any]:
        explanation = cast(Dict[str, Any], candidate.get("explanation") or {})
        if not explanation.get("supporting_memory_items"):
            explanation["supporting_memory_items"] = self._select_memory_items(
                self._group_memory_items(self.child_memory_service.get_active_child_memory(str(candidate.get("child_id") or ""))),
                cast(List[str], candidate.get("supporting_memory_item_ids") or []),
            )
        if not explanation.get("supporting_sessions"):
            explanation["supporting_sessions"] = self._select_sessions(
                cast(List[str], candidate.get("supporting_session_ids") or [])
            )
        return {**candidate, "explanation": explanation}

    def _summarize_candidate(self, candidate: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if candidate is None:
            return None
        return {
            "rank": candidate.get("rank"),
            "exercise_id": candidate.get("exercise_id"),
            "exercise_name": candidate.get("exercise_name"),
            "score": candidate.get("score"),
            "rationale": candidate.get("rationale"),
        }

    def _group_memory_items(self, items: Iterable[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        grouped: Dict[str, List[Dict[str, Any]]] = {
            "targets": [],
            "effective_cues": [],
            "ineffective_cues": [],
            "preferences": [],
            "constraints": [],
            "blockers": [],
            "general": [],
        }
        for item in items:
            category = str(item.get("category") or "general")
            grouped.setdefault(category, grouped["general"]).append(item)
        return grouped

    def _derive_desired_difficulty(
        self,
        *,
        current_difficulty: str,
        engagement_scores: Sequence[float],
        target_accuracy_scores: Sequence[float],
        parsed_constraints: Dict[str, Any],
    ) -> Tuple[str, str]:
        requested = str(parsed_constraints.get("difficulty") or "")
        if requested in DIFFICULTY_ORDER:
            return requested, f"therapist explicitly requested {requested} difficulty"

        avg_accuracy = mean(target_accuracy_scores) if target_accuracy_scores else None
        avg_engagement = mean(engagement_scores) if engagement_scores else None
        current_index = DIFFICULTY_ORDER.get(current_difficulty or "medium", 1)
        desired_index = current_index
        note = "recent performance supports holding the current difficulty"

        if avg_accuracy is not None and avg_accuracy >= 80 and (avg_engagement is None or avg_engagement >= 7):
            desired_index = min(2, current_index + 1)
            note = "recent target-sound accuracy and engagement support progressing difficulty"
        elif avg_accuracy is not None and avg_accuracy < 65:
            desired_index = max(0, current_index - 1)
            note = "recent target-sound accuracy suggests stepping difficulty back"
        elif avg_engagement is not None and avg_engagement < 5:
            desired_index = max(0, current_index - 1)
            note = "recent engagement suggests a more supportive difficulty"

        return self._difficulty_name(desired_index), note

    def _describe_numeric_trend(self, values: Sequence[float]) -> str:
        if len(values) < 2:
            return "limited"
        midpoint = max(1, len(values) // 2)
        early = mean(values[:midpoint])
        recent = mean(values[midpoint:])
        delta = recent - early
        if delta >= 0.75:
            return "improving"
        if delta <= -0.75:
            return "declining"
        return "steady"

    def _select_memory_items(
        self,
        grouped_memory: Dict[str, List[Dict[str, Any]]],
        memory_ids: Sequence[str],
    ) -> List[Dict[str, Any]]:
        wanted_ids = set(memory_ids)
        selected: List[Dict[str, Any]] = []
        for items in grouped_memory.values():
            for item in items:
                item_id = str(item.get("id") or "")
                if item_id and item_id in wanted_ids:
                    selected.append(self._summarize_memory_item(item))
        return selected

    def _select_sessions(self, session_ids: Sequence[str]) -> List[Dict[str, Any]]:
        seen: set[str] = set()
        result: List[Dict[str, Any]] = []
        for session_id in session_ids:
            if not session_id or session_id in seen:
                continue
            seen.add(session_id)
            session = self.storage_service.get_session(session_id)
            if session is None:
                continue
            exercise = cast(Dict[str, Any], session.get("exercise") or {})
            result.append(
                {
                    "id": session.get("id"),
                    "timestamp": session.get("timestamp"),
                    "exercise_name": exercise.get("name"),
                    "overall_score": self._session_overall_score(session),
                    "accuracy_score": self._session_accuracy_score(session),
                }
            )
        return result

    def _select_institutional_insights(
        self,
        scenario: Dict[str, Any],
        institutional_memory: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        scenario_type = str((scenario.get("exerciseMetadata") or {}).get("type") or "").strip().lower()
        selected: List[Dict[str, Any]] = []
        for insight in cast(List[Dict[str, Any]], institutional_memory.get("insights") or []):
            insight_type = str(insight.get("insight_type") or "")
            if insight_type == "strategy_insight":
                selected.append(insight)
                continue

            detail = cast(Dict[str, Any], insight.get("detail") or {})
            recommended_types = [
                str(exercise_type).strip().lower()
                for exercise_type in cast(List[str], detail.get("recommended_exercise_types") or [])
                if str(exercise_type).strip()
            ]
            if scenario_type and scenario_type in recommended_types:
                selected.append(insight)

        return selected[:3]

    def _parse_therapist_constraints(self, note: Optional[str]) -> Dict[str, Any]:
        text = str(note or "").strip().lower()
        parsed: Dict[str, Any] = {
            "difficulty": "",
            "preferred_types": [],
            "avoided_types": [],
            "short": "short" in text or "brief" in text,
            "playful": "playful" in text or "fun" in text,
        }
        for difficulty in DIFFICULTY_ORDER:
            if difficulty in text:
                parsed["difficulty"] = difficulty
                break
        for phrase, types in THERAPIST_HINT_TYPES.items():
            if f"avoid {phrase}" in text or f"no {phrase}" in text:
                parsed["avoided_types"].extend(sorted(types))
            elif phrase in text:
                parsed["preferred_types"].extend(sorted(types))
        parsed["preferred_types"] = sorted(set(cast(List[str], parsed["preferred_types"])))
        parsed["avoided_types"] = sorted(set(cast(List[str], parsed["avoided_types"])))
        return parsed

    def _memory_rule_score(self, item: Dict[str, Any], scenario_text: str, scenario_type: str) -> Tuple[int, str]:
        item_text = self._memory_match_text(item)
        for rule in MEMORY_RULES:
            phrases = cast(Sequence[str], rule["phrases"])
            if not any(phrase in item_text for phrase in phrases):
                continue
            if scenario_type in cast(set[str], rule["types"]) or any(phrase in scenario_text for phrase in phrases):
                return int(rule["score"]), str(rule["reason"])

        keywords = [token for token in re.findall(r"[a-z]{4,}", item_text) if token not in {"child", "sound", "target", "needs", "with", "when"}]
        if any(keyword in scenario_text for keyword in keywords[:4]):
            return 4, "matched cue wording carried by the scenario description"
        return 0, ""

    def _memory_match_text(self, item: Dict[str, Any]) -> str:
        detail = cast(Dict[str, Any], item.get("detail") or {})
        detail_text = " ".join(str(value) for value in detail.values())
        return f"{str(item.get('statement') or '')} {detail_text}".strip().lower()

    def _scenario_match_text(self, scenario: Dict[str, Any]) -> str:
        metadata = cast(Dict[str, Any], scenario.get("exerciseMetadata") or {})
        words = metadata.get("targetWords") or metadata.get("target_words") or []
        parts = [
            str(scenario.get("name") or ""),
            str(scenario.get("description") or ""),
            str(metadata.get("type") or ""),
            " ".join(str(word) for word in words if str(word).strip()),
        ]
        return " ".join(parts).strip().lower()

    def _memory_evidence_session_ids(self, item: Dict[str, Any]) -> List[str]:
        session_ids = {
            str(session_id)
            for session_id in cast(List[str], cast(Dict[str, Any], item.get("provenance") or {}).get("session_ids") or [])
            if str(session_id).strip()
        }
        item_id = str(item.get("id") or "").strip()
        if item_id:
            for link in self.storage_service.list_child_memory_evidence_links("item", item_id):
                session_id = str(link.get("session_id") or "").strip()
                if session_id:
                    session_ids.add(session_id)
        return sorted(session_ids)

    def _summarize_memory_item(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": item.get("id"),
            "category": item.get("category"),
            "memory_type": item.get("memory_type"),
            "statement": item.get("statement"),
            "confidence": item.get("confidence"),
            "updated_at": item.get("updated_at"),
            "detail": item.get("detail") or {},
            "supporting_session_ids": self._memory_evidence_session_ids(item),
        }

    def _summarize_recent_session(self, session: Dict[str, Any]) -> Dict[str, Any]:
        metadata = cast(Dict[str, Any], session.get("exercise_metadata") or {})
        exercise = cast(Dict[str, Any], session.get("exercise") or {})
        return {
            "session_id": session.get("id"),
            "timestamp": session.get("timestamp"),
            "exercise_id": exercise.get("id"),
            "exercise_name": exercise.get("name"),
            "target_sound": metadata.get("targetSound") or metadata.get("target_sound"),
            "difficulty": metadata.get("difficulty"),
            "overall_score": self._session_overall_score(session),
            "accuracy_score": self._session_accuracy_score(session),
            "willingness_to_retry": self._session_willingness_to_retry(session),
            "therapist_feedback_rating": cast(Dict[str, Any], session.get("therapist_feedback") or {}).get("rating"),
        }

    def _session_target_sound(self, session: Dict[str, Any]) -> str:
        metadata = cast(Dict[str, Any], session.get("exercise_metadata") or {})
        return str(metadata.get("targetSound") or metadata.get("target_sound") or "").strip().lower()

    def _session_accuracy_score(self, session: Dict[str, Any]) -> Optional[float]:
        assessment = cast(Dict[str, Any], session.get("assessment") or {})
        pronunciation = cast(Dict[str, Any], assessment.get("pronunciation_assessment") or {})
        value = pronunciation.get("accuracy_score")
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _session_overall_score(self, session: Dict[str, Any]) -> Optional[float]:
        assessment = cast(Dict[str, Any], session.get("assessment") or {})
        ai_assessment = cast(Dict[str, Any], assessment.get("ai_assessment") or {})
        value = ai_assessment.get("overall_score")
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _session_willingness_to_retry(self, session: Dict[str, Any]) -> Optional[float]:
        assessment = cast(Dict[str, Any], session.get("assessment") or {})
        ai_assessment = cast(Dict[str, Any], assessment.get("ai_assessment") or {})
        engagement = cast(Dict[str, Any], ai_assessment.get("engagement_and_effort") or {})
        value = engagement.get("willingness_to_retry")
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _difficulty_name(self, index: int) -> str:
        for name, value in DIFFICULTY_ORDER.items():
            if value == index:
                return name
        return "medium"

    def _make_factor(
        self,
        *,
        score: int,
        reason: str,
        supporting_memory_item_ids: Optional[Sequence[str]] = None,
        supporting_session_ids: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        return {
            "score": score,
            "reason": reason,
            "supporting_memory_item_ids": sorted(set(str(item_id) for item_id in supporting_memory_item_ids or [] if item_id)),
            "supporting_session_ids": sorted(set(str(session_id) for session_id in supporting_session_ids or [] if session_id)),
        }

    def _extend_support_lists(
        self,
        memory_ids: List[str],
        session_ids: List[str],
        factor: Dict[str, Any],
    ) -> None:
        memory_ids.extend(cast(List[str], factor.get("supporting_memory_item_ids") or []))
        session_ids.extend(cast(List[str], factor.get("supporting_session_ids") or []))
