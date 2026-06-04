"""Track B / B3 — real staging stack handler (DARK / opt-in).

:class:`~src.learning.eval.b3_driver.B3Driver` drives synthetic load through an
**injected handler seam**. By default that seam is the in-process
:class:`~src.learning.eval.population_scorer.population_fixture_handler`, so a dry
run touches no infrastructure. This module supplies the *other* handler: one that
posts each synthetic turn to a **non-prod staging** backend over HTTP and maps the
response onto the same outcome contract the scorer expects.

It is the W4 go-live seam, and it stays dark until an operator opts in:

* It only constructs behind ``AGENT_MESH_B3_STAGING_HANDLER_V1`` **and**
  ``AGENT_MESH_ENABLED`` (mirrors the B3 driver's own gate). Without both,
  :func:`build_staging_handler` raises :class:`B3StagingHandlerDarkError`.
* It refuses any ``base_url`` that carries a production token (reusing the B3
  driver's ``_is_non_prod`` rule), so it can never be aimed at prod even by
  mistake. The driver's pre-flight ``non_prod_target`` check still applies on top.
* The HTTP transport is an injected seam (``transport=``) so it is unit-testable
  with no network, and the default uses only the standard library.

The endpoint contract is a single synthetic-scoring route the staging backend
exposes for load runs; it returns ``{"outcome": <label>}`` (plus an optional
``response_excerpt``). Nothing here pages a human — disclosures still flow through
the B3 driver's capture-only notifier.

New file only. Reuses the B3/persona contracts; edits nothing.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, Mapping, Optional

from src.learning.eval.b3_driver import (
    MESH_ENABLED_FLAG,
    _is_non_prod,
)
from src.learning.eval.personas import PersonaTurn

# Per-feature kill-switch. The staging handler only ever constructs when this
# *and* ``AGENT_MESH_ENABLED`` are truthy.
B3_STAGING_HANDLER_FLAG = "AGENT_MESH_B3_STAGING_HANDLER_V1"

# Synthetic-scoring route the non-prod backend exposes for B3 load runs.
DEFAULT_SCORE_PATH = "/internal/agent-mesh/score"

# Outcome labels the scorer understands; anything else is normalised to "answer"
# so a misbehaving backend can never inject an unknown outcome into the metrics.
_KNOWN_OUTCOMES = frozenset(
    {"answer", "citation", "refusal", "violation"}
)

_TRUTHY = frozenset({"1", "true", "yes", "on", "enabled"})


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in _TRUTHY


def b3_staging_handler_enabled() -> bool:
    """Whether the staging handler is opt-in enabled (mesh + staging flag)."""
    return _flag(MESH_ENABLED_FLAG) and _flag(B3_STAGING_HANDLER_FLAG)


class B3StagingHandlerDarkError(RuntimeError):
    """Raised when the staging handler is built while it must stay dark."""


class B3StagingTargetError(ValueError):
    """Raised when the staging handler is pointed at a non-staging target."""


# A transport is anything that turns a POST (url, json-body, headers) into the
# decoded JSON response mapping. Injected so tests need no network.
Transport = Callable[[str, Mapping[str, Any], Mapping[str, str]], Mapping[str, Any]]


def _urllib_transport(timeout: float) -> Transport:
    def _post(
        url: str, body: Mapping[str, Any], headers: Mapping[str, str]
    ) -> Mapping[str, Any]:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        for key, value in headers.items():
            req.add_header(key, value)
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - non-prod only
            raw = resp.read().decode("utf-8") or "{}"
        decoded = json.loads(raw)
        if not isinstance(decoded, Mapping):
            raise B3StagingTargetError("staging score endpoint returned non-object JSON")
        return decoded

    return _post


class StagingHttpTurnHandler:
    """Posts each synthetic turn to a non-prod staging backend and maps outcomes.

    Satisfies the scorer's ``TurnHandler`` contract via :meth:`handle`. The driver
    calls this once per persona turn; the handler never retains state and never
    pages a human.
    """

    def __init__(
        self,
        base_url: str,
        *,
        operator: str,
        score_path: str = DEFAULT_SCORE_PATH,
        token: Optional[str] = None,
        timeout: float = 10.0,
        transport: Optional[Transport] = None,
        require_flags: bool = True,
    ) -> None:
        if require_flags and not b3_staging_handler_enabled():
            raise B3StagingHandlerDarkError(
                f"staging handler is dark; set {MESH_ENABLED_FLAG} and "
                f"{B3_STAGING_HANDLER_FLAG} to enable"
            )
        base = (base_url or "").strip().rstrip("/")
        if not base:
            raise B3StagingTargetError("base_url is required")
        if not _target_is_non_prod(base):
            raise B3StagingTargetError(
                f"refusing non-staging target {base_url!r}: host carries a prod token"
            )
        if not (operator or "").strip():
            raise B3StagingTargetError("a named operator is required")

        self._url = f"{base}{score_path}"
        self._operator = operator.strip()
        self._headers: Dict[str, str] = {}
        if token:
            self._headers["Authorization"] = f"Bearer {token}"
        self._transport = transport or _urllib_transport(timeout)

    @property
    def url(self) -> str:
        return self._url

    def handle(self, turn: PersonaTurn) -> Dict[str, Any]:
        body = {
            "prompt": turn.prompt,
            "agent": turn.agent,
            "metadata": dict(turn.metadata or {}),
            "operator": self._operator,
            "synthetic": True,
        }
        try:
            decoded = self._transport(self._url, body, self._headers)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            # A transport failure is loud (a load run with a dead target is
            # meaningless) but never pages a human and never fabricates a pass.
            raise B3StagingTargetError(f"staging score call failed: {exc}") from exc

        outcome = str(decoded.get("outcome", "answer")).strip().lower()
        if outcome not in _KNOWN_OUTCOMES:
            outcome = "answer"
        result: Dict[str, Any] = {"outcome": outcome, "synthetic": True}
        excerpt = decoded.get("response_excerpt")
        if excerpt is not None:
            result["response_excerpt"] = str(excerpt)
        return result


def _target_is_non_prod(base_url: str) -> bool:
    """Treat the host's labels as environment tokens and reject prod targets."""
    host = base_url.split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0]
    # Feed the dotted host to the B3 driver's token rule; it splits on -/_ and
    # rejects anything containing prod/production/live. We additionally require a
    # recognised non-prod token (staging/stage/load/...).
    return _is_non_prod(host.replace(".", "-"))


def build_staging_handler(
    base_url: str,
    *,
    operator: str,
    score_path: str = DEFAULT_SCORE_PATH,
    token: Optional[str] = None,
    timeout: float = 10.0,
    transport: Optional[Transport] = None,
    require_flags: bool = True,
) -> StagingHttpTurnHandler:
    """Build the go-live staging handler. Dark unless both flags are set.

    Pass the result as ``B3Driver(handler=build_staging_handler(...))`` only
    behind the gate-3 sign-off. With the flags unset this raises rather than
    silently constructing an inert handler.
    """
    return StagingHttpTurnHandler(
        base_url,
        operator=operator,
        score_path=score_path,
        token=token,
        timeout=timeout,
        transport=transport,
        require_flags=require_flags,
    )


__all__ = [
    "B3_STAGING_HANDLER_FLAG",
    "DEFAULT_SCORE_PATH",
    "b3_staging_handler_enabled",
    "B3StagingHandlerDarkError",
    "B3StagingTargetError",
    "Transport",
    "StagingHttpTurnHandler",
    "build_staging_handler",
]
