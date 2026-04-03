<!--
---
name: SpeakBright (Python + React)
description: A therapist-supervised SEN speech therapy MVP using Azure Voice Live API, Azure Speech, and Azure OpenAI.
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
   <h1 align="center">SpeakBright</h1>
</p>
<p align="center">A warm, therapist-supervised speech practice app for children with SEN, built on Azure.</p>
<p align="center">
   <a href="https://github.com/Azure-Samples/voicelive-api-salescoach/blob/main/LICENSE.md"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green.svg" style="height:27px; vertical-align:middle;"/></a>
   <a href="https://github.com/Azure-Samples/voicelive-api-salescoach/actions/workflows/lint-and-test.yml"><img alt="Build Status" src="https://github.com/Azure-Samples/voicelive-api-salescoach/actions/workflows/lint-and-test.yml/badge.svg" style="height:27px; vertical-align:middle;"/></a>&nbsp;
   <a href="https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FAzure-Samples%2Fvoicelive-api-salescoach%2Frefs%2Fheads%2Fmain%2Finfra%2Fdeployment.json"><img src="https://aka.ms/deploytoazurebutton" alt="Deploy to Azure" style="height:27px; vertical-align:middle;"/></a>&nbsp;
</p>

![SpeakBright in Action](docs/assets/preview.png)

---

## Overview

SpeakBright is a therapist-supervised speech practice MVP adapted from the Voice Live API sample. It helps children work through guided speaking exercises with a calm voice buddy while giving therapists structured session review and pronunciation feedback.

### Features

- **Guided Practice Sessions** - Run child-friendly voice exercises with short, supportive prompts
- **Therapist Exercise Authoring** - Create and tailor exercises around target sounds and words
- **Pronunciation Feedback** - Review word-level clarity and pronunciation support with Azure Speech
- **Therapist Review** - Save sessions and open progress summaries for supervised practice

![Performance Analysis Dashboard](docs/assets/analysis.png)

## Demo

See SpeakBright in action:

https://github.com/user-attachments/assets/904f1555-6981-4780-ae64-c5757337bcad

### How It Works

1. **Choose an Exercise** - Pick a therapist-authored or built-in speech practice card
2. **Start Practice** - Tap the microphone to begin a guided voice turn
3. **Work Through Retries** - The practice buddy responds with calm, child-friendly support
4. **Review Results** - Open saved practice feedback and therapist notes after the session

## Getting Started

### Deploy to Azure

1. **Deploy to Azure**:
   ```bash
   azd up
   ```
2. **Access your application**:
   The deployment will output the URL where your application is running.

Fresh Azure Container Apps deployments seed `/app/persistence/wulo.db` from an image-baked bootstrap database when the mounted Azure File Share is empty. This avoids first-boot SQLite schema creation against an empty share.

### Local Development

This project includes a dev container for easy setup and a build script for  development.

1. **Use Dev Container** (Recommended)
   - Open in VS Code and select "Reopen in Container" when prompted
   - All dependencies and tools are pre-configured

2. **Fill in the .env file**
   - Copy `.env.template` to `.env`
   - Fill in your Azure AI Foundry and Speech service keys and endpoints (you can run `azd provision` to create these resources if you haven't already)

3. **Build and run**
   ```bash
   # Build the application
   ./scripts/build.sh

   # Start the server
   cd backend && python src/app.py
   ```

Visit `http://localhost:8000` to start practising.

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

The application leverages multiple Azure AI services to deliver real-time speech practice:

- **Azure AI Foundry** - AI platform including:
  - Voice Live API for real-time speech-to-speech conversations and avatar simulation
   - Large language models (GPT-4o) for structured practice review
   - Speech Services for pronunciation assessment and speech playback
  - Optional AI Agent Service
- **React + Fluent UI** - Modern web interface
- **Python Flask** - Backend API and WebSocket communication

**Conversation Flow:** Child speech → Voice Live API → GPT-4o practice buddy → Azure Speech scoring → Therapist review

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
