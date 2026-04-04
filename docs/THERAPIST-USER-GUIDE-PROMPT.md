# Prompt: Generate Wulo Therapist User Documentation

You are a technical writer creating a comprehensive, therapist-friendly user guide for **Wulo** — an AI-powered speech therapy practice platform for children with special educational needs (SEN). The guide should be written for speech-language therapists (SLTs) who are not technical users. Use plain language, avoid jargon, and include step-by-step instructions with visual cues (icons, button labels) where applicable.

---

## Instructions

Produce a complete user guide document in Markdown covering every section below. Each section should include:

- A brief overview of **what** the feature does and **why** it matters clinically
- Step-by-step instructions with numbered lists
- Tips, warnings, or best-practice callouts where relevant (use `> 💡 Tip:` and `> ⚠️ Note:` blockquotes)
- Screenshots placeholders (use `![Description](screenshots/filename.png)`) where a visual would help

The tone should be warm, professional, and encouraging — therapists are adopting a new tool and need confidence that it supports their clinical judgement rather than replacing it.

---

## Document Structure

### Title Page

```
# Wulo Therapist User Guide
**Version:** 1.0  
**Last Updated:** [DATE]  
**Platform:** Web application (desktop & tablet supported)
```

---

### 1. Welcome to Wulo

Write an introduction covering:

- **What Wulo is:** A therapist-supervised speech practice tool that pairs children with an AI voice buddy for structured articulation exercises. It uses real-time pronunciation assessment and conversational AI to deliver engaging practice sessions while the therapist observes.
- **Who it's for:** Speech-language therapists working with children (ages 4–10) on articulation and phonological awareness in school, clinic, or home settings.
- **How it works at a high level:** The therapist selects an exercise targeting a specific speech sound → the child interacts with an animated AI buddy via voice → the platform scores pronunciation in real time → the therapist reviews results and plans next steps.
- **Key benefits:**
  - Structured, repeatable practice with consistent AI delivery
  - Real-time pronunciation scoring powered by Azure Speech Services
  - Clinical-grade analytics (articulation accuracy, engagement metrics, word-level heatmaps)
  - AI-assisted practice planning that respects therapist expertise
  - Built-in exercise library covering 9 target sounds and 8 exercise types
  - Custom exercise authoring for individualised therapy goals

---

### 2. Getting Started

#### 2.1 Logging In

Cover the authentication flow:

- Wulo supports two sign-in providers: **Google** and **Microsoft (Entra ID)**
- On first visit, the user sees the **Auth Gate Screen** with login buttons
- After signing in, the platform remembers the session — no need to re-enter credentials each visit
- If the session expires, users are redirected to the login screen with a friendly message

#### 2.2 Choosing Your Mode

After login, the **Mode Selector** screen appears with two options:

| Mode | Who it's for | What you can do |
|------|-------------|-----------------|
| **Therapist Mode** | SLTs, clinical supervisors | Full access: exercise selection, session review, analytics dashboard, AI practice planner, child profile management, custom exercise authoring |
| **Child Mode** | Children during practice | Simplified view: exercise cards, voice interaction with AI buddy, session results. No admin features. |

- Explain when to use each mode (therapist prepares the session in Therapist Mode, then switches to Child Mode or hands the device to the child)

#### 2.3 First-Time Onboarding

On first login as a therapist:

1. **Therapist PIN Setup** — Set a 4-digit PIN to secure therapist-only features. This prevents children from accidentally accessing analytics or settings.
2. **Supervised-Practice Consent** — Read and acknowledge the supervised-practice consent notice:
   - Wulo is a **practice tool**, not a diagnostic or therapeutic replacement
   - Sessions should be supervised by a qualified therapist
   - Data privacy notice regarding session recordings and analytics
   - Check the acknowledgement box and tap "Continue"

> ⚠️ Note: Sessions cannot begin until consent is acknowledged. This is a one-time step.

---

### 3. The Therapist Dashboard

Describe the main Therapist Dashboard (home screen after selecting Therapist Mode):

#### 3.1 Dashboard Layout

- **Hero Section** — Welcome banner with the Wulo robot mascot and quick-start guidance
- **"+ Create Exercise" Button** — Opens the custom exercise editor (see Section 6)
- **Built-in Exercise Canvas** — Scrollable grid of pre-built exercises, filterable by target sound
- **Sidebar Navigation** (left rail):
  - **Home** — Returns to this dashboard
  - **Dashboard** — Opens the Progress Dashboard with analytics charts
  - **Settings** — Audio, accessibility, and profile configuration
  - **Child Profile Selector** — Dropdown at top to switch between children
  - **Logout** — Ends the session

