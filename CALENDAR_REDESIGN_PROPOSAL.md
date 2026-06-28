# SAO Companion Console Calendar — Redesign Proposal

**Status:** Design proposal — awaiting approval before implementation.
**Files in scope:** `panel.html` (line ~29 calendar rules) only.
**Behavior in scope:** None. Pure CSS. The goal is to reuse this on the chat-message calendar later, so no JS, no new classes that only this build emits, no new DOM nodes.

---

## 1. Design principles

1. **Console-HUD day panels — not a spreadsheet.** Each cell is a small, distinct micro-panel with real depth (gradient + inset highlight). The grid feels like 7 columns of framed instrument readouts, not a uniform block.
2. **Day number leads, everything else supports it.** Tier the cell from top to bottom: identity (type-bar) → ordinal (day number) → content (event chips). The number is the anchor; dots-as-row-of-tiny-circles don't get to compete for the same row.
3. **"Today" earns its highlight; "Selected" is distinct from "Hover".** Today becomes a green→cyan gradient with an outer pulse halo and an inset scanline. Selected becomes a cyan inset ring + halo, and — critically — does not use the same `translateY(-2px)` lift as hover, so the three states (idle/hover/selected) can never be confused.

Everything stays within the existing palette tokens already loaded onto `#sao_panel_overlay` (cyan ↔ space navy). No new colors, no new fonts, just richer composition of what's there.

---

## 2. Per-element design changes

### 2.1 Grid container — `.sao-cal-grid`

| | Current | Proposed |
|---|---|---|
| Gap | `6px` uniform | `10px` row / `6px` column (`row-gap:10px; column-gap:6px`) |
| Auto-rows | implicit | `grid-auto-rows: minmax(84px, auto)` for predictable heights |
| Pointer context | none | `position:relative` so cell decorations anchor cleanly |

Why: 6 px in both directions reads as a monolithic block. A wider row-gap visually separates weeks; column-gap can stay narrower so days within a week read as related.

### 2.2 Weekday row — `.sao-cal-header`

