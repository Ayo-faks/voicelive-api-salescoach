# Speech Therapy Platform — Evaluation Framework

This framework covers **two distinct evaluation dimensions**:

| Dimension | What We're Evaluating | Who Benefits |
|---|---|---|
| **Student Evaluation** | The child's speech progress, accuracy, engagement over time | Therapists, parents, the child |
| **System Evaluation** | The AI buddy's behaviour, scoring accuracy, prompt quality | Engineers, product team |

---

# PART 1: STUDENT EVALUATION

> _"Is the child improving?"_

Student evaluation measures the child's speech production, engagement, and progress across sessions. This is the clinical output of the platform.

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
| **Sound Mastery Rate** | % sessions where accuracy_score ≥ masteryThreshold, per target sound | Core clinical outcome — is the child mastering sounds? |
| **Improvement Velocity** | Slope of accuracy_score over last N sessions per sound | Is practice actually working? |
| **Phoneme Error Heatmap** | Frequency of each error type across all sessions | Which sounds need more work? |
| **Session Completion Rate** | completed / started sessions | Is the child engaged enough to finish? |
| **Avg Session Duration** | mean(session_duration_seconds) | Attention span indicator |
| **Exercise Difficulty Calibration** | mean(score) grouped by difficulty level | Are "easy" exercises actually easy for this child? |
| **Drop-off Point** | Turn number where child most often stops | Where do we lose them? |

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

### SE3: Perfect Scores With No Generalization
```
/k/ isolation: 95 accuracy. /k/ in words: 40 accuracy.
Expected: System recognizes isolation mastery doesn't mean word-level mastery
```

---

# PART 2: SYSTEM EVALUATION

> _"Is the AI doing its job correctly?"_

System evaluation measures whether the AI buddy, the scoring pipeline, and the evaluation prompts behave correctly. This is engineering/product quality assurance.

## System Behaviour Contract

When an **input** (child utterance + exercise context) arrives, the system must produce an **output** that satisfies three contracts:

| Contract | Input | Expected Output |
|---|---|---|
| **Buddy Response** | Child audio/text + exercise prompt | 1 short sentence: acknowledge attempt → model target → invite retry |
| **AI Evaluation** | Full session transcript + evaluation prompt | Structured JSON: scores (0-100), celebration points, practice suggestions, therapist notes |
| **Pronunciation Assessment** | Raw audio + reference text | Per-word accuracy, phoneme-level errors, fluency/completeness scores |

## What We Measure About the System

| Metric | What It Tells Us | How to Compute |
|---|---|---|
| **Therapist Agreement Rate** | Does the AI score match therapist judgment? | % of sessions where feedback_rating = "up" |
| **Score Consistency** | Do AI eval and pronunciation scores agree? | correlation(pronunciation_score, overall_score) |
| **Buddy Response Length** | Is the buddy staying brief? | avg word count of buddy responses |
| **Buddy Character Compliance** | Does the buddy stay in character? | % responses matching exercise rules (1 sentence, no clinical terms) |
| **Celebration Positivity** | Are celebration points always positive? | % without negative language |
| **Assessment Coverage** | Are sessions being scored? | % of transcribed sessions with non-null ai_assessment_json |
| **Eval Latency** | Is scoring fast enough? | p95 latency of /api/analyze endpoint |
| **Pronunciation Pipeline Reliability** | Does Azure Speech return results? | % of audio inputs with non-null pronunciation_json |
| **Fallback Rate** | How often do we fall back to generic eval? | % of sessions using FALLBACK_EVALUATION_PROMPT |

## System Evaluation Golden Cases

