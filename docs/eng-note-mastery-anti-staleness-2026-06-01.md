# Engineering Note — Keeping Mastery Estimates Fresh (Anti-Staleness)

**Date:** 2026-06-01
**Area:** Pathfinder Learn — adaptive mastery / diagnostics
**Commit:** `5875fdf` — *feat(learning): keep mastery estimates fresh (anti-staleness)*
**Status:** Implemented, unit + integration tested, committed to `main` (not yet pushed)

---

## 1. The Problem

Pathfinder Learn estimates each learner's mastery per skill (a Beta/BKT probability +
uncertainty, or an Elo rating + deviation) from their answers, and drives item selection,
the mastery heatmap, and learner memory facts from those estimates.

The estimates were **point-in-time and timeless**: once written, an estimate stayed exactly
as confident as the moment it was computed, no matter how much real time passed. That produced
three distinct staleness failure modes:

- **Stale-low** *(the reported case):* a learner who has since improved still shows an old gap,
  so the system keeps treating a now-secure skill as weak.
- **Stale-high:** a skill the learner has since forgotten never decays — the estimate stays
  high forever.
- **Stale-confident:** an old estimate is treated as just as *certain* as a fresh one. A reading
  from 90 days ago and one from 10 minutes ago were indistinguishable to the selector and heatmap.

A second, related problem lived in **learner memory**: teacher-approved facts like
*"needs targeted practice on fractions"* were never reconciled against current mastery. Once the
learner mastered fractions, the contradicting fact silently lingered.

**Why it matters:** stale estimates mean wrong item selection (re-drilling mastered skills,
ignoring forgotten ones), a misleading heatmap for teachers, and learner-facing memory that
contradicts reality.

---

## 2. What We Built

The core decision: **model staleness as honest uncertainty growth, not as a guessed
point-estimate rewrite.** We never "detect" that a learner improved or forgot — we let
confidence decay with age and let the adaptive loop re-gather evidence.

### a) Time foundation
- `MasteryEstimate` carries an `as_of` ISO-8601 timestamp (string, JSON-safe, optional for
  back-compat; `None` ⇒ no decay).
- `MasteryUpdateInput` gained `now` and `half_life_days` (default **30 days**, overridable
  per call).

### b) Decay in the estimators (`mastery.py`)
- **BetaBKT:** before applying a new answer, the `(a, b)` counters decay toward their priors
  by `0.5 ** (Δdays / half_life)`. This **preserves the observed evidence ratio** while
  inflating variance — i.e. the *mean* forgets toward 0.5 as evidence ages, which is the
  correct forgetting behaviour, and uncertainty strictly grows with the gap.
- **Elo:** Glicko-style idle inflation —
  `deviation = min(350, sqrt(dev² + c²·Δdays))` with `c = 20/day` — so a rating that hasn't
  been tested in a while becomes less certain instead of only ever shrinking.
- `Provenance.recency` (previously an unused field) is now populated with the prior estimate's
  `as_of`.

### c) Read-time freshness (no write needed)
- `MasteryEstimate.age_adjusted_uncertainty(now, half_life_days)` — a pure helper that widens
  the reported uncertainty based purely on age, so a stale-confident estimate *displays* as
  uncertain on the heatmap even before the learner answers anything new.

### d) Closing the loop — recency-aware selection (`diagnostic.py`)
- `selection_priority()` orders skills **weakest-and-stalest-first** using
  `age_adjusted_uncertainty`, so improved/decayed skills get re-tested.
- `heatmap_status()` uses the age-adjusted uncertainty, so a stale "secure" cell honestly
  drops to "developing".
- `DeterministicItemSelector` / `run_offline` / `api.answer_diagnostic` all pass `now`.
- `LearningApi.start()` now seeds the new session's estimates from the persisted cross-session
  prior, so the **first answer after a gap decays the stale prior** (previously every session
  started fresh and the gap was invisible).

### e) Memory-fact staleness (`memory_policy.py`, `repository.py`, `api.py`)
- Session-produced gap facts use a structured key `diagnostic_gap:<skill_id>`, giving a clean
  fact→skill link without fuzzy text matching.
- `classify_fact_staleness()` flags a gap fact as `skill_now_secure` when the backing skill is
  secure (and a strength fact as `skill_now_needs_support` when it regresses).
- `repository.mark_student_fact_stale()` (InMemory + SQL) flips a contradicted fact back to
  **`pending`** with a `staleness_reason` — re-queuing it for teacher review rather than
  silently editing learner memory.
- `LearningApi.review_fact_staleness()` runs the sweep and is idempotent (already-flagged /
  already-pending facts are skipped).

---

## 3. How We Debugged It

The work was test-driven, and two failures during development were instructive:

