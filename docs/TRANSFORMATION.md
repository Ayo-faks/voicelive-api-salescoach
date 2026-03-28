# From Sales Coach to SpeakBright — A Plain-English Walkthrough

This document explains the original app, how its AI was wired together, how the prompts worked, and exactly what changed when we turned it into SpeakBright.

---

## 1. What the Original App Was

The original repo was called **Voice Live API Sales Coach**.  It was a Microsoft sample that let salespeople practice handling tough customer conversations.  Think of it as a flight simulator, but for sales calls.

A salesperson would pick a scenario (e.g. "Contoso Distributor Product Launch"), speak into their microphone, and an AI character on screen would respond as a tough customer — asking hard questions, raising objections, and keeping the conversation realistic.  After the call, a second AI would grade the salesperson on how well they did.

The three built-in scenarios were:

| Scenario | AI Character | Setting |
|----------|-------------|---------|
| Contoso Distributor Product Launch | Alex Chen, Commercial Director at MegaDistrib | Presenting a new vape product line to a skeptical distributor |
| Contoso Software Platform Contract Renewal | Sam Rodriguez, CTO of TechCorp | Annual SaaS contract renewal with a frustrated tech buyer |
| Contoso Manufacturing Equipment Introduction | Chris Thompson, Ops Manager at SteelWorks | Pitching automation equipment to a factory manager wary of change |

---

## 2. How the AI Was Wired (Original)

The app had four AI components working together in a chain:

```
Microphone → Voice Live API → GPT-4o (role-play) → Azure Speech (voice out)
                                                         ↓
                                           GPT-4o (evaluation) ← transcript
                                                         ↓
                                               Structured score card
```

### Component 1 — Voice Live API (real-time conversation)

Azure Voice Live API handled the live voice connection.  The backend opened a persistent WebSocket between the browser and Azure.  Audio from the salesperson's mic was forwarded up, and Azure sent back the AI character's spoken response plus an animated avatar.

The relevant code lives in `backend/src/services/websocket_handler.py`.  The `VoiceProxyHandler` class builds a connection to `https://<resource>.cognitiveservices.azure.com` with an API key, then relays audio between the browser and Azure in both directions.

### Component 2 — GPT-4o (role-play persona)

Each scenario had a YAML file (e.g. `scenario1-role-play.prompt.yml`) containing a long system prompt that told GPT-4o who it was.  For example, the distributor scenario opened with:

> *You are Alex Chen, Commercial Director at MegaDistrib, a major tobacco and vape distributor serving 2,000+ retail outlets...*

The prompt included a character profile (15 years of experience, results-driven, cautious about new SKUs), behavioral rules ("use conversational fillers occasionally", "take natural pauses to think"), and a numbered list of key objections to raise (limited counter space, regulatory concerns, cannibalization risk, etc.).

When the salesperson spoke, GPT-4o would respond *in character* — asking hard questions, pushing back, and behaving the way a real buyer would.

### Component 3 — GPT-4o (evaluation)

After the call ended, a separate evaluation prompt would receive the full transcript and score it.  Each scenario had a paired evaluation YAML file.  The evaluation prompt defined an explicit rubric:

| Section | Max Points | Sub-scores |
|---------|-----------|------------|
| Speaking Tone & Style | 30 | Professional Tone (10), Active Listening (10), Engagement Quality (10) |
| Conversation Content | 70 | Needs Assessment (25), Value Proposition (25), Objection Handling (20) |
| **Overall** | **100** | |

GPT-4o was called with OpenAI's **structured outputs** feature.  The response format enforced a strict JSON schema named `sales_evaluation` with fields for each sub-score, an `overall_score`, a `strengths` array (up to 3 items), an `improvements` array (up to 3 items), and a `specific_feedback` string.

### Component 4 — Azure Speech (pronunciation assessment)

Azure Speech Services would run pronunciation assessment on recorded audio.  In the sales context this was mainly used to assess speaking clarity and fluency, returning scores like `accuracy_score`, `fluency_score`, `completeness_score`, and `pronunciation_score` plus per-word breakdowns.

### Agent Management

The `AgentManager` class in `managers.py` handled creating agents.  It loaded each `*-role-play.prompt.yml` file at startup and could create agents in two ways:

1. **Local mode** — store the system prompt in memory and pass it as `instructions` when the Voice Live session starts.
2. **Azure AI Agent Service mode** — register the agent with Azure AI Foundry so it persists server-side.

