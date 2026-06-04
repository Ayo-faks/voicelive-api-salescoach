PYTHON ?= python

.PHONY: lint lint-explanations verify-phase-1 verify-phase-2 verify-phase-3 verify-phase-4 loadtest-smoke

# Pathfinder Learn — W2 contract guard.
# Fails CI if any ExplanationResult(...) construction site omits or empties
# wiki_citations. See MVP §4.1, "no citation, no answer."
lint-explanations:
	$(PYTHON) scripts/lint_explanations_have_provenance.py

lint: lint-explanations

verify-phase-1:
	cd backend && $(PYTHON) -m pytest -k "phase_1 or learning or xapi" -v
	$(PYTHON) scripts/trace_evidence_phase_1.py --offline

verify-phase-2:
	cd backend && $(PYTHON) -m pytest -k "diagnostic or mastery or provenance" -v
	cd frontend && npm test -- src/learning/components/PathfinderPhase2.test.tsx
	cd frontend && PLAYWRIGHT_SKIP_WEBSERVER=true npx playwright test e2e/pathfinder-phase2.spec.ts --reporter=line
	$(PYTHON) scripts/trace_evidence_phase_2.py --offline

verify-phase-3:
	cd backend && $(PYTHON) -m pytest -k "career or multilingual or advisor" -v
	cd frontend && npm test -- src/learning/components/PathfinderPhase3.test.tsx
	cd frontend && PLAYWRIGHT_SKIP_WEBSERVER=true npx playwright test e2e/pathfinder-phase3.spec.ts --reporter=line
	$(PYTHON) scripts/trace_evidence_phase_3.py --offline

verify-phase-4:
	cd backend && $(PYTHON) -m pytest -k "phase_4 or kpi or canary" -v
	$(PYTHON) scripts/trace_evidence_phase_4.py --tenant tenant-phase-4 --offline-fixtures

# Hermetic k6 load smoke for the /internal/agent-mesh/score route. Starts a
# local real-socket server, runs k6 SMOKE=1 with SLO thresholds, tears it down.
# No-ops with exit 0 if k6 is not installed. See backend/loadtest/README.md for
# the manual staging ramp.
loadtest-smoke:
	PYTHON=$(PYTHON) bash backend/loadtest/run_smoke.sh
