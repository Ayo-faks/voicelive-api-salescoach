from pydantic import ValidationError

from src.learning.mastery import BetaBKT, Elo, MasteryUpdateInput
from src.learning.models import InterventionPlan, MasteryEvent, Provenance
from src.learning.planner import PlannerRequest, PlannerResult, StubLearningPlanner
from src.learning.validator import PlanValidationError, PlanValidator, catalogue_grounding_rule
from src.learning.xapi import (
    ApprovalEvent,
    AuditLedgerXAPISink,
    DiagnosticCompletionEvent,
    OverrideEvent,
    approval_event_to_xapi,
    diagnostic_completion_event_to_xapi,
    mastery_event_to_xapi,
    override_event_to_xapi,
)


def provenance(source="test"):
    return [Provenance(source=source, confidence=1.0, evidence_count=1)]


def test_model_outputs_require_language_and_provenance():
    with pytest_raises_validation_error():
        InterventionPlan(
            target_skill_ids=["ratio"],
            target_student_ids=["student-1"],
            item_types=["reteach"],
            rationale="Missing language and provenance should fail.",
        )


def test_plan_validator_fails_closed_on_catalogue_mismatch():
    plan = InterventionPlan(
        lang="en-NG",
        provenance=provenance(),
        target_skill_ids=["unknown"],
        target_student_ids=["student-1"],
        item_types=["reteach"],
        rationale="Grounding should fail.",
    )
    validator = PlanValidator([catalogue_grounding_rule(["ratio"])])

    result = validator.validate(plan)

    assert not result.ok
    assert result.audit_reason is not None
    assert "catalogue_grounding_failed" in result.audit_reason
    with pytest_raises_plan_validation_error():
        validator.validate_or_raise(plan)


def test_beta_bkt_updates_probability_and_keeps_offline_fallback():
    update = MasteryUpdateInput(
        tenant_id="tenant-1",
        student_id="student-1",
        skill_id="ratio",
        correct=True,
        lang="en-NG",
        provenance=provenance("diagnostic"),
    )
    estimator = BetaBKT()

    result = estimator.update(update)

    assert estimator.offline_fallback_available is True
    assert result.estimate.kind == "beta"
    assert result.estimate.a == 2.0
    assert result.estimate.b == 1.0
    assert result.estimate.probability > 0.5


def test_elo_updates_rating_behind_same_protocol():
    update = MasteryUpdateInput(
        tenant_id="tenant-1",
        student_id="student-1",
        skill_id="ratio",
        correct=False,
        item_difficulty=1.0,
        lang="en-NG",
        provenance=provenance("diagnostic"),
    )

    result = Elo().update(update)

    assert result.estimate.kind == "elo"
    assert result.estimate.rating is not None
    assert result.estimate.probability < 0.5


def test_stub_learning_planner_reuses_budgeted_request_shape():
    request = PlannerRequest(
        tenant_id="tenant-1",
        actor_id="teacher-1",
        role="teacher",
        prompt="Suggest an intervention",
        scope={"skill_ids": ["ratio"], "student_ids": ["student-1"]},
        lang="en-NG",
        provenance=provenance("test"),
        offline=True,
    )

    result = StubLearningPlanner().run_turn(request)

    assert isinstance(result, PlannerResult)
    assert result.tool_calls_count == 0
    assert result.offline_fallback == "deterministic_intervention_stub"
    assert result.plan.requires_approval is True


def test_xapi_emitter_accepts_every_phase0_persisted_event_shape():
    mastery_result = BetaBKT().update(
        MasteryUpdateInput(
            tenant_id="tenant-1",
            student_id="student-1",
            skill_id="ratio",
            correct=True,
            lang="en-NG",
            provenance=provenance("diagnostic"),
        )
    )
    events = [
        mastery_event_to_xapi(
            MasteryEvent(
                tenant_id="tenant-1",
                student_id="student-1",
                skill_id="ratio",
                response_id="response-1",
                estimate=mastery_result.estimate,
                lang="en-NG",
                provenance=provenance("diagnostic"),
            )
        ),
        approval_event_to_xapi(
            ApprovalEvent(
                tenant_id="tenant-1",
                actor_id="teacher-1",
                plan_id="plan-1",
                action="approved",
                lang="en-NG",
                provenance=provenance("teacher"),
            )
        ),
        override_event_to_xapi(
            OverrideEvent(
                tenant_id="tenant-1",
                actor_id="teacher-1",
                student_id="student-1",
                skill_id="ratio",
                reason="Observed mastery in class.",
                lang="en-NG",
                provenance=provenance("teacher"),
            )
        ),
        diagnostic_completion_event_to_xapi(
            DiagnosticCompletionEvent(
                tenant_id="tenant-1",
                student_id="student-1",
                diagnostic_id="diag-1",
                item_count=50,
                lang="en-NG",
                provenance=provenance("diagnostic"),
            )
        ),
    ]
    sink = AuditLedgerXAPISink()

    emitted = [sink.emit(statement) for statement in events]

    assert len(emitted) == 4
    assert all(statement.actor and statement.verb and statement.object for statement in emitted)


def test_ci_lint_every_cloud_planner_result_declares_offline_fallback():
    fields = PlannerResult.model_fields

    assert "offline_fallback" in fields
    assert StubLearningPlanner.offline_fallback


def test_ci_lint_model_outputs_declare_language_and_provenance():
    plan = InterventionPlan(
        lang="yo-NG",
        provenance=provenance("lint"),
        target_skill_ids=["ratio"],
        target_student_ids=["student-1"],
        item_types=["reteach"],
        rationale="Lint fixture.",
    )

    assert plan.lang == "yo-NG"
    assert plan.provenance


def test_ci_lint_persisted_mastery_event_has_xapi_shape():
    mastery_result = BetaBKT().update(
        MasteryUpdateInput(
            tenant_id="tenant-1",
            student_id="student-1",
            skill_id="ratio",
            correct=True,
            lang="en-NG",
            provenance=provenance("diagnostic"),
        )
    )
    statement = mastery_event_to_xapi(
        MasteryEvent(
            tenant_id="tenant-1",
            student_id="student-1",
            skill_id="ratio",
            response_id="response-1",
            estimate=mastery_result.estimate,
            lang="en-NG",
            provenance=provenance("diagnostic"),
        )
    )

    assert statement.actor
    assert statement.verb
    assert statement.object


class pytest_raises_validation_error:
    def __enter__(self):
        return None

    def __exit__(self, exc_type, exc_value, traceback):
        assert exc_type is not None
        assert issubclass(exc_type, ValidationError)
        return True


class pytest_raises_plan_validation_error:
    def __enter__(self):
        return None

    def __exit__(self, exc_type, exc_value, traceback):
        assert exc_type is not None
        assert issubclass(exc_type, PlanValidationError)
        return True