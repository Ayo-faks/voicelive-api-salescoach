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
from src.learning.eval.safeguarding_probes import (  # noqa: F401
    SAFEGUARDING_PROBES_FLAG,
    SafeguardingProbesUnavailableError,
    default_probes as safeguarding_default_probes,
    safeguarding_fixture_handler,
)
from src.learning.eval.critic_probes import (  # noqa: F401
    CRITIC_PROBES_FLAG,
    CriticProbesUnavailableError,
    default_probes as critic_default_probes,
    critic_fixture_handler,
)
from src.learning.eval.text_tutor_probes import (  # noqa: F401
    TEXT_TUTOR_PROBES_FLAG,
    TextTutorProbesUnavailableError,
    default_probes as text_tutor_default_probes,
    text_tutor_fixture_handler,
)
from src.learning.eval.voice_tutor_probes import (  # noqa: F401
    VOICE_TUTOR_PROBES_FLAG,
    VoiceTutorProbesUnavailableError,
    default_probes as voice_tutor_default_probes,
    voice_tutor_fixture_handler,
)
from src.learning.eval.voice_profile_probes import (  # noqa: F401
    VOICE_PROFILE_PROBES_FLAG,
    VoiceProfileProbesUnavailableError,
    default_probes as voice_profile_default_probes,
    voice_profile_fixture_handler,
)
from src.learning.eval.insights_probes import (  # noqa: F401
    INSIGHTS_PROBES_FLAG,
    InsightsProbesUnavailableError,
    default_probes as insights_default_probes,
    insights_fixture_handler,
)
from src.learning.eval.planning_probes import (  # noqa: F401
    PLANNING_PROBES_FLAG,
    PlanningProbesUnavailableError,
    default_probes as planning_default_probes,
    planning_fixture_handler,
)
from src.learning.eval.safeguarding_classifier_probes import (  # noqa: F401
    SAFEGUARDING_CLASSIFIER_PROBES_FLAG,
    SafeguardingClassifierProbesUnavailableError,
    default_probes as safeguarding_classifier_default_probes,
    safeguarding_classifier_fixture_handler,
)
from src.learning.eval.personas import (  # noqa: F401
    SYNTHETIC_PERSONAS_FLAG,
    INTERVENE_OUTCOMES,
    Persona,
    PersonaTurn,
    SyntheticPersonasUnavailableError,
    default_personas,
)
from src.learning.eval.population_scorer import (  # noqa: F401
    POPULATION_SCORER_FLAG,
    ABComparison,
    Metrics,
    PopulationReport,
    PopulationScorer,
    PopulationScorerUnavailableError,
    population_fixture_handler,
    population_scorer_enabled,
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
