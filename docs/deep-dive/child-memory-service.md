# The Wulo Child Memory Service — Deep Dive

The child memory service in [backend/src/services/child_memory_service.py](../../backend/src/services/child_memory_service.py) is the **governed long-term memory** for each child. It turns post-session signals into *proposals*, gates them through therapist review (with one narrow auto-approve rule), compiles approved items into a category-grouped summary, and feeds that summary into the planner, recommendation service, report service, and live voice session personalization. There is no LLM in this service — memory is fact-shaped, deterministic, and reviewer-anchored.

---

## 1. Inputs

Routes in [backend/src/app.py#L2355](../../backend/src/app.py#L2355) and the post-session hook at [app.py#L2111](../../backend/src/app.py#L2111).

**a. Direct request inputs:**
- `GET /api/children/<child_id>/memory/summary` — `child_id` only.
- `GET /api/children/<child_id>/memory/items?status=&category=&include_evidence=` — filters.
- `GET /api/children/<child_id>/memory/proposals?status=&category=&include_evidence=`.
- `POST .../memory/items` (manual entry) — `{ category, statement, memory_type?, detail?, confidence? }` plus the authenticated therapist user id.
- `POST .../memory/proposals/<proposal_id>/approve` or `/reject` — optional `review_note`.
- Implicit: post-session synthesis is fired from the session save flow with a `session_id`.

**b. Server-loaded context** (during `synthesize_session_memory`):
- The full saved session (`storage.get_session(session_id)`) — `child`, `exercise_metadata.targetSound`, `assessment.ai_assessment.engagement_and_effort.willingness_to_retry`, `assessment.pronunciation_assessment.accuracy_score`, `therapist_feedback.{rating, note}`, `timestamp`.
- Existing `child_memory_items` and `child_memory_proposals` for the same child+category — for de-duplication.
- All approved/active items for summary rebuilds.

**c. Constants that shape behaviour:**
- `ACTIVE_MEMORY_ITEM_STATUSES = {"approved", "active"}`.
- `LOW_RISK_AUTO_APPROVAL_RULES = {("targets", "constraint")}` — *only* `targets/constraint` proposals can auto-approve, and only above 0.8 confidence.
- `SUMMARY_CATEGORY_ORDER = (targets, effective_cues, ineffective_cues, preferences, constraints, blockers, general)`.
- `MAX_RUNTIME_PERSONALIZATION_ITEMS = 3` per category for live-session personalization.

---

## 2. Outputs

**a. Persisted records:**
- `child_memory_items` rows — `{ id, child_id, category, memory_type, status, statement, detail, confidence, provenance, author_type, author_user_id?, source_proposal_id? }`.
- `child_memory_proposals` rows — same shape with `status` ∈ `pending | approved | rejected` plus `reviewer_user_id`, `review_note`, `approved_item_id`.
- `child_memory_evidence_links` rows — `{ subject_type: item|proposal, subject_id, child_id, session_id?, practice_plan_id?, evidence_kind, snippet (≤240 chars), metadata }`.
- `child_memory_summary` row — `{ child_id, summary_text, grouped, source_item_count, last_compiled_at }` upserted on every state change.

**b. API response shapes:**
- `synthesize_session_memory` → `{ child_id, session_id, proposals: [...with evidence_links], auto_applied_items: [...], summary }`.
- `approve_proposal` → `{ proposal, approved_item, summary }`.
- `reject_proposal` → `{ proposal, summary }`.
- `create_manual_item` → `{ item: {...with evidence_links}, summary }`.
- `build_live_session_personalization(child_id)` → `{ child_id, active_target_sound, approved_targets, approved_constraints, approved_effective_cues, used_item_ids, summary_text, summary_last_compiled_at, source_item_count }`.
- `get_recommendation_provenance_inputs(child_id)` → `{ summary, active_items }` consumed by the recommendation service.

**c. Telemetry / audit events:** `child_memory_synthesized` (with proposal/auto-applied counts) on success and `child_memory_synthesis_failed` on error from [app.py#L2114](../../backend/src/app.py#L2114). HTTP routes log `memory.read|create|approve|reject` audit events with `resource_type=child_memory_*`.

---

## 3. Algorithm

The service is split into four flows: **synthesis** (signals → proposals/auto-items), **review** (proposal → approved item), **compile** (approved items → summary), and **read** (summary + items → consumers).

**Flow A — Post-session synthesis** (`synthesize_session_memory`):
1. Load the session; reject if missing or detached from a child.
2. `_build_session_proposals` extracts up to three signal-derived proposals:
   - **Targets / constraint** — if `exercise_metadata.targetSound` exists: `"Keep /<sound>/ as an active therapy target."` with confidence `0.86`.
   - **Effective cues / inference** — if `ai_assessment.engagement_and_effort.willingness_to_retry >= 7`: `"Encouragement and retry prompts appear to help the child stay engaged."` base confidence `0.68`.
   - **Blockers / inference** — if `pronunciation_assessment.accuracy_score < 70` and a target sound exists: `"The child still needs high-support practice for /<sound>/ productions."` base confidence `0.7`.
3. Apply `_adjust_confidence` based on `therapist_feedback.rating`:
   - `up` rating boosts positive-signal proposals by `+0.08`, dampens contrary signals by `-0.04`.
   - `down` rating drops positive signals by `-0.08`, boosts blockers by `+0.08`.
   - Clamped to `[0.0, 0.98]` (note: never reaches 1.0 — perfect certainty is not auto-derivable).
4. For each proposal, `_proposal_or_item_exists` deduplicates against existing items and proposals using `_normalize_statement` (lowercase + whitespace-collapse).
5. **Auto-approve gate** (`_should_auto_approve_proposal`): only if `(category, memory_type) == ("targets", "constraint")` AND `confidence >= 0.8`. The approved item's provenance is stamped `auto_approved: true`. **All other proposals must be reviewed by a therapist.**
6. Each persisted proposal/item gets an evidence link back to the originating session via `_link_session_evidence` (snippet truncated to 240 chars).
7. `rebuild_summary(child_id)` is called at the end so consumers see the new state immediately.

**Flow B — Manual entry** (`create_manual_item`):
- Therapist-authored items skip the proposal queue and are saved directly as `status=approved`, `author_type=therapist`, `provenance.source=therapist_manual_entry`, then `rebuild_summary` runs.

**Flow C — Review** (`approve_proposal` / `reject_proposal`):
- Status check: `proposal.status == pending` is required, else `ValueError`.
- Approve: persist a new `child_memory_item` with `author_type=therapist`, `author_user_id=reviewer`, `source_proposal_id=proposal.id`; `_copy_evidence_links` clones session evidence from the proposal to the new item so audit trail is preserved across the proposal→item boundary.
- Reject: only updates the proposal record (no item is created).
- Both paths call `rebuild_summary` on the child.

**Flow D — Summary compile** (`rebuild_summary`):
- Pull active items (`status ∈ {approved, active}`).
- `_group_items_for_summary` distributes into the seven fixed categories (unknown categories fall into `general`).
- `_build_summary_text` joins per-category statements with deterministic labels:
  > *"Active targets: Keep /s/ as an active therapy target. Effective cues: Encouragement and retry prompts appear to help the child stay engaged."*
- `storage.upsert_child_memory_summary` writes both the grouped form (machine-readable) and the joined text (human-readable), plus `source_item_count` for staleness checks.

**Flow E — Live session personalization** (`build_live_session_personalization`):
- Reads active items, slices the top `MAX_RUNTIME_PERSONALIZATION_ITEMS = 3` per relevant category.
- `_resolve_active_target_sound` first looks at `detail.target_sound`/`targetSound`, then falls back to a regex `/.../` extraction from the statement, lowercased — used by the avatar agent to instantiate the right exercise lexicon.

---

## 4. Memory

This *is* the memory service, so the question is what it persists vs. what it reads from elsewhere.

**a. Owned tables (writes):**
- `child_memory_items` — the canonical approved knowledge base.
- `child_memory_proposals` — pending review queue.
- `child_memory_evidence_links` — provenance bridge to sessions and plans.
- `child_memory_summary` — denormalized cache; rebuilt every state change.

**b. Read-only inputs from elsewhere:**
- `sessions.assessment.*` — pronunciation, engagement, transcripts (only metadata is consumed; no transcript text enters memory).
- `sessions.therapist_feedback` — used to nudge confidence.

**c. State machine** — proposals: `pending → approved` (creates an item, copies evidence) or `pending → rejected` (terminal). Items: created `approved`, can be deactivated externally (only `approved`/`active` are surfaced; other statuses are filtered out by `get_active_child_memory`).

**d. No LLM memory anywhere.** No embeddings, no vector store, no model-side conversation history. The "memory" surface presented to the planner, the avatar agent, and the report service is the deterministic `summary_text` plus a fixed-shape grouped object — i.e., text the therapist has approved, framed in a structure the LLM cannot expand.

**e. Cache-as-derived-state** — the summary is *always* a function of approved items; if it is missing, `get_child_memory_summary` calls `rebuild_summary` to regenerate it deterministically from the items table. There is no risk of summary/items drift surviving a single read.

---

## 5. Protection (security & safety)

**AuthZ** — every memory route uses `_require_child_access(child_id, allowed_roles={ROLE_THERAPIST, ROLE_ADMIN}, allowed_relationships=["therapist"])`. Approve/reject and manual-create require therapist role; reads are role+relationship gated. Parents cannot see proposals or evidence links — only therapists can.

**Human-in-the-loop is the central guarantee.** Auto-approval is restricted to the single tuple `("targets", "constraint")` at confidence `≥ 0.8`. Inferences (effective cues, blockers) and any preferences/general claims **always** require explicit therapist approval. This is the explicit answer to: *"can the AI quietly write things into the child's permanent record?"* — no, not unless it is restating the exercise's already-configured target sound.

**Status guards** — review actions require `status == pending`; double-approval and replay-after-reject are rejected with `ValueError`.

**De-duplication** — `_proposal_or_item_exists` uses normalized statements (case + whitespace insensitive) across both items and proposals to prevent the queue from accumulating near-identical entries from repeated sessions.

**Confidence is bounded** — `_adjust_confidence` clamps to `[0.0, 0.98]`. The auto-approve threshold is set at `0.8`, well below the cap, so stacking up-feedback boosts can't push borderline proposals across the line trivially.

**Provenance is mandatory** — every system-authored item carries `provenance.session_ids` and `source` (`exercise_target_sound`, `ai_assessment.engagement_and_effort`, `pronunciation_assessment`, `therapist_feedback`). Manual entries carry `source=therapist_manual_entry`. There is no anonymous memory.

**Evidence isolation** — evidence links carry a 240-char snippet and explicit `child_id`; cross-child contamination is prevented because every evidence write requires the child id of the subject.

**No raw transcript ingestion** — proposals are derived from structured assessment fields and metadata, not from the LLM-generated narrative text. The avatar agent's transcript never lands in memory unless a therapist re-types the relevant fact through manual entry.

**Failure isolation** — the post-session hook wraps `synthesize_session_memory` in try/except and emits `child_memory_synthesis_failed` telemetry; failures do not block session save.

**No write paths from external prompts** — the planner, recommendation service, avatar agent, and report service consume memory but cannot mutate it. Only the memory service's own routes can write, and they all run under therapist authZ.

---

## 6. Auditability

**Every approved fact is reconstructible end-to-end:**
1. `child_memory_item.source_proposal_id` (if any) → the originating proposal.
2. `child_memory_proposal.provenance.{session_ids, source}` → the assessment fields and session that produced it.
3. `child_memory_evidence_links` (copied from proposal to item on approve) → the session(s) and snippet of justification.
4. `proposal.reviewer_user_id` and `review_note` → who approved/rejected and why.
5. `item.author_type` and `author_user_id` → therapist vs. system attribution.
6. `provenance.auto_approved` flag and `provenance.therapist_feedback` → exactly which automation rule fired and how feedback influenced the confidence.

**Telemetry events** at [app.py#L2114](../../backend/src/app.py#L2114) and [app.py#L2134](../../backend/src/app.py#L2134):
- `child_memory_synthesized` — `{ child_id, session_id, proposal_count, auto_applied_count }`.
- `child_memory_synthesis_failed` — `{ child_id, session_id, error_class }`.

**Audit events** via `_log_audit_event` for every HTTP route:
- `memory.read` (`resource_type=child_memory_summary | child_memory_items | child_memory_proposals`).
- `memory.create` for manual items.
- `memory.approve` and `memory.reject` with `proposal_id`.

**Summary recomputability** — because `_build_summary_text` is deterministic over `child_memory_items`, you can replay any historical state by querying items as-of a timestamp and re-running `rebuild_summary` — useful for explaining "why did the planner see this fact on date X?".

**Cross-service traceability** — when the planner cites a memory item, when the recommendation service includes a memory id in `used_item_ids`, when the report service references `memory_summary_text`, and when the avatar agent uses `active_target_sound`, all of those references resolve back to specific `child_memory_item.id`s with full provenance chains. This closes the loop with the planner deep dive (LLM-grounded but cite-restricted), the recommendation deep dive (deterministic ranking with `used_item_ids`), the avatar deep dive (read-only personalization payload), and the report deep dive (frozen `snapshot.memory_summary_text`) — child memory is the **single source of truth they all read from, and the only one therapists can write to**.