Either way, the instructions, model name (`gpt-4o`), temperature, and max tokens from the YAML file were combined with a stock `BASE_INSTRUCTIONS` block and sent to the voice session.

### Data Model (Original)

The original app had no persistence layer.  Each session was ephemeral — once the browser tab closed, the conversation was gone.  There was no concept of user profiles, saved sessions, or historical review.

---

## 3. What Changed — The SpeakBright Transformation

SpeakBright repurposes the exact same AI pipeline for children's speech therapy practice.  The four Azure services are identical; what changed is the *content flowing through them* and the *data layer around them*.

### 3a. Prompt Transformation

**Role-play prompts** went from tough sales buyers to a warm practice buddy named Sunny.

| What Changed | Sales Coach | SpeakBright |
|-------------|------------|-------------|
| AI character | Skeptical business executive | Sunny, a friendly speech practice buddy |
| Tone | Professional, confrontational | Warm, encouraging, child-safe |
| Response length | Full paragraphs | 1–2 short sentences max |
| Vocabulary | Business jargon | Simple words for ages 4–10 |
| Goal | Block the salesperson with hard objections | Guide the child through target sounds gently |
| Failure handling | "I'm not convinced" | "Great try! Let's try again together!" |
| Key rule | Stay in character as a tough buyer | Never say the child is wrong |

A concrete example.  The original scenario 1 system prompt opened with:

> *You are Alex Chen, Commercial Director at MegaDistrib... Show genuine interest but maintain professional skepticism... Raise concerns about limited retail counter space...*

The equivalent SpeakBright exercise opens with:

> *You are Sunny, a friendly speech practice buddy helping a child tell a short story... Keep replies to 1-2 short sentences... Encourage clear tries on red, rabbit, rocket, and rainbow... Praise effort every time.*

**Evaluation prompts** went from sales scoring to speech therapy scoring.

| What Changed | Sales Coach | SpeakBright |
|-------------|------------|-------------|
| Schema name | `sales_evaluation` | `speech_therapy_evaluation` |
| Category 1 | Speaking Tone & Style (30 pts) | Articulation Clarity (30 pts) |
| Sub-scores | Professional Tone, Active Listening, Engagement Quality | Target Sound Accuracy, Overall Clarity, Consistency |
| Category 2 | Conversation Content (70 pts) | Engagement and Effort (30 pts) |
| Sub-scores | Needs Assessment, Value Proposition, Objection Handling | Task Completion, Willingness to Retry, Self-Correction Attempts |
| Positive feedback | `strengths` array | `celebration_points` array |
| Improvement feedback | `improvements` array | `practice_suggestions` array |
| Detailed feedback | `specific_feedback` string | `therapist_notes` string |
| Scoring guard | None | "Evaluate the child speaker only — do not score the assistant" |

The structured output JSON schema was completely rewritten so GPT-4o returns therapy-relevant scores instead of sales scores.

### 3b. Exercise Data Model

Sales Coach had role-play YAML files with no structured metadata.  SpeakBright added an `exerciseMetadata` block to every YAML file:

```yaml
exerciseMetadata:
  type: guided_prompt        # word_repetition | minimal_pairs | sentence_repetition | guided_prompt
  targetSound: r             # the phoneme being practiced
  targetWords:               # words the child should attempt
    - red
    - rabbit
    - rocket
    - rainbow
  difficulty: hard           # easy | medium | hard
  ageRange: 7-10             # intended age range
  speechLanguage: en-US
```

This metadata drives the pronunciation assessor's age-calibration logic and the UI's exercise cards.

The four built-in exercises cover different therapy exercise types:

| Exercise | Type | Target Sound | Difficulty | Age Range |
|----------|------|-------------|-----------|-----------|
| Say the S Sound | word_repetition | /s/ | easy | 4–7 |
| Sound Match S vs SH | minimal_pairs | /s/ vs /sh/ | medium | 5–8 |
| TH Sentences | sentence_repetition | /th/ | medium | 6–9 |
| Rory's Red Rocket Story | guided_prompt | /r/ | hard | 7–10 |

### 3c. Pronunciation Assessment — Age Calibration

The original app used Azure Speech pronunciation scoring as-is.  SpeakBright added a calibration layer on top.

