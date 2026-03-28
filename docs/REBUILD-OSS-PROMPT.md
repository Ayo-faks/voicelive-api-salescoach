# SpeakBright — Open-Source Rebuild Prompt

> Use this prompt with any AI coding agent (Copilot, Cursor, Devin, etc.) to rebuild the SpeakBright speech therapy practice app from scratch using only open-source and self-hostable tools. Zero Azure dependency.

---

## PROMPT

You are rebuilding **SpeakBright**, a therapist-supervised speech practice application for children (ages 4-8). The current version is locked to Azure services. Rebuild it from scratch using **only open-source, self-hostable tools** that can run on a single Linux server, a Raspberry Pi, or any cloud VM.

---

### WHAT THE APP DOES (COMPLETE FUNCTIONAL SPEC)

SpeakBright is a real-time voice-interactive speech therapy practice tool. A therapist sets up exercises, a child practices speaking with an AI coach that listens and responds by voice in real-time, and the system scores pronunciation accuracy at the word and phoneme level.

#### User Roles
1. **Therapist** — Creates exercises, reviews session history, provides feedback. Authenticated by a local PIN (no OAuth).
2. **Child** — Practices speaking exercises with an AI voice coach. No authentication.

#### Core Flows

**Flow 1: Therapist Onboarding**
- Therapist enters PIN → selects child profile → selects exercise → chooses avatar persona → starts session
- Consent acknowledgment screen before first use
- State persisted to localStorage (frontend) + SQLite (backend)

**Flow 2: Real-Time Voice Practice Session**
- Child clicks mic button → browser captures audio via AudioWorklet (24kHz, mono, Int16 PCM → base64 chunks every ~100ms)
- Audio streams over WebSocket to backend
- Backend pipes audio to STT engine for real-time transcription
- Transcription sent to LLM with exercise-specific system prompt
- LLM response streamed back
- Response synthesized to speech via TTS
- Audio streamed back to client over same WebSocket, played gaplessly via Web Audio API
- Chat transcript shown in real-time (user utterances + assistant responses)
- Optional: Avatar video rendered via WebRTC (can be dropped for open-source rebuild)

**Flow 3: Single Utterance Pronunciation Assessment**
- Separate "Record one try" mode (not streaming — records full utterance, then stops)
- Audio sent to pronunciation assessment API
- Returns word-level and phoneme-level accuracy scores (0-100)
- Words displayed with color-coded badges: green (≥80), yellow (60-79), red (<60)
- Age-adjusted scoring: developmentally expected substitutions (e.g., "w" for "r" at age 4) are forgiven

**Flow 4: Session Analysis**
- After practice, transcript + audio sent to LLM for structured evaluation
- LLM returns JSON with structured schema:
  - `articulation_clarity`: target_sound_accuracy (0-10), overall_clarity (0-10), consistency (0-10)
  - `engagement_and_effort`: task_completion (0-10), willingness_to_retry (0-10), self_correction_attempts (0-10)
  - `overall_score` (0-100)
  - `celebration_points`: array of 1-3 positive observations
  - `practice_suggestions`: array of 1-3 constructive next steps
  - `therapist_notes`: clinical summary string
- Results shown in a tabbed modal (Overview, Celebrations/Next Steps, Therapist Notes)

**Flow 5: Therapist Review Dashboard**
- PIN-locked view showing child list → session history → session detail
- Therapist can rate sessions (thumbs up/down) and add notes

**Flow 6: Custom Exercise Editor**
- Therapist creates custom exercises via a modal form:
  - Exercise name, description, type (word_repetition | minimal_pairs | sentence_repetition | guided_prompt)
  - Target sound, target words, difficulty (easy/medium/hard), age range
  - Custom system prompt for AI coach persona
  - Child-facing prompt text
- Custom exercises stored in localStorage, synced to backend on use
- Import/export as JSON

#### Exercise YAML Format (data files)
```yaml
name: Say the S Sound
description: Practice the /s/ sound at the start of familiar words
model: gpt-4o
modelParameters:
  temperature: 0.6
  max_tokens: 500
exerciseMetadata:
  type: word_repetition
  targetSound: s
  targetWords: [sun, soap, star, snake, smile]
  difficulty: easy
  ageRange: 4-7
  speechLanguage: en-US
messages:
  - role: system
    content: |
      You are a warm, patient speech practice buddy named Sunny...
      RULES:
      - Keep responses to 1-2 short sentences
      - Use simple words a young child can understand
      - Celebrate effort, not just accuracy
      - Gently model target sounds and invite retries
```

