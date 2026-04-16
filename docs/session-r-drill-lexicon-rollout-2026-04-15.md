# Session Summary — 15 April 2026

## Objective

Implement the recommended pattern for clinically controlled Step 4 `/r/` drill speech in the Voice Live flow.

The target design was:

- use deterministic, app-owned whole-utterance tokens for drill-model lines
- map those tokens through a Voice Live custom lexicon
- keep child-facing text readable
- preserve the normal Voice Live path for conversational turns
- treat SSML as a fallback only if the lexicon path proved insufficient

## Problem

The existing Step 4 vowel-blending flow depended on prompt-level spelling hacks such as `rrr-ah, rah`.

That approach had three problems:

1. **It was not deterministic.** The LLM could vary the exact surface form.
2. **It was not app-controlled.** Speech behavior depended on prompt compliance rather than explicit product logic.
3. **It was acoustically fragile.** TTS could interpret repeated letters or token-like strings in unintended ways.

For a clinically sensitive drill, that is the wrong control surface.

## Decision

We moved Step 4 `/r/` modeled utterances to app-owned whole-utterance tokens and routed those tokens through Voice Live `custom_lexicon_url`.

The chosen tokens are:

- `R_RAH_MODEL`
- `R_ROO_MODEL`
- `R_ROW_MODEL`
- `R_REE_MODEL`

The important separation is now explicit:

- **Spoken form** is controlled by the app and Azure lexicon.
- **Visible form** is normalized in the frontend to child-friendly text such as `rrr-ah, rah`.

This keeps the main Voice Live path intact while making drill-model speech deterministic.

## Architecture

### Backend

Voice Live session creation now accepts an optional `AZURE_CUSTOM_LEXICON_URL` and passes it into the Azure standard voice configuration.

Updated files:

- `backend/src/config.py`
- `backend/src/services/websocket_handler.py`

### Exercise prompt layer

The Step 4 `/r/` vowel-blending exercise prompt no longer tells the model to invent repeated-letter approximations.

Instead, it instructs the model to emit exact app-owned tokens for the current target blend.

Updated file:

- `data/exercises/r-vowel-blending-exercise.prompt.yml`

### Frontend transcript/display layer

Assistant transcript text is normalized back to readable child-facing text while streaming and at final transcript time.

This prevents raw tokens from flashing in the UI and keeps stored conversation history readable for downstream analysis.

Updated and added files:

- `frontend/src/hooks/useRealtime.ts`
- `frontend/src/utils/drillTokens.ts`
- `frontend/src/utils/drillTokens.test.ts`

### Lexicon source of truth

The lexicon source file is stored in the repo and published to Azure Blob Storage for runtime use.

Added file:

- `data/lexicons/r-drill-lexicon.xml`

## What Changed

### 1. Deterministic Step 4 token path

Step 4 `/r/` modeled speech now uses exact tokens instead of prompt-level repeated-letter hacks.

This applies only to scripted drill-model lines.

### 2. Voice Live session support for custom lexicon

The app now supports `AZURE_CUSTOM_LEXICON_URL` as configuration and injects that URL into the Voice Live voice configuration.

If the variable is unset, behavior falls back cleanly to the existing path.

### 3. Child-facing transcript normalization

The frontend converts:

- `R_RAH_MODEL` → `rrr-ah, rah`
- `R_ROO_MODEL` → `rrr-oo, roo`
- `R_ROW_MODEL` → `rrr-oh, row`
- `R_REE_MODEL` → `rrr-ee, ree`

This replacement is streaming-safe, so partial token fragments do not appear in the child-facing transcript.

### 4. Hosted lexicon rollout in staging

The lexicon was hosted in the staging Azure storage account and wired into the live staging Container App.

Target environment:

- `salescoach-swe`
- resource group: `rg-salescoach-swe`
- Container App: `voicelab`
- staging URL: `https://staging-sen.wulo.ai`

Hosted blob path without credentials:

- `https://ste5dj24rvkgx2cdata.blob.core.windows.net/lexicons/r-drill-lexicon-v3.xml`

The live app uses a SAS-backed `AZURE_CUSTOM_LEXICON_URL`, but the SAS query string is intentionally not recorded in this document.

### 5. Staging application deploy

The updated application code was deployed to staging with `azd deploy` and the post-deploy health check remained green.

## Validation

### Code-level validation

Focused tests passed:

- backend: `test_config.py`, `test_websocket_handler.py`
- frontend: `drillTokens.test.ts`

These checks covered:

- config loading of `AZURE_CUSTOM_LEXICON_URL`
- Voice Live session wiring for `custom_lexicon_url`
- token-to-display normalization
- streaming-safe transcript replacement

### Staging validation

Verified in staging:

- the updated app deployed successfully
- the live Container App env var points at the v3 hosted lexicon blob
- `https://staging-sen.wulo.ai/api/health` returned `{"status":"ok"}` after rollout

## Acoustic Evaluation

We evaluated the lexicon path using Azure Speech synthesis plus recognition as a proxy for output quality.

Reason:

- this environment did not provide a reliable way to complete end-to-end manual listening for each live tokenized avatar turn
- the proxy is still good enough to compare whether candidates are collapsing into token/letter-name behavior or producing usable lexical targets

### Result 1: Alias-only lexicon was not sufficient

The first hosted lexicon version used alias-only entries.

That did not provide reliable control. Baseline token synthesis collapsed into unrelated outputs such as variants of `model`, `row`, or other non-clinical approximations.

Conclusion: alias-only control was too weak.

### Result 2: Initial phoneme pass was also weak

A first phoneme-backed attempt improved control directionally but still produced unstable recognition outputs.

That version was not strong enough to treat as production-grade.

### Result 3: Best-candidate sweep produced a usable but incomplete baseline

We ran a phoneme sweep and selected the least-bad candidates as the tuned lexicon baseline:

- `rah` → `ɹɑː`
- `roo` → `ɹuː`
- `row` → `ɹəʊ`
- `ree` → `ɹiː.ɹiː`

Observed outcome:

- `row` was the strongest result
- `rah` was acceptable
- `roo` was usable only as a homophone-level approximation
- `ree` remained weak

Conclusion: the tuned lexicon is a better baseline than alias-only, but it is still not clinically reliable across the full Step 4 target set.

## Current State

The feature is now in this state:

1. **Deterministic token path is implemented.**
2. **Voice Live custom lexicon integration is implemented.**
3. **Staging is deployed and wired to a hosted lexicon URL.**
4. **Frontend display text remains child-friendly.**
5. **Conversational Voice Live turns are unaffected.**
6. **Lexicon-only control improved the baseline but did not fully solve clinical output quality.**

## What We Did Not Change

We intentionally did **not** change:

- the existing `/api/tts` path as the primary runtime path
- the main conversation path for non-drill turns
- unrelated exercise flows
- a broad SSML refactor across the voice stack
- `custom_text_normalization_url`

This kept the implementation tightly scoped to the intended feature slice.

## Recommendation

The original recommendation was correct as a first implementation step: lexicon-first was the right thing to try.

That experiment is now complete enough to make a follow-up decision.

### Recommended next step

Introduce an **SSML-only fallback for fixed Step 4 drill-model lines**, while keeping normal conversational turns on the standard Voice Live path.

Reason:

- the token architecture is good and should be preserved
- the hosted lexicon path improved control but did not reach reliable clinical quality for all four targets
- `R_REE_MODEL` is the clearest weak point and should be the first fallback candidate if rollout is incremental

If product simplicity matters more than incremental rollout, it is reasonable to move **all fixed Step 4 model lines** to the existing `/api/tts` seam rather than mixing lexicon-only and SSML behavior by token.

## Files Changed In This Session

### Application code

- `backend/src/config.py`
- `backend/src/services/websocket_handler.py`
- `frontend/src/hooks/useRealtime.ts`

### Exercise and runtime assets

- `data/exercises/r-vowel-blending-exercise.prompt.yml`
- `data/lexicons/r-drill-lexicon.xml`

### Frontend utility and tests

- `frontend/src/utils/drillTokens.ts`
- `frontend/src/utils/drillTokens.test.ts`

### Test coverage

- `backend/tests/unit/test_config.py`
- `backend/tests/unit/test_websocket_handler.py`

### Environment template

- `.env.template`

## Short Version

We successfully shipped the deterministic token architecture, wired Voice Live to a hosted custom lexicon, deployed it to staging, and validated that the application remains healthy.

We also learned that lexicon-only output quality is not good enough for the full Step 4 `/r/` drill set.

That means the architectural experiment succeeded, but the acoustic result says the next implementation slice should be an SSML-only fallback for fixed drill-model lines.