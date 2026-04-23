# Therapist Demo Script

## Demo Thesis

Wulo is not just a child-facing avatar experience. The real story is that one therapist-supervised practice session becomes a governed evidence loop: guided exercise, saved review, approved child memory, explainable recommendations, an assistant that can reason over the case, a next-session plan, and parent-ready home support.

If you keep the demo disciplined, that story lands much harder than a feature-by-feature walkthrough.

## The Strongest Story To Tell

Use one child, one sound family, and one progression.

Recommended live storyline:

- Child: Ayo
- Focus sound: /r/
- Clinical position: moving from supported production into phrase and conversational carryover
- Stable avatar path: Meg
- Visual wow path: Riya (Photo), but only if you have already validated it in the target environment
- Main live exercise: /r/ - Conversation Level
- Progression you can point to in the library:
  1. /r/ vs /w/ - Auditory Discrimination (Minimal Pairs)
  2. /r/ - Sound in Isolation
  3. /r/ - Syllable Level (CV Blending)
  4. /r/ - Word Level (Initial Position)
  5. /r/ - Phrase Level
  6. /r/ - Sentence Level (Guided Narrative)
  7. /r/ - Conversation Level

Why this path works:

- It shows the therapist is in control of progression, not trapped in one gimmick exercise.
- It gives you a child-friendly avatar moment with enough emotional warmth to hook the audience.
- It creates a believable planning and carryover story after the session.

## What Is Real In The Product Today

These are safe anchors for the demo because they are already implemented:

- Therapist Home with quick signals: Active memory, Needs review, Last memory refresh, Suggested next
- Exercise browsing by step, activity, and target sound
- Avatar selection with Meg, Riya (Photo), and Simone (Photo)
- Live session surfaces with activity-specific panels plus avatar/video session layout
- Dashboard tabs: Session detail, Memory, Recommendations, Reports, Plan
- Insights rail with typed chat and optional voice mode when enabled
- Governed child memory with approve or reject review flow
- Explainable recommendation ranking with supporting sessions and memory
- Planner with refine-and-approve workflow
- Parent and school report generation with explicit home-support and classroom-support sections

## Tours: What To Use And What To Avoid

Live tours that are safe to use:

- Replay the welcome tour
- Tour the dashboard
- Tour the Insights rail

Tours that exist in code but are parked and should not be part of the live demo:

- first-session
- session-review-tour
- child-memory-review-tour
- family-intake-tour
- custom-scenario-tour
- practice-plans-tour
- progress-reports-tour
- planner-readiness-tour
- reports-audience-tour

Recommendation:

- Use Tour the dashboard only if the audience needs a quick orientation to the workspace.
- Use Tour the Insights rail only if you want a polished bridge into the assistant segment.
- Skip the welcome tour unless the audience cares about onboarding maturity.
- Do not build the core demo around tours. They should be garnish, not the meal.

## Demo Length Options

### 6-Minute Executive Version

- Open on Therapist Home
- Show exercise progression and avatar choice
- Launch one short live /r/ moment
- Jump to Dashboard review
- Approve memory
- Open recommendation rationale
- Generate or refine plan
- End on parent-ready home support

### 10-Minute Full Therapist Version

- Use the full script below
- Add a short Insights moment
- Add a Reports moment to show home-support output and export readiness

## Pre-Demo Setup

Before you present, make sure these are true:

1. A therapist account is signed in and lands in the therapist shell.
2. Ayo is selected as the active child, or you have a named demo child ready.
3. The app is already warm on Home and Dashboard so you do not spend time waiting for first-load calls.
4. If you plan to use a photo avatar, validate it before the meeting. Otherwise use Meg.
5. If you plan to use Insights voice, confirm it is enabled. If not, use typed prompts.
6. Have at least one saved session available so Memory, Recommendations, Plan, and Reports feel populated.
7. Keep one refinement prompt and one Insights prompt copied somewhere you can paste quickly.

## Presenter Positioning

Open with this, or something close to it:

"Most speech demos stop at the practice moment. Wulo is more interesting because it closes the therapist loop. A child gets a warm guided experience, and the therapist gets evidence, governed memory, explainable recommendations, a next-session plan, and parent-ready support without leaving the same workspace."

That line frames the audience correctly before they get distracted by the avatar.

## Main Script

### Scene 1: Start On Therapist Home

