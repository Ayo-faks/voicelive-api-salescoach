# Pathfinder Phase 2 — UX & Polish Fixes

Implement the fixes below in the `voicelive-api-salescoach-pathfinder-phase-0` workspace, on branch `fix/pathfinder-pilot-gaps-2026-05-23`. Each fix is independent — land them as separate commits in the listed order. Re-run the dev stack (`scripts/start-local.sh` for backend on `:8000`, `npx vite --port 5174 --strictPort --host 127.0.0.1` for frontend) and verify each fix in the browser at `http://localhost:5174` before moving on. Update or add unit tests where indicated; do not weaken existing ones.

---

## Fix 1 — Cookie banner on `/home` intercepts clicks

**Symptom.** On first load of `http://localhost:5174/home`, the cookie consent banner overlays the page and blocks pointer events on nav, hero CTAs, and any element below it until dismissed. Playwright surfaces this as `intercepts pointer events`.

**Acceptance.**
- Banner is dismissible with a single click on "Accept" / "Manage".
- Once dismissed, choice is persisted in `localStorage` under a stable key (e.g. `pathfinder.cookie-consent.v1`) and the banner does not re-appear on reload.
- Banner does **not** cover primary navigation or above-the-fold CTAs — pin it to the bottom with a max-height, drop shadow, and `pointer-events: auto` only on the banner itself; the rest of the viewport must remain interactive even before dismissal (so a teacher can still click "Teacher" in the sidebar).
- Add `data-testid="cookie-consent-banner"` and `data-testid="cookie-consent-accept"` so e2e can dismiss it deterministically.

**Files (likely).** `frontend/src/learning/PathfinderLearnApp.tsx` or the layout/header it renders; whichever component owns the banner today. Grep for the banner text first.

**Test.** Add an RTL test asserting (a) banner renders when storage is empty, (b) Accept writes the storage key and unmounts the banner, (c) banner does not render when storage is already set.

---

## Fix 2 — Two console warnings on `/teacher`

**Symptom.** Navigating to `/teacher` produces 2 console warnings in dev. They are non-blocking but noisy and will trip a "no console errors in pilot" gate.

**Steps.**
1. Open `http://localhost:5174/teacher` with the browser console open (or via Playwright `browser_console_messages`) and capture both warnings verbatim, including the React component stack.
2. Diagnose each — most likely candidates given the current code: missing `key` prop in a list render, controlled/uncontrolled input flip in the intent composer, or a Fluent `Slider`/`Drawer` aria attribute warning.
3. Fix at the source — do not silence with `console.warn` overrides.

**Acceptance.** A fresh hard-reload of `/teacher` followed by opening the student drawer and the override dialog produces **zero** warnings and **zero** errors in the console.

---

## Fix 3 — `SkillLibrary` card label concatenation

**Symptom.** Library cards render skill name and id glued together, e.g. `Ratio and proportionratio-proportion`, instead of separating them.

**Location.** `frontend/src/learning/routes/SkillLibrary.tsx` around line 175 (the card body / title block).

**Fix.** Render the skill id as a secondary line with proper spacing and typography — distinct DOM nodes, not adjacent string children. Suggested markup:

```tsx
<div className={styles.cardTitle}>{skill.label}</div>
<code className={styles.cardSkillId}>{skill.skill_id}</code>
```

with `cardSkillId` styled as a smaller, muted, monospace caption. Do not add a separator character (`·`, `—`) inside a single text node — keep them in separate elements so screen readers announce them as distinct.

**Test.** Update `frontend/src/learning/__tests__/SkillLibrary.test.tsx` to assert the label and the id appear as separate accessible nodes (e.g. `getByText('Ratio and proportion')` and `getByText('ratio-proportion')` both succeed), and that the rendered card does **not** contain the concatenated string `Ratio and proportionratio-proportion`.

---

## Fix 4 — "Current vs new" diff in `OverrideMasteryDialog`

**Symptom.** The override dialog shows the new probability/uncertainty sliders but does not show the model's pre-override values, so the teacher cannot see what they are changing.

**File.** `frontend/src/learning/OverrideMasteryDialog.tsx`.

**Acceptance.**
- Above the **Probability** slider, render a one-line diff: `Model estimate: 42% → New: 65%` where:
  - "Model estimate" value = the `skill.probability` passed in via props (frozen at dialog open, not bound to the slider).
  - "New" value = the live slider value, formatted as a percentage integer.
  - The arrow and "New" value update reactively as the slider moves.
  - When the slider equals the original value, drop the arrow and show only `Model estimate: 42%` (no diff to display).
