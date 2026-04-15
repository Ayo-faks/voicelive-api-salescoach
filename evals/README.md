# Speech Therapy Platform — Evaluation Framework

This framework covers **three evaluation dimensions**:

| Dimension | What We're Evaluating | Who Benefits |
|---|---|---|
| **Student Evaluation** | The child's speech progress, accuracy, engagement over time | Therapists, parents, the child |
| **System Evaluation** | AI buddy behaviour, scoring accuracy, planner quality, infrastructure reliability | Engineers, product team |
| **Planner Evaluation** | AI-generated practice plans — clinical relevance, safety, exercise selection | Therapists, product team |

---

# PART 1: STUDENT EVALUATION

> _"Is the child improving?"_

## What We Measure Per Session

| Metric | Source | Range | What It Tells the Therapist |
|---|---|---|---|
| `target_sound_accuracy` | AI Eval | 0-10 | Can the child produce the target phoneme? |
| `overall_clarity` | AI Eval | 0-10 | Is the child's speech intelligible? |
| `consistency` | AI Eval | 0-10 | Can they do it repeatedly, not just once? |
| `task_completion` | AI Eval | 0-10 | Did they stay on task? |
| `willingness_to_retry` | AI Eval | 0-10 | Do they try again after a miss? |
| `self_correction_attempts` | AI Eval | 0-10 | Do they self-correct without prompting? |
| `overall_score` | AI Eval | 0-100 | Holistic session quality |
| `accuracy_score` | Azure Speech | 0-100 | Word-level pronunciation accuracy |
| `fluency_score` | Azure Speech | 0-100 | Speech rhythm and flow |
| `completeness_score` | Azure Speech | 0-100 | % of reference words attempted |
| `pronunciation_score` | Azure Speech | 0-100 | Composite pronunciation rating |

## What We Should Measure Across Sessions (not yet implemented)

| Metric | Computation | Clinical Value |
|---|---|---|
| **Sound Mastery Rate** | % sessions where accuracy_score ≥ masteryThreshold per target sound | Core clinical outcome |
| **Improvement Velocity** | Slope of accuracy_score over last N sessions per sound | Is practice working? |
| **Phoneme Error Heatmap** | Frequency of each error type across all sessions | Which sounds need more work? |
| **Session Completion Rate** | completed / started sessions | Is the child engaged enough to finish? |
| **Avg Session Duration** | mean(session_duration_seconds) | Attention span indicator |
| **Exercise Difficulty Calibration** | mean(score) grouped by difficulty level | Are "easy" exercises actually easy? |
| **Drop-off Point** | Turn number where child most often stops | Where do we lose them? |
| **Cross-Exercise Generalisation** | Compare accuracy on same sound across exercise types (isolation → words → story) | Is the child transferring skills? |

## Student Evaluation Golden Cases

### SG1: Measurable Improvement Over Time
```
Session 1: /r/ accuracy_score = 45, "wed wocket"
Session 5: /r/ accuracy_score = 62, "red wocket"
Session 10: /r/ accuracy_score = 78, "red rocket"
Expected: Progress visible in therapist dashboard, mastery trending toward threshold
```

### SG2: Mastery Achievement
```
Exercise: k-sound-words, masteryThreshold = 80
Sessions 1-7: accuracy_score = [55, 60, 65, 72, 75, 80, 85]
Expected: System flags mastery reached, suggests advancing difficulty
```

### SG3: Age-Appropriate Baseline
```
Child age: 4, target: /r/
accuracy_score = 50 with /w/ substitutions
Expected: NOT flagged as concerning — age calibration applied, therapist_notes say "developmentally expected"
```

### SG4: Generalisation Across Exercise Types
```
/k/ isolation: accuracy 90 → /k/ sound-words: accuracy 70 → /k/ sentence-spotlight: accuracy 55
Expected: Dashboard shows progression ladder, therapist sees generalisation gap
```

