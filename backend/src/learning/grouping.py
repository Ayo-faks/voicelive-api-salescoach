"""Differentiated grouping helpers for teacher-facing Wulo Academy views."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Iterable, List, Mapping

SUPPORT_TYPES = {"reteach", "targeted_practice", "extension", "monitor", "review"}


@dataclass(frozen=True)
class MasteryCellForGrouping:
    student_id: str
    skill_id: str
    skill_label: str
    probability: float
    uncertainty: float
    status: str


def _support_type_for(cell: MasteryCellForGrouping) -> str:
    if cell.status == "needs_support" and cell.probability < 0.45:
        return "reteach"
    if cell.uncertainty >= 0.42:
        return "review"
    if cell.status == "needs_support" or cell.probability < 0.65:
        return "targeted_practice"
    if cell.status == "secure" and cell.probability >= 0.78 and cell.uncertainty <= 0.28:
        return "extension"
    return "monitor"


def _uncertainty_label(uncertainty: float) -> str:
    if uncertainty >= 0.42:
        return "needs_more_evidence"
    if uncertainty >= 0.28:
        return "thin_evidence"
    return "strong_evidence"


def _rationale(support_type: str, skill_label: str, cells: list[MasteryCellForGrouping]) -> str:
    count = len(cells)
    avg_mastery = sum(cell.probability for cell in cells) / count
    avg_uncertainty = sum(cell.uncertainty for cell in cells) / count
    uncertainty_label = _uncertainty_label(avg_uncertainty).replace("_", " ")
    if support_type == "reteach":
        return f"{count} learners share low mastery evidence in {skill_label}; start with a short reteach before practice."
    if support_type == "targeted_practice":
        return f"{count} learners are developing {skill_label}; targeted practice can gather more evidence and close the gap."
    if support_type == "extension":
        return f"{count} learners show secure evidence in {skill_label}; offer an extension task while monitoring transfer."
    if support_type == "review":
        return f"{count} learners have {uncertainty_label} for {skill_label}; use a brief check before deciding the next support."
    return f"{count} learners are near the expected range for {skill_label}; monitor with a light-touch follow-up."


def build_differentiation_groups(
    cells: Iterable[Mapping[str, Any] | MasteryCellForGrouping],
) -> List[dict[str, Any]]:
    """Bucket mastery cells into teacher-editable support groups.

    The grouping is intentionally conservative: it exposes uncertainty instead of
    treating a thin estimate as a fixed learner label.
    """

    parsed: list[MasteryCellForGrouping] = []
    for raw in cells:
        if isinstance(raw, MasteryCellForGrouping):
            parsed.append(raw)
            continue
        parsed.append(
            MasteryCellForGrouping(
                student_id=str(raw["student_id"]),
                skill_id=str(raw["skill_id"]),
                skill_label=str(raw.get("skill_label") or raw["skill_id"]),
                probability=float(raw.get("probability") or 0.0),
                uncertainty=float(raw.get("uncertainty") or 0.0),
                status=str(raw.get("status") or "developing"),
            )
        )

    buckets: dict[tuple[str, str], list[MasteryCellForGrouping]] = defaultdict(list)
    for cell in parsed:
        buckets[(_support_type_for(cell), cell.skill_id)].append(cell)

    groups: list[dict[str, Any]] = []
    for (support_type, skill_id), group_cells in buckets.items():
        group_cells.sort(key=lambda cell: (cell.probability, -cell.uncertainty, cell.student_id))
        skill_label = group_cells[0].skill_label
        avg_mastery = sum(cell.probability for cell in group_cells) / len(group_cells)
        avg_uncertainty = sum(cell.uncertainty for cell in group_cells) / len(group_cells)
        groups.append(
            {
                "group_id": f"group-{support_type}-{skill_id}".replace("_", "-"),
                "support_type": support_type,
                "target_skill_id": skill_id,
                "target_skill_label": skill_label,
                "student_ids": [cell.student_id for cell in group_cells],
                "learner_count": len(group_cells),
                "confidence": round(max(0.0, min(1.0, 1.0 - avg_uncertainty)), 3),
                "uncertainty": round(max(0.0, min(1.0, avg_uncertainty)), 3),
                "uncertainty_label": _uncertainty_label(avg_uncertainty),
                "mastery_estimate": round(max(0.0, min(1.0, avg_mastery)), 3),
                "rationale": _rationale(support_type, skill_label, group_cells),
                "evidence_summary": (
                    f"Average mastery {avg_mastery:.0%}; uncertainty {avg_uncertainty:.0%} "
                    f"across {len(group_cells)} learner{'s' if len(group_cells) != 1 else ''}."
                ),
                "next_action": _next_action_for(support_type, skill_label),
            }
        )

    support_order = ["reteach", "targeted_practice", "review", "monitor", "extension"]
    return sorted(
        groups,
        key=lambda group: (
            support_order.index(group["support_type"]),
            -int(group["learner_count"]),
            str(group["target_skill_label"]),
        ),
    )


def _next_action_for(support_type: str, skill_label: str) -> str:
    if support_type == "reteach":
        return f"Run a 12-minute reteach on {skill_label}, then check one exit question."
    if support_type == "targeted_practice":
        return f"Assign focused practice on {skill_label} with one scaffolded hint."
    if support_type == "extension":
        return f"Set a transfer challenge that applies {skill_label} in a new context."
    if support_type == "review":
        return f"Collect two quick evidence points for {skill_label} before grouping further."
    return f"Monitor {skill_label} during the next independent practice block."


__all__ = ["SUPPORT_TYPES", "MasteryCellForGrouping", "build_differentiation_groups"]
