PYTHON ?= python

.PHONY: verify-phase-1 verify-phase-2
verify-phase-1:
	cd backend && $(PYTHON) -m pytest -k "phase_1 or learning or xapi" -v
	$(PYTHON) scripts/trace_evidence_phase_1.py --offline

verify-phase-2:
	cd backend && $(PYTHON) -m pytest -k "diagnostic or mastery or provenance" -v
	cd frontend && npm test -- src/learning/components/PathfinderPhase2.test.tsx
	cd frontend && PLAYWRIGHT_SKIP_WEBSERVER=true npx playwright test e2e/pathfinder-phase2.spec.ts --reporter=line
	$(PYTHON) scripts/trace_evidence_phase_2.py --offline