- Do the same for **Uncertainty**: `Model uncertainty: 0.10 → New: 0.18` (two decimal places, not percent).
- Style: small, muted caption above the field label. Use existing FluentUI `Caption1` / `tokens.colorNeutralForeground3` rather than introducing new colours.
- Capture the original values once with a `useRef` or a `useState` initialiser so they do not drift if the parent re-renders with new props mid-edit.

**Test.** Extend the dialog test in `frontend/src/learning/__tests__/` (create if absent):
1. Render with `skill.probability = 0.42`, assert the diff line shows `42%` and no arrow.
2. Move the slider to `0.65`, assert it shows `42% → 65%`.
3. Move it back to `0.42`, assert the arrow disappears again.

---

## Fix 5 — Undo override ("Revert to model estimate")

**Symptom.** Each override is its own event so the data model supports rollback, but the teacher has no UI to undo it. Once they save a wrong value they have to manually slide back.

**Scope (frontend-only, no backend schema change).** Use the existing override endpoint — a revert is just another `OverrideEvent` whose probability/uncertainty match the model's last non-override estimate, with reason `"Reverted teacher override"` (or teacher-supplied).

**Acceptance.**

In `frontend/src/learning/StudentProfileDrawer.tsx`:
- For each skill row whose latest event is a teacher override (detect via `recent_mastery_events` where `kind === 'mastery_override'` and `skill_id` matches), render a secondary **"Revert to model estimate"** button next to the existing "Override mastery" button.
- Compute the pre-override estimate by walking `recent_mastery_events` backwards from the latest override and finding the most recent non-override estimate for that skill. If none exists in the recent window, disable the button with a tooltip `No prior model estimate available`.
- Clicking it opens a small confirmation (Fluent `Dialog` or `MessageBar` with confirm/cancel — no new sliders) showing `Revert from 65% back to 42%?` and, on confirm, calls `overrideMastery({ skill_id, probability: <prior>, uncertainty: <prior>, reason: 'Reverted teacher override' })`.
- After success, the drawer refetches the profile so the row's status badge updates and the audit log entry appears (`Override mastery for <student>/<skill> -> p=0.42`).
- Surface the same revert affordance in the dashboard audit log (`TeacherMasteryDashboard.tsx`): for any `mastery_override` entry, append a small `Rollback` link that does the same flow without opening the drawer. (Optional polish — implement only if Fix 5 main path is clean.)

**Test.** Extend `frontend/src/learning/__tests__/StudentProfileDrawer.test.tsx`:
1. Mock a profile where skill `ratio-proportion` has a `mastery_override` event with `probability=0.65` preceded by a model event with `probability=0.42`. Assert the **Revert** button is enabled and shows the right diff in its confirmation.
2. Confirm the revert and assert `overrideStudentMastery` was called with `probability=0.42`, `uncertainty` matching the prior estimate, and `reason='Reverted teacher override'`.
3. Mock a profile where the only event for a skill is the override itself (no prior model estimate). Assert the **Revert** button is disabled with the expected tooltip.

---

## Bonus (only if time permits) — Student name cell clickable

The student name column in `TeacherMasteryDashboard.tsx` (around line 547, `<td className={styles.nameCell}>{row.name}</td>`) is plain text and not interactive, even though the mastery cells already open the profile drawer. Wrap it in a button with the same `onClick={() => setSelectedStudentId(row.studentId)}` handler and `aria-label={\`Open profile for ${row.name}\`}`. Add a `nameButton` style (unstyled button, inherits colour, underline on hover, focus ring). Update or add a test asserting `getByRole('button', { name: /open profile for/i })` opens the drawer.

---

## Definition of done (whole prompt)

- All five fixes (1–5) landed as discrete commits with conventional-commit messages prefixed `fix(frontend):` or `fix(learning):`.
- `npm run test` (frontend) and `pytest backend/tests` both pass.
- Visual walkthrough at `http://localhost:5174`: `/home` interactive without banner dismissal; `/teacher` console silent; `/library` cards readable; override dialog shows the before→after diff; drawer offers revert; revert lands in audit log and updates mastery in place.
- No new TypeScript or ESLint errors (`npm run lint` and `tsc --noEmit` clean).
- No new backend warnings on startup.
