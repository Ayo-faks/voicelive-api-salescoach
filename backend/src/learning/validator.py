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