#### 3.2 Navigation Tips

- On desktop, the sidebar is always visible (expanded)
- On tablet/mobile (< 720px), the sidebar collapses to an icon rail — tap the menu icon to expand
- The child profile dropdown at the top of the sidebar determines which child's data appears in analytics

---

### 4. Managing Child Profiles

Cover child profile management:

- **Viewing profiles:** Open the child profile dropdown in the sidebar to see all registered children
- **Selecting a child:** Tap a child's name to make them the "active" child. All subsequent sessions and analytics will be associated with this child.
- **Profile information:** Each profile tracks:
  - Child's name
  - Last session date
  - Total practice sessions completed
  - Sound targets in progress
  - Mastery badges earned

> 💡 Tip: Always confirm the correct child is selected before starting a session. The active child's name appears at the top of the sidebar.

---

### 5. Built-in Exercise Library

#### 5.1 Exercise Types

Describe all 8 exercise types in detail, explaining the clinical purpose and child experience for each:

| Exercise Type | Clinical Purpose | What the Child Does | Speaking Required? |
|---------------|-----------------|--------------------|--------------------|
| **Listening Minimal Pairs** | Auditory discrimination — can the child hear the difference between target and error sounds? | Listens to two words (e.g., "cap" vs "tap"), taps the matching picture card | No (receptive only) |
| **Silent Sorting** | Sound categorisation — can the child identify which words contain the target sound? | Drags picture cards into two "sound homes" (e.g., words with /k/ vs words without /k/) | No (receptive only) |
| **Sound Isolation** | Isolated sound production — can the child produce the target sound in isolation? | Repeats the target sound on its own (e.g., "sss", "kkk") after the AI buddy models it | Yes |
| **Vowel Blending** | Sound blending — can the child combine the target consonant with different vowels? | Repeats consonant-vowel combinations (e.g., "soo", "saa", "see") | Yes |
| **Word Repetition** | Single-word production — can the child produce the target sound within a word? | Repeats individual words containing the target sound (e.g., "sun", "soap", "sing") | Yes |
| **Minimal Pairs** | Contrastive production — can the child produce the target sound distinctly from the error sound? | Repeats word pairs that differ only by the target sound (e.g., "sea" / "she") | Yes |
| **Sentence Repetition** | Connected speech — can the child maintain the target sound in a sentence context? | Repeats full sentences containing the target sound | Yes |
| **Guided Prompt** | Conversational carryover — can the child use the target sound in naturalistic speech? | Engages in a themed conversation or narrative with the AI buddy | Yes |

#### 5.2 Target Sounds Covered

List the 9+ sound targets with example exercises:

- **/k/** — K-silent-sorting, K-sound-isolation, K-sound-words, K-vowel-blending, K-listening-pairs
- **/r/** — R-silent-sorting, R-sound-isolation, R-sound-words, R-vowel-blending, R-listening-pairs, R-w-listening-pairs, Guided-story-r
- **/s/** — S-silent-sorting, S-sound-isolation, S-sound-words, S-vowel-blending, S-listening-pairs
- **/ʃ/ (sh)** — Sh-silent-sorting, Sh-sound-isolation, Sh-sound-words, Sh-vowel-blending, S-sh-listening-pairs
- **/t/** — K-t-listening-pairs (contrasting /k/ and /t/)
- **/θ/ (th)** — Th-silent-sorting, Th-sound-isolation, Th-sound-words, Th-vowel-blending, Th-f-listening-pairs, Sentence-spotlight-th
- **Contrast pairs** — Minimal-pairs-s-sh (distinguishing /s/ from /ʃ/)

> 💡 Tip: Exercises follow a clinical progression from receptive (listening) to expressive (speaking). Start with Listening Minimal Pairs for a new sound target, then progress through Sorting → Isolation → Blending → Words → Sentences → Guided conversation.

#### 5.3 Browsing & Selecting Exercises

1. From the Therapist Dashboard, scroll through the **exercise grid**
2. Each card shows:
   - Exercise name (e.g., "K Sound Words")
   - Target sound badge (e.g., "/k/")
   - Difficulty level (Easy / Medium / Hard)
   - Exercise type icon
3. Tap an exercise card to select it for the next session
4. The platform will prepare the AI buddy agent for this specific exercise