### SG5: Real-Time Utterance Feedback Loop
```
Turn 1: /api/assess-utterance → accuracy 40 → buddy models again
Turn 5: /api/assess-utterance → accuracy 72 → buddy celebrates improvement
Expected: Per-turn scoring drives adaptive buddy behaviour within the same session
```

## Student Evaluation Edge Cases

### SE1: Regression After Progress
```
Sessions 1-5: accuracy improving → Session 6: sharp drop
Expected: therapist_notes flag regression, NOT treated as normal variance
```

### SE2: High Engagement, Low Accuracy
```
willingness_to_retry = 9, self_correction_attempts = 8, but accuracy_score = 35
Expected: Celebration points emphasize effort. Practice suggestions focus on technique, not effort.
```

### SE3: Perfect Scores With No Generalisation
```
/k/ isolation: 95 accuracy. /k/ in words: 40 accuracy.
Expected: System recognises isolation mastery doesn't mean word-level mastery
```

### SE4: Child Exceeds Repetition Target
```
Exercise: repetitionTarget = 25, child does 40 attempts
Expected: Session scores based on quality across all attempts, not just first 25
```

---

# PART 2: SYSTEM EVALUATION

> _"Is the AI doing its job correctly?"_

## System Components Under Evaluation

| Component | Service | Endpoints | What Can Go Wrong |
|---|---|---|---|
| **AI Buddy** | VoiceProxyHandler (websocket_handler.py) | `/ws/voice` | Wrong tone, too verbose, breaks character, clinical jargon |
| **AI Evaluation** | ConversationAnalyzer (analyzers.py) | `/api/analyze` | Score inflation/deflation, null results, slow response |
| **Pronunciation** | PronunciationAssessor (analyzers.py) | `/api/analyze`, `/api/assess-utterance` | Age calibration failure, null scores, low-quality audio |
| **Practice Planner** | PracticePlanningService (planning_service.py) | `/api/plans`, `/api/plans/<id>/messages`, `/api/plans/<id>/approve` | Hallucinated exercises, wrong difficulty, unsafe plans |
| **Voice Proxy** | VoiceProxyHandler (websocket_handler.py) | `/ws/voice` | WebRTC failures, avatar disconnect, audio latency |
| **TTS** | app.py | `/api/tts` | Wrong pronunciation, latency, silence output |
| **Agent Manager** | AgentManager (managers.py) | `/api/agents/create`, `/api/agents/<id>` | Agent creation failure, orphaned agents |
| **Exercise Manager** | ExerciseManager (managers.py) | `/api/scenarios`, `/api/scenarios/<id>` | Missing exercises, YAML parse errors |
| **Auth** | Easy Auth integration | `/api/auth/session` | Missing headers, role failures, LOCAL_DEV_AUTH bypass |
| **Storage** | StorageService (storage.py) | All data endpoints | SQLite locking, blob backup failures, data loss |
| **Telemetry** | PilotTelemetryService (telemetry.py) | Internal | Missing events, wrong dimensions |

## System Behaviour Contracts

### Contract 1: Buddy Response
| Input | Expected Output | Constraints |
|---|---|---|
| Child audio/text + exercise prompt | 1 short sentence: acknowledge → model → invite retry | ≤ 25 words, no clinical terms, matches exercise rules |

### Contract 2: AI Evaluation
| Input | Expected Output | Constraints |
|---|---|---|
| Full session transcript + evaluation prompt | Structured JSON with scores, celebrations, suggestions, therapist notes | Valid schema, positive celebrations, constructive suggestions |

### Contract 3: Pronunciation Assessment
| Input | Expected Output | Constraints |
|---|---|---|
| Raw audio (≥ 48KB) + reference text | Per-word accuracy, phoneme errors, fluency/completeness | Age calibration applied, null for silence/noise |

