# Session memory — real-agent evals (Pathfinder Learn mesh)

> Snapshot of working state for the agent-eval thread. Companion to
> `all-agent-eval-plan.md` (the forward plan) and
> `all-agent-eval-handoff.prompt.md` (the fresh-session prompt).

## Status

- **Done & pushed**: `real_agent_eval.py` on branch `feat/agent-mesh-gate2-obs`,
  commit `508e07f`, pushed to **origin** (`Ayo-faks` fork) — never upstream.
- **Live results** (unsandboxed, az = `build@neoflames.com`):
  - **A2 text dig-deeper tutor** — 8/8, real source-bound citations (gpt-4o).
  - **A5 safeguarding** — 5/5, recall 1.0, fpr 0.0 (gpt-4o).

## Hard-won lessons (do not relearn)

- **Run live-model evals UNSANDBOXED.** The terminal sandbox blocks the az CLI
  credential cache → `DefaultAzureCredential` fails → every agent **fail-opens
  silently** (none/defer) → false negatives. Use
  `requestUnsandboxedExecution=true`. Verify with `az account show` first.
- The old `real_model_population_eval.py` caveats were artefacts of evaluating a
  **naked gpt-4o + LLM judge**, not the real product agents. Fix = drive the
  **real agents**, which already have RAG + in-code turn cap + structured output.
- Tutor's production model **is** gpt-4o and is correct — the old failures were
  **missing RAG**, not the model. Optional A/B: `AOAI_TUTOR_DEPLOYMENT=gpt-5.3-chat`.

## Resource facts

- AI Foundry resource `aifoundry-voicelab-e5dj24rvkgx2c`, managed-identity auth
  (no API key), API version `2024-12-01-preview`, scope
  `https://cognitiveservices.azure.com/.default`.
- Deployments that EXIST: `gpt-4o`, `gpt-5.2-chat`, `gpt-5.3-chat`,
  `text-embedding-3-small`, `text-embedding-ada-002`, `gpt-realtime-1.5`,
  `gpt-image-1`. **No `gpt-4o-mini`** here (production safeguarding pin lives on a
  different resource), so the eval uses gpt-4o for A5.

## What `real_agent_eval.py` does

- Drives REAL agents, judge-free where possible. Writes
  `data/c1/real_agent_eval_report.json`, prints `REAL_AGENT_EVAL_OK`.

### A2 Text Dig-Deeper Tutor (gpt-4o; configurable `AOAI_TUTOR_DEPLOYMENT`)

- Build: merge `WikiCorpus` from repo-root `data/learning/wiki/*.json` →
  `RagRetriever(corpus, embedder=None)` (lexical; dense via `AOAI_DENSE_RETRIEVAL=1`)
  → `ModelAssistantProvider(client, model, rag_retriever, fallback, max_turns=3)`.
- `ask(q, ctx)` → `{answer, citations, grounded, smalltalk?}`.
- Outcome map (NO judge): smalltalk→answer; grounded&citations→citation;
  grounded&no-cite→answer; not grounded → refusal (turn-cap msg vs defer msg).
- Grounded queries: "simplify a fraction" (maths jss3), "solve a linear equation",
  english "verb agree with subject". Off-corpus: Fermat proof; off-topic: football.

### A5 Safeguarding Classifier (gpt-4o on this resource)

- `SafeguardingClassifier(client_factory=lambda: client, model)`; `classify()` is
  **async** → `asyncio.run`. Returns `LayerScore.severity` (`Severity` enum, `.rank`:
  NONE0 LOW1 MEDIUM2 HIGH3 CRITICAL4). Intervene if `rank >= MEDIUM.rank`.
- Cases: critical ideation/neglect, medium bullying (intervene); benign exam
  stress / frustration (pass).

## Honesty to keep surfacing

- Real Azure OpenAI spend on shared quota (kept tiny).
- Lexical-only retrieval by default (dense optional, extra embedding cost).
- Bounded case set; safeguarding content synthetic, non-graphic, low volume.
- A5 uses gpt-4o because the production gpt-4o-mini pin is absent here.

## Not yet covered (the forward work)

- **A1 insights** (`CopilotInsightsPlanner`) and **A8 planning**
  (`LearningPlanner`/`StubLearningPlanner`) run on the GitHub Copilot SDK + a
  tool registry → need a different (fake-client) harness.
- No adapter yet from the eval report → `ObservabilityReport`. See the plan.
