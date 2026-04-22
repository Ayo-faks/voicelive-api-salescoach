# Apple-style Chrome Pass — Sidebar + InsightsRail Top Bar

**Status:** Planned, not yet implemented
**Scope:** Visual styling only. No logic, codec, audio, props, or behavior changes.
**Target files:**
- `voicelive-api-salescoach/frontend/src/components/SidebarNav.tsx`
- `voicelive-api-salescoach/frontend/src/components/InsightsRail.tsx`
- `/memories/repo/wulo-design-system.md` (memory doc refresh)

## Context / Why

`InsightsOrb`, hero cards (`SessionScreen`, `VideoPanel`, `SessionLaunchOverlay`,
`AuthGateScreen`, `LogoutScreen`) and overlays already use a dimensional
Apple-ish language: **layered radial gradients + specular top highlights + soft
ambient shadows + embossed pills**. The two persistent chrome surfaces —
`SidebarNav` and the `InsightsRail` top bar — were never brought along; they
still follow the old "flat + 1px border, no shadows" rule. Since they're
on-screen at all times, the inconsistency is maximally visible.

Reference formula (from `InsightsOrb.tsx`):
```
background: radial-gradient(circle at 35% 30%, <light>, <mid> 55%, <dark> 100%)
box-shadow: 0 6px 20px rgba(13, 138, 132, 0.32)
```

## Phase 1 — SidebarNav (`SidebarNav.tsx`)

All edits inside the `useStyles` block, plus one small JSX wrapper for the brand logo platter.

