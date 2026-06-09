# Wulo Flow Ad Assets

This folder contains Playwright-generated reference frames for a Google Flow Omni product video. The screenshots are rendered from the real Wulo React app routes with seeded demo API data; they are not production user data and not static mockups.

The assets are designed for this concept:

> A luminous Wulo voice tutor talks through real product capabilities: voice-on practice, live tutor follow-up, misconception explanation, diagnostic repair, career paths, and parent/teacher summaries.

## Generate

From the repo root:

```bash
cd frontend
npm run capture:flow-assets
```

The Playwright spec starts the local frontend with `frontend/playwright.flow-capture.config.ts`, seeds deterministic learner data through route interception, and writes 1920x1080 PNGs into `images/`.

## Submit To Google Flow

You do not need another script to submit these assets. Use the existing capture script only when you want to refresh the screenshots, then upload the PNGs to Flow manually as image references/keyframes.

1. Run `npm run capture:flow-assets` from `frontend/` if the app UI or copy has changed.
2. Open Google Flow and create a new video using the Omni model.
3. Upload the PNGs from `images/` in this exact order:
	- `01-real-app-voice-tutor-entry.png`
	- `02-real-app-voice-practice-question.png`
	- `03-real-app-voice-explanation-tutor.png`
	- `04-real-app-live-tutor-dig-deeper.png`
	- `05-real-app-diagnostic-explain-mistake.png`
	- `06-real-app-career-pathways.png`
	- `07-real-app-parent-summary.png`
4. Use the prompt below as the main instruction.
5. Set format to `16:9`, keep the output short (`30-45s`), and ask Flow to preserve UI text and layout from the reference images.
6. If Flow invents new UI, rerun with stronger wording: `Do not redesign the app. Do not invent screens. Use the uploaded images as the source of truth.`

## Voiceover Script

Use this as narration guidance. Keep it calm, premium, and human:

```text
Wulo listens first.

It turns practice into a conversation: the learner answers, the tutor spots the exact misconception, and the next explanation adapts in real time.

When Ayoola misses a ratio question, Wulo does not just mark it wrong. It explains the why, breaks the idea into a smaller scaffold, and updates the next step.

Behind the scenes, mastery keeps moving: diagnostics, intervention planning, career pathways, and parent-ready summaries all stay connected.

Wulo Academy. The tutor that learns how you learn.
```

## Suggested Flow Prompt

Attach the PNGs in shot order and use this prompt:

```text
Create a premium cinematic product advertisement for Wulo Academy using the attached reference frames.

Visual style: pure black stage, luminous intelligent orb speaking at center frame, elegant product UI panels floating as glass screens, cinematic reflections, high contrast, warm and trustworthy education technology. Preserve the UI layout and wording from the reference frames. Do not invent a different product interface.

Story sequence: the orb awakens inside Wulo, opens a voice-on practice session, explains a missed ratio question step by step, lets the learner dig deeper with the live tutor, diagnoses a misconception, reveals career paths unlocked by skill mastery, then closes on the parent/teacher summary.

Motion: slow premium camera moves, subtle parallax, gentle light pulses, crisp UI reveals, no chaotic sci-fi effects, no cartoon style. The orb should feel calm, alive, and intelligent.

Voiceover theme: Wulo listens, spots the misconception, explains the why, adapts the next intervention, and opens the path forward.

Required beats by reference image:
1. Show the Wulo learner home and orb as the entry point.
2. Cut to the voice-on practice question; the UI should remain readable.
3. Show the tutor explaining why the answer is 9 cups.
4. Move into the live tutor dig-deeper orb screen.
5. Show the diagnostic explanation as proof that mistakes become interventions.
6. Reveal career pathways linked to mastery signals.
7. Close on the parent progress summary.

Negative instruction: do not create fake dashboards, extra charts, generic robot teachers, cartoon avatars, sci-fi clutter, or invented app screens. Keep Wulo's UI faithful to the uploaded references.
```
