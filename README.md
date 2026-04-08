<!--
---
name: Wulo (Python + React)
description: A therapist-supervised SEN speech practice platform using Azure Voice Live API, Azure Speech, and Azure OpenAI.
languages:
- python
- typescript
- bicep
- azdeveloper
products:
- azure-openai
- azure-ai-foundry
- azure-speech
- azure
page_type: sample
urlFragment: voicelive-api-salescoach
---
-->
<p align="center">
   <h1 align="center">Wulo</h1>
</p>
<p align="center">A warm, therapist-supervised speech practice app for children with SEN, built on Azure.</p>
<p align="center">
   <a href="https://github.com/Azure-Samples/voicelive-api-salescoach/blob/main/LICENSE.md"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green.svg" style="height:27px; vertical-align:middle;"/></a>
   <a href="https://github.com/Azure-Samples/voicelive-api-salescoach/actions/workflows/lint-and-test.yml"><img alt="Build Status" src="https://github.com/Azure-Samples/voicelive-api-salescoach/actions/workflows/lint-and-test.yml/badge.svg" style="height:27px; vertical-align:middle;"/></a>&nbsp;
   <a href="https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FAzure-Samples%2Fvoicelive-api-salescoach%2Frefs%2Fheads%2Fmain%2Finfra%2Fdeployment.json"><img src="https://aka.ms/deploytoazurebutton" alt="Deploy to Azure" style="height:27px; vertical-align:middle;"/></a>&nbsp;
</p>

![Wulo in Action](docs/assets/preview.png)

---

## Overview

Wulo is a therapist-supervised speech practice platform for structured articulation and language-support sessions. It started from the Voice Live API sample, but the current repository is now a fuller product stack with authenticated therapist workflows, saved session review, governed child memory, recommendation ranking, and Copilot-backed next-session planning.

### Features

- **Guided Practice Sessions** - Run child-friendly voice exercises with short, supportive prompts
- **Therapist Exercise Authoring** - Create and tailor exercises around target sounds and words
- **Pronunciation Feedback** - Review word-level clarity and pronunciation support with Azure Speech
- **Therapist Review** - Save sessions, add therapist feedback, and inspect structured dashboards
- **Governed Child Memory** - Approve or reject proposed durable child-memory items before they influence planning
- **Inspectable Recommendations** - Rank next-exercise suggestions with visible supporting evidence
- **Copilot-Backed Planning** - Generate, refine, and approve next-session plans from saved session context
- **Dual Persistence Paths** - Run on seeded SQLite today while supporting PostgreSQL rollout behind configuration

![Performance Analysis Dashboard](docs/assets/analysis.png)

## Demo

See Wulo in action:

https://github.com/user-attachments/assets/904f1555-6981-4780-ae64-c5757337bcad

### How It Works

1. **Choose an Exercise** - Pick a therapist-authored or built-in speech practice card
2. **Start Practice** - Tap the microphone to begin a guided voice turn
3. **Work Through Retries** - The practice buddy responds with calm, child-friendly support
4. **Review Results** - Open saved practice feedback, therapist notes, and session detail after the session
5. **Update Memory And Plans** - Review proposed child memory, recommendations, and next-session plans from the therapist dashboard

## Current Product Surface

The current app has two main operating surfaces:

- **Child practice flow** - A simplified exercise picker, avatar-led live session, instant utterance scoring for supported exercise types, and a session completion flow.
- **Therapist workspace** - Authenticated home, dashboard, memory review, recommendation inspection, session history, charts, and planner flows.

The app is designed for therapist-supervised use. Results and generated plans are support tools for clinical workflow, not diagnostic output.

## Getting Started

### Deploy to Azure

1. **Deploy to Azure**:
   ```bash
   AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d) azd up
   ```
2. **Access your application**:
   The deployment will output the URL where your application is running.

Fresh Azure Container Apps deployments seed `/app/persistence/wulo.db` from an image-baked bootstrap database when the mounted Azure File Share is empty. This avoids first-boot SQLite schema creation against an empty share.

For WSL-based deploys, prefer the `AZURE_EXTENSION_DIR=/tmp/az-noext DOCKER_CONFIG=$(mktemp -d)` prefix on `azd provision` and `azd deploy`. In this repository it avoids Azure CLI extension-directory failures and Docker credential-helper issues that can break otherwise valid deployments.

### Local Development