### Contract 4: Practice Plan
| Input | Expected Output | Constraints |
|---|---|---|
| Child history + therapist request | Plan with exercises, rationale, difficulty progression | Only real catalog exercises, age-appropriate, clinically sound |

### Contract 5: Real-Time Utterance Scoring
| Input | Expected Output | Constraints |
|---|---|---|
| Single audio chunk + reference word | accuracy_score + per-word detail | < 2s latency, age calibration applied |

### Contract 6: TTS Sound Modelling
| Input | Expected Output | Constraints |
|---|---|---|
| Target word/sound + voice config | Audio bytes | Correct target sound pronunciation, < 3s latency |

## System Health Metrics

| Metric | What It Tells Us | How to Compute |
|---|---|---|
| **Therapist Agreement Rate** | Does the AI score match therapist judgment? | % of sessions where feedback_rating = "up" |
| **Score Consistency** | Do AI eval and pronunciation scores agree? | correlation(pronunciation_score, overall_score) |
| **Buddy Response Length** | Is the buddy staying brief? | avg word count of buddy responses |
| **Buddy Character Compliance** | Does the buddy stay in character? | % responses matching exercise rules |
| **Celebration Positivity** | Are celebration points always positive? | % without negative language |
| **Assessment Coverage** | Are sessions being scored? | % of transcribed sessions with non-null ai_assessment_json |
| **Eval Latency** | Is scoring fast enough? | p95 latency of /api/analyze |
| **Utterance Scoring Latency** | Is per-turn feedback fast enough? | p95 of /api/assess-utterance (target < 2s) |
| **Pronunciation Pipeline Reliability** | Does Azure Speech return results? | % of audio inputs with non-null pronunciation_json |
| **Fallback Rate** | How often do we use generic eval? | % sessions using FALLBACK_EVALUATION_PROMPT |
| **Voice Proxy Uptime** | Is WebRTC stable? | % sessions with clean connect→disconnect |
| **Avatar Load Success** | Does avatar video start? | % sessions with video track within 10s |
| **TTS Success Rate** | Does TTS produce audio? | % of /api/tts returning non-empty audio |
| **Agent Creation Success** | Do agents initialize? | % of /api/agents/create returning valid agent_id |
| **Blob Backup Success** | Is DB backed up? | % of writes followed by successful blob upload |
| **Plan Generation Success** | Does planner produce valid plans? | % of /api/plans POST returning valid JSON |
| **Plan Approval Rate** | Do therapists approve plans? | approved / total plans |
| **Auth Gate Reliability** | Does Easy Auth work? | % of authenticated requests with valid session |

## System Evaluation Golden Cases

### G1: Clean Target Sound Production
```
Exercise: k-sound-isolation (target: /k/)
Input:    Child says "kkk" clearly
Expected Buddy: Short praise + invite another try ("Great back sound! Try one more kkk.")
Expected Eval:  target_sound_accuracy ≥ 8, overall_clarity ≥ 8, consistency ≥ 7
Expected Pronunciation: accuracy_score ≥ 85
```

### G2: Correct Minimal Pair Discrimination
```
Exercise: r-w-listening-pairs (target: /r/ vs /w/)
Input:    Buddy says "ring or wing?" → Child says "ring"
Expected Buddy: Confirm correct choice, move to next pair
Expected Eval:  task_completion ≥ 8, willingness_to_retry ≥ 7
```

### G3: Approximation With Self-Correction
```
Exercise: r-sound-words (target: /r/)
Input:    Child says "wed wocket... red rocket"
Expected Buddy: Celebrate the self-correction specifically
Expected Eval:  self_correction_attempts ≥ 8, overall_score ≥ 65
Expected Pronunciation: second attempt accuracy > first attempt
```

### G4: Guided Story Participation
```
Exercise: guided-story-r (target: /r/ in context)
Input:    Child retells story with multiple /r/ words, some substituted
Expected Buddy: Highlight 1-2 accurate words, gently model 1 missed word
Expected Eval:  engagement scores ≥ 7, therapist_notes mentions /w/→/r/ substitution
```

