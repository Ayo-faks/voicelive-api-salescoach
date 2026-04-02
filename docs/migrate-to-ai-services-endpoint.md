# Prompt: Drop-in migration from `cognitiveservices.azure.com` to `services.ai.azure.com` + `2026-01-01-preview`

## Goal

Switch the Voice Live WebSocket connection from `cognitiveservices.azure.com / 2025-05-01-preview` to `services.ai.azure.com / 2026-01-01-preview` **without changing voice type, avatar behaviour, or any user-facing defaults**. The current working configuration (Azure standard voice `en-GB-AbbiNeural` with avatar) must continue to work identically. The new endpoint must also unlock the ability to use OpenAI voices (e.g. `shimmer`) via env var override in the future.

## Current working baseline (commit `ce89a3b`)

| Setting | Value | File |
|---|---|---|
| `AZURE_VOICE_API_VERSION` | `"2025-05-01-preview"` | `websocket_handler.py:39` |
| `AZURE_COGNITIVE_SERVICES_DOMAIN` | `"cognitiveservices.azure.com"` | `websocket_handler.py:40` |
| `_build_endpoint()` | `https://{resource_name}.cognitiveservices.azure.com` | `websocket_handler.py:157` |
| Default voice | `en-GB-AbbiNeural` / `azure-standard` | `config.py:25-26`, `websocket_handler.py:49-50` |
| `FINISH_SESSION_TOOL` | `FunctionTool(name=..., ...)` (SDK class) | `managers.py` |
| Avatar | Always enabled (`Modality.AVATAR` + `AvatarConfig`) | `websocket_handler.py:243-253` |

## Validated facts from prior investigation

1. **DNS**: `aifoundry-voicelab-e5dj24rvkgx2c.services.ai.azure.com` resolves to the same IP as `cognitiveservices.azure.com` — same backend, different API surface.
2. **SDK**: `azure-ai-voicelive==1.1.0` accepts any `api_version` string. Default is `"2025-10-01"`.
3. **Live-tested**: `services.ai.azure.com` + `2026-01-01-preview` successfully accepts `OpenAIVoice(name="shimmer")` via SDK `connect()` + `session.update()`.
4. **`AZURE_OPENAI_ENDPOINT`** env var in staging resolves to `https://aifoundry-voicelab-e5dj24rvkgx2c.cognitiveservices.azure.com/` — Bicep injects it from `aiFoundryResource.properties.endpoint`.
5. **`config.py`** already reads `AZURE_OPENAI_ENDPOINT` into `config["azure_openai_endpoint"]`.

## Investigation tasks

### Task 1: Verify Azure standard voice + avatar works on new endpoint

Run a live integration test (similar to the shimmer test we did) but with the CURRENT voice config:

```python
async with connect(
    endpoint="https://aifoundry-voicelab-e5dj24rvkgx2c.services.ai.azure.com",
    credential=AzureKeyCredential(key),
    model="gpt-4o",
    api_version="2026-01-01-preview",
) as conn:
    await conn.session.update(session=RequestSession(
        modalities=[Modality.TEXT, Modality.AUDIO, Modality.AVATAR],
        voice=AzureStandardVoice(name="en-GB-AbbiNeural", type="azure-standard"),
        turn_detection=AzureSemanticVad(type="azure_semantic_vad"),
        avatar=AvatarConfig(character="lisa", style="casual-sitting", customized=False),
        tools=[FunctionTool(name="finish_session", description="End session", parameters={"type":"object","properties":{},"required":[]})],
    ))
    # Must NOT error. If session.updated fires, it's a pass.
```

If this fails, **stop** — the new API version may not support avatars or Azure standard voices. Document the error and fallback plan.

### Task 2: Verify the `AZURE_OPENAI_ENDPOINT` domain

Check what `aiFoundryResource.properties.endpoint` actually returns for both environments:

```bash
az containerapp show -n voicelab -g rg-salescoach-prod --query "properties.template.containers[0].env[?name=='AZURE_OPENAI_ENDPOINT'].value" -o tsv
az containerapp show -n voicelab -g rg-salescoach-swe --query "properties.template.containers[0].env[?name=='AZURE_OPENAI_ENDPOINT'].value" -o tsv
```

