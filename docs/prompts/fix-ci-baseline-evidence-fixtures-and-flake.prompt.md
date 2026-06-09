# Fix the red CI baseline: 7 missing-fixture failures + 1 logging flake

## Mission
`main` (HEAD `cc7e5db` on `origin/main`) has a **red CI baseline** of **8 failing
backend tests** that are **pre-existing** (they predate the recent safety work and
fail on a clean checkout). They keep `lint-and-test.yml` red, which masks future
real regressions. Make the backend test suite green **without weakening any real
assertion** and **without touching unrelated code**.

This is a **test-hygiene / fixtures** task only. Do NOT change application logic,
safeguarding, RLS, the calibration tile, or any feature code.

## Repo / environment facts (verified 2026-06-06)
- Workspace: `/home/ayoola/sen/voicelive-api-salescoach`
- Python venv: `source /home/ayoola/sen/.venv/bin/activate`
- Run backend tests from `backend/` with: `python -m pytest -p no:cacheprovider -o addopts="" -q`
- CI runs the **full** suite with no exclusions: `.github/workflows/lint-and-test.yml`
  step "Run Python tests" → `cd backend && python -m pytest -v` (env `PYTHONPATH: src:src/services`).
- A local Postgres 16 is available for the parity/RLS tests (NOT needed for this task):
  `export PGROOT="$HOME/sen/pgextract/root"; export LD_LIBRARY_PATH="$PGROOT/usr/lib/aarch64-linux-gnu:$PGROOT/usr/lib/postgresql/16/lib"; export POSTGRES_TEST_DATABASE_URL="postgresql://postgres@/pathfinder_rls?host=$HOME/sen/pgextract/sock&port=5433"`
  (If that Postgres isn't running, re-create it — see "Appendix: local Postgres" — but
  the 8 target failures do NOT depend on it.)

## The 8 failures, root-caused

### Group A — 5 × CASE adapter (curriculum-standards import)
- File: `backend/tests/unit/test_case_adapter_conformance.py`
- Expects a committed fixture at:
  `evidence/compliance/case_framework_nerdc_jss2_maths.json`
  (path = `Path(__file__).resolve().parents[3] / "evidence" / "compliance" / "case_framework_nerdc_jss2_maths.json"`,
  i.e. **repo-root** `evidence/compliance/…`, NOT under `backend/`).
- `test_case_fixture_is_present_for_evidence_bundle` hard-asserts `FIXTURE_PATH.is_file()`.
- The other 4 load that fixture (`test_case_adapter_loads_nerdc_jss2_maths_framework`)
  or build malformed docs in `tmp_path` (`rejects_*`). The `rejects_*` ones likely fail
  only because import/module setup references the missing fixture — verify per-test.

### Group B — 2 × OneRoster import (roster import)
- File: `backend/tests/unit/test_oneroster_import_smoke.py`
- `EVIDENCE_DIR = Path(__file__).resolve().parents[3] / "evidence" / "compliance" / "oneroster_smoke"`
- Needs `EVIDENCE_DIR/{stem}.csv` for each `stem in REQUIRED_COLUMNS`
  (import `REQUIRED_COLUMNS` from `src.common.oneroster`).
- Asserts: 2 orgs (`org-wulo-pilot`, `org-school-001`), 2 classes, 4 users with roles
  `{teacher, student, administrator}`. Whatever CSVs you create MUST satisfy these.

### Group C — 1 × logging flake
- `backend/tests/unit/test_events_endpoint.py::test_truncates_oversize_props`
- **Passes in isolation; fails only in the full run** (1709 passed / 8 failed full run).
- Uses `caplog` to assert a record with `event_props == {"_truncated": True}` is emitted
  when an oversize payload hits the events endpoint.
- Root cause: `caplog` only captures if the emitting logger **propagates** to root.
  Another test in the full run mutates logging config/propagation (or the logger is
  created with `propagate=False`), so the record isn't captured under full-run ordering.

## gitignore reality (important)
`.gitignore` currently has:
```
evidence/
!evidence/compliance/
evidence/compliance/bundle.zip
evidence/compliance/bundle.zip.manifest.json
```
So `evidence/` is ignored **except** `evidence/compliance/`. New files you add under
`evidence/compliance/` (the JSON + the `oneroster_smoke/*.csv`) WILL be trackable.
Confirm with `git check-ignore -v <path>` before committing — if a nested path is still
ignored, add a narrower `!evidence/compliance/oneroster_smoke/` un-ignore rule.

## Decide the approach per group (pick the lower-risk option, justify in the PR body)

**Preferred = commit real fixtures** (makes the import paths actually covered):
1. Look for the fixtures elsewhere first — they may exist in git history or another branch:
   `git log --all --oneline -- '*case_framework_nerdc_jss2_maths.json' '*oneroster_smoke*'`
   and `git show <rev>:<path>`. If found, restore them verbatim (authoritative).
