# SEN Speech Therapy MVP — New Session Build Prompt

> **Copy this entire file into a new Copilot chat session to bootstrap the MVP build.**
> It contains all context, design rules, and sprint instructions needed to build without re-discovery.

---

## 1. PROJECT IDENTITY

**Product name:** SpeakBright  
**What it is:** A therapist-supervised speech therapy practice tool for children with Special Educational Needs (SEN), adapted from Microsoft's `voicelive-api-salescoach` Azure Sample.  
**What it is NOT:** A diagnostic tool. A replacement for a therapist. A standalone children's app.

**Repo location:** `/home/ayoola/sen/voicelive-api-salescoach`  
**Sprint plan:** `docs/SPRINT-PLAN.md` — read this FIRST for the full 6-sprint delivery plan.  
**Deployed endpoint:** `https://voicelab.wittyground-443dbaba.swedencentral.azurecontainerapps.io/`  
**Azure env:** `salescoach-swe` in `swedencentral`, subscription `Microsoft Azure Sponsorship`

---

## 2. TECH STACK (do not change these)

| Layer | Technology | Key files |
|-------|-----------|-----------|
| Backend | Python 3.11, Flask 3.1.2, flask-sock | `backend/src/app.py` |
| Voice AI | azure-ai-voicelive SDK, Azure Speech SDK 1.47.0 | `backend/src/services/websocket_handler.py` |
| LLM | Azure OpenAI GPT-4o via openai 2.13.0 | `backend/src/services/analyzers.py` |
| Frontend | React 19, TypeScript, Vite 7 | `frontend/src/` |
| UI Library | Fluent UI React Components 9.72.9 | `frontend/package.json` |
| Infra | AZD + Bicep → Azure Container Apps | `infra/resources.bicep` |
| Tests | pytest (backend), unit tests in `backend/tests/unit/` | `backend/pytest.ini` |

---

## 3. ARCHITECTURE SNAPSHOT

```
Browser (React + Fluent UI)
    ↕ WebSocket
Flask backend (VoiceProxyHandler)
    ↕ azure-ai-voicelive SDK
Azure Voice Live API ← GPT-4o (agent personality)
                     ← Azure Speech (pronunciation assessment)
```

**Key backend services:**
- `managers.py` → ScenarioManager (YAML exercise loader), AgentManager (Voice Live agent creation)
- `analyzers.py` → ConversationAnalyzer (GPT-4o structured evaluation), PronunciationAssessor (Azure Speech pronunciation)
- `websocket_handler.py` → VoiceProxyHandler (bidirectional WebSocket proxy, direct reuse)
- `config.py` → All env-var driven config, DEFAULT_SPEECH_LANGUAGE="en-US"

**Key frontend structure:**
- `App.tsx` → Main flow: scenario selection → voice session → assessment
- `types/index.ts` → Assessment, Scenario, CustomScenario interfaces
- `services/api.ts` → API client (getScenarios, createAgent, analyzeConversation)
- `services/customScenarios.ts` → localStorage CRUD for therapist-created exercises
- `components/AssessmentPanel.tsx` → Score display with ProgressBar, word-level pronunciation grid
- `components/ScenarioList.tsx` → Exercise selection (currently sales scenarios)
- `hooks/useRealtime.ts` → WebSocket connection management
- `hooks/useRecorder.ts` → Audio recording

---

## 4. DESIGN SYSTEM — "SPEAKBRIGHT"

### Design Philosophy

This is a **premium children's therapy tool** used in clinical settings. The aesthetic is: **"Montessori classroom meets modern health app"** — warm, calming, trustworthy, with moments of playful delight. NOT a cartoon game. NOT corporate enterprise. NOT generic AI slop.

**Design pillars:**
1. **Calm confidence** — The child feels safe. The therapist feels professional trust.
2. **Playful precision** — Moments of delight (micro-animations, friendly shapes) but never chaotic or overstimulating.
3. **Inclusive warmth** — Warm tones, rounded forms, generous spacing. No harsh edges, no cold clinical whites.
4. **Clear hierarchy** — Children see big, obvious actions. Therapists see organized data.