1. **Decay test failed: probability drifted ~0.14 between a fresh and a 90-day-late update.**
   The first instinct ("decay should preserve the mean a/(a+b)") was *wrong*. Forgetting
   *should* pull the mean toward 0.5 — that's the whole point. The fix was to assert on the
   **preserved evidence ratio** `(a-1)/(b-1)` instead of the mean, and to document explicitly
   that the mean is expected to drift toward 0.5 as evidence ages. The "bug" was the test's
   assumption, not the code.

2. **Duplicate `heatmap_status` definition.** While wiring recency into selection, an edit
   inserted a new `heatmap_status` next to `DeterministicItemSelector`, leaving the original
   (raw-uncertainty) version still defined earlier in the file — so the wrong definition could
   win depending on order. Caught by reading the diff; removed the stale original so there is a
   single, recency-aware definition.

3. **Integration test `ValidationError: lang Field required`.** The `StudentFactProposal`
   fixture omitted the required `lang` field. Pydantic surfaced it immediately; added
   `lang="en-NG"`.

**Verification approach:**
- Targeted unit + integration suite (decay, recency selection, fact staleness, memory policy,
  phase0/1, api, cat selector): **69 passing**.
- Full backend unit suite: **1112 passed, 14 failed** — and crucially, **all 14 failures were
  confirmed pre-existing and unrelated**:
  - 7 × `test_learner_memory_api` reference a `set_memory_consent` method that never existed
    (`git show HEAD:...api.py | grep -c set_memory_consent` → `0`).
  - 5 × `test_case_adapter_conformance` + 2 × `test_oneroster_import_smoke` fail on missing
    fixture directories in this environment.
- Diff audit: `api.py` was purely additive (59 insertions, 0 deletions); every deletion in the
  other files was an intentional replacement (recency-aware `heatmap_status`, `as_of`-aware
  estimate construction, `selection_priority` ordering).

**Note on UI testing:** this behaviour is *time- and cross-session-based* (decay over days,
facts re-queued across sessions), which a single Playwright session can't meaningfully exercise.
It is validated at the logic layer by injecting `now`. The only user-visible slice (a stale
"secure" skill demoting on the heatmap and resurfacing first) is covered by
`test_learning_recency_selection.py`.

---

## 4. Lessons Learned

- **Model staleness as uncertainty, not as a guess.** Inflating variance with age is honest,
  replayable from the event log, and keeps the system from inventing improvement/forgetting it
  never observed. Rewriting the point estimate would have been a lie with extra steps.
- **Question the test's assumption, not just the code.** The decay "failure" was a wrong
  expectation (mean preservation) hiding correct behaviour (mean forgets toward 0.5). Forgetting
  preserves the *evidence ratio*, not the mean.
- **A structured key beats fuzzy matching.** `diagnostic_gap:<skill_id>` gave a deterministic
  fact→skill link for staleness detection. Trying to match "struggles with fractions" text to a
  skill would have been brittle.
- **Don't silently edit learner memory.** Contradicted facts route back to the teacher approval
  queue (`status=pending` + `staleness_reason`) instead of being auto-deleted. Keeps a human in
  the loop and leaves an audit trail.
- **Keep new fields optional and back-compat.** `as_of=None ⇒ no decay` meant old events and the
  existing 49-test baseline kept passing; decay is a parameter change, not a migration.
- **Triage a failing full suite before blaming your change.** 14 red tests looked alarming;
  a one-line `git show HEAD | grep -c` proved they were pre-existing, saving a wild goose chase.
- **Watch behavioural side-effects of "obviously correct" changes.** Seeding sessions from the
  persisted prior changed returning-student diagnostics from "fresh each session" to "continues
  from prior mastery." It was the right call, but it's the kind of change that can quietly break
  a behavioural test — worth flagging.

---

## 5. Files Touched

| File | Change |
| --- | --- |
| `backend/src/learning/models.py` | `MasteryEstimate.as_of` + `age_adjusted_uncertainty()`; `StudentFactProposal.staleness_reason` |
| `backend/src/learning/mastery.py` | BetaBKT recency decay; Elo idle inflation; `now`/`half_life_days` inputs; populate `Provenance.recency` |
| `backend/src/learning/diagnostic.py` | `selection_priority()`; recency-aware `heatmap_status()`; pass `now` through selection/offline |
| `backend/src/learning/api.py` | seed session estimates from prior; pass `now`; `review_fact_staleness()` |
| `backend/src/learning/memory_policy.py` | `skill_id_from_fact_key()`; `classify_fact_staleness()` |
| `backend/src/learning/repository.py` | `mark_student_fact_stale()` (abstract + InMemory + SQL) |
| `backend/tests/unit/test_learning_mastery_decay.py` | new — decay/forgetting behaviour |
| `backend/tests/unit/test_learning_recency_selection.py` | new — selection + heatmap recency |
| `backend/tests/unit/test_learning_fact_staleness.py` | new — end-to-end fact re-queue |
| `backend/tests/unit/test_memory_policy.py` | classifier cases |