### G5: Multi-Turn Sustained Practice
```
Exercise: any sound-words exercise, 10+ turns
Input:    Child attempts target words with gradual improvement
Expected Eval:  consistency ≥ 7, overall_score reflects improvement trajectory
```

### G6: Silent Sorting Exercise
```
Exercise: k-silent-sorting (target: /k/, requiresMic = false)
Input:    Child silently categorises words via tap UI
Expected Buddy: "Does 'cat' have the /k/ sound? Tap yes or no!"
Expected Eval:  task_completion based on sorting accuracy, NOT pronunciation
Expected Pronunciation: Should NOT be called (no mic)
```

### G7: Vowel Blending Exercise
```
Exercise: r-vowel-blending (target: /r/ + vowels)
Input:    Child blends "r" with vowels: "ra", "re", "ri", "ro", "ru"
Expected Buddy: Model each blend, praise smooth transitions
Expected Eval:  consistency across vowel combinations
```

### G8: Sentence Spotlight Exercise
```
Exercise: sentence-spotlight-th (target: /th/ in sentences)
Input:    Child says "The three brothers think together"
Expected Buddy: Highlight sentence-level production, pick 1-2 target words
Expected Eval:  Scores reflect connected-speech accuracy (harder than isolation)
Expected Pronunciation: Reference text = full sentence, per-word breakdown
```

### G9: Custom Therapist Exercise
```
Exercise: Custom scenario via CustomScenarioEditor
Input:    Therapist defines target sound, words, instructions
Expected: Falls back to FALLBACK_EVALUATION_PROMPT
Expected Eval:  Valid structured JSON with all required fields
```

### G10: Real-Time Utterance Scoring
```
Endpoint: POST /api/assess-utterance
Input:    Audio chunk + reference word "rabbit"
Expected: Return < 2s with { accuracy_score, words: [{word: "rabbit", accuracy: 72}] }
Expected: Age calibration applied if child age < threshold
```

### G11: TTS Sound Modelling
```
Endpoint: POST /api/tts
Input:    { text: "kkk" }
Expected: Audio bytes with correct /k/ production, latency < 3s
```

### G12: Practice Plan Generation
```
Endpoint: POST /api/plans
Input:    Child with 5 /r/ sessions (scores: 45, 52, 60, 65, 70)
Expected: Plan advances to harder /r/ exercise, references past scores
Expected: Only exercise IDs from catalog
```

### G13: Plan Refinement Via Conversation
```
Endpoint: POST /api/plans/<id>/messages
Input:    Therapist: "Focus more on /r/ in sentences"
Expected: Planner adjusts exercise selection, keeps other elements
Expected: Uses get_planning_context and list_candidate_exercises tools
```

### G14: Session End → Agent Cleanup
```
Endpoint: DELETE /api/agents/<id>
Expected: Agent deleted, no orphans
Expected Telemetry: exercise_completed with all score dimensions
```

---

## Edge Cases

### E1: Silent or Near-Silent Input
```
Input:    Audio < 0.5s or below noise floor
Expected Buddy: Gentle re-prompt ("I'm ready when you are!")
Expected Pronunciation: Return null, do NOT score silence as failure
```

### E2: Off-Topic Speech
```
Input:    Child says "I want juice" during /k/ exercise
Expected Buddy: Acknowledge, redirect ("That sounds yummy! Let's try one more kkk.")
Expected Eval:  task_completion penalized, engagement NOT penalized
```

### E3: Crying / Emotional Distress
```
Input:    Audio contains crying or "I don't want to"
Expected Buddy: Warm, zero-pressure ("That's okay. We can take a break.")
Expected Eval:  therapist_notes flags emotional state, scores NOT harshly penalized
```