This project includes a dev container for easy setup and a build script for  development.

1. **Use Dev Container** (Recommended)
   - Open in VS Code and select "Reopen in Container" when prompted
   - All dependencies and tools are pre-configured

2. **Fill in the .env file**
   - Copy `.env.template` to `.env`
   - Fill in your Azure AI Foundry and Speech service keys and endpoints (you can run `azd provision` to create these resources if you haven't already)
   - For local auth testing, set `LOCAL_DEV_AUTH=true` and keep `LOCAL_DEV_USER_ROLE=therapist`

3. **Build and run**
   ```bash
   # Build the application
   ./scripts/build.sh

   # Start the server
   cd backend && python -m src.app
   ```

Visit `http://localhost:8000` to start practising.

### Local Validation

Use the focused validation set that matches the current codebase:

```bash
cd frontend && npx tsc --noEmit && npm run build
cd ../backend && /home/ayoola/sen/.venv/bin/python -m pytest tests/unit/test_app.py tests/unit/test_websocket_handler.py tests/integration/test_auth_roles.py
```

For broader backend coverage, run:

```bash
cd backend && /home/ayoola/sen/.venv/bin/python -m pytest tests/
```

### Copilot Planner Requirements

The therapist planning workflow now uses the GitHub Copilot SDK in the backend.

Runtime requirements:

- `github-copilot-sdk` installed in the backend Python environment
- GitHub Copilot CLI available to the backend process
- One authentication mode configured:
   - GitHub Copilot CLI already logged in, or
   - `COPILOT_GITHUB_TOKEN` / `GITHUB_TOKEN`, or
   - Azure BYOK values already used by the app: `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY`

The backend container image now installs the GitHub Copilot CLI at `/usr/local/bin/copilot`, and the Azure Container App wiring sets `COPILOT_CLI_PATH` to that location by default.

Optional planner-specific environment variables:

- `COPILOT_CLI_PATH` - absolute path to the Copilot CLI executable if it is not on `PATH`
- `COPILOT_GITHUB_TOKEN` - optional token-based auth path for backend-service scenarios
- `COPILOT_PLANNER_MODEL` - overrides the planner model, default `gpt-5`
- `COPILOT_PLANNER_REASONING_EFFORT` - optional reasoning level: `low`, `medium`, `high`, or `xhigh`
- `COPILOT_AZURE_API_VERSION` - Azure BYOK API version, default `2024-10-21`

For `azd` environments, the planner override inputs now flow through `infra/main.parameters.json`:

- `COPILOT_CLI_PATH`
- `COPILOT_GITHUB_TOKEN`
- `COPILOT_PLANNER_MODEL`
- `COPILOT_PLANNER_REASONING_EFFORT`
- `COPILOT_AZURE_API_VERSION`

In the current Azure Container Apps deployment, `COPILOT_PLANNER_MODEL` defaults to the deployed Azure OpenAI model name when no override is provided, which keeps the BYOK path aligned with the existing `gpt-4o` deployment.

The authenticated config payload at `/api/config` now includes a `planner` object that reports backend readiness, including whether the SDK is installed, whether the CLI is executable, and whether planner authentication is available.

## Architecture

<table>
<tr>
<td width="400">
<img src="docs/assets/architecture.png" alt="Architecture Diagram" width="500"/>
</td>
<td>

The application combines a React/Vite frontend, a Flask + WebSocket backend, and Azure-hosted AI services to deliver realtime speech practice plus therapist review workflows:

- **Frontend** - React 19, Vite, TypeScript, Fluent UI, Heroicons, and Recharts for the therapist workspace and child session surfaces
- **Backend** - Flask for REST endpoints, Flask-Sock for the realtime proxy, and service-layer orchestration for storage, planning, recommendation, and memory workflows
- **Azure AI Voice Live** - Realtime conversation loop, avatar streaming, WebRTC bootstrap, and voice session orchestration
- **Azure OpenAI / AI Services** - Structured conversation analysis, planning BYOK support, and deployed model endpoints
- **Azure Speech** - Pronunciation assessment, speech configuration, and voice output settings
- **Persistence** - Seeded SQLite by default, Azure Files for mounted persistence, blob backup restore, and optional PostgreSQL Flexible Server wiring
- **Azure Container Apps** - Runtime hosting, Easy Auth integration, custom domain support, and environment-driven deployment through `azd`

### Backend Service Boundaries

- **`src/app.py`** - Flask entrypoint, API routes, auth/session checks, and runtime service initialization
- **`src/services/websocket_handler.py`** - Voice Live proxy, session configuration, and WebSocket auth enforcement
- **`src/services/storage_factory.py`** - Runtime storage selection and safe bootstrap/migration decisions
- **`src/services/child_memory_service.py`** - Governed child-memory proposals, approvals, summaries, and live-session personalization inputs
- **`src/services/recommendation_service.py`** - Next-exercise ranking and explanation inputs
- **`src/services/planning_service.py`** - GitHub Copilot SDK integration for therapist plan generation and refinement
- **`src/services/institutional_memory_service.py`** - De-identified clinic-level insights derived from reviewed evidence

### Frontend Surface Areas

- **`frontend/src/app/App.tsx`** owns routing, mode switching, session orchestration, auth/session state, and dashboard loading.
- **`frontend/src/components/SessionScreen.tsx`** presents the avatar-first live session layout.
- **`frontend/src/components/DashboardHome.tsx`** is the therapist preparation and launch surface.
- **`frontend/src/components/ProgressDashboard.tsx`** is the deep review workspace for sessions, memory, recommendations, and plans.

### Repository Layout

```text
backend/        Flask app, storage, AI orchestration, tests, Dockerfile
frontend/       React/Vite therapist and child UI
infra/          Bicep templates and Azure deployment parameters
data/           Exercise prompts, scenarios, images, and seeded content
docs/           Product plans, architecture notes, and therapist guidance
scripts/        Build, lint, test, migration, and content-generation utilities
static/         Legacy/static web assets used outside the built frontend bundle
```

### Request And Data Flow

1. The frontend authenticates the therapist session and loads app configuration from `/api/config`.
2. The child session opens a same-origin WebSocket to `/ws/voice` and upgrades into the backend proxy.
3. The backend configures Azure Voice Live, avatar settings, transcription, and tool-enabled session behavior.
4. Session artifacts are analyzed and saved through the storage layer after completion.
5. Therapist workflows read saved sessions, child memory summaries, recommendation logs, and plans through REST APIs.
6. The planner uses saved session context plus approved child memory to generate draft next-session plans.

## Persistence Model

- **Default runtime today** - SQLite seeded from a baked bootstrap database and mounted on Azure Files.
- **Backup path** - Blob restore support can repopulate the mounted SQLite file before first open.
- **Migration seam** - The backend supports `DATABASE_BACKEND=postgres` with guarded startup migrations and Azure PostgreSQL infrastructure already wired in Bicep.

## Repo Docs

- [docs/repo-architecture.md](docs/repo-architecture.md) for the engineering-oriented architecture walkthrough
- [docs/therapist-guide.md](docs/therapist-guide.md) for the product workflow from a therapist perspective
- [AGENTS.md](AGENTS.md) for repo-specific validation and Azure deployment guidance used by coding agents

</td>
</tr>
</table>


## Contributors
<p float="left">
  <a href="https://github.com/aymenfurter"><img src="https://github.com/aymenfurter.png" width="100" height="100" alt="aymenfurter" style="border-radius:50%;"/></a>
  <a href="https://github.com/curia-damiano"><img src="https://github.com/curia-damiano.png" width="100" height="100" alt="curia-damiano" style="border-radius:50%;"/></a>
  <a href="https://github.com/TiffanyZ4Msft"><img src="https://github.com/TiffanyZ4Msft.png" width="100" height="100" alt="TiffanyZ4Msft.png" style="border-radius:50%;"/></a>
</p>

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Security

Microsoft takes the security of our software products and services seriously, which includes all source code repositories managed through our GitHub organizations, which include [Microsoft](https://github.com/Microsoft), [Azure](https://github.com/Azure), [DotNet](https://github.com/dotnet), [AspNet](https://github.com/aspnet) and [Xamarin](https://github.com/xamarin).

If you believe you have found a security vulnerability in any Microsoft-owned repository that meets [Microsoft's definition of a security vulnerability](https://aka.ms/security.md/definition), please report it to us as described in [SECURITY.md](SECURITY.md).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
Any use of third-party trademarks or logos are subject to those third-party's policies.



<p align="center">
   <br/>
   <br/>
   Made with ❤️ in 🇨🇭
</p>