### 1.1 `aside` (≈L52–L79)
Replace the flat 135deg linear gradient with a layered stack:
```ts
background:
  'radial-gradient(circle at top left, rgba(13,138,132,0.12), transparent 38%), ' +
  'radial-gradient(circle at bottom right, rgba(13,138,132,0.06), transparent 42%), ' +
  'linear-gradient(180deg, rgba(236, 246, 246, 0.98), rgba(222, 238, 240, 0.98))',
boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 2px 0 24px rgba(17,36,58,0.05)',
```
Keep `backdrop-filter: blur(16px)`, sticky behavior, and the existing responsive collapse rules (including `@media (max-width: 720px)` overrides — don't touch them).

### 1.2 `navButton` (≈L162–L172)
- Add `borderRadius: '12px'` (pill).
- Idle stays transparent.
- Hover:
  ```ts
  ':hover': {
    backgroundColor: 'rgba(255,255,255,0.45)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
  }
  ```

### 1.3 `navButtonActive` (≈L174–L178)
Embossed pill:
```ts
background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(245,251,251,0.85))',
border: '1px solid rgba(13,138,132,0.22)',
boxShadow:
  'inset 0 1px 0 rgba(255,255,255,0.85), ' +
  '0 1px 2px rgba(15,42,58,0.08), ' +
  '0 0 0 3px rgba(13,138,132,0.06)',
color: 'var(--color-primary)',
borderLeft: '2px solid #0d8a84', // optional teal accent
```

### 1.4 Brand logo platter (JSX + styles, ≈L114–L120)
Add a new `brandPlatter` style and wrap the `<img>` in it:
```ts
brandPlatter: {
  width: '44px',
  height: '44px',
  borderRadius: '14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  background:
    'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.9), rgba(232,244,244,0.6) 60%, rgba(13,138,132,0.12) 100%)',
  border: '1px solid rgba(13,138,132,0.18)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 4px 10px rgba(13,138,132,0.08)',
},
```
JSX change:
```tsx
<span className={styles.brandPlatter}>
  <img src="/wulo-logo.png" alt="Wulo logo" className={styles.brandLogo} />
</span>
```
Shrink `brandLogo` from 40×40 to 30×30; keep `objectFit: 'contain'`.

### 1.5 `userAvatar` (≈L219–L231)
Swap linear gradient for the `InsightsOrb` radial formula:
```ts
background:
  'radial-gradient(circle at 35% 30%, #49b8b1, #0d8a84 55%, #06625e 100%)',
boxShadow:
  'inset 0 1px 0 rgba(255,255,255,0.45), 0 2px 6px rgba(13,138,132,0.28)',
```
Keep size, font, flexShrink.

### 1.6 `userCard` (≈L207–L216)
Keep `borderRadius: 14px`, replace bg:
```ts
background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,252,252,0.82))',
boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(15,42,58,0.04)',
```

### 1.7 `dropdown` (≈L199–L203)
Match the userCard treatment — keep 1px border, add:
```ts
boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 2px rgba(15,42,58,0.04)',
```

## Phase 2 — InsightsRail top bar (`InsightsRail.tsx`)

Styles only. No JSX changes.

### 2.1 `topBar` (≈L118–L124)
```ts
background: 'linear-gradient(180deg, rgba(250,252,252,0.96), rgba(240,247,247,0.92))',
borderBottom: '1px solid rgba(15,42,58,0.06)',
boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 0 rgba(15,42,58,0.04)',
```

### 2.2 `menuTrigger` (≈L135–L149)
Replace the flat grey hover with an embossed pill:
```ts
':hover': {
  background: 'linear-gradient(180deg, rgba(255,255,255,0.95), rgba(245,250,250,0.85))',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(15,42,58,0.08)',
  border: '1px solid rgba(15,42,58,0.08)',
}
```
(Ensure base style has `border: '1px solid transparent'` so the hover border doesn't cause layout shift.)

### 2.3 `iconButton` (≈L151–L166)
Same hover emboss as `menuTrigger`. Add a pressed feel:
```ts
':active': {
  boxShadow: 'inset 0 1px 2px rgba(15,42,58,0.12)',
}
```
Add matching `border: '1px solid transparent'` to the base to avoid layout jumps.

## Phase 3 — Memory doc refresh

Update `/memories/repo/wulo-design-system.md`:
- Retire rule **#5 "No Shadows, All Borders"** — the system now uses layered
  soft shadows and specular highlights deliberately.
- Add a new section **"Embossed chrome"** with the recipe:
  - Specular inset top: `inset 0 1px 0 rgba(255,255,255, 0.55–0.85)`
  - Ambient: `0 1px 2px rgba(15,42,58, 0.04–0.08)` and `0 4–10px` for lifted surfaces
  - Radial brand tints (teal 0.06–0.14) for nav surfaces
  - Embossed pill: `180deg` white-to-mist linear + inset highlight + hairline border + 1px ambient
- Note that hero radial patterns (`circle at top/bottom/corner`) now also apply to persistent chrome (sidebar + rails), not just hero sections.

## Verification

1. `cd voicelive-api-salescoach/frontend && npm run lint` — no new errors.
2. `npm run build` or `npx tsc --noEmit` — type-check passes.
3. Dev server manual pass:
   - Sidebar: active nav pill reads embossed with a subtle teal halo; brand logo sits on a platter; user avatar looks spherical and matches `InsightsOrb`.
   - InsightsRail: top bar has a faint top highlight + soft bottom shadow instead of a hard line; menu/icon buttons lift on hover, indent on press.
   - Collapsed sidebar (68px) still renders correctly; mobile drawer unaffected.
4. Run the existing frontend test subset touched recently:
   `npm test -- useInsightsVoice InsightsOrb InsightsRail` — should still pass (no JSX or logic changes in `InsightsRail`; sidebar tests unaffected).
5. Side-by-side visual check against `SessionLaunchOverlay` and `AuthGateScreen` — chrome should now belong to the same family.

## Out of scope (do NOT touch)

- Any codec, audio, WebSocket, or session logic.
- `InsightsRail` body, chips, transcript, scope rows, collapsed launcher, message rows, or props.
- Icon swaps, new dependencies, routing, accessibility semantics.
- `SidebarNav` behavior, props, navigation callbacks, responsive breakpoints.
- Any other component.

## Accessibility notes

- Active nav pill keeps `var(--color-primary)` text on a light background — contrast remains ≥ AA.
- `:focus-visible` outlines must not be overridden. If the Fluent `Button` already has one, leave it alone.
- No motion added — respects `prefers-reduced-motion` implicitly.

## Decisions

- No new dependencies; pure Fluent `makeStyles` edits plus existing CSS vars.
- Token values are inlined rgba where a matching CSS var doesn't already exist — consistent with how the rest of the codebase handles these (see `SessionScreen`, `VideoPanel`, `AuthGateScreen`).
- The 2px teal left accent on the active nav pill is **optional** — keep it unless it clashes with the collapsed 68px width.