If both return `cognitiveservices.azure.com`, the code must transform the domain. If either returns `services.ai.azure.com`, it can be used directly.

### Task 3: Check production AI Foundry resource name

```bash
az containerapp show -n voicelab -g rg-salescoach-prod --query "properties.template.containers[0].env[?name=='AZURE_AI_RESOURCE_NAME'].value" -o tsv
```

Verify DNS resolves: `{resource_name}.services.ai.azure.com`

## Implementation spec (only after Tasks 1-3 pass)

**File: `backend/src/services/websocket_handler.py`** — 3 edits:

1. **Line 39**: `AZURE_VOICE_API_VERSION = "2025-05-01-preview"` → `"2026-01-01-preview"`
2. **Line 40**: `AZURE_COGNITIVE_SERVICES_DOMAIN = "cognitiveservices.azure.com"` → rename to `AZURE_AI_SERVICES_DOMAIN = "services.ai.azure.com"`
3. **Lines 155-157** — `_build_endpoint()`: Replace with:

```python
def _build_endpoint(self) -> str:
    endpoint = config.get("azure_openai_endpoint", "") or ""
    if endpoint:
        endpoint = endpoint.replace(".cognitiveservices.azure.com", f".{AZURE_AI_SERVICES_DOMAIN}")
        endpoint = endpoint.replace(".openai.azure.com", f".{AZURE_AI_SERVICES_DOMAIN}")
    else:
        resource_name = config["azure_ai_resource_name"]
        endpoint = f"https://{resource_name}.{AZURE_AI_SERVICES_DOMAIN}"
    endpoint = endpoint.rstrip("/")
    logger.info("Voice Live endpoint: %s", endpoint)
    return endpoint
```

**NO changes to**: `config.py`, `managers.py`, `app.py`, any frontend files, infra/, voice defaults, avatar config.

**File: `backend/tests/unit/test_websocket_handler.py`** — replace `test_build_endpoint`:

- `test_build_endpoint_from_env_var` — mock `azure_openai_endpoint` with cognitiveservices URL → assert `services.ai.azure.com`
- `test_build_endpoint_fallback_to_resource_name` — empty env var → assert `https://{name}.services.ai.azure.com`
- `test_build_endpoint_preserves_services_ai_domain` — already correct domain → unchanged
- `test_build_endpoint_transforms_openai_domain` — `.openai.azure.com` → `.services.ai.azure.com`

## Validation sequence

1. `cd backend && python -m pytest tests/unit/ -v` — all tests pass
2. `cd frontend && npm run build` — no regressions
3. Deploy to staging: `docker builder prune -af && DOCKER_CONFIG=$(mktemp -d) azd deploy --environment salescoach-swe --no-prompt`
4. Test on `staging-sen.wulo.ai`:
   - Start a voice session → avatar loads, AbbiNeural voice plays, overlay clears
   - Verify logs show `Voice Live endpoint: https://aifoundry-voicelab-*.services.ai.azure.com`
   - No "Only Azure voice is supported" or any other error
5. Deploy to production: `azd deploy --environment salescoach-prod --no-prompt`
6. Test on `sen.wulo.ai` — same checks

## Future: Enable OpenAI voices (separate PR after this lands)

Once `services.ai.azure.com / 2026-01-01-preview` is confirmed working with Azure standard voice + avatar:

1. Re-add `OpenAIVoice` import and conditional logic from stash `openai-voice-endpoint-fix`
2. Set `AZURE_VOICE_TYPE=openai` + `AZURE_VOICE_NAME=shimmer` via env vars (not default change)
3. Audio-only mode: skip `Modality.AVATAR` and `avatar=None` when `voice_type == "openai"`
4. Frontend: set `avatarVideoReady=true` when no TURN servers returned (already in stash)

## Rollback

If Task 1 fails or deployment breaks sessions: revert the 3 edits in `websocket_handler.py` (or `git revert`). No other files are touched so rollback is trivial.
