# Dashboard Charts Implementation Prompt

You are working in the Wulo frontend repo at /home/ayoola/sen/voicelive-api-salescoach.

## Task

Add clinical-grade data visualizations to the therapist dashboard (ProgressDashboard.tsx) to replace text-only metric displays with charts that speech therapists can interpret instantly.

## Important constraints

- Do not add React Router.
- Keep the existing state-driven navigation in App.tsx.
- Do not change backend behavior or data contracts.
- Do not redesign the homepage or sidebar.
- Preserve brand palette and accessibility contrast.
- Keep sharp edges (all border-radius is 0px by design).
- All shadows are `none` by design — do not add box-shadow.
- Use the existing Wulo brand colors from global.css CSS variables:
  - Primary teal: `--color-primary` (#0d8a84)
  - Primary light: `--color-primary-light` (#20a39e)
  - Primary dark: `--color-primary-dark` (#06625e)
  - Primary soft: `--color-primary-soft` (rgba(13, 138, 132, 0.14))
  - Secondary warm: `--color-secondary` (#f2e9d8)
  - Warning/sand: `--color-warning` (#b89455)
  - Accent ink: `--color-accent-strong` (#0f2a3a)
  - Surfaces: `--color-bg` (#fbf8f2), `--color-bg-card`, `--color-bg-muted`
  - Text: `--color-text-primary` (#0f2a3a), `--color-text-secondary`, `--color-text-tertiary`
  - Font: Manrope (`--font-display`, `--font-body`)
- Do not introduce generic "AI dashboard" styling or flashy gradients.
- Charts must feel calm, premium, professional, and therapeutically meaningful.
- Use inline SVG charts or a lightweight charting library (recharts is preferred — already React-compatible). Install recharts if not present.

## Files involved

- `frontend/src/components/ProgressDashboard.tsx` — main file to edit
- `frontend/src/app/App.tsx` — do not change layout, only reference for data flow
- `frontend/src/styles/global.css` — reference for design tokens, do not edit
- `frontend/src/types.ts` — reference for data types (SessionSummary, SessionDetail, etc.)

## What to do first

1. Read `frontend/src/types.ts` to understand the exact data shapes available (SessionSummary, SessionDetail, Assessment, PronunciationAssessment, PracticePlan).
2. Read `frontend/src/components/ProgressDashboard.tsx` to understand the current layout, props, and available data.
3. Read `frontend/src/styles/global.css` to confirm brand tokens.
4. Install recharts: `cd frontend && npm install recharts`
5. Implement charts one by one, building each from the data already available in props.

## Charts to implement (in priority order)

### 1. Progress Trendline — Line Chart
**Replace:** The existing sparkline in the summary strip AND the "Recent trend" summary card text.
**Data source:** `sessions` array — each has `overall_score`, `accuracy_score`, `pronunciation_score`, `timestamp`.
**Plot:** Line chart with 4 series: Overall, Accuracy, Pronunciation score over time (x-axis = session date).
**Styling:**
- Overall line: `--color-primary` (#0d8a84), stroke-width 2
- Accuracy line: `--color-primary-light` (#20a39e), stroke-width 1.5, dashed
- Pronunciation line: `--color-warning` (#b89455), stroke-width 1.5
- Grid lines: rgba(15, 42, 58, 0.06)
- Axis labels: `--color-text-tertiary`, 0.72rem, Manrope
- Background: transparent (sits on the card surface)
- No rounded corners on the chart container
- Tooltip: white bg, `--color-border`, compact, Manrope font
**Placement:** Replace the "Average score" and "Recent trend" summary cards with a single wider chart card spanning 2 columns in the summary strip.

### 2. Session Quality Radar Chart
**Replace:** The text-only "Accuracy 24 / Pron 52 / Fluency 100" badges in session detail.
**Data source:** `selectedSession.assessment` — `ai_assessment` (articulation_clarity, engagement_and_effort) and `pronunciation_assessment` (accuracy_score, pronunciation_score, fluency_score).
**Plot:** Radar/spider chart with axes: Target Sound Accuracy, Overall Clarity, Consistency, Task Completion, Willingness to Retry, Self-Correction.
**Styling:**
- Fill: `--color-primary-soft` (rgba(13, 138, 132, 0.14))
- Stroke: `--color-primary`
- Axis lines: rgba(15, 42, 58, 0.1)
- Labels: `--color-text-secondary`, 0.75rem
- Max size: 280px × 280px
**Placement:** Top of session detail section, before the metrics grid.

### 3. Word-Level Error Heatmap
**Replace:** The current badge list of word accuracy percentages under "Pronunciation review".
**Data source:** `selectedSession.assessment.pronunciation_assessment.words` — each has `word`, `accuracy`, `error_type`.
**Plot:** Grid of cells, each representing a word. Color intensity maps to accuracy (0% = strong sand/warning, 100% = strong teal/success). Show word text inside each cell.
**Styling:**
- 0% accuracy: rgba(184, 148, 85, 0.4) background
- 50% accuracy: rgba(184, 148, 85, 0.15) background
- 80%+ accuracy: rgba(13, 138, 132, 0.15) background
- 100% accuracy: rgba(13, 138, 132, 0.3) background
- Cell border: 1px solid rgba(15, 42, 58, 0.08)
- Word text: `--color-text-primary`, 0.75rem, bold
- Accuracy text below word: `--color-text-tertiary`, 0.65rem
- Grid: auto-fill columns, min 72px
**Placement:** Replace the chipGrid of word badges in Pronunciation review.

### 4. Sound-Level Accuracy Breakdown — Horizontal Bar Chart
**Replace:** The "Focus sounds" summary card text.
**Data source:** Aggregate from `sessions` — group by target sound, calculate average accuracy per sound.
**Plot:** Horizontal bar chart. Each bar = one target sound. Bar length = average accuracy.
**Styling:**
- Bar fill: `--color-primary-soft` with `--color-primary` for the filled portion
- Background bar: rgba(15, 42, 58, 0.04)
- Labels left: sound name, `--color-text-primary`, 0.8rem, bold
- Labels right: percentage, `--color-text-secondary`, 0.8rem
- Bar height: 28px, gap 8px
**Placement:** Replace "Focus sounds" summary card content — or add as a new section below the summary strip.

### 5. Session Frequency Calendar Heatmap
**Replace:** Enhance the "Session history" column header area.
**Data source:** `sessions` array — count sessions per day from timestamps.
**Plot:** GitHub-style calendar grid. 7 rows (days of week) × N columns (weeks). Cell color intensity = session count.
**Styling:**
- 0 sessions: rgba(15, 42, 58, 0.04)
- 1 session: rgba(13, 138, 132, 0.15)
- 2 sessions: rgba(13, 138, 132, 0.3)
- 3+ sessions: rgba(13, 138, 132, 0.5)
- Cell size: 14px × 14px, gap 2px
- Day labels: `--color-text-tertiary`, 0.6rem
- Show last 12 weeks
**Placement:** Above the session list in the Session history card.

### 6. Articulation & Engagement Progress Bars (Enhanced)
**Keep:** The existing ProgressBar components but enhance them.
**Data source:** `ai_assessment.articulation_clarity` and `ai_assessment.engagement_and_effort`.
**Enhancement:** Add a small inline comparison indicator showing the score vs the child's average for that metric across all sessions.
**Styling:** Keep existing ProgressBar but ensure bar color uses `--color-primary`. Add a small dot or marker for the average.

### 7. Celebration Points Donut Chart
**Replace:** The text list "No celebration points saved for this session."
**Data source:** `ai_assessment.celebration_points` array length (earned) vs a reasonable max (e.g., 5).
**Plot:** Simple donut chart showing earned vs possible.
**Styling:**
- Earned fill: `--color-primary`
- Remaining fill: rgba(15, 42, 58, 0.06)
- Center text: count, `--color-text-primary`, 1.5rem, bold
- Size: 120px × 120px
**Placement:** Beside the celebration points text list.

### 8. Plan Confidence Gauge
**Replace:** Enhance the "Plan next session" area when a plan exists.
**Data source:** Derive a confidence score from: number of sessions available, score trend direction, plan status.
**Plot:** Semi-circle gauge. Needle position = confidence percentage.
**Styling:**
- Low (0-40): `--color-warning`
- Mid (40-70): `--color-secondary-dark`
- High (70-100): `--color-primary`
- Background arc: rgba(15, 42, 58, 0.06)
- Size: 160px × 90px
**Placement:** Next to the plan status badges.

## Implementation approach

- Create chart components as small functions or sub-components within ProgressDashboard.tsx (or extract to a `frontend/src/components/charts/` folder if the file gets too large).
- Use recharts for Line, Radar, and Bar charts.
- Use inline SVG for the calendar heatmap, donut, gauge, and word heatmap (these are simpler as custom SVG).
- All charts must be responsive and work on mobile (stack vertically, reduce size).
- Add `@media (max-width: 640px)` breakpoints where needed.

## Verification

After implementation:
1. Run `cd frontend && npm run build` — must pass with no errors.
2. Visually verify charts render with the brand palette.
3. Charts should degrade gracefully when data is missing (show empty states, not broken layouts).

## What NOT to do

- Do not add animations or transitions to charts (keep it calm and professional).
- Do not use bright/saturated colors outside the brand palette.
- Do not add rounded corners to chart containers.
- Do not add drop shadows.
- Do not make charts take up more than 50% of available vertical space — they should complement text, not replace all of it.
- Do not change the 3-column grid layout of the dashboard.
- Do not modify data contracts or backend APIs.