What to show:

- Active child selector
- Avatar selector
- Quick signal cards
- Exercise library filters and step browser

What to say:

"This is the therapist launch surface. It is doing more than session setup. At a glance I can see whether memory is current, whether new evidence needs review, and whether there is already a strong next-step suggestion waiting for me."

Then say:

"The exercise library is also intentionally structured. I can browse by developmental step, by activity type, and by target sound, so the therapist controls the progression instead of the system improvising one."

Action:

1. Confirm Ayo is selected.
2. Choose Meg for the stable path, or briefly show Riya (Photo) for visual punch.
3. Click through the step browser from Step 1 to Step 8 to show progression.
4. Filter to the /r/ family if useful.
5. Land on /r/ - Conversation Level.

Why it lands:

- It proves clinical structure.
- It proves the avatar is not the product by itself.
- It sets up the later recommendation and planning story.

### Scene 2: Give The Audience A Quick Emotional Hook

What to show:

- The selected /r/ - Conversation Level exercise
- The avatar/buddy framing

What to say:

"Now let us switch from therapist prep to the child experience. The key here is that the child sees encouragement and focus, while the therapist knows exactly which target, activity type, and support level they selected."

Action:

1. Start the session.
2. Let the avatar open the interaction.
3. If the topic cards appear, pick the most vivid one. For /r/, Rabbits and rockets is the strongest demo topic.
4. Do one very short interaction only.

Suggested line if you speak as the child:

"I want the rocket one."

If you want one more turn:

"The red rocket goes really fast."

Why it lands:

- It gives the room the emotional payoff of the product.
- It keeps the session short enough that the therapist workflow still dominates the demo.

### Scene 3: Pivot Fast From Child Magic To Therapist Control

What to say while leaving the live moment:

"The live avatar is only step one. What matters for the therapist is what gets saved, reviewed, and acted on after the child finishes."

Action:

Move to Dashboard.

Optional tour beat:

- If the audience needs orientation, use Help > Tour the dashboard here.
- Keep it under 20 seconds.

### Scene 4: Review The Saved Session

What to show:

- Session detail
- Summary cards
- Session analysis charts
- Transcript area
- Therapist feedback markers if present

What to say:

"This is where Wulo becomes a therapist product. I am not just getting a generic score. I can review the saved session, inspect the transcript, look at articulation and engagement patterns, and decide whether this was a strong session or one that needs follow-up."

Then say:

"The important design choice is that the review stays legible. It is evidence I can discuss, not an opaque model verdict."

Why it lands:

- It reframes the app as a clinical workflow tool.
- It prepares the room for governed memory and explainable recommendations.

### Scene 5: Approve Memory, Do Not Just Generate It

What to show:

- Memory tab
- Pending proposals
- Evidence links
- Approved memory groups

What to say:

"Wulo does not silently turn AI guesses into durable child facts. It proposes memory, and the therapist governs what becomes part of the child's working picture."

If you have a good proposal, say:

"This is a nice example: the system has noticed that encouragement and retry prompts appear to help Ayo stay engaged. That is useful, but it should only become durable memory if I agree."

Action:

Approve one proposal if available.

Then say:

"Now that this is approved, it can responsibly influence planning and recommendations later."

Why it lands:

- It shows safety and governance.
- It differentiates Wulo from AI tools that auto-write the case history.

### Scene 6: Show Explainable Recommendations

What to show:

- Recommendations tab
- Recommendation history
- Top recommendation
- Ranking factors
- Supporting memory
- Supporting sessions
- Institutional memory section if present

Use this therapist note when generating a run:

"Keep this playful and move into phrase work."

What to say:

"This is not a black-box recommendation engine. Wulo stores the ranking run, shows the reasoning, links the supporting sessions, and tells me what evidence could change the answer."

Then say:

"That means I can challenge the recommendation like a clinician. I can see whether it is leaning on the right memory, whether it is over-weighting old evidence, and whether the therapist note actually changed the ranking in a sensible way."

If the top recommendation moves toward phrase work, say:

"That is exactly the progression I want to see. We are moving from successful /r/ work into a richer phrase or narrative task, but we can still inspect why that leap is justified."

Why it lands:

- It proves explainability.
- It proves recommendations are grounded in the child's reviewed history.
- It sets up the planning beat naturally.

