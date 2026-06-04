"""Agent-mesh package for voicelive-api-salescoach.

Phase 1 (dark / opt-in) introduces a thin, in-process agent mesh that
*wraps* existing services rather than replacing them. Two agents ship in
this phase:

* :class:`~src.agents.planner_agent.PlannerAgent` — a 1:1 shim over the
  existing ``InsightsPlanner`` (e.g. ``CopilotInsightsPlanner``). It adds
  structured ``[agent-mesh]`` logging and a per-turn budget guard without
  changing planner behaviour.
* :class:`~src.agents.safeguarding_agent.SafeguardingAgent` — a read-only
  verdict layer over the existing safety primitives
  (``services.safety_gates``, ``services.transcript_safety``, and
  ``storage_service.user_has_child_access``). It never mutates state and
  never raises for a denied action; it returns a
  :class:`~src.agents.safeguarding_agent.SafeguardingVerdict`.

Framework note: the :class:`~src.agents.base.MeshAgent` base is a thin
internal abstraction deliberately shaped to mirror a Microsoft Agent
Framework (MAF) agent (``name`` + tool allow-list + bounded run). When the
MAF Python SDK is pinned for this backend, ``MeshAgent`` can be re-based on
it without touching agent call sites.

Everything in this package is gated by ``AGENT_MESH_ENABLED`` at the call
sites; importing the package has no side effects.
"""

from src.agents.base import MeshAgent, MeshBudget, agent_mesh_enabled
from src.agents.planner_agent import PlannerAgent
from src.agents.safeguarding_agent import (
    SafeguardingAgent,
    SafeguardingVerdict,
)
from src.agents.aiops_agent import (
    AIOpsAgent,
    AIOpsFinding,
    AIOpsReport,
    AIOpsThresholds,
)
from src.agents.genaiops_agent import (
    GenAIOpsAgent,
    GenAIOpsVerdict,
)
from src.agents.orchestrator import (
    MeshOrchestrator,
    OrchestratedTurn,
)
from src.agents.critic_agent import (
    CriticAgent,
    Critique,
    CritiqueFinding,
)
from src.agents.memory_agent import (
    MemoryAgent,
    MemoryRecord,
)
from src.agents.devops_agent import (
    DeployDecision,
    DevOpsAgent,
)
from src.agents.migration_agent import (
    MigrationAgent,
    MigrationFinding,
    MigrationPlan,
)
from src.agents.observability_gate import (
    ObservabilityGate,
    ObservabilityReport,
)

__all__ = [
    "MeshAgent",
    "MeshBudget",
    "agent_mesh_enabled",
    "PlannerAgent",
    "SafeguardingAgent",
    "SafeguardingVerdict",
    "AIOpsAgent",
    "AIOpsFinding",
    "AIOpsReport",
    "AIOpsThresholds",
    "GenAIOpsAgent",
    "GenAIOpsVerdict",
    "MeshOrchestrator",
    "OrchestratedTurn",
    "CriticAgent",
    "Critique",
    "CritiqueFinding",
    "MemoryAgent",
    "MemoryRecord",
    "DevOpsAgent",
    "DeployDecision",
    "MigrationAgent",
    "MigrationPlan",
    "MigrationFinding",
    "ObservabilityGate",
    "ObservabilityReport",
]
