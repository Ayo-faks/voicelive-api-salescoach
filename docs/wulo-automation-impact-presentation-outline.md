# Wulo Automation Impact Presentation

Generated source outline for presenter rehearsal and quick edits.

## 1. Wulo
Section: Opening
Subtitle: The speech therapy operating system

Presenter notes:
- Frame Wulo as a workflow automation project, not just an AI demo.
- The goal was to recover clinical time while improving practice quality at home.

## 2. Wulo in one slide
Section: Executive Summary

- Problem: Therapists lost up to 30 minutes reconstructing what happened between sessions.
- Approach: Design a speech therapy OS that captures practice, analyses it, and presents it back to the therapist.
- Implementation: Real-time voice practice, phoneme-aware assessment, session summaries, review dashboards.
- Results: Review time reduced from 30 minutes to 5 minutes; clinical phoneme performance improved by 22%.

Presenter notes:
- This slide previews the judging criteria: clarity, problem solving, technical depth, and measured outcomes.

## 3. A one-hour session was being consumed by missing context
Section: 1. The Problem
Headline: Therapists were forced to reconstruct the week before they could treat the child in front of them.

- Home practice was inconsistent, undocumented, and hard to verify.
- Parents wanted to help but often lacked time, structure, or clinical confidence.
- Children needed repeated practice, but not every home had someone available to coach it.
- The first 30 minutes of a 60-minute session could disappear into catch-up and guesswork.

Presenter notes:
- The waste was not a single UI problem. It was a broken information loop between therapist, parent, and child.

## 4. Where the inefficiency came from
Section: Problem Quantified

- Therapist sets targets: Good clinical plan
- Home practice happens: Low structure
- Evidence is missing: No reliable trace
- Next session starts: 30 min reconstruction

Presenter notes:
- The opportunity was to convert unstructured home activity into useful clinical evidence.

## 5. I designed Wulo as an operating system for therapist-led care
Section: 2. The Approach
Headline: The question was not what can AI do? It was what should the OS run on behalf of the therapist, and what must the therapist still own?

- Observed the workflow around session prep, home practice, review, and next-step planning.
- Separated clinical judgement from repeatable evidence-capture tasks.
- Prioritized automations with measurable time savings and low safety risk.
- Designed human-in-the-loop checkpoints so generated outputs supported, rather than replaced, therapists.

Presenter notes:
- This shows decision making: automate the repetitive work, preserve clinical control.

## 6. What the OS runs for the therapist
Section: Automation Choices

- Guided home practice: Give the child structured repetitions without needing a parent to lead every turn.
- Transcript capture: Preserve what happened instead of relying on memory or parent recall.
- Pronunciation scoring: Turn audio into word and phoneme-level signals therapists can inspect.
- Session summarisation: Compress raw interaction data into review-ready clinical context.
- Next-session planning: Use saved evidence to draft a plan for therapist approval.

Presenter notes:
- Each automation maps to a bottleneck in the original workflow.

## 7. OS architecture: realtime practice plus review intelligence
Section: 3. Implementation

- React and TypeScript frontend for child practice and therapist dashboard workflows.
- Python Flask backend with WebSocket proxy for real-time audio and avatar sessions.
- Azure Voice Live for guided conversation and avatar delivery.
- Azure Speech for pronunciation assessment; Azure OpenAI for structured analysis and planning.
- Persistence layer for session history, child memory, recommendations, and audit-friendly review.

Presenter notes:
- Explain the system as two loops: real-time practice and asynchronous therapist review.

## 8. Realtime practice loop
Section: Implementation Detail
Headline: The child gets a supportive practice partner; the therapist gets structured evidence back.

- Audio capture streams from browser to backend over WebSocket.
- Voice session returns assistant audio, avatar output, and transcriptions.
- Session completion triggers analysis of transcript, target words, and pronunciation data.
- Results are saved for therapist review before the next appointment.

Presenter notes:
- This converts home practice from an invisible event into a replayable, analysable artifact.

## 9. Making speech AI work for clinical phonemes
Section: Implementation Detail
Headline: Off-the-shelf speech models were not enough for therapy-specific pronunciation targets.

- Built a target-sound layer around words, phonemes, repetitions, and child-appropriate prompts.
- Used Azure Speech pronunciation assessment for word-level accuracy, fluency, and completeness signals.
- Added phoneme-aware content and lexicon support so clinical targets were pronounced and evaluated more reliably.
- Compared baseline model behaviour against therapy-specific prompts and target lists on clinical phoneme examples.
- +22%: Improvement over the off-the-shelf speech model on clinical phoneme pronunciation tasks

Presenter notes:
- The 22 percent result is the technical credibility anchor. Emphasize iteration: baseline, error analysis, targeted adaptation, retest.

## 10. Therapist review dashboard
Section: Implementation Detail
Headline: Raw practice becomes decision-ready evidence.

- Per-session transcripts and assessment results are stored for review.
- Pronunciation scores surface word-level strengths and failure cases.
- AI-generated notes summarise effort, clarity, retries, and suggested practice focus.
- Therapist feedback stays authoritative and can be added after review.

Presenter notes:
- This is where the time saving shows up: therapists review a structured record instead of reconstructing from scratch.

## 11. Measured impact
Section: 4. Results

- 30 min Before: Manual reconstruction at start of a 60-minute therapy session
- 5 min After: Review using Wulo session evidence and summaries
- 83% Faster review: 25 minutes returned to therapy time
- +22% Speech quality: Improvement on clinical phoneme pronunciation tasks

Presenter notes:
- State the before and after clearly. 30 to 5 minutes is an 83 percent reduction and returns 25 minutes to direct therapy.

## 12. The OS changed the economics of care delivery
Section: Why It Matters
Headline: The value was not just speed. It was better allocation of scarce clinical attention.

- Performance: therapists start with evidence, not uncertainty.
- Efficiency: 25 minutes per session moves from reconstruction to intervention.
- Quality: phoneme-specific feedback improves the signal therapists use to adjust plans.
- Scalability: parents no longer need to personally lead every practice repetition.
- Safety: AI supports preparation and review while therapists retain clinical judgement.

Presenter notes:
- Tie the outcome to performance, efficiency, cost, and quality as requested.

## 13. The engineering lesson
Section: Closing
Headline: A good speech therapy OS respects the expert workflow it runs on.

- I did not build an AI therapist. I built the OS that surrounds the therapist.
- It captures practice, analyses speech, summarises evidence, and proposes next steps.
- The therapist remains the decision maker, but now enters the session with better data and more time.
Closing: Wulo is the speech therapy OS that turns between-session practice into measurable clinical progress.

Presenter notes:
- End with the senior-engineer framing: the best technical decision was preserving the human control boundary.
