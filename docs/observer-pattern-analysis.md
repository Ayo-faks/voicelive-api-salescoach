# Observer Pattern for Voice Agent Guardrails — Applicability to Wulo

Source analysed: [LiveKit blog — "How to Build a Background Observer for Voice AI Guardrails" (2026-04-16)](https://livekit.com/blog/observer-pattern-voice-agent-guardrails)

Scope: [voicelive-api-salescoach/backend/src/services](../backend/src/services) — specifically the child realtime session, the therapist Planner, and the therapist Insights agent.

---

## 1. The LiveKit pattern in one page

**Problem.** Packing safety / compliance logic into the primary agent's system prompt competes with conversational latency and dilutes the agent's main job. A single model can't reliably do both low-latency voice turns and multi-step policy reasoning.

**Solution.** Split **detection** from **response** via a background **Observer**:

| Phase | What it does | Mechanism |
|---|---|---|
| 1. Listen | Capture every user turn from the live session, non-blocking. | Subscribes to `AgentSession.on("conversation_item_added")`. Filters `role == "user"`. |
| 2. Evaluate | Send the rolling transcript (last N turns) to a **separate, more capable LLM** with a structured JSON prompt → boolean per violation category + `details`. | `asyncio.create_task`; reentrancy guarded by `_evaluating` + `_pending_eval` flags so evals never stack and no turn is skipped. |
| 3. Inject | On violation, copy `current_agent.chat_ctx`, append a `[POLICY: …]` **system message** with a concrete, tool-aware instruction, push via `update_chat_ctx`. Dedup by violation type. | Primary agent never learns the Observer exists — it just sees new context on its next turn. |

**Key properties** (these are the bits worth copying):

1. **Out-of-band.** Observer is a plain class, not an `Agent`. Zero impact on the voice loop's latency budget.
2. **Asymmetric models.** Fast model for voice; slower, smarter model for evaluation.
3. **Context-level intervention, not code-level.** The Observer mutates the *prompt*, not the agent's behaviour tree. Any tool the agent already has can be referenced by the injected hint (`escalate_to_safety_team`, `file_driver_report`).
4. **Concurrency discipline.** Single in-flight eval, pending flag, `_bg_tasks` set to prevent GC of fire-and-forget coroutines.
5. **Bounded side-effects.** Deduped `injected_violations` set → upper bound on prompt growth (N categories × 1).
6. **Event contract.** The whole thing hangs on one well-defined event (`conversation_item_added`). Swap the source, not the Observer.

---

## 2. Wulo today — where does conversation state actually flow?

Three loops, two WebSockets, no shared event bus:

```
 child browser                              therapist browser
 useRealtime.ts ──► /ws/voice               useInsightsVoice.ts ──► /ws/insights-voice
                      │                                                 │
                      ▼                                                 ▼
     VoiceProxyHandler (websocket_handler.py)               InsightsVoiceHandler
        ├─ Azure VoiceLive SDK (aio)                          (Azure Speech STT / TTS)
        ├─ AgentManager + FINISH_SESSION_TOOL                            │
        ├─ append_phoneme_rule (prompt_rules.py)                         ▼
        ├─ ScoredTurnDispatcher + TargetTokenTally             InsightsService.ask(...)
        │    (scoring.py)                                        ├─ InsightsTool registry (read-only)
        ├─ wulo.* custom events (tally, scaffold,                ├─ scope auth, budgets
        │   mic_mode, scored_turn.*)                             └─ InsightsPlanner Protocol
        └─ INPUT_AUDIO_TRANSCRIPTION_COMPLETED_TYPE                     └─ CopilotInsightsPlanner
                      │
                      ▼
     storage / ChildMemoryService / InstitutionalMemoryService
                      │
                      ▼
     report_pipeline → ProgressReportService → RecommendationService
                      │
                      ▼
     PracticePlanningService / CopilotPlannerRuntime   (offline, on demand)
```

### What each component is and does

- **Child voice agent** — [`VoiceProxyHandler`](../backend/src/services/websocket_handler.py). Async proxy between `/ws/voice` (Flask-Sock) and the Azure VoiceLive SDK. Consumes `conversation.item.input_audio_transcription.completed` events and forwards them to `ScoredTurnDispatcher`.
- **Scoring middleware** — [`TargetTokenTally` / `ScoredTurnDispatcher`](../backend/src/services/scoring.py). Already a mini-observer for target-phoneme accuracy: consumes transcripts, maintains a sliding window, emits `wulo.scaffold_escalate` when thresholds trip. **This is the shape the guardrail Observer should take.**
- **Planner agent** — [`PracticePlanningService` / `CopilotPlannerRuntime`](../backend/src/services/planning_service.py). Offline, therapist-triggered. Uses Copilot SDK with Azure BYOK to produce a next-session plan from prior sessions. Tool-calling, auto-permission, validated via `plan_validation.normalize_plan_draft`.
- **Insights agent** — [`InsightsService`](../backend/src/services/insights_service.py) + [`CopilotInsightsPlanner`](../backend/src/services/insights_copilot_planner.py). Therapist "ask-your-data" surface. Frozen `PROMPT_VERSION = "insights-v1"`, read-only tool registry, per-turn `InsightsRequestContext`, hard `DEFAULT_TOOL_CALL_BUDGET = 6` + `DEFAULT_WALL_CLOCK_BUDGET_SECONDS = 20.0`, `InsightsAuthorizationError`, `InsightsBudgetExceeded`, scope gating to `caseload|child|session|report`. Reached over `/ws/insights-voice` (full-duplex STT → planner → TTS) in [`InsightsVoiceHandler`](../backend/src/services/insights_websocket_handler.py).
- **Guardrails today** are all *in-band*:
  - Prompt rules — [`PHONEME_CITATION_RULE`](../backend/src/services/prompt_rules.py), appended at three sites (`AgentManager.BASE_INSTRUCTIONS`, `VoiceProxyHandler._combine_instructions`, `PracticePlanningService._build_system_message`).
  - Tool-description rules — the `FINISH_SESSION_TOOL` description *tells* the model not to end sessions on its own.
  - Authorization — `InsightsAuthorizationError`, `ALLOWED_SCOPE_TYPES`.
  - Budgets — `InsightsBudgetExceeded`, `on_pre_tool_use` in the Copilot planner.
  - Post-hoc redaction — `report_redaction.py` runs after the fact on reports.

No in-process pub/sub, no `EventEmitter`, no shared async `Queue` between services. The only "event stream" is the `wulo.*` JSON envelope over the client WebSocket.

---

## 3. Gap analysis — Wulo vs. the LiveKit observer pattern

Legend: ✅ present / ⚠️ partial / ❌ missing.

| Capability | LiveKit pattern | Wulo today | Gap |
|---|---|---|---|
| Event that fires on every user turn | `conversation_item_added` on `AgentSession` | ⚠️ `INPUT_AUDIO_TRANSCRIPTION_COMPLETED_TYPE` is received inside `VoiceProxyHandler` but **not re-published** on an in-process bus. | Only `ScoredTurnDispatcher` and the WS forwarder see it. |
| Parallel evaluator agent | Yes, separate LLM | ❌ | No second model watches the live child conversation. Planner + Insights only run offline / therapist-driven. |
| Non-blocking single-flight eval | `asyncio.create_task` + `_evaluating`/`_pending_eval` | ⚠️ Pattern exists *inside* `TargetTokenTally` for scaffold cooldowns — phoneme-specific, not generic. | Need a generic async evaluator harness. |
| Structured JSON violation schema | `{safety_emergency, threatening_language, …, details}` | ❌ | No policy/safety schema at all for Wulo (child safeguarding, clinical-scope creep, phoneme spelling, PII, etc.). |
| Inject into active agent's chat context | `current_agent.chat_ctx.copy() → update_chat_ctx` | ❌ | VoiceLive session instructions are set once at `session.update`. There is no public path to **append a system message mid-session**. `_combine_instructions` runs only at start. |
| Context-growth bound | Dedup by violation type, max N messages | ⚠️ Phoneme rule is idempotent (`append_phoneme_rule` checks for substring). | Nothing similar for per-session dynamic hints. |
| Separation of concerns: primary agent doesn't know | Observer is not an `Agent` | ⚠️ `ScoredTurnDispatcher` follows this shape, but it's scoped to one concern (target-token scoring). | Generalise into a plug-in Observer harness. |
| Post-session / offline observation | Possible but blog focuses on live | ⚠️ `report_pipeline` + `report_redaction` do post-hoc safety, but they run **after the child has left the room**. | A live equivalent is missing. |
| Observer on the Insights/Planner tool chain | — (blog is voice-only) | ❌ | `on_pre_tool_use` enforces a numeric budget; there is no semantic observer watching for out-of-scope reasoning, hallucinated citations, or PII-leaking visualisations. |
| Concurrency-safe bg-task bookkeeping | `_bg_tasks: set[asyncio.Task]` | ❌ | The async loop inside `VoiceProxyHandler.handle_connection` uses ad-hoc `asyncio.gather` for the proxy fan-in/out; no registry of owned background tasks. |
| Shared transcript buffer | `self.conversation_history` list on the Observer | ⚠️ Live transcript lives only in `TargetTokenTally._events` (phoneme-scoped) and in the WS forwarder's log lines. `ChildMemoryService` only reads persisted turns. | Need a thin, explicitly-owned rolling transcript per session. |
| Event-driven tests | conversation-level unit tests | ⚠️ Scoring + insights have good coverage; there is no harness for "simulate a user turn, expect observer to fire". | Add fakes once the event exists. |

**Bottom line.** The *components* Wulo already has (scoring, budgets, scope checks, prompt rules) are all **observer-adjacent**. What's missing is the **single, generic event + harness** that would let multiple independent observers subscribe to "a child just said X" or "the Insights planner just invoked tool Y".

---

## 4. Why this pattern actually matters for Wulo

Wulo's risk surface is wider than LiveKit's ride-share example:

1. **Child safeguarding.** Disclosure of harm ("my dad hit me"), self-harm ideation, unsafe-home signals. Must never be swallowed by the conversational model, must never interrupt therapy abruptly, must create a therapist-facing flag.
2. **Clinical-scope creep.** Child asks for medical / psychological / legal advice. Agent must gracefully redirect and log.
3. **Phoneme citation.** Already handled by `PHONEME_CITATION_RULE`, but violations (the model spelling out "tee aitch") are caught today only by human listening. An observer could detect `\bt(ee)?[- ]?aitch\b` etc. in agent transcripts and inject a corrective hint without restarting the session.
4. **Therapist Insights scope leakage.** `InsightsService` authorises the *tool call*, but a natural-language answer could still reference another therapist's caseload indirectly (e.g. via aggregate stats). An observer on the planner response can hold a second-pass check before TTS synthesis.
5. **Planner drift.** `PracticePlanningService` draft is validated by `plan_validation.normalize_plan_draft` for **shape**, not **content** — e.g. picking an exercise the child has regressed on, or a difficulty step that the Progress Report flagged as too hard. An observer with read access to `ChildMemoryService` can veto or re-prompt.
6. **Latency budget for children.** Kids disengage fast. Putting more rules into the VoiceLive system prompt will cost response-time. Observer keeps the fast path fast.

Asymmetric-model economics also align: the child-facing model is already the most expensive *per-minute* component (realtime TTS-quality voice). An observer on a cheaper async Azure OpenAI deployment (e.g. `gpt-4.1-mini` or a future `gpt-4o-mini`) evaluating every ~3 turns costs a tiny fraction of the VoiceLive minute and can safely use a more capable backbone.

---

## 5. Mapping the pattern onto three Wulo "observable subjects"

Wulo has **three** places the pattern applies, with different concurrency shapes:

### 5.1 Child realtime voice session → `SessionObserver`

- **Subject:** `VoiceProxyHandler`.
- **Event:** new method `VoiceProxyHandler._publish_transcript_event(role, text, meta)` called from the existing `INPUT_AUDIO_TRANSCRIPTION_COMPLETED_TYPE` branch *and* from the assistant transcript branch. Replace today's implicit "feed scoring" with an explicit `SessionEventBus.publish(ConversationItemAdded(...))` — `TargetTokenTally` becomes subscriber #1, the safeguarding observer becomes subscriber #2.
- **Injection:** the blog's `update_chat_ctx` has no direct VoiceLive equivalent. Two viable substitutes:
  - **(a) Instruction patch via `session.update`.** Send another `session.update` over the VoiceLive connection with an appended system instruction. Needs verification that the SDK accepts instruction deltas mid-session and that it doesn't reset session state — if it resets turn detection / VAD / voice config, this is unsafe.
  - **(b) Out-of-band UI event.** Emit a `wulo.safeguard_flag` custom event to the client + push a redacted system message into the **next** agent turn by queuing it in `_combine_instructions` state. Simpler, but latency is "on next `session.update`" rather than "on next model turn".
  - **(c) Therapist-rail escalation.** For safeguarding specifically, the correct response is often *not* to change the child agent's behaviour but to alert the therapist. This maps to the blog's "inject" step but pointed at the therapist's UI, not the child's agent.
- **Observers to ship (priority order):**
  1. `SafeguardingObserver` — categories: disclosure-of-harm, self-harm, bullying, unsafe-home. Injects a gentle redirect hint into the child agent + emits a therapist flag.
  2. `PhonemeCitationObserver` — regex on assistant transcripts for letter-spelling of target sounds; injects a corrective system message (or flags for QA).
  3. `ScopeCreepObserver` — child asks medical/legal; injects a "stay-in-scope" hint.

### 5.2 Therapist Insights planner → `InsightsObserver`

- **Subject:** `InsightsService.ask` loop.
- **Event:** `on_tool_called` (already has `on_pre_tool_use`) + `on_planner_response`. Extend the `InsightsPlanner` Protocol with an `events: Optional[InsightsEventSink]` parameter, or thread the bus through `InsightsRequestContext`.
- **Evaluator:** a second, cheaper model checks the candidate `answer_text` + `citations` + `visualizations` for (i) out-of-caseload references, (ii) unsupported claims vs. citations, (iii) PII in `visualizations.data`.
- **Injection point:** before `InsightsService.ask` returns. If violation → either (a) strip the offending block and set a warning in the envelope, (b) re-plan with an injected `[SCOPE:]` system message.
- **Concurrency:** run synchronously within the turn because Insights turns are already async/bounded — unlike live voice, a 1-2s extra eval is acceptable (well inside the 20s wall-clock budget).

### 5.3 Therapist Planner (`CopilotPlannerRuntime`) → `PlannerObserver`

- **Subject:** the draft returned by `CopilotPlannerRuntime` before it hits `normalize_plan_draft`.
- **Evaluator:** read `ChildMemoryService` context + recent `ProgressReport`, check the draft against the child's trajectory (e.g. avoid exercises the last report flagged as discouraging).
- **Injection:** same channel as the blog — re-run the Copilot turn with an injected system message describing the mismatch, up to N retries. Already well-scoped because this path is offline.

---

## 6. Recommendations

Ordered by impact × effort. None of these require rewriting existing services.

### R1. Introduce an explicit `SessionEventBus` (small, enabling)
- New module `backend/src/services/session_events.py` with a minimal async pub/sub: `subscribe(event_type, handler)`, `publish(event)` (fire-and-forget via `asyncio.create_task`), `_bg_tasks: set[Task]` for GC safety (copy the blog's discipline exactly).
- Events: `ConversationItemAdded { role, text, session_id, agent_id, ts }`, `ToolInvoked { service, tool_name, args, result_or_error }`, `PlannerResponseReady { service, payload }`.
- Wire `VoiceProxyHandler`, `InsightsService`, `CopilotPlannerRuntime` to publish on these. No behaviour change on day one — `TargetTokenTally` becomes the first subscriber.
- **Value:** unlocks every subsequent recommendation with a 200-line change.

### R2. Ship `SafeguardingObserver` as the first consumer (high value, medium effort)
- Async, single-flight (`_evaluating` + `_pending_eval`), runs every 2-3 user turns or 10s whichever comes first.
- Uses a dedicated Azure OpenAI deployment (env: `WULO_OBSERVER_DEPLOYMENT`); falls back to disabled if unset so local dev isn't blocked.
- Categories specific to child SLT context: disclosure-of-harm, self-harm/ideation, unsafe-home, distress-escalation, adult-present-coercion.
- Violation action: (i) emit `wulo.safeguard_flag` to the **therapist rail** (new channel — do **not** interrupt the child agent unless category is `acute`), (ii) persist to a new `safeguarding_flags` table linked to session_id, (iii) only inject a gentle redirect into the child agent for `distress-escalation`.
- Dedup per-session by category, with override for `acute` (always re-fire).

### R3. Resolve the "inject into live VoiceLive session" question explicitly (spike)
- Time-boxed investigation: does `azure.ai.voicelive.aio` accept `session.update` with a delta `instructions` field mid-session, and what is reset? Document the answer in `docs/voicelive-session-update-semantics.md`.
- This determines whether recommendation R2 can close the loop on the child agent or must rely on a therapist-side escalation only.

### R4. Add `InsightsObserver` second-pass on planner output (medium value, low effort)
- Extend `InsightsPlanner` Protocol → return existing payload **plus** `raw_planner_trace`.
- New class `InsightsGuardObserver` called by `InsightsService.ask` after the planner returns and before persistence. Checks: citation coverage, scope drift (cross-reference `InsightsRequestContext.scope`), PII in visualisation cells.
- On violation: downgrade — strip the offending citation/viz and append a `{answer_warnings: [...]}` field. Do **not** re-plan by default (cost).

### R5. Generalise `append_phoneme_rule` into `SystemRuleRegistry` (small, hygiene)
- The fact that the same rule is hand-appended in three places is the same smell the observer pattern fixes. Convert the three sites into subscribers on a `BuildingInstructions` event; register `PhonemeCitationRule` once.
- Opens the door for adding per-child rules (e.g. "avoid homework references until child re-engages" from the Planner) without new code in the three call sites.

### R6. Structured-output contract for observers (required for R2, R4)
- Copy the blog's schema discipline verbatim: every observer defines `VIOLATION_KEYS: ClassVar[list[str]]`, returns a JSON object with one boolean per key + `details: str`. Add a `response_format={"type":"json_object"}` where the Azure OpenAI deployment supports it; fall back to the blog's `{...}` substring parser.
- Validate against a Pydantic model in a new `backend/src/services/observer_schemas.py`.

### R7. Observability (cheap once R1 exists)
- Every published event and every observer decision → structured log (reuse `[insights-voice-timing]` format in `InsightsVoiceHandler`). Tag with `observer=`, `category=`, `decision=inject|flag|noop`, `latency_ms=`.
- Emit per-session counters (violations_detected, violations_deduped, evals_run, evals_skipped) to the existing pilot telemetry service.

### R8. Testing harness
- Add `tests/unit/observers/fake_session_bus.py` — publish a scripted list of `ConversationItemAdded` events, assert the observer made the expected injection/flag. Mirrors the blog's implicit test shape; no live VoiceLive needed.
- Golden-transcript regression tests per observer category.

### What to defer
- **Agent handoff semantics** — the blog warns about `session.current_agent` changing mid-evaluation. Wulo has no handoffs today; don't solve it until we do.
- **Token-threshold batching** instead of per-turn evaluation — premature until we see real production cost numbers from R2.
- **Unifying Planner + Insights into one Copilot runtime** — tempting because both use `CopilotClient`, but the observer pattern works cleanly with them separate. Keep separation.

---

## 7. Suggested sequencing

1. R1 (bus) + R3 (spike on VoiceLive `session.update`) — in parallel.
2. R6 (schemas) + R8 (test harness) — before any real observer ships.
3. R2 (SafeguardingObserver, therapist-rail only) behind `WULO_SAFEGUARDING_OBSERVER=1`. Ship dark, dogfood with a cooperating therapist, tune categories.
4. R4 (InsightsObserver) — cheap win, catches scope/PII regressions as Insights usage grows.
5. R5 + R7 — hygiene and visibility, continuous.
6. Extend child-agent injection (R2's second half) once R3 concludes.

---

## 8. TL;DR

The LiveKit observer pattern fits Wulo unusually well because Wulo's clinical and safeguarding concerns have exactly the property the pattern assumes: **they are complex, contextual, and MUST NOT compete with the child agent's latency or conversational warmth**. Wulo already has the ingredients (`ScoredTurnDispatcher` is a domain-specific observer, `append_phoneme_rule` is a static guardrail, `on_pre_tool_use` is a budget observer) — they just aren't unified. A ~200-LOC `SessionEventBus` + a `SafeguardingObserver` behind a feature flag is a low-risk, high-value first cut that matches the pattern one-for-one and also sets up the therapist Insights and Planner surfaces for second-pass guardrails without rewriting them.
