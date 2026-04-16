# Session Summary — 15 April 2026

## Objective

Extend the deterministic Step 4 vowel-blending drill pattern from the earlier `/r/` rollout to the remaining target sounds `/k/`, `/s/`, `/sh/`, and `/th/`, then harden the Azure runtime path so the hosted drill lexicon survives future `azd provision` runs.

The target design for this slice was:

- keep drill-model speech deterministic through app-owned whole-utterance tokens
- use one combined custom lexicon source of truth for all Step 4 drill sounds
- keep child-facing transcript text readable
- preserve the normal Voice Live path for non-drill turns
- remove live-only runtime drift around `AZURE_CUSTOM_LEXICON_URL`

## Problem

After the Step 4 `/r/` rollout, four follow-up issues remained.

1. The same deterministic token pattern needed to be carried across the remaining vowel-blending sounds.
2. The runtime lexicon URL was still configured as live Container App drift rather than deployment-managed infrastructure state.
3. The combined drill lexicon had one clinically meaningful phoneme mismatch: `TH_THOUGH_MODEL` was mapped to `θəʊ` instead of the voiced `ðəʊ` target.
4. The first staging `azd provision --preview` showed broader Azure drift, so the infrastructure change was not safe to apply until the preview was explained and narrowed.

## Decision

We kept the `/r/` design and generalized it rather than inventing a second control path.

The operating decisions were:

- reuse the exact deterministic token architecture already proven for `/r/`
- treat `data/lexicons/drill-lexicon.xml` as the combined source of truth for Step 4 drill tokens
- keep the hosted blob name stable as `drill-lexicon.xml`
- move `AZURE_CUSTOM_LEXICON_URL` into azd and Bicep as secret-backed infrastructure state
- change only real mismatches; do not churn already-correct prompt or frontend files
- classify broader preview drift explicitly before applying infrastructure changes

## Scope Clarification

An important engineering detail: much of the code-side rollout for `/k/`, `/s/`, `/sh/`, and `/th/` had already landed by the time this session started.

When we inspected the repo, these items were already aligned to the `/r/` pattern:

- `data/exercises/k-vowel-blending-exercise.prompt.yml`
- `data/exercises/s-vowel-blending-exercise.prompt.yml`
- `data/exercises/sh-vowel-blending-exercise.prompt.yml`
- `data/exercises/th-vowel-blending-exercise.prompt.yml`
- `frontend/src/utils/drillTokens.ts`
- `frontend/src/utils/drillTokens.test.ts`

So the work in this session was not a bulk rewrite. It was a targeted completion and hardening pass:

- verify the remaining sound rollout is consistent
- fix the one real phoneme mismatch in the combined lexicon
- publish the combined lexicon to staging
- remove infra drift around the lexicon URL
- apply the staging provision safely without regressing the custom domain binding

## Architecture

### Exercise prompt layer

The remaining Step 4 prompt files already used exact model tokens such as:

- `K_KEY_MODEL`, `K_COW_MODEL`, `K_COO_MODEL`, `K_KAY_MODEL`
- `S_SEE_MODEL`, `S_SIGH_MODEL`, `S_SEW_MODEL`, `S_SUE_MODEL`
- `SH_SHE_MODEL`, `SH_SHY_MODEL`, `SH_SHOW_MODEL`, `SH_SHOE_MODEL`
- `TH_THEE_MODEL`, `TH_THIGH_MODEL`, `TH_THOUGH_MODEL`, `TH_THOO_MODEL`

That means the model now has one explicit responsibility in Step 4 drill turns: emit the exact app-owned token for the target blend.

### Frontend display layer

The transcript normalization layer was already prepared for the expanded token set.

The frontend maps drill tokens back to child-friendly text, for example:

- `K_KEY_MODEL` → `k-ee, key`
- `S_SEW_MODEL` → `sss-oh, sew`
- `SH_SHOE_MODEL` → `sh-oo, shoe`
- `TH_THOUGH_MODEL` → `th-oh, though`

Streaming-safe token replacement remained intact, so raw tokens do not flash in the child-facing transcript.

### Lexicon runtime layer

The combined lexicon file now serves as the runtime source of truth for all supported Step 4 drill sounds:

- `/r/`
- `/k/`
- `/s/`
- `/sh/`
- `/th/`

The hosted runtime blob path without credentials is:

- `https://ste5dj24rvkgx2cdata.blob.core.windows.net/lexicons/drill-lexicon.xml`

The live app uses a SAS-backed URL, but the SAS query string is intentionally not recorded here.

### Infrastructure layer

The critical hardening change in this session was to stop treating `AZURE_CUSTOM_LEXICON_URL` as an out-of-band runtime patch.

The infrastructure now threads the lexicon URL through:

- azd environment state
- `infra/main.parameters.json`
- a secure Bicep parameter
- Container App secret storage
- `secretRef`-based runtime env injection

This means future `azd provision` runs preserve the lexicon path instead of overwriting it.

## What Changed

### 1. Corrected the combined `/th/` lexicon entry

The only drill-content change required in this session was inside the combined lexicon file.

We changed the `TH_THOUGH_ALIAS` phoneme from the voiceless form `θəʊ` to the voiced target `ðəʊ`.

That is the right correction for `though` and removes a clinically incorrect baseline from the hosted drill lexicon.

Updated file:

- `data/lexicons/drill-lexicon.xml`

