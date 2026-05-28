"""W7 — eval / safety / cost / rollback bounded context."""

from src.learning.eval.harness import (  # noqa: F401
    EVAL_HARNESS_FLAG,
    EVAL_RULE_ID,
    EvalHandlerProtocol,
    EvalHarnessUnavailableError,
    EvalReport,
    ProbeCase,
    ProbeResult,
    Tier1Thresholds,
    run_suite,
)
from src.learning.eval.safety_probes import (  # noqa: F401
    SAFETY_PROBES_FLAG,
    SafetyProbesUnavailableError,
    default_probes,
    fixture_handler,
)
from src.learning.eval.cost_dashboard import (  # noqa: F401
    COST_DASHBOARD_FLAG,
    CostDashboardUnavailableError,
    CostLedgerEntry,
    CostRollup,
    build_dashboard_tiles,
)
from src.learning.eval.auto_rollback import (  # noqa: F401
    AUTO_ROLLBACK_FLAG,
    AutoRollbackUnavailableError,
    RollbackDecision,
    RollbackPolicy,
    VersionMarker,
    decide,
)