| | Current | Proposed |
|---|---|---|
| Font | Rajdhani 700, 0.78em, uppercase | Rajdhani 700, **0.8em**, uppercase |
| Color | `--primary-bright` (#66e8ff) flat | `--primary-bright` + `text-shadow: 0 0 8px rgba(0,210,255,0.35)` |
| Padding | `8px 4px` | `12px 4px 10px` (more air, anchors visual rhythm above cells) |
| Separator | `border-bottom: 1px solid var(--border-accent)` | `border-bottom: 1px solid rgba(0,210,255,0.18)` + **`box-shadow: 0 1px 6px rgba(0,210,255,0.18)`** for a soft drop |
| Visual weight | barely visible | Subtle but unmistakable header chip feel — the row reads as a calibrated header strip, not "tiny faint text" |

### 2.3 Day cell — `.sao-cal-cell` (default)

| | Current | Proposed |
|---|---|---|
| Background | flat `rgba(22,30,46,0.55)` | `linear-gradient(160deg, rgba(28,38,58,0.78) 0%, rgba(16,24,40,0.78) 100%)` |
| Border | `1px solid var(--border-subtle)` (≈8% white) | `1px solid rgba(255,255,255,0.12)` (almost double the alpha — the panel needs a real frame to feel framed) |
| Border radius | `8px` | `10px` (matches `.sao-card` radius used elsewhere) |
| Inset depth | none | `box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.25)` — a thin top ridge + bottom shadow = "pressed-in panel" |
| Padding | `6px` | `8px` |
| Min height | `64px` | `84px` |
| Transition | `all 0.2s ease` | `border-color 0.18s ease, background 0.2s ease, box-shadow 0.25s ease, transform 0.2s ease` (skip `all` — avoids repainting the gradient on every state swap) |

The bottom inset shadow + top inset ridge does the "physical panel" work without gradients on hover/selected, so transitions stay cheap.

### 2.4 Type-bar accent (NEW — via `::before` pseudo)

This is the "has-event" indicator that replaces the noise of three tiny dots.

- Rendered on `.sao-cal-cell.sao-cal-has-event::before`
- Sits as a `2px`-tall sliver across the **full top edge** of the cell, segment-painted by the *highest-priority event type on that day*. Priority: appointment (gold/warning) > canon (green/success) > custom (cyan/primary). Wins by checking child class names (`[class~="sao-cal-dot-apt"]`, etc).
- Implementation: keep three classes on the bar element via `::before` for ONE selected color — we approximate priority using a stacked technique: render three stacked 2px bars at top using three pseudo-positions is impossible with one `::before`. **Solution:** render the bar with `background: linear-gradient(90deg, var(--warning) 0 30%, transparent 30%)` and let the JS data drive priority via existing class hook.
- Cleaner alternative (chosen): **emit the bar with a single color picked by which dot class the cell already contains.** We do this by stacking `::before` (apt-stripe) and `::after` (canon-stripe) and turning them on via attribute presence. Since the dots themselves already encode type via class names on children (`.sao-cal-dot-apt`, `.sao-cal-dot-canon`), we can use child-sibling selectors:
  - `.sao-cal-has-event:has(.sao-cal-dot-apt)::before` — gold
  - `.sao-cal-has-event:has(.sao-cal-dot-canon):not(:has(.sao-cal-dot-apt))::before` — green
  - `.sao-cal-has-event:not(:has(.sao-cal-dot-apt)):not(:has(.sao-cal-dot-canon))::before` — cyan (custom only)
  - `:has()` is widely supported (SillyTavern runs in Chromium under the hood) — Safari support landed in 15.4 (March 2022) so users on modern SillyTavern stacks are safe. **Fallback**: a single cyan default if `:has()` isn't available — handled by declaring a non-`:has()` cyan default first, then `:has()` rules override.

Below the bar: a thin `box-shadow: 0 1px 4px rgba(0,210,255,0.18)` glow under the selected color so the bar looks "energized", not pasted on.

Also: turn the existing `.sao-cal-dots` row into the type-color legend that sits in the bottom-left chip — current behavior preserved (color encoding) but it's not the row that anchors the cell anymore.

### 2.5 Day number — `.sao-cal-day-num`

| | Current | Proposed |
|---|---|---|
| Font | Orbitron 700, 0.95em | Orbitron 700, **1.05em** |
| Letter-spacing | none | `letter-spacing: 0.5px` (gives numerals calibration feel) |
| Color (default) | `--text-primary` | `--text-primary` (unchanged — but contrast is now helped by larger size + better cell contrast) |
| Color (today) | `--success` | `--success` + **`text-shadow: 0 0 10px rgba(0,214,138,0.55)`** (halo) |
| Color (selected) | inherited | `--primary` + `text-shadow: 0 0 10px rgba(0,210,255,0.45)` |
| Color (other-month) | `--text-tertiary` via container | `--text-tertiary` (unchanged) — but the rest of the cell is no longer dimmed via opacity |

The number sits top-left under the type-bar with `margin-top:2px`. It now owns ordinal primacy because event chips are pushed below + the type-bar narrows the visual focus above.

### 2.6 Event chips — `.sao-cal-event-text`

Convert from "raw text rows" to **mini type-coded chips** — keeps same DOM (`<div class="sao-cal-event-text [apt|canon]">`), just new CSS.

| | Current | Proposed |
|---|---|---|
| Size | 0.62em (tiny) | **0.72em** |
| Background | none | `rgba(255,255,255,0.04)` (base) — and for typed variants, a tinted variant: apt `rgba(255,184,0,0.08)`, canon `rgba(0,214,138,0.08)` |
| Border | none | **2px solid** left border in type color: apt → `--warning`, canon → `--success`, default → transparent |
| Border-radius | none | `3px` (chip, not card) |
| Padding | none | `1px 5px` |
| Max-height | `2.6em` (~2 lines) | `1.4em` (1 line, ellipsis past 40 chars as the JS already does) |
| Color (default text) | `--text-secondary` at 0.9 opacity | `--text-secondary` at full opacity (we no longer need the opacity dim because the chip background already separates it from cell bg) |
| Color (apt) | `--success` ❌ (suspected bug — appointment swaps to green which conflicts with canon semantics) | **`--warning`** (gold, matching the type-bar) — *and* the dot variant `.sao-cal-dot-apt` should already be `--warning`, so we are now internally consistent |
| Color (canon) | `--primary-bright` | **`--success`** (green, matching the type-bar and the dot variant) |

Notes:
- The current mapping (apt = success/green, canon = primary-bright/cyan) is inconsistent with `.sao-cal-dot-apt`=warning and `.sao-cal-dot-canon`=success. **Fixing as part of this redesign so the chip border, chip tint, type-bar sliver, and the dot row all agree.**
- Last event chip: if events > 3, append a thin "+N more" sub-line at 0.65em, `--text-tertiary`, italic — visible only when the cell is selected (so the calendar doesn't shout about counts on every day). Implementation: the JS already truncates to 3; we add a pure-CSS `::after` on `.sao-cal-cell.sao-cal-selected .sao-cal-events` that shows "+N more" only when the cell has more than 3 events.

### 2.7 Today highlight — `.sao-cal-today`

Multi-layer accent. Top priority visual element of the whole calendar.

- **Background (multi-stop):** `linear-gradient(155deg, rgba(0,214,138,0.22) 0%, rgba(0,210,255,0.06) 55%, rgba(22,30,46,0.7) 100%)` — green→cyan haze that reads as "now / alive"
- **Border:** `1px solid rgba(0,214,138,0.65)`
- **Outer glow:** `box-shadow: 0 0 16px rgba(0,214,138,0.4), inset 0 1px 0 rgba(0,214,138,0.35)`
- **Corner notch (via `::after`):** a 14×14px diagonal triangle in the top-right corner of the cell, `border-image` triangular clip drawn via clip-path: `polygon(100% 0, 0 0, 100% 100%)` filled with `--success` at 80% opacity. Adds the SAO "system marker" feel without bigger layout.
- **Pulse:** `@keyframes sao-pulse-today { 0%,100% { box-shadow: 0 0 16px rgba(0,214,138,0.4), inset 0 1px 0 rgba(0,214,138,0.35); } 50% { box-shadow: 0 0 22px rgba(0,214,138,0.6), inset 0 1px 0 rgba(0,214,138,0.5); } }`, `animation: sao-pulse-today 2.6s ease-in-out infinite`. Slow + subtle — feels like a heartbeat on life support, not a flashing alarm.
- Day number inside: `--success` + green halo `text-shadow: 0 0 10px rgba(0,214,138,0.55)` (matches the cell pulse).
- **Hover override:** on `.sao-cal-today:hover`, suppress the `translateY()` lift — the cell already "elevates" itself via glow; lifting too adds visual jitter.

### 2.8 Selected — `.sao-cal-selected`

Distinct from both idle and hover. Reads as "currently being inspected."

- **Background:** `rgba(0,210,255,0.22)` flat (uniform, not gradient — feels like a "fixed focus" rather than idle ambience)
- **Border:** `1px solid var(--primary)`
- **Inset ring:** `box-shadow: inset 0 0 0 1px var(--primary), 0 0 16px rgba(0,210,255,0.32)` — the inset ring is what makes selected feel *locked in*, a frame around the frame
- **Lift:** NONE. `transform: none`. Hover lift only fires on cells that are NOT selected.

If today === selected, the today styles win for the pulse + bg gradient, but the **inset ring** still layers on top (it's a separate `box-shadow` prop and merges with the today glow). This way "today and selected" looks coherent — green-cyan halo + crisp inner cyan ring + notch.

### 2.9 Hover — `.sao-cal-cell:hover`

Sharper, lighter, clearly not the same as selected.

- **translateY(-1px)** (was -2px) — current -2px is too eager in a 7×6 grid, makes neighboring cells jitter
- **border-color:** `--border-accent` (cyan @0.35)
- **box-shadow:** `0 0 12px rgba(0,210,255,0.22), inset 0 1px 0 rgba(255,255,255,0.08)`
- Cursor unchanged
- Suppression on selected: `.sao-cal-cell.sao-cal-selected:hover { transform:none; }` — selected wins, hover can't lift it

### 2.10 Other-month — `.sao-cal-other-month`

- **Drop the global `opacity:0.45`.** It's the worst offender in the current design — it dims the day to "ghost" levels that read as broken.
- Keep `background: rgba(22,30,46,0.3)` (slightly dimmer than current-month idle) for visual demotion
- Day number color: `--text-tertiary` (unchanged) — this alone is enough to communicate "not this month"
- Border: same as default. No different border for adjacent-month cells — the graduated bg + muted number is enough
- No event chips, no type-bar (JS already only renders those for current-month cells, so this is automatic)

---

## 3. Color tokens (reused — no new vars)

All values are existing CSS variables on `#sao_panel_overlay`. No new tokens added. Reused:

| Token | Hex / rgba | Used for |
|---|---|---|
| `--bg-elevated` (`#0f1522`) | nav base | event chip default bg (`rgba(255,255,255,0.04)`) |
| `--primary` (`#00d2ff`) | cyan | selected border, hover border, default type-bar when only-custom |
| `--primary-bright` (`#66e8ff`) | bright cyan | weekday headers, type-bar glow halo |
| `--primary-dim` (`#0094b4`) | dim cyan | (reserved, currently unused in calendar) |
| `--success` (`#00d68a`) | green | today day number, today border, **canon** chip border/bar |
| `--warning` (`#ffb800`) | gold | **appointment** chip border/bar (was `--success` — bugfix) |
| `--danger` (`#ff2e4a`) | red | (unused in calendar — reserved for "missed" state if added later) |
| `--text-primary` (`#eaf2ff`) | near-white | default day number |
| `--text-secondary` (`#9fb0cc`) | soft blue-gray | event chip text |
| `--text-tertiary` (`#5c6b85`) | dim gray | other-month day number, "+N more" |
| `--border-subtle` (`rgba(255,255,255,0.08)`) | hairline | (still used by non-calendar parts) |
| `--border-accent` (`rgba(0,210,255,0.35)`) | cyan border | hover border, weekday separator |
| `--shadow-glow` (`0 0 18px rgba(0,210,255,0.25)`) | cyan glow | (template — calendar uses tuned per-state versions) |
| `--shadow-soft` (`0 8px 32px rgba(0,0,0,0.45)`) | deep shadow | (kept — calendar cells are too small to need it) |

Spot rgba values added inline (no new vars — kept inline because they're tightly bound to a single rule):
- Cell gradient: `rgba(28,38,58,0.78)` → `rgba(16,24,40,0.78)`
- Cell inset ridge: `rgba(255,255,255,0.06)` top, `rgba(0,0,0,0.25)` bottom
- Today bg gradient: `rgba(0,214,138,0.22)` → `rgba(0,210,255,0.06)` → `rgba(22,30,46,0.7)`
- Today glow: `rgba(0,214,138,0.4)` outer, `rgba(0,214,138,0.6)` peak, `rgba(0,214,138,0.35)` inset ridge
- Type-bar apt: `--warning` + glow `rgba(255,184,0,0.45)`
- Type-bar canon: `--success` + glow `rgba(0,214,138,0.45)`
- Type-bar custom: `--primary` + glow `rgba(0,210,255,0.45)`
- Appointment chip bg: `rgba(255,184,0,0.08)`
- Canon chip bg: `rgba(0,214,138,0.08)`
- Selected inner ring uses `--primary` (no inline rgba needed)
- Selected hover-glow: `rgba(0,210,255,0.32)`
- Hover glow: `rgba(0,210,255,0.22)`

---

## 4. Estimated CSS changes

| Selector | Action | Notes |
|---|---|---|
| `.sao-cal-grid` | edit — gap split row/col, auto-rows | ~1 rule |
| `.sao-cal-header` | edit — size, glow, padding, separator upgrade | ~1 rule |
| `.sao-cal-cell` | edit — gradient bg, stronger border, radius bump, inset shadow stack, padding/min-height, refined transition | ~1 rule |
| `.sao-cal-cell:hover` | edit — softer lift, sharper glow | ~1 rule |
| `.sao-cal-cell.sao-cal-selected` | edit — inset ring addition, suppress hover lift | ~1 rule |
| `.sao-cal-cell.sao-cal-today` | edit — multi-bg gradient + glow + animation | ~1 rule, plus keyframes block |
| `.sao-cal-cell.sao-cal-today:hover` | NEW — suppress transform.lift | ~1 rule |
| `.sao-cal-cell.sao-cal-other-month` | edit — drop global opacity, keep dimmed bg, day number stays tertiary | ~1 rule |
| `.sao-cal-has-event` | edit — drop the border-color override (type-bar replaces it) | ~1 rule |
| `.sao-cal-has-event:has(.sao-cal-dot-apt)::before` | NEW — gold type-bar | ~1 rule |
| `.sao-cal-has-event:has(.sao-cal-dot-canon):not(:has(.sao-cal-dot-apt))::before` | NEW — green type-bar | ~1 rule |
| `.sao-cal-has-event:not(:has(.sao-cal-dot-apt)):not(:has(.sao-cal-dot-canon))::before` | NEW — cyan type-bar (custom only) | ~1 rule |
| `.sao-cal-has-event::before` | NEW — base bar styles (position, height, transition) | ~1 rule |
| `.sao-cal-cell.sao-cal-today::after` | NEW — corner notch | ~1 rule |
| `.sao-cal-events` | edit — gap, margin | ~1 rule |
| `.sao-cal-event-text` | edit — bg, padding, radius, border-left, max-height; bugfix apt color to `--warning`, canon color to `--success` | ~1 rule |
| `.sao-cal-event-text.sao-cal-event-apt` | edit — full chip variant (bg + border + text) | ~1 rule |
| `.sao-cal-event-text.sao-cal-event-canon` | edit — full chip variant | ~1 rule |
| `.sao-cal-events::after` | NEW — "+N more" pseudo on selected cells with overflow indicator | uses `data-overflow` if we add it — otherwise skip and let the chip ellipsis be enough for v1 |
| `.sao-cal-day-num` | edit — letter-spacing, color/halo adjustments | ~1 rule |
| `.sao-cal-today .sao-cal-day-num` | edit — halo added | ~1 rule |
| `.sao-cal-selected .sao-cal-day-num` | NEW | ~1 rule |
| `.sao-cal-other-month .sao-cal-day-num` | unchanged | 0 rules |
| `.sao-cal-dots` | edit — lift into a small chip strip (size 7px, soft top-center placement, transparent container) | ~1 rule |
| `.sao-cal-dot` | edit — bigger (7×7), more glow | ~1 rule |
| `.sao-cal-dot-apt` | unchanged | 0 rules |
| `.sao-cal-dot-canon` | unchanged | 0 rules |
| `@keyframes sao-pulse-today` | NEW | ~3 lines |
| `@media(max-width:640px)` block (calendar portion only) | edit — adjust min-height to 56px, padding 5px, dot 5×5, type-bar 1.5px | minor |

**Count:** ~25 selectors edit, ~4 new selectors, ~1 new keyframe block, 1 media-query edit. Total roughly **95–110 lines** (formatted for human readability, multiline).

**Footprint vs current:** Current line 29 packs ~30 calendar rules into one ~2 KB compressed line. New CSS in the same style (single-line compressed rules) is ~3 KB — about the same. If reformatted with proper indentation: ~110 lines. Either format is fine; the existing line-29 style is preferred to minimize diff noise.

---

## 5. Structural HTML changes

**None.** The current `buildCalCell` HTML is fine — `<div class="sao-cal-cell [modifiers]"><div class="sao-cal-day-num">…</div><div class="sao-cal-dots">…</div><div class="sao-cal-events">…</div></div>` already carries enough state via classes on the cell and on child dots to drive every proposed visual treatment via `::before`/`::after` and `.sao-cal-has-event:has(.sao-cal-dot-…):…`.

This means:
- The chat-message calendar (planned follow-up) can reuse the exact same stylesheet blocks just by emitting the same DOM shape with the same class names.
- No refactor of `buildCalCell` in `index.js`.
- No new attribute selectors needed.

### Two optional micro-additions if portability wins are easy later

These are **not** proposed for v1 — recorded as future-friendly only:

1. Replace `buildCalCell`'s inline `.sao-cal-event-text` class-name concatenation with a `data-type="appointment|canon|custom"` attribute. This would let CSS `[data-type=...]` selectors replace the three `:has()` queries, which is more robust and avoids any `:has()`-support concerns. *If we go this way, it's a 1-line JS change + slightly simpler CSS.*

2. Add a `data-overflow="${events.length-3}"` attribute on `.sao-cal-events` only when there are more than 3 events, to drive the "+N more" pill. *Pure additivity — no behavior change today.*

For v1, both can be skipped and the visuals still work end-to-end.

---

## Appendix A — State matrix

State matrix summary of how the four modifier classes + parent selectors compose:

| Class on cell | bg | border | extra pseudo | pulse | day-num color | type-bar |
|---|---|---|---|---|---|---|
| (idle, default) | gradient `160deg` | `rgba(255,255,255,0.12)` | — | — | text-primary | — |
| `sao-cal-today` | tint overlay + bg | `rgba(0,214,138,0.65)` | corner notch ::after | ✓ | success + halo | (any) |
| `sao-cal-selected` | uniform cyan | `--primary` | inset cyan ring | — | primary + halo | (any) |
| `sao-cal-other-month` | dimmer bg | `rgba(255,255,255,0.12)` | — | — | text-tertiary | — |
| `sao-cal-has-event` | (any above) | (any above) | ::before = type-bar | (today only) | (any above) | apt / canon / cyan |
| Hover (any of above except selected/today) | — | `--border-accent` | glow `0 0 12px` | — | — | — |

State composability check:
- today + selected → today bg/tint + today pulse + corner notch + selected inset ring merge into the same `box-shadow` (outer glow + inset: inner cyan ring + outer green glow → layered). Works because `box-shadow` merges.
- has-event + other-month → JS already suppresses dots/events for non-current-month — so the type-bar won't draw anyway.
- has-event + today → type-bar sits ABOVE today's tint layer via `z-index` on `::before` (default stacking order works since `::before` is later than bg).

---

## Appendix B — Implementation checklist

After approval, the implementation should:
1. Replace the `.sao-cal-*` segment on line 29 of `panel.html` only.
2. Add `@keyframes sao-pulse-today` near the existing `@keyframes sao-fade-in` on line 29.
3. Touch up the `@media(max-width:640px)` calendar rules.
4. Bump the visible version in panel.html footer from "0.6.15" to "0.6.16" (line 217) — optional, but consistent with the prior cadence.

No JS edits. No HTML edits. No new files. Total diff: effectively a single line replacement + keyframe insertion.

---

## Appendix C — Open questions for reviewer

1. **Pulsing today**: subtle 2.6s breath, but is any pulse at all acceptable, or should the today highlight be a static glow only? (Some users find animation distracting in dense UIs.) → proposed default: gentle breath; can be removed by deleting the `animation` line if rejected.
2. **Apt color bugfix**: the proposed fix changes appointment chip text/bar from `--success` (green) to `--warning` (gold). This is more consistent with the existing dot legend but is technically a *semantic color change*. Approve the fix or keep the old mapping? → proposed default: fix.
3. **Type-bar via `:has()`**: we'll lean on `:has()` for clean selector logic. Confirm the runtime supports it (SillyTavern is Electron/Chromium-based — should be fine).
4. **Cell height bump (84px)**: makes the calendar 24 px taller overall. Acceptable, or reduce to 76 px to preserve vertical density? → proposed default: 84 px; quickly scrollable if rejected.