### E4: Age-Appropriate Substitution
```
Input:    4-year-old says "wabbit" for "rabbit"
Expected: Age calibration suppresses /w/→/r/ penalty for age < 5
Expected Eval:  therapist_notes mentions developmental expectation
```

### E5: Background Noise / Sibling Talking
```
Input:    Multiple voices in audio
Expected: Lower confidence flag, NOT penalized
```

### E6: Echolalia / Pure Imitation
```
Input:    Child repeats buddy verbatim every turn
Expected Eval:  therapist_notes notes imitation pattern
```

### E7: Very Short Session (1-2 turns)
```
Expected Eval:  Low consistency, celebration_points still present
```

### E8: Custom Exercise Fallback
```
Input:    scenario_id not in loaded evaluation YAMLs
Expected: FALLBACK_EVALUATION_PROMPT, valid structured JSON
```

### E9: WebRTC Drop Mid-Session
```
Expected: Transcript preserved, partial session can still be analyzed
Expected Telemetry: session_duration reflects actual active time
```

### E10: Planner With No Session History
```
Input:    New child, zero sessions
Expected: Plan starts at easiest difficulty, does NOT hallucinate past scores
```

### E11: Planner With Conflicting Therapist Instructions
```
Input:    "Do advanced /r/ sentences" but child accuracy = 30
Expected: Planner honours therapist but notes risk in rationale
```

### E12: Concurrent Sessions From Same Child
```
Expected: Separate agents, no cross-contamination, both scored independently
```

### E13: Audio Too Short for Pronunciation
```
Input:    Audio < 48KB (MIN_AUDIO_SIZE_BYTES)
Expected: PronunciationAssessor returns null, AI eval still runs from transcript
```

### E14: Silent Sorting — No Audio
```
Exercise: requiresMic = false
Expected: pronunciation_json = null (not attempted, not failed)
```

### E15: Consent Not Yet Given
```
Input:    User hits /api/agents/create before /api/pilot/consent
Expected: Consent gate enforced, no session created
```

### E16: First User Auto-Therapist
```
Input:    First user sign-in, no existing therapists
Expected: Auto-assigned therapist role, can access all features
```

---

## Failure Modes

### F1: Hallucinated Praise
```
Trigger:  Child produces wrong sound
Failure:  Buddy says "Perfect /k/ sound!"
Detect:   accuracy_score < 40 AND buddy transcript contains "perfect"/"great"
Severity: HIGH
```

### F2: Score Inflation
```
Trigger:  Weak session, minimal attempts
Failure:  overall_score > 80
Detect:   overall_score > 80 AND (turn_count < 3 OR pronunciation_score < 50)
Severity: HIGH
```

### F3: Score Deflation for Developmental Speech
```
Trigger:  Young child with expected substitutions
Failure:  pronunciation_score < 40
Detect:   child_age < AGE_BASED_SUBSTITUTION_RULES threshold AND pronunciation_score < 50
Severity: MEDIUM
```

### F4: Buddy Breaks Character
```
Trigger:  Unexpected input or long conversation
Failure:  Adult language, clinical terms, multi-sentence lectures
Detect:   response > 25 words OR contains "phonology"/"articulation disorder"
Severity: MEDIUM
```

### F5: Assessment Timeout / Null Scores
```
Trigger:  Azure OpenAI or Speech SDK timeout
Detect:   sessions WHERE ai_assessment_json IS NULL AND transcript IS NOT NULL
Severity: MEDIUM
```

### F6: Pronunciation-AI Score Disagreement
```
Detect:   |pronunciation_score - overall_score| > 40
Severity: LOW-MEDIUM
```

### F7: Celebration Points Contain Negative Language
```
Detect:   regex on celebration_points for (struggled|failed|wrong|bad|couldn't)
Severity: HIGH
```

### F8: Planner Hallucinated Exercises
```
Trigger:  Copilot SDK generates plan with non-existent exercises
Detect:   plan exercise IDs not in ExerciseManager.get_all_scenarios()
Severity: HIGH
```

