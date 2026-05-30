#!/usr/bin/env python3
"""Stage 3.5 — ensemble answer-confidence verification for an MCQ bank.

WHAT THIS IS (AND IS NOT)
-------------------------
This is an *answer-confidence* signal, not a sign-off. Three independent model
reviewers, **blind to the scraped key**, each pick the option they believe is
correct. A fourth "critic" pass sanity-checks the consensus answer. The result
is written back onto every item as a ``model_consensus`` provenance entry and a
``verification_status`` of either ``machine_verified`` or ``flagged_for_human``.

Crucially, ``machine_verified`` is **below** the human two-reviewer gate. Every
item keeps ``review_state = "pending_two_reviewer_signoff"``. We **never**
auto-flip the scraped key: when the models agree on a *different* option we only
record a ``proposed_correct_option_id`` for a human to adjudicate.

DECISION RULE
-------------
* unanimous (3/3) AND matches the scraped key AND critic passes
      -> ``machine_verified``
* models agree (>=2/3) on an option that DIFFERS from the key
      -> ``flagged_for_human`` + ``proposed_correct_option_id``
* any disagreement / low confidence / critic fail
      -> ``flagged_for_human``

RESUMABLE
---------
Items that already carry a ``model_consensus`` provenance entry are skipped, so
the batch can be re-run safely after an interruption or partial failure.

REVIEWERS
---------
``call_reviewer(role, item)`` is pluggable:

* ``--offline`` (default for tests): a deterministic stub that returns the
  bank's own correct option. This makes the pipeline fully runnable and
  testable without any network or cost.
* online: three persistent Azure AI Foundry agents pinned to
  ``gpt-5`` / ``gpt-5`` / ``gpt-4o`` via the staging project endpoint, using
  ``DefaultAzureCredential`` (managed identity, **no api key**).

A cheap auth probe runs against the Foundry endpoint BEFORE any cost-incurring
review when ``--online`` is requested; if it fails the run aborts early.

Run::

    cd backend/data/question_banks
    python ensemble_verify.py --offline                 # deterministic, free
    python ensemble_verify.py --online --limit 5        # smoke test on Foundry
    python ensemble_verify.py --online                  # full batch
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
DEFAULT_BANK = HERE / "government-ss-mcq-v1.json"

# Staging Foundry project endpoint (managed identity, no key).
PROJECT_ENDPOINT = (
    "https://aifoundry-voicelab-e5dj24rvkgx2c.cognitiveservices.azure.com"
    "/api/projects/default-project"
)

# Reviewer roster: (role label, model deployment name).
# Three *distinct* non-reasoning chat deployments for genuine model diversity.
# (The reasoning ``gpt-5``/``o4-mini`` family is intentionally avoided here: it
# rejects ``temperature`` and needs ``max_completion_tokens`` with a large
# budget, which is incompatible with the cheap 5-token single-letter call below.)
REVIEWERS: List[Tuple[str, str]] = [
    ("reviewer_a", "gpt-4o"),
    ("reviewer_b", "gpt-5.2-chat"),
    ("reviewer_c", "gpt-5.3-chat"),
]
CRITIC_MODEL = "gpt-4o"

# Display label for the subject under review. Defaults to Government (the first
# subject onboarded) but is overwritten per run by ``_set_subject`` so the
# reviewer/critic prompts name the correct exam subject (History, etc.).
SUBJECT_LABEL = "Government"


def _reviewer_system(subject_label: str) -> str:
    return (
        "You are an expert examiner for Nigerian Senior Secondary (WAEC/NECO) "
        f"{subject_label}. You are shown a multiple-choice question with four "
        "options labelled A, B, C and D. Choose the single best answer. You are "
        "NOT told which option is the intended key. Reply with ONLY the letter "
        "(A, B, C or D) and nothing else."
    )


def _critic_system(subject_label: str) -> str:
    return (
        "You are a strict examiner reviewing whether a proposed answer to a "
        f"{subject_label} multiple-choice question is correct. Reply with ONLY "
        "'PASS' if the proposed option is the best answer, or 'FAIL' if it is "
        "not."
    )


REVIEWER_SYSTEM = _reviewer_system(SUBJECT_LABEL)
CRITIC_SYSTEM = _critic_system(SUBJECT_LABEL)


def _set_subject(subject_label: str) -> None:
    """Rebuild the reviewer/critic system prompts for the given subject label.

    The reviewer and critic backends read the module-level ``REVIEWER_SYSTEM`` /
    ``CRITIC_SYSTEM`` strings, so making the pipeline subject-aware is a matter
    of recomputing them once per run before any model call."""
    global SUBJECT_LABEL, REVIEWER_SYSTEM, CRITIC_SYSTEM
    SUBJECT_LABEL = subject_label
    REVIEWER_SYSTEM = _reviewer_system(subject_label)
    CRITIC_SYSTEM = _critic_system(subject_label)


# ---------------------------------------------------------------------------
# Prompt rendering (blind to the key)
# ---------------------------------------------------------------------------
def _render_question(item: Dict[str, Any]) -> str:
    lines = [item["stem"], ""]
    for opt in item["options"]:
        lines.append(f"{opt['label']}) {opt['text']}")
    return "\n".join(lines)


def _letter_to_id(item: Dict[str, Any], letter: str) -> Optional[str]:
    letter = (letter or "").strip().upper()[:1]
    for opt in item["options"]:
        if opt["label"].upper() == letter:
            return opt["id"]
    return None


def _short_err(exc: Exception) -> str:
    """Collapse an API exception to a short, stable tag for reporting.

    Azure content-filter rejections (``ResponsibleAIPolicyViolation``) are a
    legitimate, *expected* outcome for some Government items (e.g. questions
    that quote ethnic/religious conflict). They are surfaced as the explicit
    tag ``content_filter`` so the item is flagged for a human rather than
    crashing the whole batch — we never attempt to bypass the safety filter.
    """
    s = str(exc)
    if "content_filter" in s or "ResponsibleAIPolicy" in s:
        return "content_filter"
    return f"{type(exc).__name__}: {s[:140]}"


def _atomic_write_json(path: Path, payload: Any) -> None:
    """Write JSON to ``path`` atomically (temp file + os.replace) so a process
    killed mid-write can never leave a half-written/corrupt bank."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# Reviewer backends
