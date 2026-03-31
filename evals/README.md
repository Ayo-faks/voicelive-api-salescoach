# Speech Therapy Platform — Evaluation Framework

## System Behaviour Contract

When an **input** (child utterance + exercise context) arrives, the system must produce an **output** that satisfies three contracts:

| Contract | Input | Expected Output |
|---|---|---|
| **Buddy Response** | Child audio/text + exercise prompt | 1 short sentence: acknowledge attempt → model target → invite retry |
| **AI Evaluation** | Full session transcript + evaluation prompt | Structured JSON: scores (0-100), celebration points, practice suggestions, therapist notes |
| **Pronunciation Assessment** | Raw audio + reference text | Per-word accuracy, phoneme-level errors, fluency/completeness scores |

---

## Golden Use Cases

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

## Scoring System Reference

### Per-Session Scores (already implemented)

| Metric | Source | Range | What It Measures |
|---|---|---|---|
| `target_sound_accuracy` | AI Eval | 0-10 | Correct production of the target phoneme |
| `overall_clarity` | AI Eval | 0-10 | General intelligibility |
| `consistency` | AI Eval | 0-10 | Stability across repeated attempts |
| `task_completion` | AI Eval | 0-10 | Stayed on the exercise task |
| `willingness_to_retry` | AI Eval | 0-10 | Tried again after prompting |
| `self_correction_attempts` | AI Eval | 0-10 | Independent adjustment |
| `overall_score` | AI Eval | 0-100 | Holistic session quality |
| `accuracy_score` | Azure Speech | 0-100 | Word-level pronunciation accuracy |
| `fluency_score` | Azure Speech | 0-100 | Speech rhythm and flow |
| `completeness_score` | Azure Speech | 0-100 | % of reference words attempted |
| `pronunciation_score` | Azure Speech | 0-100 | Composite pronunciation rating |

### Recommended Aggregate Metrics (not yet implemented)

| Metric | Computation | Why It Matters |
|---|---|---|
| **Sound Mastery Rate** | % sessions where accuracy_score ≥ masteryThreshold, per target sound | Core clinical outcome |
| **Improvement Velocity** | Slope of accuracy_score over last N sessions per sound | Is practice working? |
| **Session Completion Rate** | completed_sessions / started_sessions | Engagement health |
| **Avg Session Duration** | mean(session_duration_seconds) | Attention span / engagement |
| **Therapist Agreement** | % of sessions where feedback_rating = "up" | AI eval quality signal |
| **Score Consistency** | correlation(pronunciation_score, overall_score) | Internal validity |
| **Exercise Difficulty Calibration** | mean(score) grouped by difficulty level | Are "easy" exercises actually easy? |
| **Drop-off Point** | Turn number where children most often stop | UX insight |
| **Phoneme Error Heatmap** | Frequency of each error type across all sessions | Population-level clinical insight |

---

## Running Evals

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