### F9: Planner Ignores Child's Level
```
Trigger:  Child accuracy = 30, planner recommends advanced difficulty
Detect:   plan difficulty > child's highest mastered type + 1 step
Severity: HIGH — clinical safety
```

### F10: Planner Produces Empty/Invalid Plan
```
Trigger:  Copilot SDK timeout or malformed response
Detect:   plan_validation.py rejects draft
Severity: MEDIUM
```

### F11: Plan Refinement Loses Prior Context
```
Trigger:  Therapist refines plan
Failure:  New plan has no overlap with original exercises
Severity: MEDIUM
```

### F12: Blob Backup Failure → Data Loss
```
Trigger:  Azure Blob outage during backup
Detect:   last_backup_timestamp > 1 hour behind latest session
Severity: HIGH
```

### F13: Voice Proxy Memory Leak
```
Trigger:  Many sessions without cleanup
Detect:   Container memory trending upward
Severity: MEDIUM
```

### F14: TTS Produces Silent Audio
```
Trigger:  Invalid voice config or Speech outage
Detect:   TTS response amplitude = 0 or duration < 0.1s
Severity: MEDIUM
```

### F15: Auth Bypass — LOCAL_DEV_AUTH in Production
```
Trigger:  LOCAL_DEV_AUTH accidentally enabled in prod
Detect:   Production env var check
Severity: CRITICAL
```

### F16: Orphaned Agents After Crash
```
Trigger:  Server restart during active sessions
Detect:   Agent count in Azure > active session count
Severity: LOW-MEDIUM
```

---

# PART 3: PLANNER EVALUATION

> _"Are the AI-generated practice plans clinically sound?"_

## Planner Golden Cases

### PG1: Standard Plan for Progressing Child
```
Input:    Child (age 5), /r/, 5 sessions with scores [45, 52, 60, 67, 73]
Expected: Advances to next exercise type (isolation → sound-words)
Expected: Rationale references improvement trend
Expected: All exercise IDs in catalog
```

### PG2: Plan for New Child
```
Input:    Child (age 4), /k/, no prior sessions
Expected: Starts at easiest difficulty (k-sound-isolation)
Expected: Exercises age-appropriate (ageRange includes 4)
```

### PG3: Therapist Refinement Honoured
```
Input:    Plan has 3 exercises → therapist: "Add a listening exercise"
Expected: Updated plan has original 3 + listening-pairs exercise
```

### PG4: Plan Approval Workflow
```
Input:    Therapist reviews → approves
Expected: Status changes, visible in child's plan history
Expected Telemetry: planner_plan_approved event
```

## Planner Edge Cases

### PE1: Mixed Sound Targets
```
Input:    Child practising /r/ and /s/, different mastery
Expected: Plan addresses both, doesn't mix in one exercise
```

### PE2: All Exercises Mastered
```
Input:    Child mastered all /k/ exercises
Expected: Suggests generalisation or maintenance
```

### PE3: Therapist Contradicts Clinical Logic
```
Input:    "Skip isolation → sentences" at 30% accuracy
Expected: Follows therapist, rationale flags risk
```

## Planner Failure Modes
See F8-F11 in System Evaluation above.

---

# PART 4: EXERCISE TYPE COVERAGE