---

### 6. Creating Custom Exercises

#### 6.1 When to Use Custom Exercises

- When a child's therapy targets are not covered by the built-in library
- When you want to use specific word lists from your own assessment data
- When you need to adjust difficulty or prompts for individual children

#### 6.2 Step-by-Step: Creating a Custom Exercise

1. From the Therapist Dashboard, tap **"+ Create Exercise"**
2. The **Custom Exercise Editor** dialog opens. Fill in the fields:

| Field | Description | Example |
|-------|-------------|---------|
| **Name** | A short, descriptive name | "L-Blends Word Practice" |
| **Description** | Clinical context — what is this exercise targeting? | "Word-initial /l/ blends (bl, cl, fl) in single words for Jake" |
| **Exercise Type** | Select from the 8 types (dropdown) | Word Repetition |
| **Target Sound** | The phoneme being targeted (IPA or common notation) | "/l/" or "l-blends" |
| **Target Words** | Comma-separated word list | "blue, clap, flag, black, climb, float" |
| **Difficulty** | Easy, Medium, or Hard | Medium |
| **Child-Facing Prompt** | The text the AI buddy will show/say to the child | "Let's practise some tricky words together! Say each word after me." |
| **System Prompt** | (Optional) Fine-tune the AI buddy's personality or approach | "Be extra encouraging. Pause 3 seconds between words." |

3. Tap **Save** — the exercise appears in your exercise list immediately

#### 6.3 Managing Custom Exercises

- **Edit:** Tap an existing custom exercise card → opens the editor with pre-filled fields
- **Delete:** Open the editor → tap "Delete" → confirm
- **Export as JSON:** Use the export button to save the exercise as a JSON file — useful for sharing with colleagues
- **Import from JSON:** Use the import button to load a previously exported exercise

> 💡 Tip: Export your custom exercises regularly as a backup. Custom exercises are stored in your browser, so clearing browser data will remove them.

> ⚠️ Note: Custom exercises are saved locally in your browser's storage. They do not sync across devices. Use the JSON export/import feature to transfer exercises between devices.

---

### 7. Running a Practice Session

#### 7.1 Before the Session

1. **Select the child profile** — confirm the correct child is active in the sidebar
2. **Choose an exercise** — browse built-in or custom exercises and tap to select
3. **Select an avatar** — choose the AI buddy's animated appearance (the child will see this during the session)

#### 7.2 Session Launch

1. After selecting an exercise and avatar, the **Session Launch Overlay** appears
2. The overlay shows a loading indicator while the AI buddy agent initialises (typically 2–5 seconds)
3. Once ready, the session screen opens automatically

> ⚠️ Note: Do not refresh the page during the loading overlay — this will cancel the agent setup.

#### 7.3 The Session Screen

The session screen is divided into two columns:

**Left Column (60%) — Avatar & Voice**
- The AI buddy avatar appears as an animated video panel (16:9)
- Below the avatar: a **microphone button** for the child to hold-to-talk or tap-to-toggle
- Real-time pronunciation feedback appears beneath the microphone after each utterance

**Right Column (40%) — Conversation Transcript**
- Live transcript showing the conversation between the AI buddy and the child
- Messages are labelled: **Buddy** (AI) or **Child**
- Therapist notes and controls are accessible via an expandable panel

**Exercise-Specific Panels** (appear for interactive exercise types):
- **Listening Minimal Pairs:** Picture card grid — child taps the matching card
- **Silent Sorting:** Draggable cards and two "sound home" targets
- **Sound Isolation:** Visual cue for the isolated sound
- **Vowel Blending:** Consonant-vowel combination display

#### 7.4 During the Session

- The AI buddy guides the child through the exercise structure automatically
- For speaking exercises, the child speaks into the microphone
- After each utterance, the platform provides **real-time pronunciation feedback**:
  - Word-by-word accuracy cards appear below the avatar
  - Each word is colour-coded:
    - 🟢 **Green** (80%+) — Good production
    - 🟡 **Amber** (60–80%) — Needs attention
    - 🔴 **Red** (< 60%) — Significant difficulty
- The AI buddy will praise correct productions and gently re-model incorrect ones

#### 7.5 Ending the Session

Sessions end automatically when:
- The exercise's planned number of turns is reached
- The child says "done" or a stop keyword

After ending, the **Assessment Panel** appears with full results (see Section 8).

