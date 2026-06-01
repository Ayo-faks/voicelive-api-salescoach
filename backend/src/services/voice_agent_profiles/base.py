"""Shared types for scoped VoiceLive agent profiles."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

ToolDef = Any
ToolHandler = Callable[[Mapping[str, Any], "AgentProfileContext"], Mapping[str, Any]]


@dataclass
class AgentProfileContext:
    scope: str
    child_id: str | None = None
    exam: str | None = None
    class_year: str | None = None
    subject: str | None = None
    last_card_id: str | None = None
    last_kind: str | None = None
    # Dig-Deeper focus item the learner arrived on (optional). When present the
    # realtime voice session is anchored on this question and grounded on it
    # before the first tool call, mirroring the text drawer path.
    focus_stem: str | None = None
    focus_skill_id: str | None = None
    focus_topic: str | None = None
    focus_misconception: str | None = None
    focus_scored: bool | None = None


@dataclass(frozen=True)
class AgentProfile:
    id: str
    system_prompt: str
    tools: list[ToolDef]
    voice: str
    temperature: float
    max_response_output_tokens: int
    forced_response_tool_name: str | None = None
    tool_handlers: Mapping[str, ToolHandler] = field(default_factory=dict, repr=False)

    def handle_tool_call(
        self,
        name: str,
        arguments: Mapping[str, Any],
        context: AgentProfileContext,
    ) -> Mapping[str, Any]:
        handler = self.tool_handlers.get(name)
        if handler is None:
            raise ValueError(f"Unknown tool for {self.id} profile: {name}")
        return handler(arguments, context)