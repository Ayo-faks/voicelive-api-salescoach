# Execution Prompt — Apple Chrome Pass

Paste the block below into a fresh Copilot Chat session in this workspace.

---

You are implementing a pre-planned visual-only pass. The full plan lives at
`voicelive-api-salescoach/docs/chrome-apple-pass-plan.md` — **read that file
first** and follow it exactly. Do not deviate, do not expand scope.

**Hard constraints (do not violate):**

1. Visual styling only. No changes to logic, props, behavior, routing,
   accessibility semantics, icons, dependencies, tests, audio, codecs,
   WebSocket, or session state.
2. Touch only these files:
   - `voicelive-api-salescoach/frontend/src/components/SidebarNav.tsx`
     (`useStyles` block + one small JSX wrapper span around the brand `<img>`).
   - `voicelive-api-salescoach/frontend/src/components/InsightsRail.tsx`
     (styles only: `topBar`, `menuTrigger`, `iconButton` — no JSX).
   - `/memories/repo/wulo-design-system.md` (memory doc refresh per Phase 3).
3. Do NOT modify any other file. Do NOT create new files (except if a memory
   tool call requires it for the design-system doc). Do NOT create any new
   markdown docs.
4. Preserve all existing responsive rules (`@media (max-width: 720px)`),
   collapsed/expanded states, and the mobile drawer transform.
5. Use the rgba values and gradient recipes from the plan verbatim unless a
   clear conflict with existing code forces a minor adjustment — if so, note
   the deviation in your final summary.

**Execution order:**

1. Read `voicelive-api-salescoach/docs/chrome-apple-pass-plan.md` fully.
2. Read the current state of `SidebarNav.tsx` and `InsightsRail.tsx` to confirm
   line ranges still match (the plan's line numbers are approximate).
3. Apply Phase 1 (SidebarNav): `aside`, `navButton`, `navButtonActive`,
   `brandPlatter` (new style + JSX wrap), `brandLogo` resize, `userAvatar`,
   `userCard`, `dropdown`. Use `multi_replace_string_in_file` for batched edits.
4. Apply Phase 2 (InsightsRail): `topBar`, `menuTrigger` hover, `iconButton`
   hover + `:active`. Add `border: '1px solid transparent'` to the base
   `menuTrigger` and `iconButton` if missing, to prevent hover layout shift.
5. Apply Phase 3 (memory doc refresh) via the memory tool: update
   `/memories/repo/wulo-design-system.md` — retire rule #5, add the
   "Embossed chrome" section described in the plan.
6. Verification:
   - Run `npx tsc --noEmit` from `voicelive-api-salescoach/frontend` (or
     `npm run build` if tsc isn't wired up) and fix any type errors you
     introduced.
   - Run `npm run lint` (if present) and fix any new warnings in the two
     files you touched.
   - Run `npm test -- InsightsRail InsightsOrb useInsightsVoice` from the
     frontend dir — confirm still green.
7. Report back with:
   - A diff summary per file (what styles changed, where the JSX wrapper
     was added).
   - Any deviations from the plan and why.
   - Verification command output (pass/fail).

**Do not:**
- Ask clarifying questions before starting — the plan is complete.
- Refactor unrelated styles "while you're there".
- Add comments, docstrings, or type annotations to untouched code.
- Run a dev server or take screenshots unless explicitly asked afterward.
- Commit or push anything.

Begin.