> 💡 Tip: Let the AI buddy manage the session pacing. It's designed to give appropriate wait time and encouragement. Intervene only if the child is distressed or disengaged.

---

### 8. Understanding Session Results

After every session, the **Assessment Panel** displays a comprehensive results summary.

#### 8.1 Overall Score

- A large score badge (0–100) appears at the top
- This is a weighted composite of articulation accuracy, pronunciation scores, and engagement

#### 8.2 Articulation Metrics (Tab 1)

These metrics assess the child's speech production quality. Each is scored 0–10 and displayed as a progress bar:

| Metric | What It Measures |
|--------|-----------------|
| **Target Sound Accuracy** | How accurately the child produced the specific target phoneme (e.g., /k/) |
| **Overall Clarity** | General intelligibility of the child's speech during the session |
| **Consistency** | How consistent the child's productions were across multiple attempts |

#### 8.3 Engagement Metrics (Tab 2)

These metrics assess the child's participation and therapeutic engagement:

| Metric | What It Measures |
|--------|-----------------|
| **Task Completion** | Did the child attempt all items in the exercise? |
| **Willingness to Retry** | Did the child try again after incorrect attempts (indicates motivation)? |
| **Self-Correction Attempts** | Did the child notice and attempt to fix their own errors (indicates phonological awareness)? |

#### 8.4 Pronunciation Review (Tab 3)

A detailed word-by-word breakdown showing:
- Each target word
- Accuracy percentage (0–100%)
- Colour-coded card (green / amber / red)
- Specific feedback (e.g., "Clear /s/ sound!" or "The /r/ was produced as /w/")

#### 8.5 AI Feedback Summary (Tab 4)

The AI generates a narrative summary including:
- **Strengths:** What the child did well (e.g., "Strong /k/ production in word-initial position")
- **Areas for Improvement:** Specific targets to work on (e.g., "/r/ in word-final position was inconsistently produced")

#### 8.6 Therapist Notes (Tab 5)

- A free-text field where you can add your own clinical observations
- These notes are saved with the session and visible in later reviews

#### 8.7 Session Rating

At the bottom of the Assessment Panel:
- **👍 Helpful session** — marks the session as productive
- **👎 Needs follow-up** — flags the session for review or replanning

> 💡 Tip: Use the "Needs follow-up" flag to easily find sessions that warrant a plan revision. These flagged sessions appear highlighted in the Progress Dashboard.

---

### 9. Progress Dashboard & Analytics

The Progress Dashboard provides clinical-grade data visualisation for tracking a child's progress over time.

#### 9.1 Accessing the Dashboard

1. Tap **"Dashboard"** in the sidebar navigation
2. Select the child from the profile dropdown (if not already active)

#### 9.2 Summary Metrics Strip

At the top of the dashboard, three key numbers:

| Metric | Description |
|--------|-------------|
| **Total Sessions** | Total number of completed practice sessions for this child |
| **Average Score** | Mean overall score across all sessions |
| **Recent Trend** | Change in score compared to baseline (↑ improving, ↓ declining, → stable) |

#### 9.3 Clinical Charts

The dashboard includes 6 interactive charts. Each can be hovered for detail tooltips.

**1. Progress Trendline (Line Chart)**
- Tracks three scores over time:
  - **Overall Score** (solid teal line)
  - **Accuracy Score** (dashed light teal line)
  - **Pronunciation Score** (warm sand line)
- X-axis: Session date
- Y-axis: 0–100 scale
- **Clinical use:** Identify upward trends (progress), plateaus (need for strategy change), or dips (possible regression or bad day)

**2. Session Quality Radar (Spider Chart)**
- Six axes showing balanced performance across:
  - Target Sound Accuracy
  - Overall Clarity
  - Consistency
  - Task Completion
  - Willingness to Retry
  - Self-Correction Attempts
- **Clinical use:** Quickly identify if a child excels in engagement but struggles with accuracy (or vice versa). A "round" shape indicates balanced performance.

**3. Word-Level Accuracy Heatmap (Colour Grid)**
- Each cell represents a target word from recent sessions
- Colour scale: Red (0%) → Amber (50%) → Teal (100%)
- Shows the word text and accuracy percentage
- **Clinical use:** Instantly spot which specific words are problematic. Persistent red cells indicate words needing targeted intervention.

**4. Sound-Level Accuracy Breakdown (Horizontal Bar Chart)**
- One bar per target sound (e.g., /k/, /r/, /s/)
- Bar length = average accuracy across all exercises targeting that sound
- Colour-coded by performance tier
- **Clinical use:** Compare progress across different sound targets. Useful for prioritising which sounds to focus on in the next session.

