PYTHON ?= python

.PHONY: verify-phase-1
verify-phase-1:
	cd backend && $(PYTHON) -m pytest -k "phase_1 or learning or xapi" -v
	$(PYTHON) scripts/trace_evidence_phase_1.py --offline