### Color Palette

```css
:root {
  /* ─── Core Palette ─── */
  --color-primary:          #4A90E2;  /* Calming sky blue — main actions, active states */
  --color-primary-light:    #7BB3F0;  /* Hover states, subtle highlights */
  --color-primary-dark:     #2D6BC4;  /* Pressed states, text on light bg */
  --color-primary-soft:     #E8F2FC;  /* Primary tinted backgrounds */

  --color-secondary:        #F7D154;  /* Friendly sunshine yellow — accents, celebrations */
  --color-secondary-light:  #FBDF7A;  /* Hover on secondary elements */
  --color-secondary-dark:   #D4A824;  /* Text on secondary-bg if needed */
  --color-secondary-soft:   #FFF8E1;  /* Yellow tinted backgrounds */

  /* ─── Semantic Colors ─── */
  --color-success:          #7BC47F;  /* Soft green — correct pronunciation, good scores */
  --color-success-light:    #A8D9AA;  /* Success backgrounds */
  --color-success-soft:     #EDF7EE;  /* Subtle success bg */

  --color-error:            #FF6F61;  /* Gentle coral — errors, needs-work indicators */
  --color-error-light:      #FFA69E;  /* Error hover */
  --color-error-soft:       #FFF0EE;  /* Error backgrounds */

  --color-warning:          #FFB74D;  /* Warm amber — caution, partial scores */
  --color-warning-soft:     #FFF3E0;  /* Warning bg */

  /* ─── Accent (added for depth, not in original palette) ─── */
  --color-accent:           #B39DDB;  /* Soft lavender — badges, tags, secondary CTAs */
  --color-accent-soft:      #F3EFFA;  /* Lavender tinted bg */

  /* ─── Neutrals ─── */
  --color-bg:               #FFF9F2;  /* Warm cream — page background */
  --color-bg-card:          #FFFFFF;  /* Cards and elevated surfaces */
  --color-bg-secondary:     #FDF5EC;  /* Slightly deeper warm bg for sections */
  --color-bg-therapist:     #F5F7FA;  /* Cooler neutral for therapist/data views */

  --color-text-primary:     #2C3E50;  /* Warm dark gray — body text (NOT pure black) */
  --color-text-secondary:   #5D6D7E;  /* Muted text, labels, captions */
  --color-text-placeholder: #A0AEC0;  /* Input placeholders */
  --color-text-inverse:     #FFFFFF;  /* Text on dark/colored backgrounds */

  --color-border:           #E8E0D8;  /* Warm border matching the cream bg */
  --color-border-focus:     #4A90E2;  /* Focus ring = primary */

  /* ─── Elevation ─── */
  --shadow-sm:    0 1px 3px rgba(44, 62, 80, 0.06);
  --shadow-md:    0 4px 12px rgba(44, 62, 80, 0.08);
  --shadow-lg:    0 8px 24px rgba(44, 62, 80, 0.12);
  --shadow-glow:  0 0 0 3px rgba(74, 144, 226, 0.2);  /* Focus glow */

  /* ─── Spacing (8px base grid) ─── */
  --space-xs:   4px;
  --space-sm:   8px;
  --space-md:   16px;
  --space-lg:   24px;
  --space-xl:   32px;
  --space-2xl:  48px;
  --space-3xl:  64px;

  /* ─── Border Radius ─── */
  --radius-sm:   8px;     /* Subtle rounding */
  --radius-md:   12px;    /* Cards, inputs */
  --radius-lg:   16px;    /* Large cards, panels */
  --radius-xl:   24px;    /* Buttons, chips */
  --radius-full: 9999px;  /* Pills, avatars */

  /* ─── Typography ─── */
  --font-display: 'Fredoka', 'Nunito', sans-serif;        /* Headings — rounded, friendly, distinctive */
  --font-body:    'Nunito Sans', 'Nunito', sans-serif;     /* Body — clean, readable, warm */
  --font-mono:    'JetBrains Mono', 'Fira Code', monospace; /* Code/data only */

  /* Font sizes (fluid where possible) */
  --text-xs:   0.75rem;   /* 12px — fine print, disclaimers */
  --text-sm:   0.875rem;  /* 14px — captions, labels */
  --text-base: 1rem;      /* 16px — body */
  --text-lg:   1.125rem;  /* 18px — large body */
  --text-xl:   1.5rem;    /* 24px — section headings */
  --text-2xl:  2rem;       /* 32px — page titles */
  --text-3xl:  2.5rem;    /* 40px — hero/child-facing headings */
  --text-hero: 3.5rem;    /* 56px — child mode big numbers/scores */

  /* ─── Transitions ─── */
  --transition-fast:   150ms ease;
  --transition-normal: 250ms ease;
  --transition-slow:   400ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-bounce: 500ms cubic-bezier(0.34, 1.56, 0.64, 1);

  /* ─── Z-Index Scale ─── */
  --z-base:    0;
  --z-card:    10;
  --z-sticky:  100;
  --z-modal:   1000;
  --z-toast:   1100;
}
```