2. If not in history, generate **minimal** fixtures that satisfy the exact assertions:
   - CASE JSON: minimal valid CASE framework doc with the keys the adapter requires
     (read `src/common/<case module>` to get the required document keys + association
     types; the test has `rejects_missing_document_keys` / `rejects_unsupported_association_type`
     / `rejects_dangling_association_origin` that document the schema).
   - OneRoster CSVs: the smallest set of `orgs/classes/users/...` CSVs that yield exactly
     2 orgs, 2 classes, 4 users with the 3 required roles.

**Fallback = explicit skip guards** (only if fixtures genuinely can't be reconstructed and
the import features are out-of-scope for the pilot):
- Convert the two `*_is_present_for_evidence_bundle` tests and their dependents to
  `pytest.mark.skipif(not <path>.exists(), reason="evidence bundle not present in this checkout")`.
- This is honest (skips, not fakes) and turns CI green, but leaves the import paths
  uncovered — note that explicitly in the PR.

**Flake (Group C) — fix the test, not the product:**
- Reproduce deterministically: run the flake AFTER a test that mutates logging, e.g.
  `python -m pytest backend/tests/unit -p no:cacheprovider -o addopts="" -q -k "events or <suspect>"`,
  or run the whole `tests/unit` dir to reproduce.
- Fix by making the assertion robust to propagation, the standard pytest way:
  in the test, set `caplog.set_level(logging.<LEVEL>, logger="<events logger name>")` and/or
  add a fixture that forces `logging.getLogger("<events logger>").propagate = True` for the
  test's duration. Identify the exact logger name from `src/.../events` (the endpoint that
  logs `{"_truncated": True}`; search `_truncated` and `event_props`).
- Do NOT weaken the assertion (still require the truncated record to be emitted).

## Hard constraints (learned the hard way in the prior session)
1. **Branch discipline.** Create a NEW branch off `origin/main`:
   `git fetch origin && git switch -c fix/ci-baseline-evidence-and-flake origin/main`.
   Do NOT commit on a detached or stale tree. Verify `git status` shows ONLY your intended files.
2. **Touch ONLY:** the two evidence test files (if adding skips), the events test file,
   and new fixture files under `evidence/compliance/`. Nothing else. Specifically do NOT
   touch: `backend/src/learning/api.py`, anything under `backend/src/safeguarding/`,
   `backend/src/services/learner_voice_websocket_handler.py`, the RLS migration, or any
   frontend file.
3. **No app-logic edits.** If a "fix" requires changing `src/` application code, STOP and
   report — it means the failure is a real bug, not a fixture gap.
4. **Verify provenance before assuming "mine vs not".** Use
   `git log --oneline -1 -- <file>` and `git merge-base --is-ancestor <commit> origin/main`.
5. **Leave untracked data artifacts alone:** `backend/data/calibration/`,
   `backend/data/c1/real_agent_eval_report_gpt4o.json` (regenerable; not part of this task).

## Definition of done
- `cd backend && python -m pytest -p no:cacheprovider -o addopts="" -q` → **0 failed**
  (skips allowed only via the documented fallback). Run it **twice** (ordering can vary) to
  prove the Group C flake is gone.
- `git status` shows only the intended files.
- Open a PR to `main` titled `test(ci): green the backend baseline (evidence fixtures + logging flake)`
  with a body that states, per group, whether you committed fixtures or added skip-guards and why.
- Do NOT deploy anything. Do NOT merge without the user's review.

## Appendix: recreate the local Postgres (only if you need the parity/RLS tests)
```
cd ~/sen/pgextract && export PGROOT="$HOME/sen/pgextract/root" \
  && export PGBIN="$PGROOT/usr/lib/postgresql/16/bin" \
  && export LD_LIBRARY_PATH="$PGROOT/usr/lib/aarch64-linux-gnu:$PGROOT/usr/lib/postgresql/16/lib" \
  && "$PGBIN/pg_ctl" -D pgdata -o "-k $HOME/sen/pgextract/sock -p 5433 -c listen_addresses=''" -l pg.log start
```
(The 8 target failures do NOT require Postgres.)

## Context you can trust (no need to re-derive)
- The recent safety work (learner safeguarding P1–P7, parent reports, RLS migration
  `20260606_000034_parental_consents_rls.py`, calibration-tile regression fix) is already
  committed and on `origin/main` at `cc7e5db`/`4bd5280`. Do not revisit it.
- These 8 failures are unrelated to that work and were red before it (verified:
  `test_oneroster_import_smoke.py` and `test_case_adapter_conformance.py` were introduced
  by commit `fb55fdb`, an ancestor of pre-push `main`).