**5. Celebration Donut (Achievement Rings)**
- Visual representation of mastery milestones achieved
- Rings fill as the child reaches accuracy thresholds
- **Clinical use:** Motivational tool — show this to the child or parents to celebrate progress

**6. Session Frequency Heatmap (Calendar View)**
- Day-of-week grid showing practice frequency
- Colour intensity indicates number of sessions per day
- **Clinical use:** Track practice consistency. Identify if certain days of the week have lower engagement (useful for scheduling recommendations).

> 💡 Tip: Use the Progress Trendline and Sound Breakdown charts together in parent consultations. The trendline shows overall trajectory while the sound breakdown shows specific targets.

---

### 10. AI Practice Planner

The AI Practice Planner helps you create structured, evidence-informed practice plans based on session data. The planner uses AI to suggest exercises, repetitions, and progression steps — but **you always have the final say**.

#### 10.1 Creating a Practice Plan

1. Open the **Progress Dashboard** or a specific **session review**
2. Tap **"Create Practice Plan"**
3. (Optional) Type a therapist instruction to guide the AI, for example:
   - "Focus on /r/ in word-final position"
   - "This child responds well to story-based exercises"
   - "Reduce difficulty — the child was frustrated last session"
4. Tap **Generate** — the AI processes session data and your instruction
5. A structured plan appears with:
   - **Recommended exercises** (from the built-in library)
   - **Sets and repetitions** for each exercise
   - **Progression steps** (what to try if the child succeeds or struggles)
   - **Therapist rationale** (AI explains why it chose each exercise)

#### 10.2 Refining a Plan

If the generated plan doesn't quite match your clinical judgement:

1. Type a refinement instruction in the message box, for example:
   - "Replace the sentence repetition exercise with vowel blending"
   - "Add more minimal pairs practice"
   - "Make it shorter — we only have 15 minutes"
2. Tap **Send** — the AI revises the plan based on your feedback
3. You can refine as many times as needed

#### 10.3 Approving a Plan

1. Once you're satisfied with the plan, tap **"Approve"**
2. Approved plans are saved to the child's profile
3. Approved plans appear in the dashboard for reference during future sessions

> ⚠️ Note: The AI planner requires an active connection to the AI service. If the planner is unavailable (shown as greyed out), check your connection or contact your administrator.

> 💡 Tip: The planner works best when you provide specific, clinical instructions. Instead of "make it harder", try "increase to 3-syllable words with /r/ in medial position".

---

### 11. Session Review & History

#### 11.1 Viewing Past Sessions

1. Open the **Progress Dashboard**
2. The session history list shows all completed sessions for the active child
3. Each entry displays:
   - Date and time
   - Exercise name and type
   - Overall score badge
   - Feedback rating (👍/👎 if set)

#### 11.2 Reviewing a Session in Detail

1. Tap a session entry to open the full **Assessment Panel**
2. All tabs are available: Articulation, Engagement, Pronunciation Review, AI Feedback, Therapist Notes
3. You can:
   - Add or edit therapist notes
   - Change the feedback rating
   - Use this session as the basis for a new practice plan (see Section 10)

#### 11.3 Identifying Sessions That Need Attention

- Sessions rated **👎 Needs follow-up** are visually flagged
- Use these flags to quickly find sessions requiring plan revision or parent discussion

---

### 12. Settings & Configuration

Access settings via the **Settings** option in the sidebar.

#### 12.1 Audio Device Selection

- Choose the microphone and speaker used for sessions
- Test audio before starting a session with a new device

#### 12.2 Accessibility Options

- Toggle reduced motion for animated elements
- Adjust contrast settings
- Keyboard navigation is supported throughout the platform

#### 12.3 Profile & Account

- View your logged-in account details
- Manage child profiles
- Check telemetry/debug status

---

### 13. Tips for Success

Include a "best practices" section for therapists:

1. **Start with listening exercises** — Build the child's auditory discrimination before asking them to produce sounds
2. **Follow the clinical progression** — Listening → Sorting → Isolation → Blending → Words → Sentences → Conversation
3. **Use custom exercises for personalisation** — The built-in library is a starting point; tailor word lists to each child's needs
4. **Review results together** — Show the child their celebration donut and green words to build confidence
5. **Use the AI planner as a collaborator** — Give it specific instructions and refine until the plan matches your clinical reasoning
6. **Rate every session** — Consistent 👍/👎 ratings help you track patterns and identify sessions needing follow-up
7. **Check the radar chart** — A "lopsided" radar suggests an imbalance between engagement and accuracy that may need addressing
8. **Export custom exercises** — Back up your work by exporting to JSON regularly