### Typography Rules

**Install fonts** — Add to `frontend/index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Usage:**
- `Fredoka` — All headings, exercise titles, score numbers, button labels in child mode. It's rounded and friendly without being cartoon-ish.
- `Nunito Sans` — Body text, therapist UI, form labels, data tables. Clean and highly readable.
- NEVER use Inter, Roboto, Arial, or system fonts. These are generic and violate the design identity.

### Component Design Rules

**Buttons (Child-facing):**
- Minimum 56px height on desktop, 64px on mobile (large touch targets)
- `border-radius: var(--radius-xl)` (pill-shaped)
- Slight `box-shadow: var(--shadow-md)` to feel "pressable"
- On hover: subtle scale(1.02) + shadow-lg
- On press: scale(0.98) + shadow-sm (satisfying tactile feel)
- Primary actions: `var(--color-primary)` background, white text
- Success/celebration: `var(--color-success)` with a subtle sparkle animation

**Cards (Exercise cards, session cards):**
- `border-radius: var(--radius-lg)`
- `background: var(--color-bg-card)`
- `box-shadow: var(--shadow-sm)` at rest
- `box-shadow: var(--shadow-md)` on hover
- 1px `border: 1px solid var(--color-border)` for warmth
- Generous padding: `var(--space-lg)` minimum

**Microphone Button (the hero element in child session):**
- Circular, 120px diameter on desktop, 100px on mobile
- Primary blue with a subtle pulse animation when listening
- Animated ring/glow effect when actively recording (3-ring ripple)
- White microphone icon, 40px
- On idle: soft blue glow shadow
- On active: pulsing rings in `var(--color-primary-light)` expanding outward
- Include a friendly label below: "Tap to talk!" in Fredoka

**Score displays:**
- Score numbers in `font-family: var(--font-display)`, `font-size: var(--text-hero)` for child view
- Color-coded: ≥80 = `var(--color-success)`, 50-79 = `var(--color-warning)`, <50 = `var(--color-error)`
- Animated count-up from 0 to score value (400ms cubic-bezier bounce)
- Circular progress rings (SVG) instead of flat progress bars for child view
- Flat ProgressBar retained for therapist detail views

**Word-level pronunciation feedback:**
- Each word as a rounded chip/pill (`border-radius: var(--radius-full)`)
- Background color = score color (success/warning/error soft variants)
- Border left accent in the strong color variant
- Words the child got right: small checkmark icon + green bg
- Words needing work: gentle highlight in `var(--color-error-soft)` + subtle wiggle animation (not alarming)

**Navigation / Mode Switching:**
- Two modes: "Therapist" and "Practice" (child mode)
- Therapist mode: cooler palette (`var(--color-bg-therapist)`), smaller text, data-dense
- Child/Practice mode: warm palette (`var(--color-bg)`), large text, minimal UI
- Mode switch is a large obvious toggle or the therapist PIN gateway (not visible to children)

### Animation Guidelines

- **Page load:** Stagger card reveal (fade-in + translateY from 20px, 80ms delay between cards)
- **Exercise start:** Microphone button entrance with scale + bounce (`var(--transition-bounce)`)
- **Score reveal:** Numbers count up with easing, progress rings draw clockwise
- **Success moment:** Brief confetti burst (lightweight CSS-only or canvas, 1.5s, subtle — 12-15 particles, primary + secondary + accent colors). NOT every time. Only on scores ≥ 80.
- **Errors/needs-work:** NO negative animations. Just static color change. Never shake, flash red, or make error sounds. These are children.
- **Transitions between views:** Crossfade (200ms) or subtle slide, never hard cuts

### Critical "Not AI Slop" Rules

1. **No purple gradients on white.** The internet is drowning in them. Use the warm cream background.
2. **No generic hero sections** with abstract blobs. Every visual element must have purpose.
3. **No stock-looking iconography.** Use Fluent UI's icon set (already in the project). Customize colors to match the palette.
4. **No symmetrical 3-column layouts** for child-facing views. Use asymmetry, generous whitespace, and clear hierarchy.
5. **No "AI-powered" or "smart" marketing copy** in the UI. The child sees: "Let's practice!" The therapist sees: exercise data.
6. **No tooltip-heavy UIs.** If it needs a tooltip, it's not clear enough for a child.
7. **No dark mode for child view.** Warm cream background only. Therapist view can optionally support dark later.
8. **No gray placeholder states.** Loading states should use skeleton screens with warm tones or a friendly animated character.
9. **The font MUST be Fredoka for child-facing headings.** This is non-negotiable. Load from Google Fonts.
10. **Every interactive element must pass 44px minimum touch target** (WCAG 2.5.8).

### Accessibility (Non-Negotiable)

- All text must meet WCAG AA contrast (4.5:1 body, 3:1 large text) against its background
- `--color-text-primary` (#2C3E50) on `--color-bg` (#FFF9F2) = ~10:1 ✓
- `--color-primary` (#4A90E2) on `--color-bg` (#FFF9F2) = ~3.8:1 — use only for large text/icons; use `--color-primary-dark` (#2D6BC4) for small text
- `--color-secondary` (#F7D154) — NEVER use for text. Accent/background only. Contrast with cream is ~1.5:1.
- Focus states: `outline: 3px solid var(--color-primary); outline-offset: 2px` or `box-shadow: var(--shadow-glow)`
- All images/icons need `aria-label` or be `aria-hidden` if decorative
- Screen reader announcements for score results and exercise instructions

---

## 5. KEY ARCHITECTURAL DECISIONS

### What to REUSE directly
- `websocket_handler.py` — VoiceProxyHandler, bidirectional WebSocket proxy. Zero changes.
- `PronunciationAssessor` class — Phoneme-level scoring, word-level results. Change: add age-calibration method, exercise-aware reference text.
- `useRealtime.ts` hook — WebSocket lifecycle. Minor: add "record one utterance" mode.
- `useRecorder.ts` — Audio capture. Minor: add stop-after-one-utterance mode.
- `useAudioPlayer.ts` — TTS playback. No changes.
- Fluent UI component library — Already in deps, use for layout primitives. Override token colors with the design system.

### What to REPLACE (domain swap)
- `ScenarioManager` → Exercise-focused. YAML dir changes from `data/scenarios/` to `data/exercises/`.
- `AgentManager.BASE_INSTRUCTIONS` → Child-friendly speech coach persona.
- `ConversationAnalyzer._get_response_format()` → SEN evaluation schema (not sales).
- `types/index.ts` Assessment interface → SEN fields instead of sales fields.
- `AssessmentPanel.tsx` → Redesign for child-friendly score display.
- `ScenarioList.tsx` → Become exercise cards with large touch targets.
- `CustomScenarioEditor.tsx` → Become ExerciseEditor with target_sound, target_words, difficulty.

### What to ADD
- `data/exercises/*.prompt.yml` — SEN exercise YAML library
- `ExerciseFeedback.tsx` — Per-utterance word-level feedback component
- `ProgressDashboard.tsx` — Therapist session review
- `OnboardingFlow.tsx` — First-run therapist setup
- `ConsentScreen.tsx` — Legal/safety consent gate
- `storage.py` — Persistence layer (Cosmos DB or SQLite)
- `POST /api/assess-utterance` — Single utterance scoring endpoint
- `GET /api/children/{id}/sessions` — Session history endpoint

### What to REMOVE (Sprint 5)
- `data/scenarios/` — All sales YAMLs
- `graph_scenario_generator.py` — Microsoft Graph integration
- Avatar picker UI — Not needed for pilot
- Sales-specific copy in README

---

## 6. EXERCISE YAML FORMAT

```yaml
name: "Say the S Sound"
description: "Practice the /s/ sound at the start of words"
model: gpt-4o
modelParameters:
  temperature: 0.6
  max_tokens: 500
exerciseMetadata:
  type: word_repetition          # word_repetition | minimal_pairs | sentence_repetition | guided_prompt
  targetSound: "s"
  targetWords: ["sun", "soap", "star", "snake", "smile"]
  difficulty: easy                # easy | medium | hard
  ageRange: "4-7"
  speechLanguage: "en-US"
messages:
  - role: system
    content: |
      You are a friendly, encouraging speech practice buddy named Sunny.
      You help children practice saying words clearly.
      
      CRITICAL RULES:
      - Keep responses to 1-2 SHORT sentences maximum
      - Use simple words a 4-7 year old understands
      - Be enthusiastic and encouraging, NEVER critical
      - If the child struggles, say "Great try! Let's try again together!"
      - NEVER say the child is wrong. Say "Almost! Listen to how I say it..."
      - Celebrate effort, not just accuracy
      - Stay in character as Sunny the practice buddy
      
      Today's practice: The /s/ sound in these words: sun, soap, star, snake, smile
      Guide the child through each word one at a time.
  - role: user
    content: "{{child_utterance}}"
testData:
  - child_utterance: "thun"
    expected: "Should gently model the correct /s/ sound and encourage retry"
evaluators:
  - name: Uses encouraging language
  - name: Stays age-appropriate
  - name: Models correct pronunciation
```

---

## 7. SEN EVALUATION SCHEMA (replaces sales_evaluation)

```json
{
  "type": "object",
  "properties": {
    "articulation_clarity": {
      "type": "object",
      "properties": {
        "target_sound_accuracy": { "type": "integer", "minimum": 0, "maximum": 10 },
        "overall_clarity": { "type": "integer", "minimum": 0, "maximum": 10 },
        "consistency": { "type": "integer", "minimum": 0, "maximum": 10 },
        "total": { "type": "integer", "minimum": 0, "maximum": 30 }
      }
    },
    "engagement_and_effort": {
      "type": "object",
      "properties": {
        "task_completion": { "type": "integer", "minimum": 0, "maximum": 10 },
        "willingness_to_retry": { "type": "integer", "minimum": 0, "maximum": 10 },
        "self_correction_attempts": { "type": "integer", "minimum": 0, "maximum": 10 },
        "total": { "type": "integer", "minimum": 0, "maximum": 30 }
      }
    },
    "overall_score": { "type": "integer", "minimum": 0, "maximum": 100 },
    "celebration_points": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Things the child did well — phrased positively"
    },
    "practice_suggestions": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Constructive next-steps — NEVER negative language"
    },
    "therapist_notes": {
      "type": "string",
      "description": "Clinical observation summary for the therapist (not shown to child)"
    }
  }
}
```

---

## 8. SPRINT EXECUTION INSTRUCTIONS

Read `docs/SPRINT-PLAN.md` for the full plan. Execute sprints sequentially.

### Sprint 1 Quick-Start Checklist

```
[ ] Read docs/SPRINT-PLAN.md Sprint 1 section
[ ] Create data/exercises/ directory
[ ] Create 4-6 exercise YAML files (use format from Section 6 above)
[ ] Create matching evaluation YAML files
[ ] Update backend/src/services/managers.py:
    - Change SCENARIO_DATA_DIR to "data/exercises"
    - Change ROLE_PLAY_FILE_SUFFIX to "-exercise.prompt.yml" (or keep existing, your call)
    - Update AgentManager.BASE_INSTRUCTIONS with child-friendly persona
[ ] Update backend/src/services/analyzers.py:
    - Replace SCENARIO_DATA_DIR to "data/exercises"
    - Replace _get_response_format() with SEN schema (Section 7)
    - Replace _build_evaluation_prompt() criteria
    - Replace _process_evaluation_result() field names
    - Replace scoring constants with SEN equivalents
[ ] Update frontend/src/types/index.ts:
    - Replace Assessment.ai_assessment fields
    - Add exercise-specific types
[ ] Update frontend/src/components/AssessmentPanel.tsx:
    - Replace sales field references with SEN fields
    - Update labels from sales terminology to therapy terminology
[ ] Fix tests:
    - backend/tests/unit/test_analyzers.py
    - backend/tests/unit/test_managers.py
[ ] Run: cd backend && python -m pytest tests/
[ ] Run: cd frontend && npm run build
[ ] Verify: docker build -f backend/Dockerfile .
```

### Sprint 2 Quick-Start Checklist (after Sprint 1 is green)

```
[ ] Read docs/SPRINT-PLAN.md Sprint 2 section
[ ] Install Google Fonts (Fredoka + Nunito Sans) in frontend/index.html
[ ] Create the design system CSS variables in frontend/src/styles/global.css
[ ] Redesign ScenarioList.tsx → ExerciseCards with large touch targets
[ ] Adapt CustomScenarioEditor.tsx → ExerciseEditor
    - Add: exercise_type dropdown, target_sound, target_words, difficulty
[ ] Update customScenarios.ts localStorage key + default template
[ ] Redesign App.tsx: warm background, child-friendly layout
[ ] Update api.ts: pass exercise metadata to createAgentWithCustomScenario
[ ] Update backend/src/app.py: accept exercise metadata in create_agent endpoint
[ ] Implement the microphone hero button with pulse animation
[ ] Run tests + build
```

---

## 9. FLUENT UI TOKEN OVERRIDES

Since the project uses Fluent UI React Components, override the Fluent theme to match the design system. Do this in `App.tsx` or a shared theme provider:

```tsx
import { createLightTheme, BrandVariants } from '@fluentui/react-components';

const speakBrightBrand: BrandVariants = {
  10:  '#061724',
  20:  '#0C2D43',
  30:  '#134163',
  40:  '#1B5685',
  50:  '#236CA8',
  60:  '#2D6BC4',  // primary-dark
  70:  '#4A90E2',  // primary (Brand 70 = primary)
  80:  '#7BB3F0',  // primary-light
  90:  '#A5CCF5',
  100: '#C1DEFA',
  110: '#D8EBFC',
  120: '#E8F2FC',  // primary-soft
  130: '#F2F8FE',
  140: '#F9FCFF',
  150: '#FDFEFF',
  160: '#FFFFFF',
};

export const speakBrightTheme = {
  ...createLightTheme(speakBrightBrand),
  colorNeutralBackground1: '#FFFFFF',
  colorNeutralBackground2: '#FFF9F2',  // warm cream
  colorNeutralBackground3: '#FDF5EC',  // deeper warm
  colorNeutralForeground1: '#2C3E50',  // warm dark text
  colorNeutralForeground2: '#5D6D7E',  // secondary text
  colorNeutralStroke1: '#E8E0D8',      // warm border
};
```

Wrap the app:
```tsx
<FluentProvider theme={speakBrightTheme}>
  <App />
</FluentProvider>
```

---

## 10. RULES FOR THE BUILD AGENT

1. **Read `docs/SPRINT-PLAN.md` before starting any sprint.** Every task has specific file references.
2. **Follow the design system in Section 4 exactly.** If you deviate, explain why.
3. **Run tests after every file change.** Command: `cd /home/ayoola/sen/voicelive-api-salescoach/backend && python -m pytest tests/`
4. **Run frontend build after UI changes.** Command: `cd /home/ayoola/sen/voicelive-api-salescoach/frontend && npm run build`
5. **Never use diagnostic language in child-facing UI.** No "assessment", "evaluation", "score" visible to children. Use: "Great job!", "Let's practice!", "Your results".
6. **Never add features not in the current sprint.** Defer means defer.
7. **Preserve the copyright headers** in all existing files.
8. **Keep the existing Flask+flask-sock backend.** Do not rewrite to FastAPI (that's deferred).
9. **Keep Fluent UI** as the component library. Override its theme tokens, don't replace it.
10. **Every new component must use the CSS custom properties** from the design system. No hard-coded colors.
11. **Mobile-first is Sprint 5.** Sprints 1-4 target desktop-first, but use responsive-safe patterns (flexbox, relative units).
12. **Test with `docker build -f backend/Dockerfile .` from repo root** before considering any sprint done.
13. **The warm cream background (`#FFF9F2`) is the default page color.** Not white. Not gray.
14. **All scores shown to children use circular SVG progress rings**, not flat bars.
15. **Confetti only on scores ≥ 80.** Not every time. Subtle, brief.
16. **Safety disclaimer on every feedback screen:** "Practice feedback — not a clinical assessment."

---

## 11. KEY FILES REFERENCE TABLE

| File | Purpose | Sprint Modified |
|------|---------|----------------|
| `backend/src/services/managers.py` | ScenarioManager → ExerciseManager, AgentManager persona | 1 |
| `backend/src/services/analyzers.py` | ConversationAnalyzer (eval schema), PronunciationAssessor (age-cal) | 1, 3 |
| `backend/src/app.py` | Flask routes, new endpoints | 1, 3, 4 |
| `backend/src/config.py` | Env-var config, voice/language defaults | 2, 5 |
| `backend/src/services/websocket_handler.py` | VoiceProxyHandler — NO CHANGES | — |
| `frontend/src/types/index.ts` | Assessment + Exercise type interfaces | 1, 2 |
| `frontend/src/app/App.tsx` | Main layout, routing, theme provider | 2, 4, 6 |
| `frontend/src/styles/global.css` | Design system CSS variables, base styles | 2, 5 |
| `frontend/src/components/AssessmentPanel.tsx` | Score display (child + therapist) | 1, 3 |
| `frontend/src/components/ScenarioList.tsx` | → Exercise cards | 2 |
| `frontend/src/components/CustomScenarioEditor.tsx` | → ExerciseEditor | 2 |
| `frontend/src/services/api.ts` | API client, exercise metadata | 2, 3 |
| `frontend/src/services/customScenarios.ts` | localStorage exercise CRUD | 2 |
| `frontend/src/hooks/useRecorder.ts` | Audio recording, utterance mode | 3 |
| `data/exercises/*.prompt.yml` | SEN exercise library | 1, 5 |
| `infra/resources.bicep` | Azure infra + optional Cosmos DB | 4, 5 |

---

## 12. GETTING STARTED COMMAND

```bash
cd /home/ayoola/sen/voicelive-api-salescoach

# Verify everything builds before you change anything
cd backend && python -m pytest tests/ && cd ..
cd frontend && npm install && npm run build && cd ..
docker build -f backend/Dockerfile .

# Then start Sprint 1 per docs/SPRINT-PLAN.md
```

---

**END OF BUILD PROMPT — Begin with Sprint 1.**