### 2. Audited the remaining sound rollout and confirmed parity

We verified that the four remaining Step 4 prompt files were already aligned to the deterministic token pattern from the `/r/` rollout.

We also verified that the frontend token display map and tests already covered the expanded token set.

No additional code change was needed in those files.

### 3. Published the combined drill lexicon to staging

The combined `drill-lexicon.xml` file was uploaded to the staging Azure storage account and the live staging app remained pointed at the stable `drill-lexicon.xml` blob name.

This avoided any blob-name churn during rollout.

### 4. Moved lexicon URL wiring into deployment-managed infrastructure

We added secure lexicon URL plumbing through the existing azd and Bicep path.

Updated files:

- `infra/main.bicep`
- `infra/main.parameters.json`
- `infra/resources.bicep`

The important runtime change is that the live Container App now exposes:

- `AZURE_CUSTOM_LEXICON_URL` via `secretRef: azure-custom-lexicon-url`

instead of relying on an inline manually patched value.

### 5. Reduced preview noise so the infrastructure diff could be reviewed safely

Before applying the infra change, we inspected the staging preview drift resource by resource.

Two template areas were tightened to better match live Azure intent:

- Azure AI deployments now explicitly declare the live RAI policy and the embedding model version
- PostgreSQL Flexible Server now explicitly declares live default auth and storage settings that had previously appeared only as Azure-side defaults

These were not feature changes. They were deployment-safety changes that made the preview easier to classify.

### 6. Applied the staging provision without regressing the custom domain binding

We normalized the missing `AZURE_RESOURCE_GROUP` azd environment value for `salescoach-swe`, ran:

- `AZURE_EXTENSION_DIR=/tmp/az-noext azd provision --environment salescoach-swe`

and verified that:

- the provision succeeded
- `AZURE_CUSTOM_LEXICON_URL` became secret-backed on the live Container App
- `staging-sen.wulo.ai` remained attached
- staging health stayed green

## Validation

### Code-level validation

Focused checks passed:

- backend: `tests/unit/test_config.py`, `tests/unit/test_websocket_handler.py`
- frontend: `frontend/src/utils/drillTokens.test.ts`
- frontend build: `npm run build`

These checks covered:

- config loading of `AZURE_CUSTOM_LEXICON_URL`
- Voice Live session wiring for `custom_lexicon_url`
- deterministic token normalization for the expanded sound set
- streaming-safe transcript replacement

### Infrastructure validation

The infrastructure path was validated with:

- `az bicep build --file infra/main.bicep`
- `AZURE_EXTENSION_DIR=/tmp/az-noext azd provision --preview --no-prompt --environment salescoach-swe`

The final preview was accepted only after the remaining differences were classified as one of:

- provider-managed or read-only fields
- benign default normalization
- the intended `AZURE_CUSTOM_LEXICON_URL` secret-backed wiring

### Live staging validation

After apply, we verified in staging that:

- the Container App now exposes `AZURE_CUSTOM_LEXICON_URL` through `secretRef`
- the secret inventory includes `azure-custom-lexicon-url`
- the live custom domain binding still includes `staging-sen.wulo.ai`
- `https://staging-sen.wulo.ai/api/health` returned `{"status":"ok"}`

## Current State

The system is now in this state:

1. Step 4 deterministic drill tokens are in place across `/r/`, `/k/`, `/s/`, `/sh/`, and `/th/`.
2. The combined lexicon file is the repo-side source of truth for all supported Step 4 drill tokens.
3. The hosted staging blob path is stable at `drill-lexicon.xml`.
4. The live staging Container App now gets `AZURE_CUSTOM_LEXICON_URL` through deployment-managed secret wiring.
5. The staging custom domain binding remained intact throughout the infrastructure rollout.
6. Conversational Voice Live turns remain unaffected.

## What We Did Not Change

We intentionally did not change:

- the existing Voice Live session creation behavior beyond how the env value is supplied
- the `/api/tts` path as the primary drill runtime path
- the custom-domain configuration model
- non-drill exercise flows
- a broader SSML fallback implementation

This kept the session tightly scoped to deterministic drill rollout completion and lexicon deployment hardening.

## Recommendation

The infrastructure side of the drill lexicon path is now in a good state.

The next engineering step should not be more infra work. It should be a repeatable acoustic tuning workflow.

### Recommended next step

Build a small tuning harness around Azure Speech synthesis plus recognition to evaluate candidate IPA entries before updating the hosted `drill-lexicon.xml` content.

The important operational rule should remain:

- change lexicon content freely
- do not change the blob name unless the runtime contract truly needs to change

That keeps future tuning iterations low-risk, because the deployment-managed URL can stay stable while only the blob contents evolve.

## Files Changed In This Session

### Runtime asset

- `data/lexicons/drill-lexicon.xml`

### Infrastructure

- `infra/main.bicep`
- `infra/main.parameters.json`
- `infra/resources.bicep`

### Deployment record

- `.azure/deployment-plan.md`

### Audited and confirmed already aligned

- `data/exercises/k-vowel-blending-exercise.prompt.yml`
- `data/exercises/s-vowel-blending-exercise.prompt.yml`
- `data/exercises/sh-vowel-blending-exercise.prompt.yml`
- `data/exercises/th-vowel-blending-exercise.prompt.yml`
- `frontend/src/utils/drillTokens.ts`
- `frontend/src/utils/drillTokens.test.ts`