These represent ideal interactions the system must handle correctly every time.

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
Expected Eval:  engagement scores ≥ 7, therapist_notes mentions /w/→/r/ substitution pattern
```

### G5: Multi-Turn Sustained Practice
```
Exercise: any sound-words exercise, 10+ turns
Input:    Child attempts target words across many turns with gradual improvement
Expected Eval:  consistency ≥ 7, overall_score reflects improvement trajectory
```

---

## Edge Cases

### E1: Silent or Near-Silent Input
```
Input:    Audio < 0.5s or below noise floor
Expected Buddy: Gentle re-prompt ("I'm ready when you are! Try saying kkk.")
Expected Pronunciation: Return null/skip, do NOT score silence as failure
Expected Eval:  Low task_completion, high willingness_to_retry if child tries again after
```

### E2: Off-Topic Speech
```
Input:    Child says "I want juice" during /k/ isolation exercise  
Expected Buddy: Acknowledge briefly, redirect to task ("That sounds yummy! Let's try one more kkk.")
Expected Eval:  task_completion penalized, engagement NOT penalized (child is talking)
```

### E3: Crying / Emotional Distress
```
Input:    Audio contains crying, whimpering, or "I don't want to"
Expected Buddy: Warm, zero-pressure response ("That's okay. We can take a break.")
Expected Eval:  Do NOT penalize scores harshly — therapist_notes should flag emotional state
System:   Should NOT push for more attempts
```

### E4: Age-Appropriate Substitution (Developmental)
```
Input:    4-year-old says "wabbit" for "rabbit" during /r/ exercise
Expected Pronunciation: Apply age calibration — suppress /w/→/r/ penalty for age < 5
Expected Eval:  therapist_notes should mention developmental expectation, NOT mark as failure
```

### E5: Background Noise / Sibling Talking
```
Input:    Multiple voices in audio, target child's voice mixed with others
Expected Pronunciation: May return lower confidence — system should flag, not penalize
Expected Buddy: Continue normally unless audio is completely unintelligible
```

### E6: Echolalia / Exact Repetition Without Understanding
```
Input:    Child perfectly repeats buddy's model verbatim every turn, no variation
Expected Eval:  High target_sound_accuracy, but therapist_notes should note pure imitation pattern
```

### E7: Very Short Session (1-2 turns only)
```
Input:    Child does 1 attempt then session ends
Expected Eval:  Low consistency (not enough data), DO NOT extrapolate from single attempt
Expected:  celebration_points still present (reward any attempt)
```

### E8: Custom/Therapist-Created Exercise
```
Input:    scenario_id not in loaded evaluation files
Expected: System falls back to FALLBACK_EVALUATION_PROMPT, still produces valid structured JSON
```

---

## Failure Modes

### F1: Hallucinated Praise
```
Trigger:  Child produces completely wrong sound (e.g., /t/ instead of /k/)
Failure:  Buddy says "Perfect /k/ sound!" 
Detect:   pronunciation accuracy_score < 40 but buddy transcript contains "perfect"/"great"
Severity: HIGH — erodes trust with therapists
```

### F2: Score Inflation
```
Trigger:  Weak session with minimal attempts
Failure:  AI eval returns overall_score > 80
Detect:   overall_score > 80 AND (turn_count < 3 OR pronunciation_score < 50)
Severity: HIGH — misleading progress data
```

### F3: Score Deflation for Developmentally Normal Speech
```
Trigger:  Young child with expected substitutions
Failure:  pronunciation_score < 40 for age-appropriate speech
Detect:   child_age < threshold in AGE_BASED_SUBSTITUTION_RULES AND pronunciation_score < 50
Severity: MEDIUM — discouraging for families
```

### F4: Buddy Breaks Character
```
Trigger:  Unexpected input or long conversation
Failure:  Buddy responds with adult-level language, clinical terminology, or multi-sentence lectures
Detect:   buddy response > 25 words OR contains clinical terms (phonology, articulation disorder, etc.)
Severity: MEDIUM — confusing for children
```

### F5: Assessment Timeout / Null Scores
```
Trigger:  Azure OpenAI or Speech SDK timeout
Failure:  Session saved with null ai_assessment_json or pronunciation_json
Detect:   sessions WHERE ai_assessment_json IS NULL AND transcript IS NOT NULL
Severity: MEDIUM — lost data, therapist sees no scores
```

### F6: Pronunciation-AI Score Disagreement
```
Trigger:  Audio quality issue or eval prompt mismatch
Failure:  pronunciation_score = 90 but AI overall_score = 30 (or vice versa)
Detect:   |pronunciation_score - overall_score| > 40
Severity: LOW-MEDIUM — confusing but not harmful
```

### F7: Celebration Points Contain Negative Language
```
Trigger:  Poorly calibrated eval
Failure:  celebration_points array contains "You struggled with..." 
Detect:   regex match on celebration_points for negative words (struggled, failed, wrong, bad, couldn't)
Severity: HIGH — child-facing content must be positive
```

---

# PART 3: RUNNING EVALS

### 1. Unit Tests (existing)
```bash
cd backend && python -m pytest tests/ -v
```

### 2. Eval Test Cases From YAML
Each `*-evaluation.prompt.yml` has a `testData` section with input/expected pairs. To run these systematically:

```bash
cd backend && python -m pytest tests/ -v -k "eval"
```

### 3. Manual Smoke Test
```bash
# Send a test transcript to the analyze endpoint
curl -X POST https://<your-host>/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "scenario_id": "k-sound-isolation",
    "transcript": "Buddy: Camera goes kkk.\nChild: kkk.\nBuddy: Nice back sound.",
    "session_id": "test-001"
  }'
```

### 4. Failure Mode Detection Queries

Run these against your session DB to find problems:

```sql
-- F2: Score inflation
SELECT id, overall_score, pronunciation_score 
FROM sessions 
WHERE overall_score > 80 AND pronunciation_score < 50;

-- F5: Missing assessments
SELECT id, created_at 
FROM sessions 
WHERE transcript IS NOT NULL AND ai_assessment_json IS NULL;

-- F6: Score disagreement  
SELECT id, overall_score, pronunciation_score,
       ABS(overall_score - pronunciation_score) as gap
FROM sessions 
WHERE ABS(overall_score - pronunciation_score) > 40
ORDER BY gap DESC;
```

### 5. App Insights Queries (KQL)

```kql
// Session completion funnel
customEvents
| where name in ("exercise_started", "exercise_completed")
| summarize count() by name, bin(timestamp, 1d)

// Score distribution by exercise type
customEvents
| where name == "exercise_completed"
| extend score = toint(customDimensions.overall_score)
| summarize avg(score), percentile(score, 50), percentile(score, 25) by tostring(customDimensions.exercise_type)
```