---

### ARCHITECTURE TO BUILD

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (React + Vite)                   │
│  Components: ChatPanel, ExerciseFeedback, AssessmentPanel,  │
│  OnboardingFlow, ProgressDashboard, CustomScenarioEditor    │
│  Hooks: useRealtime (WS), useRecorder (AudioWorklet),       │
│         useAudioPlayer (Web Audio API)                       │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP REST + WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│                 BACKEND (Python, Flask + flask-sock)         │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ Agent        │  │ Exercise     │  │ Storage            │ │
│  │ Manager      │  │ Manager      │  │ (SQLite)           │ │
│  │ (LangChain   │  │ (YAML loader)│  │                    │ │
│  │  or LangGraph│  │              │  │                    │ │
│  │  agent)      │  │              │  │                    │ │
│  └──────┬───────┘  └──────────────┘  └────────────────────┘ │
│         │                                                    │
│  ┌──────▼──────────────────────────────────────────────────┐│
│  │              VOICE PIPELINE (WebSocket handler)          ││
│  │                                                          ││
│  │  Client Audio ──► STT ──► LLM ──► TTS ──► Client Audio  ││
│  │  (base64 PCM)   (ASR)  (agent) (synth)   (base64 PCM)  ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │         PRONUNCIATION ASSESSOR                           ││
│  │  Audio ──► STT with word timestamps ──► Alignment ──►   ││
│  │  Score per word/phoneme against reference text           ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │         CONVERSATION ANALYZER                            ││
│  │  Transcript ──► LLM (structured JSON output) ──►        ││
│  │  Evaluation scores + celebrations + suggestions          ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

### OPEN-SOURCE TOOL CHOICES (USE THESE)

#### 1. Speech-to-Text (STT) — Replace Azure Speech Service

Pick ONE primary + ONE optional fallback:

| Tool | Why | Install |
|------|-----|---------|
| **Moonshine ASR** (primary, recommended) | Tiny, fast, runs on CPU. Designed for real-time streaming on edge devices. Apache 2.0 license. | `pip install useful-moonshine-onnx` or build from [github.com/usefulsensors/moonshine](https://github.com/usefulsensors/moonshine) |
| **Whisper.cpp** (alternative) | C++ port of OpenAI Whisper. Fast CPU inference. Can compile to WASM for browser-side STT. | Build from [github.com/ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp) |
| **Vosk** (lightweight alternative) | Small models (50MB), supports streaming, works offline. | `pip install vosk` + download model |
| **faster-whisper** (highest accuracy) | CTranslate2-optimized Whisper. Best accuracy but heavier. | `pip install faster-whisper` |

**For browser-side WASM STT** (optional, enables fully offline use):
- **whisper-turbo-wasm** or **sherpa-onnx WASM** — run STT entirely in the browser, send only text over WebSocket

**Implementation approach:**
```python
# Streaming STT interface to implement
class STTProvider(Protocol):
    async def transcribe_stream(self, audio_chunks: AsyncIterator[bytes]) -> AsyncIterator[str]:
        """Yield partial transcriptions as audio streams in."""
        ...

    async def transcribe_full(self, audio: bytes, language: str = "en-US") -> TranscriptionResult:
        """Transcribe a complete audio buffer. Return text + word timestamps."""
        ...

class MoonshineSTT(STTProvider):
    # Use moonshine streaming API
    ...

class WhisperCppSTT(STTProvider):
    # Use whisper.cpp Python bindings
    ...
```

#### 2. Text-to-Speech (TTS) — Replace Azure TTS

| Tool | Why | Install |
|------|-----|---------|
| **Piper TTS** (recommended) | Fast, lightweight, many voices, runs on CPU/RPi. Created by Rhasspy project. | `pip install piper-tts` or download from [github.com/rhasspy/piper](https://github.com/rhasspy/piper) |
| **Coqui TTS / XTTS** | Higher quality, voice cloning, but heavier. | `pip install TTS` |
| **eSpeak-NG** (fallback) | Ultra-lightweight, robotic but instant. Good for minimal setups. | `apt install espeak-ng` |
| **Bark** (expressive) | Can express emotions, laughter. Heavier but engaging for children. | `pip install suno-bark` |

**Implementation approach:**
```python
class TTSProvider(Protocol):
    async def synthesize(self, text: str, voice: str = "default") -> bytes:
        """Return PCM audio bytes (24kHz, 16-bit, mono)."""
        ...

    async def synthesize_stream(self, text: str, voice: str = "default") -> AsyncIterator[bytes]:
        """Yield audio chunks as they're generated for streaming playback."""
        ...

class PiperTTS(TTSProvider):
    # Piper generates full audio fast enough for near-realtime
    ...
```

**Voice persona mapping (replace Azure Neural Voices):**
- `en-US-AnaNeural` → Piper `en_US-amy-medium` or `en_US-lessac-medium`
- Download child-friendly voices from Piper voice samples page

#### 3. LLM — Replace Azure OpenAI

| Tool | Why | Install |
|------|-----|---------|
| **Ollama** (recommended for local) | One-command setup, runs any GGUF model. REST API compatible. | `curl -fsSL https://ollama.ai/install.sh \| sh` then `ollama pull llama3.1:8b` |
| **vLLM** (production serving) | Fast inference server, OpenAI-compatible API. | `pip install vllm` |
| **llama.cpp server** (lightweight) | Minimal C++ server with OpenAI-compatible endpoint. | Build from source |
| **LiteLLM** (proxy) | Unified API proxy — lets you swap between Ollama, OpenAI, Anthropic, etc. via config. | `pip install litellm` |

**Integration via LangChain (recommended):**
```python
# Use LangChain so you can swap LLM providers via config
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

def get_llm(provider: str = "ollama", model: str = "llama3.1:8b"):
    if provider == "ollama":
        return ChatOllama(model=model, temperature=0.6)
    elif provider == "openai":
        return ChatOpenAI(model=model, temperature=0.6)
    elif provider == "litellm":
        return ChatOpenAI(
            base_url="http://localhost:4000",  # LiteLLM proxy
            model=model,
            api_key="not-needed",
        )
```

**For structured JSON output (evaluation):**
```python
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel

class SpeechEvaluation(BaseModel):
    articulation_clarity: ArticulationClarity
    engagement_and_effort: EngagementAndEffort
    overall_score: int  # 0-100
    celebration_points: list[str]
    practice_suggestions: list[str]
    therapist_notes: str

parser = JsonOutputParser(pydantic_object=SpeechEvaluation)
chain = prompt | llm | parser
```

#### 4. Agent Orchestration — Replace Azure AI Foundry / AI Projects

| Tool | Why |
|------|-----|
| **LangGraph** (recommended) | Stateful agent graphs with tool calling. Perfect for conversational agents. |
| **LangChain Agents** | Simpler if you don't need complex state machines. |
| **CrewAI** | Multi-agent if you want separate "coach" and "evaluator" agents. |

**Agent design:**
```python
from langgraph.prebuilt import create_react_agent

# Each exercise creates an agent with exercise-specific system prompt
def create_exercise_agent(exercise_data: dict, llm):
    system_prompt = exercise_data["messages"][0]["content"]
    system_prompt += "\n\nKEEP RESPONSES TO 1-2 SHORT SENTENCES. BE WARM AND ENCOURAGING."
    
    return create_react_agent(
        model=llm,
        tools=[],  # No tools needed for speech practice
        prompt=system_prompt,
    )
```

#### 5. Pronunciation Assessment — Replace Azure Pronunciation Assessment

This is the hardest piece. Azure provides word-level + phoneme-level scoring out of the box. Open-source approach:

**Option A: Whisper + forced alignment (recommended)**
```python
# Use whisper with word-level timestamps + forced alignment against reference
import stable_ts  # or use whisperx

class PronunciationAssessor:
    """Score pronunciation by aligning ASR output against reference text."""
    
    def assess(self, audio: bytes, reference_text: str) -> dict:
        # 1. Transcribe with word-level timestamps
        result = self.stt.transcribe_full(audio)
        
        # 2. Align transcribed words against reference words
        ref_words = reference_text.lower().split()
        asr_words = [w.text.lower() for w in result.words]
        
        alignment = self._align_words(ref_words, asr_words)
        
        # 3. Score each word
        word_scores = []
        for ref, asr, confidence in alignment:
            if ref == asr:
                score = min(100, confidence * 100)
            elif self._is_close_match(ref, asr):
                score = 60 + (confidence * 40)
            else:
                score = max(0, confidence * 50)
            word_scores.append({"word": ref, "spoken": asr, "accuracy": score})
        
        # 4. Aggregate
        avg = sum(w["accuracy"] for w in word_scores) / len(word_scores)
        return {
            "accuracy_score": avg,
            "pronunciation_score": avg,
            "words": word_scores,
        }
```

**Option B: Phoneme-level with Allosaurus or Gruut**
```python
# For phoneme-level scoring
import allosaurus  # Universal phone recognizer
import gruut       # IPA phoneme lookup for reference

class PhonemePronunciationAssessor:
    def assess(self, audio: bytes, reference_text: str):
        # 1. Get expected phonemes from reference
        expected_phonemes = gruut.sentences(reference_text, lang="en-us")
        
        # 2. Recognize actual phonemes from audio
        actual_phonemes = allosaurus.recognize(audio)
        
        # 3. Align and score
        ...
```

**Option C: wav2vec2 fine-tuned for pronunciation scoring**
- Use HuggingFace `facebook/wav2vec2-base-960h` with CTC alignment
- Compare forced-alignment output against reference phonemes

**Keep the age-adjusted scoring logic** — it's pure Python with no Azure dependency (already portable).

#### 6. Telemetry — Replace Azure Application Insights

| Tool | Why | Install |
|------|-----|---------|
| **OpenTelemetry + Prometheus + Grafana** | Industry standard. The current code already uses OpenTelemetry. | `pip install opentelemetry-sdk opentelemetry-exporter-prometheus` |
| **Plausible** (if you want web analytics) | Self-hosted, privacy-focused. | Docker image |

```python
# Replace azure-monitor-opentelemetry with generic OTLP exporter
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)
```

#### 7. Infrastructure — Replace Azure Container Apps + Bicep

| Tool | Why |
|------|-----|
| **Docker Compose** (simplest) | Single `docker-compose.yml` runs everything. |
| **Kubernetes + Helm** (production) | If you need scaling. |
| **Coolify** (self-hosted PaaS) | Open-source Heroku alternative. Push to deploy. |
| **Kamal** (Rails-style deploy) | Zero-downtime deploys to any Linux server via SSH. |

```yaml
# docker-compose.yml
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    environment:
      LLM_PROVIDER: ollama
      LLM_MODEL: llama3.1:8b
      LLM_BASE_URL: http://ollama:11434
      STT_PROVIDER: moonshine
      TTS_PROVIDER: piper
      TTS_VOICE: en_US-amy-medium
      STORAGE_PATH: /data/speakbright.db
    volumes:
      - ./data:/data
      - ./models:/models
    depends_on: [ollama]
  
  ollama:
    image: ollama/ollama
    volumes: ["ollama-data:/root/.ollama"]
    # GPU passthrough if available:
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - capabilities: [gpu]

  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    depends_on: [backend]

  # Optional monitoring
  prometheus:
    image: prom/prometheus
    volumes: ["./prometheus.yml:/etc/prometheus/prometheus.yml"]
  
  grafana:
    image: grafana/grafana
    ports: ["3001:3000"]

volumes:
  ollama-data:
```

---

### API CONTRACTS TO PRESERVE

Keep the exact same REST and WebSocket API so the frontend works unchanged:

```
GET  /api/config              → {status, proxy_enabled, ws_endpoint, storage_ready}
GET  /api/scenarios           → [{id, name, description, exerciseMetadata}]
GET  /api/scenarios/:id       → {full scenario YAML data}
GET  /api/pilot/state         → {consent_timestamp, therapist_pin_configured}
POST /api/pilot/consent       → {consent_timestamp}  [X-Therapist-Pin header]
POST /api/agents/create       → {agent_id, scenario_id}  [body: {scenario_id} or {custom_scenario}]
DELETE /api/agents/:id        → {success: true}
POST /api/analyze             → {ai_assessment, pronunciation_assessment, session_id}
POST /api/assess-utterance    → {pronunciation_assessment}
GET  /api/children            → [{id, name}]
POST /api/therapist/auth      → {authorized: true}  [body: {pin}]
GET  /api/children/:id/sessions → [session summaries]
GET  /api/sessions/:id        → {full session detail}
POST /api/sessions/:id/feedback → {updated session}

WS   /ws/voice                → Bidirectional: client sends base64 PCM chunks,
                                 server sends back {type, ...} JSON events:
                                 - response.audio.delta (base64 audio chunk)
                                 - conversation.item.input_audio_transcription.completed
                                 - response.audio_transcript.done
                                 - session.created / session.updated
```

---

### WEBSOCKET VOICE PIPELINE — DETAILED IMPLEMENTATION

This is the most complex part. Replace the `VoiceProxyHandler` that currently proxies to Azure VoiceLive.

```python
class OpenSourceVoicePipeline:
    """Real-time voice conversation pipeline using open-source STT + LLM + TTS."""
    
    def __init__(self, stt: STTProvider, llm, tts: TTSProvider):
        self.stt = stt
        self.llm = llm
        self.tts = tts
    
    async def handle_connection(self, client_ws):
        """Main WebSocket handler."""
        agent = None
        audio_buffer = bytearray()
        
        # 1. Wait for session.update with agent_id
        first_msg = await client_ws.receive()
        config = json.loads(first_msg)
        agent_id = config.get("session", {}).get("agent_id")
        agent = self.agent_manager.get_agent(agent_id)
        
        await client_ws.send(json.dumps({
            "type": "session.created",
            "session": {"id": str(uuid4())}
        }))
        
        # 2. Process audio in real-time
        conversation_history = []
        
        async def process_audio():
            nonlocal audio_buffer
            
            while True:
                msg = await client_ws.receive()
                if msg is None:
                    break
                
                if isinstance(msg, str):
                    data = json.loads(msg)
                    if data.get("type") == "input_audio_buffer.append":
                        chunk = base64.b64decode(data["audio"])
                        audio_buffer.extend(chunk)
                    elif data.get("type") == "input_audio_buffer.commit":
                        # STT: transcribe accumulated audio
                        text = await self.stt.transcribe_full(bytes(audio_buffer))
                        audio_buffer.clear()
                        
                        # Send transcription to client
                        await client_ws.send(json.dumps({
                            "type": "conversation.item.input_audio_transcription.completed",
                            "transcript": text.text
                        }))
                        
                        # LLM: get response
                        conversation_history.append({"role": "user", "content": text.text})
                        response = await self.llm.ainvoke(conversation_history)
                        response_text = response.content
                        conversation_history.append({"role": "assistant", "content": response_text})
                        
                        # Send text response
                        await client_ws.send(json.dumps({
                            "type": "response.audio_transcript.done",
                            "transcript": response_text
                        }))
                        
                        # TTS: synthesize and stream audio back
                        async for audio_chunk in self.tts.synthesize_stream(response_text):
                            await client_ws.send(json.dumps({
                                "type": "response.audio.delta",
                                "delta": base64.b64encode(audio_chunk).decode()
                            }))
                        
                        await client_ws.send(json.dumps({
                            "type": "response.done"
                        }))
        
        await process_audio()
```

For **true streaming** (respond while the user is still speaking), use VAD (Voice Activity Detection):

```python
# pip install silero-vad or webrtcvad
import webrtcvad

class VADProcessor:
    """Detect speech start/end to know when user is done talking."""
    def __init__(self, aggressiveness: int = 2):
        self.vad = webrtcvad.Vad(aggressiveness)
    
    def is_speech(self, frame: bytes, sample_rate: int = 24000) -> bool:
        return self.vad.is_speech(frame, sample_rate)
```

---

### CONFIGURATION — REPLACE config.py

```python
# New config.py — zero Azure references
config = {
    # LLM
    "llm_provider": os.getenv("LLM_PROVIDER", "ollama"),       # ollama | openai | litellm
    "llm_model": os.getenv("LLM_MODEL", "llama3.1:8b"),
    "llm_base_url": os.getenv("LLM_BASE_URL", "http://localhost:11434"),
    "llm_api_key": os.getenv("LLM_API_KEY", ""),               # only needed for hosted APIs
    
    # STT
    "stt_provider": os.getenv("STT_PROVIDER", "moonshine"),     # moonshine | whisper_cpp | vosk | faster_whisper
    "stt_model_path": os.getenv("STT_MODEL_PATH", ""),          # path to model files
    "stt_language": os.getenv("STT_LANGUAGE", "en"),
    
    # TTS
    "tts_provider": os.getenv("TTS_PROVIDER", "piper"),         # piper | coqui | espeak
    "tts_voice": os.getenv("TTS_VOICE", "en_US-amy-medium"),
    "tts_model_path": os.getenv("TTS_MODEL_PATH", ""),
    
    # App
    "port": int(os.getenv("PORT", "8000")),
    "host": os.getenv("HOST", "0.0.0.0"),
    "storage_path": os.getenv("STORAGE_PATH", "data/speakbright.db"),
    "therapist_pin": os.getenv("THERAPIST_PIN", "2468"),
    "default_child_id": os.getenv("DEFAULT_CHILD_ID", "child-ava"),
    
    # Telemetry (optional)
    "otlp_endpoint": os.getenv("OTLP_ENDPOINT", ""),            # OpenTelemetry collector
}
```

---

### FILE STRUCTURE TO CREATE

```
speakbright-oss/
├── docker-compose.yml
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── pyproject.toml
│   ├── src/
│   │   ├── __init__.py
│   │   ├── app.py                    # Flask app (same API routes)
│   │   ├── config.py                 # Cloud-agnostic config
│   │   └── services/
│   │       ├── __init__.py
│   │       ├── voice_pipeline.py     # NEW: STT→LLM→TTS WebSocket pipeline
│   │       ├── stt/
│   │       │   ├── __init__.py
│   │       │   ├── base.py           # STTProvider protocol
│   │       │   ├── moonshine.py      # Moonshine ASR implementation
│   │       │   ├── whisper_cpp.py    # Whisper.cpp implementation
│   │       │   └── vosk_stt.py       # Vosk implementation
│   │       ├── tts/
│   │       │   ├── __init__.py
│   │       │   ├── base.py           # TTSProvider protocol
│   │       │   ├── piper_tts.py      # Piper TTS implementation
│   │       │   └── coqui_tts.py      # Coqui/XTTS implementation
│   │       ├── llm/
│   │       │   ├── __init__.py
│   │       │   ├── base.py           # LLM provider interface
│   │       │   └── langchain_llm.py  # LangChain-based (supports ollama, openai, etc.)
│   │       ├── pronunciation.py      # Open-source pronunciation assessor
│   │       ├── analyzers.py          # Conversation analyzer (LangChain, not AzureOpenAI)
│   │       ├── managers.py           # Agent + Exercise managers (no Azure AI Projects)
│   │       ├── storage.py            # SQLite storage (unchanged — already portable)
│   │       └── telemetry.py          # OpenTelemetry (no Azure Monitor)
│   ├── models/                       # Downloaded model files
│   │   ├── moonshine/
│   │   ├── piper/
│   │   └── whisper/
│   └── tests/
├── frontend/                         # React frontend (minimal changes to WebSocket events)
│   ├── src/
│   │   ├── hooks/
│   │   │   ├── useRealtime.ts        # Same WebSocket protocol, just different server
│   │   │   ├── useRecorder.ts        # Unchanged
│   │   │   └── useAudioPlayer.ts     # Unchanged
│   │   └── ...                       # All other components unchanged
├── data/
│   ├── exercises/                    # Same YAML exercise files
│   └── speakbright.db               # SQLite database
└── scripts/
    ├── download-models.sh            # Download STT/TTS/LLM models
    ├── build.sh
    └── test.sh
```

---

### REQUIREMENTS.TXT (NEW — ZERO AZURE)

```
# Web framework
flask>=3.0
flask-sock>=0.7
simple-websocket>=1.0
python-dotenv>=1.0
pyyaml>=6.0

# LLM
langchain>=0.3
langchain-ollama>=0.3
langchain-openai>=0.3
langchain-core>=0.3
langgraph>=0.2

# STT
useful-moonshine-onnx>=0.1       # Moonshine ASR
# OR: faster-whisper>=1.0
# OR: vosk>=0.3

# TTS  
piper-tts>=1.2                    # Piper TTS
# OR: TTS>=0.22                   # Coqui TTS

# Pronunciation assessment
stable-ts>=2.16                   # Whisper with word-level alignment
# OR: whisperx>=3.1
gruut>=2.4                        # IPA phoneme lookup
jiwer>=3.0                        # Word error rate calculation

# Audio processing
numpy>=1.24
soundfile>=0.12

# VAD (Voice Activity Detection)
webrtcvad>=2.0.10
# OR: silero-vad

# Telemetry (optional)
opentelemetry-sdk>=1.20
opentelemetry-exporter-otlp>=1.20

# Testing
pytest>=8.0
pytest-asyncio>=0.23
```

---

### KEY IMPLEMENTATION NOTES

1. **The frontend is almost unchanged.** It just sends/receives WebSocket JSON messages. As long as the backend emits the same event types (`response.audio.delta`, `conversation.item.input_audio_transcription.completed`, `response.audio_transcript.done`, `session.created`, `response.done`), the React app works as-is.

2. **Drop avatar/video support** initially. The current Azure VoiceLive provides avatar rendering — this is proprietary and complex. Replace with a simple animated icon or Lottie animation on the frontend. Add back later with an open-source talking head if needed (SadTalker, Wav2Lip, LivePortrait).

3. **SQLite storage is already portable** — `storage.py` has zero Azure dependencies.

4. **The exercise YAML files are already portable** — pure YAML, no Azure references.

5. **The conversation analyzer** just needs `AzureOpenAI` replaced with LangChain's `ChatOllama` or `ChatOpenAI`. The structured JSON schema evaluation is the same.

6. **The pronunciation assessor** is the hardest replacement. Azure provides a single API call that returns word + phoneme accuracy. Open-source requires: ASR with timestamps → alignment against reference → scoring. Use `stable-ts` or `whisperx` for word-level alignment, then score based on edit distance and confidence.

7. **For latency-sensitive voice interaction**, consider running STT and TTS on GPU if available, or use the smallest models (Moonshine tiny, Piper medium). Target <500ms round-trip for the full STT→LLM→TTS pipeline.

8. **Model download script** should fetch all models on first run:
```bash
#!/bin/bash
# download-models.sh
mkdir -p models/moonshine models/piper

# Moonshine ASR
pip install useful-moonshine-onnx  # includes model

# Piper TTS voices
wget -P models/piper/ https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
wget -P models/piper/ https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json

# LLM (via Ollama)
ollama pull llama3.1:8b
```

---

### PRIORITY ORDER FOR IMPLEMENTATION

1. **Config + storage** — already portable, just strip Azure env vars
2. **LLM integration** — swap AzureOpenAI for LangChain + Ollama
3. **Conversation analyzer** — same swap, test structured JSON output
4. **TTS** — integrate Piper, test audio format matches frontend expectations (24kHz, 16-bit, mono PCM)  
5. **STT** — integrate Moonshine, test streaming transcription
6. **Voice pipeline** — new WebSocket handler replacing VoiceLive proxy
7. **Pronunciation assessor** — hardest, do last. Whisper + alignment scoring
8. **Docker Compose** — package everything
9. **Frontend tweaks** — remove avatar/video references, adjust if any WS event names differ

---

### TESTING STRATEGY

```bash
# Unit tests (same structure as current)
pytest backend/tests/unit/ -v

# Integration test: start all services
docker compose up -d
curl http://localhost:8000/api/config
curl http://localhost:8000/api/scenarios
# WebSocket test with wscat:
wscat -c ws://localhost:8000/ws/voice

# LLM test
curl http://localhost:11434/api/chat -d '{"model":"llama3.1:8b","messages":[{"role":"user","content":"hello"}]}'

# Full pipeline test
python -c "
from src.services.stt.moonshine import MoonshineSTT
from src.services.tts.piper_tts import PiperTTS
stt = MoonshineSTT()
tts = PiperTTS()
# Record → transcribe → synthesize → verify
"
```