| Exercise Type | Eval YAML | Golden Case | Edge Case | Notes |
|---|---|---|---|---|
| `sound_isolation` | ✅ (k,r,s,sh,th) | G1 | E1 (silence) | requiresMic = true |
| `sound_words` | ✅ (k,r,s,sh,th) | G3, G5 | SE2 | requiresMic = true |
| `listening_pairs` | ✅ (k-t,r-w,s-sh,th-f) | G2 | E6 | Discrimination only |
| `silent_sorting` | ✅ (k,r,s,sh,th) | G6 | E14 | requiresMic = false |
| `vowel_blending` | ✅ (k,r,s,sh,th) | G7 | — | Blend target + vowels; evaluators now check opening/retry turn shape, target-set drift, and sound-specific correction |
| `guided_story` | ✅ (r) | G4 | E5 | Connected speech |
| `sentence_spotlight` | ✅ (th) | G8 | — | Target in sentences |
| `minimal_pairs` | ✅ (s-sh) | G2 | — | Production contrast |
| `two_word_phrase` | ❌ needs YAML | ❌ needs case | — | Frontend type only |
| `generalisation` | ❌ needs YAML | ❌ needs case | — | Frontend type only |
| `cluster_blending` | ❌ needs YAML | ❌ needs case | — | Frontend type only |
| `syllable_practice` | ❌ needs YAML | ❌ needs case | — | Frontend type only |
| Custom (therapist) | Fallback prompt | G9 | E8 | FALLBACK_EVALUATION_PROMPT |

---

# PART 5: RUNNING EVALS

### 1. Unit Tests
```bash
cd backend && python -m pytest tests/ -v
```

### 2. YAML Test Cases
```bash
cd backend && python -m pytest tests/ -v -k "eval"
```

### 3. Smoke Tests

```bash
# AI Evaluation
curl -X POST https://<host>/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"scenario_id":"k-sound-isolation","transcript":"Buddy: Camera goes kkk.\nChild: kkk.","session_id":"test-001"}'

# Utterance scoring
curl -X POST https://<host>/api/assess-utterance \
  -H "Content-Type: application/json" \
  -d '{"audio_base64":"<b64>","reference_text":"cat"}'

# TTS
curl -X POST https://<host>/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"kkk"}' --output test.wav

# Plan creation
curl -X POST https://<host>/api/plans \
  -H "Content-Type: application/json" \
  -d '{"child_id":"<id>","message":"Plan for /r/ sounds"}'

# Plan refinement
curl -X POST https://<host>/api/plans/<plan_id>/messages \
  -H "Content-Type: application/json" \
  -d '{"message":"Add a listening exercise too"}'

# Plan approval
curl -X POST https://<host>/api/plans/<plan_id>/approve
```

### 4. Failure Detection Queries (SQLite)

```sql
-- F2: Score inflation
SELECT id, overall_score, pronunciation_score
FROM sessions WHERE overall_score > 80 AND pronunciation_score < 50;

-- F5: Missing assessments
SELECT id, created_at
FROM sessions WHERE transcript IS NOT NULL AND ai_assessment_json IS NULL;

-- F6: Score disagreement
SELECT id, ABS(overall_score - pronunciation_score) as gap
FROM sessions WHERE gap > 40 ORDER BY gap DESC;
```

### 5. App Insights (KQL)

```kql
// Session funnel
customEvents
| where name in ("exercise_started", "exercise_completed")
| summarize count() by name, bin(timestamp, 1d)

// Score distribution
customEvents
| where name == "exercise_completed"
| extend score = toint(customDimensions.overall_score)
| summarize avg(score), percentile(score, 50) by tostring(customDimensions.exercise_type)

// Planner success
customEvents
| where name in ("planner_plan_created", "planner_plan_approved")
| summarize count() by name, bin(timestamp, 1d)

// Utterance latency
customEvents
| where name == "utterance_scored"
| extend latency_ms = toint(customDimensions.latency_ms)
| summarize percentile(latency_ms, 95) by bin(timestamp, 1h)

// Auth failures
customEvents
| where customDimensions.status_code == "401"
| summarize count() by bin(timestamp, 1h)

// F15: LOCAL_DEV_AUTH in production
customEvents
| where customDimensions.local_dev_auth == "true" and cloud_RoleName contains "prod"
```

### 6. Infrastructure Health
```bash
curl -s https://<host>/api/health | jq .
curl -s https://<host>/api/config | jq '.planner_enabled'
```