Young children often substitute sounds in developmentally normal ways — saying "wed" instead of "red" or "fink" instead of "think".  The `PronunciationAssessor._apply_age_calibration()` method checks each word-level result against a small rule table:

| Target Sound | Max Age for Leniency | Common Substitution |
|-------------|---------------------|-------------------|
| /r/ | 5 | r → w |
| /l/ | 6 | l → w |
| /th/ | 6 | th → f, th → d, th → t |

If a substitution matches and the child is within the age window, the word's `error_type` is changed from `Mispronunciation` to `None`, and its accuracy is floored at 80%.  This prevents the score from harshly penalizing developmentally appropriate speech.

### 3d. Persistence Layer (New)

The original app had zero persistence.  SpeakBright added a SQLite database with four tables:

```
┌──────────────┐    ┌──────────────┐
│ app_settings │    │  children    │
│──────────────│    │──────────────│
│ key    (PK)  │    │ id     (PK)  │
│ value        │    │ name         │
│ updated_at   │    │ created_at   │
└──────────────┘    └───────┬──────┘
                            │
┌──────────────┐    ┌───────┴──────┐
│  exercises   │    │  sessions    │
│──────────────│    │──────────────│
│ id     (PK)  │    │ id     (PK)  │
│ name         │    │ child_id (FK)│
│ description  │    │ exercise_id  │
│ metadata_json│    │ timestamp    │
│ is_custom    │    │ ai_assessment│
│ updated_at   │    │ pronunciation│
└──────────────┘    │ transcript   │
                    │ reference_txt│
                    │ feedback_*   │
                    └──────────────┘
```

- **app_settings** — key/value store for pilot state like consent timestamps.
- **children** — seeded with three default profiles (Ava, Noah, Zuri); therapists can add more.
- **exercises** — mirrors the YAML exercises plus any therapist-authored custom ones.
- **sessions** — stores every practice session with its AI assessment JSON, pronunciation assessment JSON, transcript, and optional therapist feedback (rating + note).

This means a therapist can close the browser, come back later, and still see every child's session history, scores, and progress over time.

### 3e. Agent Instructions — BASE_INSTRUCTIONS

The `AgentManager.BASE_INSTRUCTIONS` block is appended to every exercise's system prompt.  In the sales version this was a generic "stay in character" block.  In SpeakBright it enforces child-safe interaction rules across all exercises:

```
- Keep responses SHORT and child-friendly (2 short sentences max)
- ALWAYS stay in character as a warm speech practice buddy
- Use simple words a young child can understand
- Celebrate effort and retries, not just accuracy
- Never use critical, diagnostic, or discouraging language
- Gently model target sounds and invite the child to try again
- Keep the interaction calm, encouraging, and easy to follow
```

These rules act as a safety net — even if a custom exercise prompt forgets to mention "be encouraging", the base instructions still enforce it.

### 3f. Frontend Changes

| Feature | Sales Coach | SpeakBright |
|---------|------------|-------------|
| Landing page | Scenario picker for sales role-plays | Therapist onboarding + consent screen |
| Access control | None | Therapist PIN gate |
| User profiles | None | Child profiles with session history |
| Score display | Tone & Content bar charts | Articulation & Engagement bar charts, celebration points, practice tips |
| Review mode | None | Therapist progress dashboard with per-child session history |
| Therapist feedback | None | Quick thumbs-up/down + note per session |

### 3g. Telemetry

Sales Coach had no application telemetry.  SpeakBright added privacy-safe pilot telemetry through Azure Application Insights, tracking events like `exercise_started`, `exercise_completed`, `utterance_scored`, `session_duration`, and `therapist_review_opened` — with no child names, transcripts, or speech content in the telemetry payload.

---

## 4. Summary — What Stayed the Same

The infrastructure and AI plumbing are unchanged:

- Azure Voice Live API still handles the real-time voice WebSocket
- GPT-4o still powers both the live conversation and the post-session evaluation
- Azure Speech still runs pronunciation assessment
- The backend is still Python/Flask with the same WebSocket proxy architecture
- The frontend is still React + Fluent UI
- Deployment is still AZD + Bicep → Azure Container Apps

What changed is entirely in the *content layer* — the prompts, the scoring rubrics, the structured output schemas, the exercise metadata, and the data model around them — transforming a sales practice tool into a children's speech therapy practice tool.