### Scene 7: Turn Review Into A Plan

What to show:

- Plan tab
- Objective
- Activities
- Therapist cues
- Success markers
- Carryover
- Memory that informed this plan

Use this refinement note:

"Start with listening and shorten the sequence."

What to say:

"Now we move from analysis to action. The therapist can generate a draft plan, then shape it with plain-language instructions. The plan is not just a paragraph. It is a structured next session with activities, cues, success markers, and carryover."

Then say:

"And crucially, the plan carries its own memory provenance. I can see which approved memory statements informed this draft, instead of wondering what the model was secretly relying on."

Why it lands:

- It is the cleanest expression of therapist co-pilot value.
- It shows that AI output stays editable, inspectable, and therapist-approved.

### Scene 8: Bring In The Insights Assistant

What to show:

- Insights rail
- One typed prompt
- Citations/sources if returned

Optional tour beat:

- Use Help > Tour the Insights rail immediately before this section if the audience values product polish.

Most reliable typed prompt:

"Summarise what matters clinically for Ayo before the next /r/ session."

Good follow-up prompt:

"Why did Wulo recommend moving into phrase work instead of staying in listening?"

Home-support prompt:

"Give me two parent-friendly carryover ideas for this week."

What to say:

"This is the therapist assistant layer. It is not a separate chatbot bolted on top. It is child-scoped, grounded in saved sessions, memory, plans, and reports, and it cites what it used."

If sources appear, say:

"That is what I want from an assistant in a clinical workflow: not just an answer, but an answer I can trace back to the underlying evidence."

Why it lands:

- It connects the earlier workflow pieces into a single intelligence surface.
- It makes the product feel modern without giving up control.

### Scene 9: End On Home Practice Support, Not Just Clinical Review

What to show:

- Reports tab with audience set to Parent
- The parent-oriented section How to support at home
- Or, if time is short, the Carryover section in the Plan tab

What to say:

"This is where the loop closes. The therapist workflow does not stop at internal review. Wulo can turn that reviewed evidence into parent-friendly home support."

Then say:

"The parent version is not a dump of clinical detail. It reshapes the same evidence into strengths, current focus, and simple support at home."

If showing Carryover first:

"The carryover section is the therapist bridge into home practice. The parent report turns that into language a family can act on immediately."

Why it lands:

- It broadens the value story beyond therapy sessions.
- It makes the product feel adoption-ready, not just technically impressive.

## Strong Closing Line

Use this to end:

"What you just saw was not a talking avatar demo. It was a therapist workflow where one guided practice becomes reviewed evidence, governed memory, explainable next steps, a co-authored plan, and practical support that can leave the clinic with the family."

## Best Live Prompts And Notes

Recommendation note:

- Keep this playful and move into phrase work.

Plan refinement note:

- Start with listening and shorten the sequence.

Insights prompts:

- Summarise what matters clinically for Ayo before the next /r/ session.
- Why did Wulo recommend moving into phrase work instead of staying in listening?
- Give me two parent-friendly carryover ideas for this week.

Report framing line:

- Here is the same reviewed evidence translated into what a parent can do at home this week.

## Fallback Moves If Something Wobbles

If the avatar session is unstable:

- Do not fight it live.
- Say, "The child moment is important, but the therapist workflow is where Wulo really differentiates," and jump straight to a saved session in Dashboard.

If photo avatars are unreliable:

- Use Meg.

If Insights voice is off or noisy:

- Type the question instead of using the mic.

If you do not have fresh memory proposals:

- Show approved memory and explain the review model verbally.

If you do not have time for Reports:

- End on Plan > Carryover and mention that Reports turns it into a parent-ready home-support section.

If the audience is non-clinical:

- Spend less time on charts.
- Spend more time on the before-and-after story: child practice, therapist control, parent carryover.

## What Not To Do

- Do not spend two minutes inside the live avatar exchange.
- Do not try to demo every tab equally.
- Do not rely on parked tours.
- Do not make the assistant the star before the audience understands the evidence model underneath it.
- Do not end on a chart. End on plan or home support.

## Recommended Order If You Want Maximum Impact

1. Home
2. Live child moment
3. Session detail
4. Memory approval
5. Recommendation rationale
6. Plan generation/refinement
7. Insights assistant
8. Parent home support

That order tells the best story: warmth first, trust second, action last.