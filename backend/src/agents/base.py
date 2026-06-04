"""Base abstractions for the agent mesh.

``MeshAgent`` is intentionally tiny and dependency-free. It provides the
two things every mesh agent needs:

1. A stable identity (``name``) and an explicit ``allowed_tools`` allow-list
   so an agent can only ever touch the seams it was constructed with.
2. Structured ``[agent-mesh]`` logging that matches the existing
   ``[insights-cache]`` / ``[insights-voice-stt]`` log conventions in this
   repo, so mesh activity is greppable in Azure Log Analytics
   (``ContainerAppConsoleLogs_CL``) alongside the rest of the app.

The base is deliberately shaped like a Microsoft Agent Framework (MAF)
agent (named, tool-scoped, bounded run) so it can be re-based onto the MAF
Python SDK later without changing call sites.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Sequence

logger = logging.getLogger(__name__)

_LOG_PREFIX = "[agent-mesh]"
_TRUTHY = frozenset({"1", "true", "yes", "on", "enabled"})

# Mirror ``insights_service.DEFAULT_TOOL_CALL_BUDGET`` so the mesh inherits
# the same conservative per-turn ceiling the planner already uses. Kept as a
# local constant to avoid importing the heavier service module here.
DEFAULT_TOOL_CALL_BUDGET = 4

ENV_AGENT_MESH_ENABLED = "AGENT_MESH_ENABLED"
ENV_AGENT_MESH_TOOL_CALL_BUDGET = "AGENT_MESH_TOOL_CALL_BUDGET"


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "")
    value = raw.strip().lower()
    if not value:
        return default
    return value in _TRUTHY


def agent_mesh_enabled() -> bool:
    """Whether the agent mesh is opt-in enabled for this process.

    Defaults to ``False`` — Phase 1 ships dark. Call sites must treat a
    ``False`` result as "behave exactly as before the mesh existed".
    """
    return _flag(ENV_AGENT_MESH_ENABLED, default=False)


def _default_tool_call_budget() -> int:
    raw = os.environ.get(ENV_AGENT_MESH_TOOL_CALL_BUDGET, "").strip()
    if not raw:
        return DEFAULT_TOOL_CALL_BUDGET
    try:
        parsed = int(raw)
    except ValueError:
        return DEFAULT_TOOL_CALL_BUDGET
    return parsed if parsed >= 1 else DEFAULT_TOOL_CALL_BUDGET


@dataclass
class MeshBudget:
    """Mutable per-run budget guard.

    Agents that delegate work (e.g. the planner) pass ``tool_call_budget``
    straight through to the wrapped runtime, which enforces it. ``MeshBudget``
    is the mesh-level accounting seam so future multi-agent flows can share a
    single ceiling across hand-offs.
    """

    tool_call_budget: int
    tool_calls_used: int = 0

    @property
    def remaining(self) -> int:
        return max(0, self.tool_call_budget - self.tool_calls_used)

    @property
    def exhausted(self) -> bool:
        return self.remaining <= 0

    def charge(self, count: int = 1) -> None:
        self.tool_calls_used += max(0, int(count))


class MeshAgent:
    """Minimal base class for in-process mesh agents.

    Subclasses set ``name`` and may declare ``allowed_tools``. The base only
    provides identity, an allow-list, and structured logging — it imposes no
    runtime model and performs no I/O, so wrapping an existing service in a
    ``MeshAgent`` cannot change that service's behaviour.
    """

    #: Human-readable agent identity, used in logs.
    name: str = "mesh-agent"

    def __init__(
        self,
        *,
        name: Optional[str] = None,
        allowed_tools: Optional[Sequence[str]] = None,
        tool_call_budget: Optional[int] = None,
    ) -> None:
        if name is not None:
            self.name = name
        self.allowed_tools: tuple[str, ...] = tuple(allowed_tools or ())
        self.tool_call_budget = (
            int(tool_call_budget)
            if tool_call_budget is not None
            else _default_tool_call_budget()
        )

    # -- Tooling --------------------------------------------------------

    def ensure_tool_allowed(self, tool_name: str) -> None:
        """Raise ``PermissionError`` if ``tool_name`` is outside the allow-list.

        An empty allow-list means "no restriction declared" and permits any
        tool — agents that want hard scoping must pass ``allowed_tools``.
        """
        if self.allowed_tools and tool_name not in self.allowed_tools:
            raise PermissionError(
                f"{self.name}: tool '{tool_name}' is not in the allow-list"
            )

    def new_budget(self, tool_call_budget: Optional[int] = None) -> MeshBudget:
        return MeshBudget(
            tool_call_budget=(
                int(tool_call_budget)
                if tool_call_budget is not None
                else self.tool_call_budget
            )
        )

    # -- Logging --------------------------------------------------------

    def log(self, event: str, **fields: Any) -> None:
        """Emit one structured ``[agent-mesh]`` log line.

        Matches the repo's existing ``[insights-cache]`` style so dashboards
        and KQL can treat all of it uniformly.
        """
        payload: dict[str, Any] = {"agent": self.name, "event": event}
        for key, value in fields.items():
            payload[key] = _safe_log_value(value)
        try:
            serialised = json.dumps(payload, default=str, sort_keys=True)
        except (TypeError, ValueError):  # pragma: no cover - defensive
            serialised = json.dumps({"agent": self.name, "event": event})
        logger.info("%s %s", _LOG_PREFIX, serialised)


def _safe_log_value(value: Any) -> Any:
    """Coerce a log field to something JSON-friendly and non-sensitive-by-size.

    Long strings are truncated so a stray transcript or prompt can't bloat a
    log line; structured values pass through for ``json.dumps`` to handle.
    """
    if isinstance(value, str):
        if len(value) > 200:
            return value[:200] + "…"
        return value
    if isinstance(value, Mapping):
        return {str(k): _safe_log_value(v) for k, v in value.items()}
    return value
