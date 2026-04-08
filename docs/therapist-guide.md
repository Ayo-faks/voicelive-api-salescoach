# Wulo Therapist User Guide
**Version:** 1.0
**Last Updated:** April 6, 2026
**Platform:** Web application (desktop and tablet supported)

_Image removed: Wulo therapist workspace overview._

## Table of Contents

1. [Welcome to Wulo](#1-welcome-to-wulo)
2. [Getting Started](#2-getting-started)
   1. [Signing in](#21-signing-in)
   2. [Choosing a mode](#22-choosing-a-mode)
   3. [Consent and safe use framing](#23-consent-and-safe-use-framing)
3. [Understanding the Therapist Workspace](#3-understanding-the-therapist-workspace)
   1. [Home](#31-home)
   2. [Dashboard](#32-dashboard)
   3. [Workspace](#33-workspace)
4. [Managing the Active Child](#4-managing-the-active-child)
5. [Exercise Library and Session Preparation](#5-exercise-library-and-session-preparation)
6. [Running a Practice Session](#6-running-a-practice-session)
7. [Reviewing a Saved Session](#7-reviewing-a-saved-session)
8. [Child Memory: What It Is and How It Works](#8-child-memory-what-it-is-and-how-it-works)
   1. [Memory overview cards](#81-memory-overview-cards)
   2. [Approved memory sections](#82-approved-memory-sections)
   3. [Therapist memory note](#83-therapist-memory-note)
   4. [Pending proposals](#84-pending-proposals)
   5. [Memory refresh and evidence freshness](#85-memory-refresh-and-evidence-freshness)
9. [Recommendations: Inspectable Next-Exercise Suggestions](#9-recommendations-inspectable-next-exercise-suggestions)
   1. [Recommendation overview cards](#91-recommendation-overview-cards)
   2. [Generating a recommendation run](#92-generating-a-recommendation-run)
   3. [Recommendation history](#93-recommendation-history)
   4. [Inspecting the selected recommendation](#94-inspecting-the-selected-recommendation)
   5. [Why the system recommended an exercise](#95-why-the-system-recommended-an-exercise)
   6. [Institutional memory](#96-institutional-memory)
   7. [Evidence status on the therapist home surface](#97-evidence-status-on-the-therapist-home-surface)
10. [Planning the Next Session](#10-planning-the-next-session)
    1. [Plan overview cards](#101-plan-overview-cards)
    2. [Generating a plan](#102-generating-a-plan)
    3. [Refining a plan](#103-refining-a-plan)
    4. [Approving a plan](#104-approving-a-plan)
    5. [Memory that informed this plan](#105-memory-that-informed-this-plan)
11. [Charts and Dashboard Interpretation](#11-charts-and-dashboard-interpretation)
12. [Session History and Review Workflow](#12-session-history-and-review-workflow)
13. [Custom Exercises and Local Management](#13-custom-exercises-and-local-management)
14. [Workspace Settings and Everyday Checks](#14-workspace-settings-and-everyday-checks)
15. [Best-Practice Tips for Therapists](#15-best-practice-tips-for-therapists)
16. [Glossary](#16-glossary)
17. [Troubleshooting](#17-troubleshooting)

## 1. Welcome to Wulo

Wulo is a therapist-supervised AI speech practice platform for structured articulation and phonological awareness work. It helps children practise with a voice buddy while keeping the therapist in control of review, interpretation, and next-step planning.

It is designed for therapists and clinical educators supporting children in clinics, schools, or supervised home practice.

At a high level, the workflow is:

1. Choose the active child.
2. Choose an exercise and avatar.
3. Run a guided session.
4. Review the saved session.
5. Review child memory and recommendations.
6. Generate or refine a next-session plan.

The key principle is simple: Wulo is a practice and review tool, not a diagnostic tool. It can surface patterns, suggestions, and evidence, but it does not replace therapist judgement.

### What Wulo helps you do

- Deliver structured practice with an AI buddy.
- Review pronunciation and engagement results.
- Preserve therapist-approved child memory over time.
- Inspect recommendation evidence instead of treating AI suggestions as black-box output.
- Create therapist-guided next-session plans.

> Note:
> Wulo supports supervised practice. It should be used alongside professional judgement, not instead of it.

_Image removed: Therapist home and review workflow._

## 2. Getting Started

### 2.1 Signing in

Therapists can sign in with Microsoft or Google. On the sign-in screen, choose the provider you normally use for work. After sign-in, Wulo keeps your session active until it expires, so you do not need to sign in again each time you return during normal use.

If the session expires, Wulo returns you to the login screen and asks you to sign in again.

To sign in:

1. Open Wulo in your browser.
2. Select `Continue with Microsoft` or `Continue with Google`.
3. Complete the sign-in process.
4. Wait for Wulo to load your workspace.

> Tip:
> If your organisation uses more than one account, try to use the same sign-in provider each time so your normal therapist workspace opens consistently.

_Image removed: Sign-in screen._

### 2.2 Choosing a mode

After sign-in, Wulo asks which workspace mode you want to use.

| Mode | Intended user | What is visible |
| --- | --- | --- |
| Therapist mode | Therapist or supervisor | Therapist home, dashboard review workspace, planning, memory review, recommendations, workspace settings |
| Child mode | Child during a session | Simplified practice home and live session surfaces |

Therapists usually prepare the session in Therapist mode, then either switch to Child mode or hand the device over once the practice is ready to begin.

A short onboarding screen appears before first use in that browser. It reminds the therapist to confirm adult access, choose the child and exercise, and stay nearby during practice.

To choose a mode:

1. Sign in.
2. Select `Therapist mode` when you want review and planning tools.
3. Select `Child mode` when the child is ready to practise.
4. Use the Workspace page later if you need to switch modes.

### 2.3 Consent and safe use framing

Before the first child session, Wulo asks the therapist to acknowledge supervised-practice consent.

This consent makes three things clear:

- Wulo is intended for supervised practice.
- It does not replace therapist judgement or diagnosis.
- Therapists remain responsible for interpreting results and deciding next steps.

To acknowledge consent:

1. Read the supervised-practice message.
2. Tick the acknowledgement box.
3. Select `Acknowledge and continue`.

> Note:
> Wulo does not currently use a therapist PIN flow. The implemented first-use steps are the onboarding screen plus supervised-practice consent acknowledgement.

## 3. Understanding the Therapist Workspace

The therapist-facing experience has three different surfaces. They work together, but each has a different job.

### 3.1 Home

The therapist home screen is the launch and preparation surface. It is where you choose who is practising, which buddy the child will see, which exercise is active, and whether you want to start practice or move into review.

On the home screen you can see:

- The child selector.
- The avatar selector.
- The selected exercise context.
- The `Start session` action.
- The `Review progress` action.
- The exercise library below.

The compact insight cards on the home surface are quick signals only. Full review happens in the dashboard workspace.

#### Compact insight cards on Home

| Card | What it means | How to use it |
| --- | --- | --- |
| Active memory | How many approved child-memory items currently exist, with a short leading example | Use this as a quick reminder of the child’s current working picture, not as a full case summary |
| Needs review | How many pending memory proposals are waiting for therapist review | If this number is above zero, consider checking the dashboard before relying on older recommendations |
| Last memory refresh | Whether approved memory has been compiled recently | This tells you whether therapist-reviewed memory is current enough to support planning |
| Top recommendation | The current top-ranked saved recommendation, if one exists | Use it as a prompt to review, not as an automatic instruction |
| Last recommendation run | When recommendations were last generated and how many options were ranked | Helps you judge how recent the suggestion is |
| Evidence status | Whether the saved recommendation evidence is current, stale, or not yet run | Review this before treating any recommendation as reliable for today’s session |

> Tip:
> Think of the home cards as traffic lights. They tell you where to look next, but they are not the full clinical review.

_Image removed: Therapist home surface._

### 3.2 Dashboard

The dashboard is the deep review workspace for one active child. This is where therapists inspect saved sessions, child memory, recommendations, and plans in one place.

The dashboard has four main tabs:

- `Session detail`
- `Memory`
- `Recommendations`
- `Plan`

It also includes a child list, session history, summary cards at the top, and review charts that help you understand the child’s recent work over time.

Use the dashboard when you want to:

1. Open a saved session.
2. Review evidence in more detail.
3. Approve or reject memory proposals.
4. Inspect why an exercise was recommended.
5. Generate, refine, or approve a next-session plan.

### 3.3 Workspace

The Workspace page is the settings surface for everyday session setup. It is where you:

- Change therapist versus child mode.
- Confirm the active child.
- Change the active practice buddy or avatar.

It also shows a simple summary of the current role, current mode, current child, and current buddy so you can confirm that the environment is set correctly.

The active child should stay aligned across Therapist home, Dashboard, and Workspace. If you change it in one place, your review context should follow that child.

_Image removed: Workspace settings page._

## 4. Managing the Active Child

Wulo uses an active-child model. This means the app is always working in the context of one selected child at a time.

When you change the active child, all of the following change with it:

- Saved sessions.
- Review charts.
- Child memory.
- Recommendation history.
- Planning context.

You can switch the active child from therapist-facing surfaces such as the sidebar child list, the child dropdown, or the home screen child selector.

To change the active child safely:

1. Check the current child name before starting or reviewing anything.
2. Open the child selector or child list.
3. Select the correct child.
4. Wait for the dashboard or home surface to refresh.
5. Re-check the child name before continuing.

This matters because Wulo does not treat sessions, memory, recommendations, and plans as separate floating items. They all follow the active child context.

> Tip:
> Confirm the active child before launching a session, reviewing recommendations, or approving memory. This is one of the most important everyday checks in Wulo.

### If the wrong child context appears

1. Open the therapist shell and verify the active child name.
2. Re-select the correct child from the child list or selector.
3. Re-open the dashboard for that child.
4. Check that the session history and summary cards now match the correct case.

## 5. Exercise Library and Session Preparation

The exercise library sits on the therapist home screen below the main launch area. It is the main place to choose what the child will practise next.

Wulo includes both built-in exercises and custom exercises.

- Built-in exercises give you a structured library organised by step, activity type, and target sound.
- Custom exercises let you add your own therapist-authored practice items for a particular child or target.

Exercise cards and filters help you see useful context quickly, including:

- Target sound badges.
- Exercise type labels.
- Difficulty labels where available.
- Step-based browsing for progression.

To prepare a session:

1. Choose the active child.
2. Choose the avatar or practice buddy.
3. Browse or filter the exercise library.
4. Select the exercise you want.
5. Start the session.

On the therapist home surface, you can start in two ways:

1. Select an exercise and use the main `Start session` button.
2. Select an exercise card directly from the library to move straight into session launch.

This makes it easy to use the home page either as a slower preparation space or a quick-start surface.

### A practical progression through exercise types

Wulo supports a sensible progression from easier listening work towards more expressive speech work, but it does not force a single clinical sequence.

A common pattern is:

1. Listening minimal pairs.
2. Silent sorting.
3. Sound isolation.
4. Vowel blending.
5. Word repetition.
6. Minimal pairs or sentence work.
7. Guided prompt or carryover conversation.

> Note:
> Use progression as a clinical guide, not a rigid rule. A child may need to move back to an easier listening or cueing task before moving forward again.

_Image removed: Exercise library and filters._

## 6. Running a Practice Session

A Wulo session begins once the child, exercise, and buddy are selected.

### What the live session includes

During a session, Wulo can show:

- The buddy video or avatar panel.
- The microphone control for speaking activities.
- A live conversation panel.
- Exercise-specific activity panels for tasks such as listening minimal pairs, silent sorting, sound isolation, or vowel blending.
- Live speaking feedback for relevant activities.

The exact layout depends on the activity type. Receptive exercises show more task panels, while speaking tasks rely more on voice interaction and live feedback.

### How to run a session

1. Confirm the active child.
2. Choose the exercise.
3. Choose the avatar.
4. Start the session.
5. Let the AI buddy guide the child through the practice.
6. Support the child as needed while staying nearby.
7. End the session and review the saved results.

### Live interaction and transcript behaviour

The AI buddy speaks first to open the session. For child sessions, the screen stays simple and the conversation appears in the transcript panel as it unfolds.

For speaking activities, the microphone stays available once the session is ready. For listening or sorting tasks, the interactive task panel may be more central than the microphone.

### How sessions finish and save

Once the live interaction finishes, Wulo saves the session so it can feed review, memory, recommendations, and planning.

> Tip:
> A live session is only the first step. The real clinical value comes from reviewing the saved evidence afterwards.

_Image removed: Live practice session._

## 7. Reviewing a Saved Session

Saved sessions are reviewed from the dashboard. Open the active child, then choose a session from the history list. The `Session detail` tab is the place for full review.

### How to open a saved session

1. Open the dashboard.
2. Confirm the active child.
3. Use the session history list on the left.
4. Select the session you want to inspect.
5. Stay on `Session detail` for the full review.

### What you see in Session detail

The Session detail tab includes several layers of review.

#### Summary strip at the top of the dashboard

At the top of the dashboard you will usually see a selected-child summary and, when enough data exists, trend or sound summaries. This gives context before you open an individual session.

#### Session overview cards

When a session is selected, the top cards in `Session detail` show:

- Session date.
- Overall score.
- Transcript turns.

This is a quick orientation layer before you read deeper.

#### Session analysis

The session analysis area brings together the overall profile of the session. It uses a radar-style view and score bars for articulation and engagement areas such as target sound accuracy, clarity, consistency, task completion, willingness to retry, and self-correction attempts.

Clinically, this can help you tell the difference between:

- A child who was engaged but not yet accurate.
- A child who was accurate in parts but inconsistent.
- A child who may have needed more support, more time, or a lower task load.

#### Pronunciation review

The pronunciation review area shows saved speech scores and, when available, a word-level heatmap so you can see which words or attempts were easier or harder.

#### Review summary

The review summary combines several therapist-friendly elements:

- Celebration.
- Highlights.
- Next steps.
- Therapist note.

This area is useful for preparing your clinical summary or next-session focus.

#### Transcript access

The transcript area shows the saved conversation. This can help when you want to check how the child responded, what the buddy asked, or whether a moment in the session should be interpreted with more caution.

#### Therapist feedback markers

If feedback has been saved, the session can be marked as:

- `Helpful session`
- `Needs follow-up`

This is useful when you want to flag sessions that should shape planning or closer review later.

> Tip:
> Use the full Session detail view when you need to explain why a session felt successful or why it needs follow-up. It gives you more than a headline score.

_Image removed: Saved session review._

## 8. Child Memory: What It Is and How It Works

Child memory is a governed, therapist-facing knowledge layer built from reviewed session evidence. It is separate from raw session history.

Raw session history shows what happened. Child memory preserves what has been reviewed and judged useful enough to carry forward.

This matters because:

- Clinically useful facts can be preserved over time.
- Approved memory improves planning and recommendation quality.
- Higher-risk inferences stay reviewable rather than silently turning into durable facts.

Wulo separates child memory into two states:

| Memory state | Meaning |
| --- | --- |
| Approved child memory | Reviewed information that a therapist has accepted as part of the child’s working picture |
| Pending memory proposals | Proposed updates that are still waiting for therapist review |

### 8.1 Memory overview cards

At the top of the `Memory` tab, Wulo shows three overview cards.

| Card | Meaning | Why it matters |
| --- | --- | --- |
| Approved memory | Number of approved memory items, with last update time | Shows how much reviewed context exists for this child |
| Pending review | Number of proposals awaiting decision | Signals whether therapist review is needed before relying on older summaries |
| Planner signal | Whether memory is ready enough to support planning | A quick indicator of whether planning has meaningful approved context behind it |

### 8.2 Approved memory sections

Approved memory is grouped into categories such as:

- Targets.
- Effective cues.
- Ineffective cues.
- Preferences.
- Constraints.
- Blockers.
- General notes.

Each memory item is shown as a short statement. Where evidence links are available, you can open the source session directly from the memory item.

In practice:

- `Targets` helps you see what is currently being worked on.
- `Effective cues` helps you reuse approaches that have already helped.
- `Ineffective cues` helps you avoid repeating strategies that have not worked well.
- `Preferences` and `constraints` help with practical session design.
- `Blockers` can highlight barriers such as fatigue, pace, or frustration.
- `General notes` can hold broader therapist-approved observations.

### 8.3 Therapist memory note

Wulo also lets therapists write a memory item directly when they want to preserve an important practical observation without waiting for another synthesis cycle.

To add a therapist memory note:

1. Open the `Memory` tab.
2. Go to `Therapist memory note`.
3. Choose a category.
4. Write a concise statement.
5. Select `Save approved memory`.

Common uses include:

- Preserving a cueing strategy that worked especially well.
- Recording a clear preference that affects cooperation.
- Saving a practical constraint that should shape future sessions.

> Tip:
> Keep therapist-authored memory notes short and concrete. Wulo works best when memory statements describe observable patterns rather than broad conclusions.

### 8.4 Pending proposals

Pending proposals are possible memory updates that still need therapist review.

Each proposal shows:

- The proposed statement.
- Its category.
- Its type.
- Confidence, where available.
- Evidence links back to source sessions.

To review a proposal:

1. Open the `Memory` tab.
2. Go to `Pending proposals`.
3. Read the statement.
4. Open the evidence links if needed.
5. Select `Approve` or `Reject`.

The actions mean:

- `Approve` moves the proposal into approved memory so it can support planning and recommendations.
- `Reject` keeps it out of approved memory.

Pending proposals are kept separate from approved memory on purpose. This is a governance and safety feature. It lets the system surface useful ideas without silently converting them into durable clinical facts.

### 8.5 Memory refresh and evidence freshness

On the home surface, `Last memory refresh` tells you whether approved memory has been compiled recently enough to act as a current summary.

If memory has not been refreshed, or if there are pending proposals waiting, review the Memory tab before trusting an older recommendation run.

That is especially important when:

- A new session has been reviewed.
- Pending proposals are waiting.
- Approved memory may have changed since the last recommendation run.

_Image removed: Child memory review tab._

## 9. Recommendations: Inspectable Next-Exercise Suggestions

Wulo can generate therapist-facing exercise recommendations, but these are inspectable, evidence-linked suggestions rather than automatic decisions.

The Recommendations tab is built to answer three questions: `What does Wulo suggest next?`, `Why?`, and `What would change that answer?`

### 9.1 Recommendation overview cards

At the top of the Recommendations tab, Wulo shows:

| Card | Meaning |
| --- | --- |
| Saved runs | How many recommendation runs have been logged for this child |
| Target sound | The target sound for the currently opened run |
| Ranked options | How many options were ranked in the selected run |

### 9.2 Generating a recommendation run

A recommendation run is created for the active child and saved so it can be reopened later.

To generate recommendations:

1. Open the `Recommendations` tab.
2. Optionally add a therapist note or constraint.
3. Select `Generate recommendations`.
4. Open the saved run that appears.

Useful therapist notes include:

- `Keep this playful.`
- `Avoid moving above medium difficulty.`
- `Favour short verbal models.`
- `Stay with word-level work for now.`

These notes do not remove therapist judgement. They help the ranking reflect your practical intent for that moment.

### 9.3 Recommendation history

Recommendation runs are saved and reopenable, so therapists can compare runs over time instead of relying only on the latest output.

This is useful when:

- The child’s approved memory has changed.
- A newer session has been reviewed.
- You want to compare how different therapist notes affected the ranking.

### 9.4 Inspecting the selected recommendation

When you open a saved run, the detail view shows:

- Current target.
- Top score.
- Therapist note.
- Top recommendation summary.
- Ranked options list.

The top recommendation is clearly marked, but the full ranked list stays visible so you can compare alternatives.

### 9.5 Why the system recommended an exercise

Each ranked candidate includes a detailed explanation layer.

For each candidate, Wulo can show:

- Why it was recommended.
- How it compares to approved memory.
- Ranking factors.
- Supporting approved memory items.
- Supporting sessions.
- What evidence might change the recommendation.

This matters clinically because it makes the recommendation discussable and challengeable.

A therapist can ask questions such as:

- Is this recommendation leaning too heavily on old evidence?
- Does the supporting memory still reflect the child accurately?
- Are the linked sessions still the ones I would prioritise?
- Would a different note or a newer review change the ranking?

That is the point of this design. Recommendation quality is meant to be inspected, not blindly obeyed.

### 9.6 Institutional memory

The Recommendations tab may also show a clinic-level institutional memory section.

In plain language, this is a set of de-identified patterns or strategy insights drawn from reviewed outcomes across the clinic. It may help tune recommendation ranking, but it does not become child-specific approved memory.

Treat it as a clinic-level support signal, not a diagnostic system and not a substitute for case-specific reasoning.

### 9.7 Evidence status on the therapist home surface

On the home surface, the `Evidence status` card can show:

| Status | Meaning |
| --- | --- |
| Current | The saved recommendation run still matches the latest approved memory and reviewed session picture |
| Stale | Something important has changed since the recommendation was generated |
| Not run | No recommendation run exists yet |

A recommendation may become stale if:

- Pending memory proposals exist.
- Approved memory changed after the recommendation was generated.
- A newer reviewed session exists than the saved recommendation run.

> Note:
> `Stale` does not mean the recommendation is wrong. It means the therapist should review it again before treating it as current.

_Image removed: Recommendations tab._

## 10. Planning the Next Session

The Plan tab supports next-session planning using the selected saved session, approved child memory, and therapist input.

### 10.1 Plan overview cards

At the top of the `Plan` tab, Wulo shows:

| Card | Meaning |
| --- | --- |
| Planner | Whether planning context is ready for this child |
| Plan status | Whether the current plan is a draft, approved, or absent |
| Memory inputs | How many memory items were used in the saved memory snapshot |

### 10.2 Generating a plan

To generate a plan:

1. Select a saved session from the dashboard.
2. Open the `Plan` tab.
3. Add a planning note if needed.
4. Select `Generate plan`.

A generated plan can include:

- Objective.
- Focus sound.
- Activities.
- Therapist cues.
- Success markers.
- Carryover ideas.
- Estimated duration.

This keeps the plan practical rather than just descriptive.

### 10.3 Refining a plan

If the first draft does not fit your judgement, you can refine it.

To refine a plan:

1. Open the current draft.
2. Enter a refinement instruction.
3. Select `Refine plan`.
4. Review the updated version.

Examples of useful refinement notes:

- `Start with listening and shorten the sequence.`
- `Keep this playful for home carryover.`
- `Reduce verbal load and use shorter modelling.`

### 10.4 Approving a plan

Approving a plan marks it as the therapist-accepted version for that child and saved session context. A draft is still a working suggestion; an approved plan is the version you have accepted for use.

To approve a plan:

1. Review the full draft.
2. Check the activities, cues, and success markers.
3. Confirm the plan fits the child’s current needs.
4. Select `Approve plan`.

### 10.5 Memory that informed this plan

One of the most important parts of the Plan tab is the provenance section: `Memory that informed this plan`.

This section shows:

- How many memory inputs were used.
- When the memory snapshot was compiled.
- Which approved memory statements informed the draft.
- Evidence links back to source sessions where available.

This improves transparency. Therapists can see not only what the plan says, but what reviewed memory the planner relied on when building it.

> Tip:
> Use the provenance section when you want to explain why a plan was chosen, especially during supervision, team handover, or parent discussion.

_Image removed: Plan tab and provenance._

## 11. Charts and Dashboard Interpretation

The dashboard includes visual summaries to help you understand recent work for the selected child. These are designed to support review, not replace detailed interpretation.

### Selected child summary card

What it shows:

- The currently selected child.
- How many saved or reviewed sessions are available.

What it does not show:

- It is not a full case summary.

Useful use:

- Use it as a quick confirmation that you are looking at the right child before reviewing anything else.

### Progress trendline

What it shows:

- A score trend over recent reviewed sessions when enough data exists.

What it does not show:

- It does not explain why a change happened.

Useful use:

- Use it to spot whether performance looks broadly stable, improving, or variable across recent sessions.

### Reviewed sessions summary

What it shows:

- How many saved sessions are currently available.

What it does not show:

- It does not tell you whether those sessions were clinically equivalent or equally useful.

Useful use:

- Use it to judge whether you have enough recent evidence to trust trend patterns.

### Sound breakdown or focus-sound chart

What it shows:

- A summary of sound-related performance across saved sessions when enough data exists.

What it does not show:

- It is not a complete phonological profile.

Useful use:

- Use it to see which focus sounds may need more attention or a different task type.

### Session frequency heatmap

What it shows:

- When sessions were saved across recent weeks.

What it does not show:

- It does not tell you whether practice quality was high.

Useful use:

- Use it to spot gaps in practice frequency or compare consistency across periods.

### Session history metrics

What it shows:

- Exercise name.
- Date.
- Overall score.
- Accuracy score.
- Pronunciation score where available.
- Therapist feedback markers where saved.

What it does not show:

- It is not a replacement for the full session review.

Useful use:

- Use the history list to identify which sessions should be opened first, especially flagged sessions or those with unusual changes.

> Note:
> Charts summarise patterns. They do not explain cause on their own. Always return to the saved session, memory evidence, and your own observations before making decisions.

## 12. Session History and Review Workflow

A practical dashboard workflow after a session often looks like this:

1. Open the saved session from the dashboard.
2. Check the Session detail review.
3. Review pending memory proposals.
4. Approve or reject what should become durable memory.
5. Generate or inspect recommendations.
6. Create or refine a next-session plan.

In day-to-day work, this often becomes a repeatable pattern:

- First, use the saved session to understand what happened.
- Next, decide what should become durable child memory.
- Then inspect whether the recommendation logic still fits the updated evidence.
- Finally, turn that review into a therapist-guided next-session plan.

This workflow links session evidence, reviewed memory, recommendations, and planning in one place.

## 13. Custom Exercises and Local Management

Custom exercises are available for therapist-authored practice tasks.

They are useful when you want to:

- Tailor the task to a specific child.
- Use your own word list.
- Adjust the prompt or tone.
- Work on a target not covered exactly the way you want in the built-in library.

To create a custom exercise:

1. Open the custom exercise editor.
2. Add a name.
3. Add a short therapist description.
4. Choose an exercise type.
5. Add the target sound.
6. Add target words.
7. Set the difficulty.
8. Add the child-facing prompt.
9. Add the coach instructions.
10. Save the exercise.

To edit or delete a custom exercise:

1. Open the exercise from the custom-exercise area.
2. Change the fields you want.
3. Save the update, or use delete if the exercise is no longer needed.

To export or import a custom exercise:

1. Open the custom exercise.
2. Use export to save it as a JSON file.
3. Use import to load a previously saved JSON file.

> Note:
> Custom exercises are stored in local browser storage. They do not automatically sync across devices. If browser data is cleared, local custom exercises can be lost unless they have been exported.

_Image removed: Custom exercise editor._

## 14. Workspace Settings and Everyday Checks

The Workspace page is intentionally simple. It is for quick environment checks rather than deep configuration.

Use it to:

- Switch between therapist and child mode.
- Confirm the active child.
- Confirm the active buddy or avatar.

A sensible everyday check before practice is:

1. Open Workspace.
2. Confirm the mode.
3. Confirm the active child.
4. Confirm the active buddy.
5. Return to Home and start the session.

This is especially useful when:

- More than one child is being seen in a row.
- A different therapist has just used the device.
- You are moving from review back into practice.

## 15. Best-Practice Tips for Therapists

- Confirm the active child before you launch or review anything.
- Use child memory to preserve stable clinical observations over time.
- Review pending proposals before trusting an older recommendation run.
- Treat recommendation output as evidence-linked support, not an instruction to obey.
- Use plan provenance when discussing why a session plan was chosen.
- Flag sessions that need follow-up so later review is easier.
- Use the home cards for quick orientation, then move into the dashboard for detailed review.
- Write therapist memory notes when a short practical observation should shape the next few sessions.

> Tip:
> Wulo works best when the therapist uses it as a cycle: practise, review, govern memory, inspect recommendations, then plan.

## 16. Glossary

| Term | Plain-language definition |
| --- | --- |
| Active child | The child currently selected in Wulo. Sessions, memory, recommendations, and plans all follow this context. |
| Approved child memory | Therapist-reviewed memory items that have been accepted as part of the child’s durable working picture. |
| Pending proposal | A proposed memory update that still needs therapist approval or rejection. |
| Evidence link | A link back to the saved session evidence that supports a memory item or recommendation. |
| Recommendation run | One saved set of next-exercise rankings generated for the active child. |
| Ranked candidate | One exercise option inside a recommendation run, shown with score and explanation. |
| Institutional memory | De-identified clinic-level pattern information that may help tune recommendations without becoming child-specific fact storage. |
| Memory snapshot | The saved set of approved memory inputs that were available when a plan was generated. |
| Planner status | A quick indicator showing whether enough context is available for planning. |
| Therapist note | A therapist-entered note used to guide a recommendation run, shape a plan, or save an approved memory item. |
| Source session | A saved session that provides evidence for memory, recommendation explanations, or plan provenance. |

## 17. Troubleshooting

| Issue | What to check |
| --- | --- |
| Session expired or login problems | Return to the login screen and sign in again with Microsoft or Google. If the session cannot be loaded, retry the session check or sign in again. |
| Planner unavailable | Check whether the planner is showing `Limited`. If so, review whether the child has enough approved memory and saved-session context for planning. |
| No saved sessions visible for the active child | Confirm that the correct child is selected. The session history list only shows sessions for the active child. |
| No approved memory yet | Open the Memory tab. If nothing has been approved yet, review pending proposals or add a therapist memory note if clinically appropriate. |
| Recommendation history is empty | Open the Recommendations tab and generate a recommendation run for the active child. |
| Recommendation evidence looks stale | Check whether pending proposals exist, approved memory changed after the last run, or a newer reviewed session exists. Generate a fresh run if needed. |
| Dashboard seems to show the wrong child | Verify the active child in the therapist shell, re-select the correct child, then re-open the dashboard for that child. |
| Microphone or audio problems | Check browser microphone permissions, device input selection, and whether the current exercise expects speech input. |
| Avatar or session launch problems | Return to Home, confirm the child, avatar, and exercise, then launch again. If the problem continues, refresh the workspace after checking your sign-in state. |

> Note:
> When in doubt, first verify three things: signed-in session, active child, and current mode. Most everyday workspace confusion comes from one of these three settings being out of date.