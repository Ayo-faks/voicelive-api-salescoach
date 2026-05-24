"""Fail-closed validation for structured Pathfinder plans."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Generic, Iterable, List, Optional, Sequence, Tuple, TypeVar


TPlan = TypeVar("TPlan")


@dataclass(frozen=True)
class ValidationFailure:
    code: str
    message: str
    path: Tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class ValidationResult(Generic[TPlan]):
    ok: bool
    plan: Optional[TPlan] = None
    failures: Tuple[ValidationFailure, ...] = field(default_factory=tuple)
    audit_reason: Optional[str] = None

    @classmethod
    def success(cls, plan: TPlan) -> "ValidationResult[TPlan]":
        return cls(ok=True, plan=plan)

    @classmethod
    def fail(cls, failures: Sequence[ValidationFailure]) -> "ValidationResult[TPlan]":
        reason = "; ".join(f"{failure.code}: {failure.message}" for failure in failures)
        return cls(ok=False, failures=tuple(failures), audit_reason=reason or "validation_failed")


class PlanValidationError(ValueError):
    def __init__(self, result: ValidationResult[object]) -> None:
        super().__init__(result.audit_reason or "plan_validation_failed")
        self.result = result


ValidationRule = Callable[[TPlan], Optional[ValidationFailure]]


class PlanValidator(Generic[TPlan]):
    """Parametrised semantic validator for structured planner outputs."""

    def __init__(
        self,
        rules: Optional[Iterable[ValidationRule[TPlan]]] = None,
        *,
        require_lang: bool = True,
        require_provenance: bool = True,
        xapi_converter: Optional[Callable[[TPlan], object]] = None,
    ) -> None:
        self.rules = tuple(rules or ())
        self.require_lang = require_lang
        self.require_provenance = require_provenance
        self.xapi_converter = xapi_converter

    def validate(self, plan: TPlan) -> ValidationResult[TPlan]:
        failures: List[ValidationFailure] = []

        if self.require_lang and not str(getattr(plan, "lang", "") or "").strip():
            failures.append(ValidationFailure("missing_language", "model output must declare lang", ("lang",)))

        provenance = getattr(plan, "provenance", None)
        if self.require_provenance and not provenance:
            failures.append(
                ValidationFailure(
                    "missing_provenance", "model output must carry at least one provenance item", ("provenance",)
                )
            )

        for rule in self.rules:
            failure = rule(plan)
            if failure is not None:
                failures.append(failure)

        if self.xapi_converter is not None:
            try:
                self.xapi_converter(plan)
            except Exception as exc:  # pragma: no cover - defensive guardrail
                failures.append(ValidationFailure("xapi_not_expressible", str(exc), ("xapi",)))

        if failures:
            return ValidationResult.fail(failures)
        return ValidationResult.success(plan)

    def validate_or_raise(self, plan: TPlan) -> TPlan:
        result = self.validate(plan)
        if not result.ok:
            raise PlanValidationError(result)  # type: ignore[arg-type]
        return plan


def catalogue_grounding_rule(allowed_skill_ids: Iterable[str]) -> ValidationRule[object]:
    allowed = {str(skill_id) for skill_id in allowed_skill_ids}

    def validate(plan: object) -> Optional[ValidationFailure]:
        target_skill_ids = [str(skill_id) for skill_id in getattr(plan, "target_skill_ids", [])]
        unknown = sorted(skill_id for skill_id in target_skill_ids if skill_id not in allowed)
        if unknown:
            return ValidationFailure(
                "catalogue_grounding_failed",
                f"unknown skill ids: {', '.join(unknown)}",
                ("target_skill_ids",),
            )
        return None

    return validate


def catalogue_skill_existence_rule(
    repository: object,
    tenant_id: str,
    *,
    require_active: bool = True,
) -> ValidationRule[object]:
    """Rule that resolves every ``target_skill_ids`` entry via the repo.

    Phase 1, Workstream B5. Replaces the static-list ``catalogue_grounding_rule``
    once the skills library is the source of truth. We require the skill to be
    present and (by default) not archived so a teacher cannot ground a plan in
    a retired skill. The repository contract is duck-typed (just needs
    ``get_skill(tenant_id, skill_id)``) so this stays decoupled from the
    Postgres/InMemory split.
    """

    get_skill = getattr(repository, "get_skill", None)
    if not callable(get_skill):
        raise TypeError("repository must implement get_skill(tenant_id, skill_id)")

    def validate(plan: object) -> Optional[ValidationFailure]:
        target_skill_ids = [str(skill_id) for skill_id in getattr(plan, "target_skill_ids", [])]
        missing: List[str] = []
        archived: List[str] = []
        for skill_id in target_skill_ids:
            skill = get_skill(tenant_id, skill_id)
            if skill is None:
                missing.append(skill_id)
                continue
            if require_active and getattr(skill, "status", "active") != "active":
                archived.append(skill_id)
        if missing:
            return ValidationFailure(
                "catalogue_skill_missing",
                f"unknown skill ids for tenant {tenant_id}: {', '.join(sorted(missing))}",
                ("target_skill_ids",),
            )
        if archived:
            return ValidationFailure(
                "catalogue_skill_archived",
                f"archived skill ids cannot ground new plans: {', '.join(sorted(archived))}",
                ("target_skill_ids",),
            )
        return None

    return validate
