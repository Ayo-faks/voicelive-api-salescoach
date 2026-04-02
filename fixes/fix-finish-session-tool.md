# Fix: FINISH_SESSION_TOOL serialization breaks session.update with OpenAI voice

The `FINISH_SESSION_TOOL` in `backend/src/services/managers.py` (line 32) uses OpenAI-style nested format:

```python
FINISH_SESSION_TOOL = {
    "type": "function",
    "function": {
        "name": "finish_session",
        "description": "End the practice session...",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}
```

But the Azure Voice Live SDK expects a **flat** structure matching `FunctionTool` from `azure.ai.voicelive.models`. The SDK model has `name`, `description`, `parameters` as top-level fields (not nested under `function`). This causes the error:

```
Missing required parameter: 'name'. param: session.tools.0.function.name
```

The session.update is rejected → `session.updated` never fires → frontend overlay stays stuck.

## Fix needed

1. In `backend/src/services/managers.py`, change `FINISH_SESSION_TOOL` to use the SDK's `FunctionTool` model:

```python
from azure.ai.voicelive.models import FunctionTool

FINISH_SESSION_TOOL = FunctionTool(
    name="finish_session",
    description="End the practice session. Call this when the child says they are done, want to stop, or want to finish practising.",
    parameters={"type": "object", "properties": {}, "required": []},
)
```

2. Update any test that references the old dict structure (check `backend/tests/unit/test_websocket_handler.py`).

3. Run tests: `cd backend && python -m pytest tests/unit/ -v`

4. After fixing, deploy to staging with a full Docker rebuild (cache must be cleared first):

```bash
cd /home/ayoola/sen/voicelive-api-salescoach
docker builder prune -af
azd deploy --no-prompt
```

Default azd env is `salescoach-swe` (staging: `voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io`).
Production deploy requires: `azd deploy --environment salescoach-prod`

5. Verify the fix is in the deployed bundle:

```bash
curl -s 'https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io/js/index.js' | grep -o 'shimmer' | wc -l
```

Should return 1.

6. Test a live session on staging — overlay should clear and shimmer voice should play.