---

### 14. Glossary

Define all platform-specific terms:

| Term | Definition |
|------|-----------|
| **Target Sound** | The specific speech sound (phoneme) being practised in an exercise, e.g., /k/, /r/, /s/ |
| **Articulation Clarity** | A measure of how clearly and intelligibly the child produces speech sounds (scored 0–10) |
| **Engagement Score** | A composite measure of the child's participation, willingness to try, and task completion (scored 0–10) |
| **Pronunciation Score** | An automated score (0–100) generated by Azure Speech Services measuring overall pronunciation quality |
| **Accuracy Score** | An automated score (0–100) measuring how closely the child's production matches the expected word |
| **Fluency Score** | An automated score (0–100) measuring the smoothness and rhythm of the child's speech |
| **Minimal Pairs** | Two words that differ by only one sound (e.g., "cap" vs "tap"), used to test and train sound discrimination |
| **Sound Isolation** | Producing a speech sound on its own, outside of a word context (e.g., "sss" or "kkk") |
| **Vowel Blending** | Combining a consonant with different vowel sounds (e.g., "soo", "saa", "see") to practise sound combinations |
| **Silent Sorting** | A receptive exercise where the child categorises words by sound without speaking |
| **AI Buddy** | The animated AI character that guides the child through exercises using voice and visual prompts |
| **Session Launch Overlay** | The loading screen that appears while the AI buddy agent is being prepared for a session |
| **Assessment Panel** | The results dialog that appears after every session, showing scores, feedback, and therapist notes |
| **Practice Plan** | An AI-generated set of exercise recommendations created from session data and therapist instruction |
| **Mastery Badge** | An achievement indicator awarded when a child consistently scores ≥80% on a target sound |
| **EasyAuth** | The authentication system used by the hosting platform (Azure Container Apps) to verify user identity |
| **Wulo** | The platform name and the AI buddy mascot character |

---

### 15. Troubleshooting

Include solutions for common issues:

| Issue | Solution |
|-------|----------|
| **"Session expired" message** | Log in again using Google or Microsoft. Your data is saved. |
| **Avatar not loading** | Check your internet connection. The avatar streams video from the cloud. A fallback static buddy image will appear if the connection is too slow. |
| **No sound from the AI buddy** | Check your device's speaker volume and the audio device selected in Settings. |
| **Child's voice not being recognised** | Ensure the correct microphone is selected in Settings. Move to a quieter environment. Check that the browser has microphone permission (look for the mic icon in the address bar). |
| **Custom exercises disappeared** | Custom exercises are stored in your browser. Clearing browser data removes them. Use the JSON export feature to back up exercises. |
| **AI Planner is greyed out** | The planner requires a connection to Azure OpenAI. Check your internet connection or contact your administrator. |
| **Scores seem inaccurate** | Background noise can affect pronunciation scoring. Ensure sessions are conducted in a quiet room with the microphone close to the child. |
| **Dashboard shows no data** | Confirm the correct child profile is selected in the sidebar dropdown. |

---

## Output Format

- Produce the complete guide as a single Markdown document
- Use heading levels (H1–H4) for clear hierarchy
- Include the table of contents at the top with anchor links to each section
- Use tables for structured information
- Use blockquotes for tips and warnings
- Insert screenshot placeholders where visuals would help (`![Description](screenshots/filename.png)`)
- Target length: 3,000–5,000 words
- British English spelling (practise, colour, organisation)

---

## Context Files for Reference

When generating the guide, refer to these platform files for accurate details:

- `docs/therapist-guide.md` — Existing therapist quick-start guide
- `docs/dashboard-charts-prompt.md` — Dashboard chart specifications and clinical use cases
- `docs/session-screen-redesign-plan.md` — Session screen layout and component details
- `docs/platform-challenge-simulation.md` — Platform challenge exercise type details
- `data/exercises/*.prompt.yml` — Exercise definition files (exercise types, target sounds, word lists)
- `frontend/src/components/` — UI component implementations (screen layouts, panel structures)
- `backend/src/services/` — Backend service implementations (analysis, scoring, planning)