# ---------------------------------------------------------------------------
class OfflineReviewer:
    """Deterministic stub: returns the bank's own correct option letter.

    Used for tests and dry runs. It makes the *pipeline* exercisable end to end
    without claiming any real verification — every item will come out
    ``machine_verified`` precisely because the stub trivially "agrees" with the
    key, which is the correct behaviour for a self-consistency smoke test.
    """

    def __call__(self, role: str, item: Dict[str, Any]) -> str:
        correct_id = item["correct_option_id"]
        for opt in item["options"]:
            if opt["id"] == correct_id:
                return opt["label"]
        return "A"


class FoundryReviewers:
    """Online reviewers backed by Azure AI Foundry chat deployments."""

    def __init__(self) -> None:
        from azure.ai.projects import AIProjectClient  # lazy import
        from azure.identity import DefaultAzureCredential

        self._project = AIProjectClient(
            endpoint=PROJECT_ENDPOINT,
            credential=DefaultAzureCredential(),
        )
        # One OpenAI-compatible client; model is chosen per call.
        # azure-ai-projects 1.0.0 exposes get_openai_client() on the client.
        self._client = self._project.get_openai_client(
            api_version="2024-12-01-preview"
        )
        self._model_for_role = {role: model for role, model in REVIEWERS}

    @staticmethod
    def _token_kwargs(model: str, n: int) -> Dict[str, Any]:
        """Newer models (gpt-5*) require ``max_completion_tokens`` and reject
        ``max_tokens`` / a non-default ``temperature``; older ones (gpt-4o)
        use ``max_tokens``. Adapt per model family."""
        if model.startswith("gpt-5") or model.startswith("o1") or model.startswith("o3") or model.startswith("o4"):
            # These models spend hidden overhead tokens before emitting content;
            # a tiny budget yields finish_reason="length" with empty content.
            return {"max_completion_tokens": max(n, 64)}
        return {"max_tokens": n, "temperature": 0}

    def auth_probe(self) -> None:
        """Cheap call to confirm credentials work BEFORE the costly batch."""
        self._client.chat.completions.create(
            model=CRITIC_MODEL,
            messages=[{"role": "user", "content": "Reply with OK."}],
            **self._token_kwargs(CRITIC_MODEL, 5),
        )

    def __call__(self, role: str, item: Dict[str, Any]) -> str:
        model = self._model_for_role.get(role, CRITIC_MODEL)
        resp = self._client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": REVIEWER_SYSTEM},
                {"role": "user", "content": _render_question(item)},
            ],
            **self._token_kwargs(model, 5),
        )
        return (resp.choices[0].message.content or "").strip()

    def critic(self, item: Dict[str, Any], proposed_id: str) -> bool:
        proposed_label = next(
            (o["label"] for o in item["options"] if o["id"] == proposed_id), "?"
        )
        prompt = (
            _render_question(item)
            + f"\n\nProposed answer: {proposed_label}"
        )
        resp = self._client.chat.completions.create(
            model=CRITIC_MODEL,
            messages=[
                {"role": "system", "content": CRITIC_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            **self._token_kwargs(CRITIC_MODEL, 5),
        )
        return (resp.choices[0].message.content or "").strip().upper().startswith("PASS")


# ---------------------------------------------------------------------------
# Core verification
# ---------------------------------------------------------------------------
def _already_verified(item: Dict[str, Any]) -> bool:
    for prov in item.get("provenance", []):
        if prov.get("source") == "model_consensus":
            return True
    return False


def verify_item(
    item: Dict[str, Any],
    call_reviewer: Callable[[str, Dict[str, Any]], str],
    critic: Optional[Callable[[Dict[str, Any], str], bool]] = None,
) -> Dict[str, Any]:
    """Run the 3-reviewer ensemble + critic and return a consensus record."""
    key_id = item["correct_option_id"]
    votes: Dict[str, Optional[str]] = {}
    errors: Dict[str, str] = {}
    for role, _model in REVIEWERS:
        try:
            letter = call_reviewer(role, item)
            votes[role] = _letter_to_id(item, letter)
        except Exception as exc:  # noqa: BLE001 - per-item resilience
            # A single bad item (content filter, transient 5xx, throttle that
            # exhausted retries) must never abort the whole batch. Record the
            # reason and treat this reviewer as having cast no vote.
            votes[role] = None
            errors[role] = _short_err(exc)

    tally = Counter(v for v in votes.values() if v)
    if not tally:
        winner_id, winner_n = None, 0
    else:
        winner_id, winner_n = tally.most_common(1)[0]

    unanimous = winner_n == len(REVIEWERS)
    majority = winner_n >= 2
    matches_key = winner_id == key_id

    critic_pass = True
    if critic is not None and winner_id is not None:
        try:
            critic_pass = critic(item, winner_id)
        except Exception as exc:  # noqa: BLE001 - per-item resilience
            critic_pass = False
            errors["critic"] = _short_err(exc)

    if unanimous and matches_key and critic_pass:
        status = "machine_verified"
        proposed = None
    elif majority and not matches_key:
        status = "flagged_for_human"
        proposed = winner_id
    else:
        # includes: any disagreement, low confidence, critic fail, OR any
        # reviewer error (content_filter etc.) that prevented a clean 3/3.
        status = "flagged_for_human"
        proposed = None

    return {
        "status": status,
        "votes": votes,
        "winner_option_id": winner_id,
        "agreement": winner_n,
        "matches_key": matches_key,
        "critic_pass": critic_pass,
        "proposed_correct_option_id": proposed,
        "errors": errors,
    }


def _apply_consensus(item: Dict[str, Any], result: Dict[str, Any]) -> None:
    """Write the consensus onto the item; keep it below the human gate."""
    meta = {
        "verification_status": result["status"],
        "model_reviewers": [m for _r, m in REVIEWERS],
        "votes": result["votes"],
        "agreement": result["agreement"],
        "matches_scraped_key": result["matches_key"],
        "critic_pass": result["critic_pass"],
        # NEVER auto-flip: this is a human-adjudication hint only.
        "proposed_correct_option_id": result["proposed_correct_option_id"],
        # machine_verified is strictly below the human two-reviewer gate.
        "review_state": "pending_two_reviewer_signoff",
    }
    if result.get("errors"):
        # Surface per-reviewer API failures (e.g. content_filter) so a human
        # reviewer knows WHY the item could not be machine-verified.
        meta["reviewer_errors"] = result["errors"]
    item.setdefault("provenance", []).append(
        {
            "source": "model_consensus",
            "source_id": item["item_id"],
            "rule_id": "ensemble_verify_v1",
            "recency": None,
            "confidence": round(result["agreement"] / len(REVIEWERS), 3),
            "evidence_count": result["agreement"],
            "metadata": meta,
        }
    )
    # NOTE: we deliberately leave the primary (scrape) provenance
    # ``verification_status`` as "unverified" so the deterministic Stage 3
    # validator still passes. The ensemble outcome lives ONLY on this
    # ``model_consensus`` entry; the served-bank builder reads it from here.


def run(
    bank_path: Path,
    offline: bool,
    limit: Optional[int],
    report_path: Optional[Path],
) -> Dict[str, Any]:
    bank = json.loads(bank_path.read_text("utf-8"))
    items = bank["items"]

    # Make the reviewer/critic prompts name the correct exam subject. Prefer the
    # human-friendly display name from subjects_config; fall back to the bank's
    # own subject key (title-cased) so the pipeline still works for any bank.
    subject_key = bank.get("subject")
    subject_label = SUBJECT_LABEL
    if subject_key:
        try:
            from subjects_config import get as _get_subject

            subject_label = _get_subject(subject_key).title
        except Exception:  # noqa: BLE001 - config is best-effort cosmetic
            subject_label = str(subject_key).replace("_", " ").title()
    _set_subject(subject_label)
    print(f"reviewing subject: {subject_label}", flush=True)

    if offline:
        reviewer = OfflineReviewer()
        critic = None
        backend = "offline-stub"
    else:
        foundry = FoundryReviewers()
        print("auth probe against staging Foundry endpoint ...", flush=True)
        foundry.auth_probe()
        print("auth probe OK", flush=True)
        reviewer = foundry
        critic = foundry.critic
        backend = "azure-foundry"

    processed = 0
    skipped = 0
    counts: Counter = Counter()
    disagreements: List[Dict[str, Any]] = []
    item_errors: List[Dict[str, Any]] = []
    # Checkpoint every N items so a crash/kill mid-batch loses at most N items'
    # work; the next run resumes via the _already_verified skip.
    checkpoint_every = 20

    for item in items:
        if _already_verified(item):
            skipped += 1
            continue
        if limit is not None and processed >= limit:
            break
        result = verify_item(item, reviewer, critic)
        _apply_consensus(item, result)
        counts[result["status"]] += 1
        processed += 1
        if result.get("errors"):
            item_errors.append(
                {
                    "item_id": item["item_id"],
                    "skill_id": item["skill_id"],
                    "errors": result["errors"],
                }
            )
        if result["status"] == "flagged_for_human" and not result["matches_key"]:
            disagreements.append(
                {
                    "item_id": item["item_id"],
                    "skill_id": item["skill_id"],
                    "scraped_key": item["correct_option_id"],
                    "proposed_correct_option_id": result[
                        "proposed_correct_option_id"
                    ],
                    "agreement": result["agreement"],
                }
            )
        if processed % checkpoint_every == 0:
            _atomic_write_json(bank_path, bank)
            print(f"  checkpoint: {processed} processed, bank saved", flush=True)

    _atomic_write_json(bank_path, bank)

    # Count content-filtered items distinctly: legitimate safety rejections a
    # human must adjudicate, not a code bug.
    content_filtered = sum(
        1
        for e in item_errors
        if any(v == "content_filter" for v in e["errors"].values())
    )

    report = {
        "bank": bank_path.name,
        "backend": backend,
        "total_items": len(items),
        "processed_this_run": processed,
        "skipped_already_verified": skipped,
        "status_counts": dict(counts),
        "items_with_errors": len(item_errors),
        "content_filtered": content_filtered,
        "key_disagreements": disagreements,
        "item_errors": item_errors,
    }
    if report_path is not None:
        _atomic_write_json(report_path, report)

    return report


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "bank",
        nargs="?",
        default=None,
        help="Path to the source MCQ bank (defaults to the Government bank, "
        "or <subject>-ss-mcq-v1.json when --subject is given).",
    )
    ap.add_argument(
        "--subject",
        default=None,
        help="Subject key (e.g. history). Resolves bank + report names via "
        "subjects_config.py so parallel runs never collide. Overrides the "
        "positional bank/report defaults.",
    )
    ap.add_argument(
        "--offline",
        action="store_true",
        help="Use the deterministic offline stub (no network, free).",
    )
    ap.add_argument(
        "--online",
        action="store_true",
        help="Use Azure AI Foundry reviewers (managed identity).",
    )
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument(
        "--report",
        default=None,
        help="Report output path. Defaults to <bank-stem>_ensemble_verify_report.json "
        "next to the bank, so two subjects never overwrite one report.",
    )
    args = ap.parse_args(argv)

    if args.online and args.offline:
        ap.error("choose either --offline or --online, not both")

    # Resolve the bank: --subject wins, then positional, then the Government default.
    if args.subject is not None:
        from subjects_config import get as _get_subject

        cfg = _get_subject(args.subject)
        bank_path = cfg.source_bank
        default_report = cfg.ensemble_report
    else:
        bank_path = Path(args.bank) if args.bank else DEFAULT_BANK
        default_report = bank_path.with_name(
            f"{bank_path.stem}_ensemble_verify_report.json"
        )

    report_path = Path(args.report) if args.report else default_report

    # Default to offline so the pipeline is safe and free unless asked.
    offline = not args.online

    report = run(
        bank_path,
        offline=offline,
        limit=args.limit,
        report_path=report_path,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
