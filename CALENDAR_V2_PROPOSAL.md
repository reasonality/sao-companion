# SAO Companion Console Calendar — V2 Premium Redesign Proposal

**Status:** V2 design proposal — written in response to "v1 is still too flat, can you seriously design it?"
**File in scope:** `panel.html` line ~29 calendar CSS only.
**Out of scope:** JS, `buildCalCell`, HTML structure, any rules outside the `.sao-cal-*` scope.
**Replaces:** The v1 calendar block shipped earlier on this same line (see `CALENDAR_REDESIGN_PROPOSAL.md` for the rejected v1).

---

## 1. Visual language statement

V1 committed to "rich composition of gradients + neon" — which is the same trick every dark-mode dashboard reaches for. The result reads as **flat dark cells with slightly thicker borders**, because gradients on individual tiny tiles don't change silhouette enough to register as depth.

V2 abandons that. The visual language is **"glass-tray holding elevated tiles, with HUD chrome on top."** Specifically:

- **Two-tier material hierarchy.** The calendar grid as a whole sits inside a **glass tray** (semi-transparent panel surface, hairline frame, subtle backdrop-blur). Each day cell is a **premium tile** that floats *above* the tray with a multi-layer drop-shadow stack (key shadow + ambient shadow + contact shadow — Material Design elevation pattern, not a single fuzzy glow).
- **Material elevation earns the eye.** Gradient on tile body + sharp top inner-highlight + deep black drop below = the tile clearly *rises out of the panel*. V1 used only one of those. V2 uses all three in concert.
- **Today is not a tint — it's an object.** V1 painted today green-cyan as a 22% alpha overlay, which looks like idle. V2 renders today as a **saturated green-cyan capsule** sitting visibly higher than its neighbors, with **4 corner brackets** in cyan-mint, a **3px molten top-bar**, a **white-halo day number** in `--bg-base` color (dark text on bright cell — classic premium dark-on-light focal point), and a layered halo pulse. It reads as a separate object, not a state.
- **Chips are pills, not strips.** V1 chips were rectangles with a left-border accent (`border-left:2px solid; max-height:1.4em`). That's a low-energy treatment. V2 chips are **rounded pills (`border-radius:999px`)** with internal padding, full 1px color border, and a subtle linear-gradient interior that lifts the type color from the panel. iOS Calendar / Linear-style.
- **Dots are gone. A top color bar replaces them.** V1 had a 3-pixel-diameter row of dots inside the cell — visually noisy and small. V2 hides the dot row entirely (the `:has(.sao-cal-dot-*)` selectors still work for selection since `:has()` matches even hidden elements), and renders a **3-px segmented type-bar at the top edge of the cell**: gold for appointments, green for canon, cyan for custom. Multi-segment with linear-gradient when both apt and canon exist. Reads from across the room.
- **Corner brackets for SAO HUD chrome.** 4 corner brackets at the today cell's edges (thin 2×12px L-shapes per corner) in cyan-mint. Pure decorative HUD device — instantly signals "this is the special cell."
- **Distinct halos.** Day number typography gets individual `text-shadow` halos in selected (cyan) and today (white) modes. Selected has a softer halo to differentiate from today's bright halo. Three states: idle (no halo), selected (cyan halo), today (white halo). Each readable.
- **Premium typography rhythm.** Day numbers go from 1.05em (v1) → **1.2em** with weight 900 and letter-spacing 0.04em. The day number owns the cell.

Net result: an idle calendar reads as a **framed console read-out** with **floating tiles**, today reads as a **glowing capsule with HUD brackets**, and event cells get a **clean premium pill** for each event.

---

## 2. Per-element redesign

### 2.0 Calendar grid container — the glass tray

| | v1 (current) | v2 (proposed) |
|---|---|---|
| Background | (none — transparent) | inline gradient `linear-gradient(180deg, rgba(15,21,34,0.55) → rgba(11,17,30,0.55))` — same family as `--bg-base`/`--bg-elevated` but at 55% so the tray itself feels translucent |
| Border | none | `1px solid rgba(255,255,255,0.05)` — a hairline outline that frames the whole grid |
| Border radius | none | **16px** — the tray is one rounded shape |
| Padding | none | **8px** — tiles are inset into the tray |
| Backdrop-filter | none | `backdrop-filter: blur(6px) saturate(120%)` — soft glass effect (this combines safely with the outer `.sao-card`'s blur; CSS `backdrop-filter` is composited, not stacked) |
| Gap | row-gap 10px / column-gap 6px | `gap: 4px` — tiles sit close together *inside* the tray so the tray's border does the framing work, not per-cell borders |

CSS:
```css
.sao-cal-grid{
  display:grid!important;
  grid-template-columns:repeat(7,1fr)!important;
  grid-auto-rows:minmax(92px,auto)!important;
  gap:4px!important;
  background:linear-gradient(180deg,rgba(15,21,34,0.55) 0%,rgba(11,17,30,0.55) 100%)!important;
  border:1px solid rgba(255,255,255,0.05)!important;
  border-radius:16px!important;
  padding:8px!important;
  position:relative!important;
  backdrop-filter:blur(6px) saturate(120%)!important;
  -webkit-backdrop-filter:blur(6px) saturate(120%)!important;
}
```

### 2.1 Weekday headers — tight premium caps

| | v1 (current) | v2 (proposed) |
|---|---|---|
| Size | 0.8em | **0.7em** (smaller, with more tracking) |
| Tracking | 0.5px | **0.18em letter-spacing** — caps run out wide, reads as premium calibration |
| Color | `--primary-bright` flat | `--text-secondary` (soft, not screaming cyan) + faint cyan text-shadow halo |
| Padding | 12px 4px 10px | **10px 0 8px** |
| Separator | gradient border + glow | dashed 1px `rgba(0,210,255,0.18)`, then a subtle accent dot before each letter is too far. Stick with separator. |
| Sub-element | none | a tiny 4×4 cyan dot glyph beside each weekday for calibration feel — `::before` |

CSS:
```css
.sao-cal-header{
  text-align:center!important;
  padding:10px 0 8px!important;
  font-family:"Rajdhani","Noto Sans SC",sans-serif!important;
  font-size:0.7em!important;
  font-weight:600!important;
  color:var(--text-secondary)!important;
  text-transform:uppercase!important;
  letter-spacing:0.18em!important;
  border-bottom:1px dashed rgba(0,210,255,0.22)!important;
  margin-bottom:0!important;
  text-shadow:0 0 6px rgba(0,210,255,0.18)!important;
}
```

### 2.2 Idle day cell (the critical one) — premium tile with real elevation

| | v1 (current) | v2 (proposed) |
|---|---|---|
| Min-height | 84px | **92px** (a touch taller — chips stack cleaner) |
| Padding | 8px | **10px 9px 8px** (asymmetric — more room top for type-bar, less bottom for clean edge) |
| Background | vertical gradient 28,38,58 → 16,24,40 @0.78 | **darker, more saturated** vertical gradient 36,48,72 → 22,30,46 @0.92 — sits clearly above tray |
| Border | 1px rgba(255,255,255,0.12) | 1px rgba(255,255,255,0.07) — softer (the drop shadow does the framing work now) |
| Border-radius | 10px | **14px** (matches tray feel) |
| Drop shadow | none | **multi-layer**: contact `0 1px 2px rgba(0,0,0,0.5)`, ambient `0 6px 14px rgba(0,0,0,0.3)` — material elevation 3 |
| Top inner highlight | rgba(255,255,255,0.06) | rgba(255,255,255,0.08) — slightly brighter, more obvious from a glance |
| Bottom inset shade | rgba(0,0,0,0.25) | rgba(0,0,0,0.3) — pushes the bottom visually down |
| Transition | scoped (border/bg/shadow/transform) | same plus `cubic-bezier(0.4,0,0.2,1)` on transform — premium ease-out |

CSS:
```css
.sao-cal-cell{
  min-height:92px!important;
  padding:10px 9px 8px!important;
  background:linear-gradient(180deg,rgba(36,48,72,0.92) 0%,rgba(22,30,46,0.88) 100%)!important;
  border:1px solid rgba(255,255,255,0.07)!important;
  border-radius:14px!important;
  position:relative!important;
  cursor:pointer!important;
  display:flex!important;
  flex-direction:column!important;
  justify-content:flex-start!important;
  align-items:stretch!important;
  gap:4px!important;
  transition:
    transform 0.22s cubic-bezier(0.4,0,0.2,1),
    border-color 0.2s ease,
    background 0.25s ease,
    box-shadow 0.25s ease!important;
  box-shadow:
    0 1px 2px rgba(0,0,0,0.5),
    0 6px 14px rgba(0,0,0,0.3),
    inset 0 1px 0 rgba(255,255,255,0.08),
    inset 0 -1px 0 rgba(0,0,0,0.3)!important;
  overflow:visible!important;
}
.sao-cal-cell:hover{
  transform:translateY(-3px)!important;
  border-color:var(--border-accent)!important;
  background:linear-gradient(180deg,rgba(42,56,84,0.95) 0%,rgba(26,36,56,0.92) 100%)!important;
  box-shadow:
    0 4px 8px rgba(0,0,0,0.5),
    0 14px 32px rgba(0,210,255,0.2),
    inset 0 1px 0 rgba(255,255,255,0.12),
    inset 0 -1px 0 rgba(0,0,0,0.2)!important;
}
.sao-cal-cell.sao-cal-selected:hover,.sao-cal-cell.sao-cal-today:hover{transform:none!important;}
```

Why premium: the **3 distinct shadow layers** (contact + ambient + inset top + inset bottom-shade) create the visual illusion of light hitting the tile from above, like real material. v1 had only one ambient shadow and one inset. v2 has 4 layered shadows plus an inner highlight ridge.

### 2.3 Today cell — glowing capsule with corner brackets

This is the dramatic move. Today becomes a clearly distinct object, not a tint.

| | v1 | v2 |
|---|---|---|
| Background | gradient `155deg, 0,214,138,0.22 → 0,210,255,0.06 → 22,30,46,0.7` | **fully saturated** gradient `155deg, rgba(0,200,130,0.95) → rgba(0,165,110,0.92) → rgba(0,135,90,0.88)` — opaque, vivid cyan-green capsule |
| Border | `1px solid rgba(0,214,138,0.65)` | `1px solid rgba(80,240,170,0.7)` — cyan-mint, brighter and more saturated |
| Outer ring | none today | **`box-shadow: 0 0 0 1px rgba(0,255,180,0.22)`** — a soft cyan-mint *ring outside the border*, like a glow leak |
| Shadow stack | 3 layers (outer glow + insets) | **6 layers**: outer ring + ambient `0 4px 16px rgba(0,0,0,0.35)` + bloom `0 0 32px rgba(0,220,160,0.55)` + 3 inset layers |
| Corner brackets | only top-right 14×14 triangular notch | **4-corner L-shape brackets** at every corner of the cell, in cyan-mint, 12×2px strokes, inset 5px from cell edge — SAO HUD chrome |
| Top color bar | none | **3px molten gold-cyan top bar** spanning the full cell width (rounded at corners to match the cell) |
| Day number | green, halo green | **dark `--bg-base` color, white halo, weight 900, 1.3em** — dark on bright = focal contrast |
| Animation | `sao-pulse-today 2.6s ease-in-out infinite` | `sao-pulse-today 2.4s ease-in-out infinite` (slightly faster = more "alive") |

CSS:
```css
.sao-cal-today{
  background:linear-gradient(155deg,rgba(0,200,130,0.95) 0%,rgba(0,165,110,0.92) 55%,rgba(0,135,90,0.88) 100%)!important;
  border:1px solid rgba(80,240,170,0.7)!important;
  border-radius:14px!important;
  box-shadow:
    0 0 0 1px rgba(0,255,180,0.22),
    0 4px 16px rgba(0,0,0,0.35),
    0 0 32px rgba(0,220,160,0.55),
    inset 0 1px 0 rgba(255,255,255,0.28),
    inset 0 -1px 0 rgba(0,0,0,0.15),
    inset 0 0 0 1px rgba(255,255,255,0.12)!important;
  animation:sao-pulse-today 2.4s ease-in-out infinite!important;
}

/* 4 corner L-brackets — pure decorative HUD chrome */
.sao-cal-today::before{
  content:""!important;
  position:absolute!important;
  inset:5px!important;
  pointer-events:none!important;
  z-index:3!important;
  background-image:
    linear-gradient(to right,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to bottom,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to left,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to bottom,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to right,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to top,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to left,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to top,rgba(180,255,220,0.95) 0 12px,transparent 12px)!important;
  background-size:
    12px 2px,2px 12px,
    12px 2px,2px 12px,
    12px 2px,2px 12px,
    12px 2px,2px 12px!important;
  background-position:
    0 0,0 0,
    100% 0,100% 0,
    0 100%,0 100%,
    100% 100%,100% 100%!important;
  background-repeat:no-repeat!important;
}

/* Top molten bar — gold→cyan */
.sao-cal-today::after{
  content:""!important;
  position:absolute!important;
  top:-1px!important;
  left:-1px!important;
  right:-1px!important;
  height:3px!important;
  border-radius:14px 14px 0 0!important;
  background:linear-gradient(90deg,rgba(255,200,80,0.95) 0%,rgba(80,240,200,0.95) 60%,rgba(0,210,255,0.95) 100%)!important;
  box-shadow:0 0 10px rgba(0,220,180,0.6)!important;
  pointer-events:none!important;
  z-index:4!important;
}
```

### 2.4 Selected cell — sharp cyan halo + inset ring

V1 treated selected and hover similarly. V2 makes selected **crisper and more locked-in**.

| | v1 | v2 |
|---|---|---|
| Background | flat `rgba(0,210,255,0.22)` | subtle vertical gradient `rgba(0,210,255,0.22) → rgba(0,160,200,0.18)` — premium polished feel |
| Border | `var(--primary)` | `var(--primary)` solid |
| Inset ring | `inset 0 0 0 1px var(--primary)` | `inset 0 0 0 1px var(--primary)` (kept) — gives doubled-stroke effect with border |
| Glow | `0 0 16px rgba(0,210,255,0.32)` | **`0 0 24px rgba(0,210,255,0.4)` + `0 6px 14px rgba(0,0,0,0.3)`** — combined ambient + halo |
| Drop shadow | none | added `0 6px 14px rgba(0,0,0,0.3)` so selected still floats |
| Day number | cyan + soft cyan halo | `var(--primary-bright)` + brighter halo `rgba(0,210,255,0.65)` |

CSS:
```css
.sao-cal-selected{
  background:linear-gradient(180deg,rgba(0,210,255,0.22) 0%,rgba(0,160,200,0.18) 100%)!important;
  border:1px solid var(--primary)!important;
  box-shadow:
    inset 0 0 0 1px var(--primary),
    0 6px 14px rgba(0,0,0,0.3),
    0 0 24px rgba(0,210,255,0.4)!important;
  transform:none!important;
}
```

### 2.5 Today + Selected hybrid

When both modifiers match, both effects need to coexist. Rule order: today applied first (becomes green capsule), then selected de-corner-brackets the cell and adds the cyan inset ring on top. Implementation: explicitly merge.

```css
.sao-cal-cell.sao-cal-today.sao-cal-selected{
  background:linear-gradient(155deg,rgba(0,180,150,0.85) 0%,rgba(0,170,140,0.82) 55%,rgba(0,150,120,0.78) 100%)!important;
  border:1px solid var(--primary)!important;
  box-shadow:
    inset 0 0 0 1px var(--primary),
    0 4px 16px rgba(0,0,0,0.35),
    0 0 32px rgba(0,220,200,0.5),
    0 0 0 1px rgba(0,255,180,0.3),
    inset 0 1px 0 rgba(255,255,255,0.2)!important;
  animation:none!important;
  /* Keep corner brackets and top bar from .sao-cal-today */
}
```

### 2.6 Other-month

| | v1 | v2 |
|---|---|---|
| Opacity | 1 (was already dropped) | keep 1 |
| Background | `rgba(22,30,46,0.3)` | **darker tray-tint** `rgba(15,21,34,0.4)` — visually recessed but not "ghost" |
| Border | none override | `rgba(255,255,255,0.04)` (mostly invisible) — still a tile, just dimmer |
| Day number | `--text-tertiary` | `--text-tertiary` |
| Drop shadow | inherits idle | softened — `box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 4px rgba(0,0,0,0.2)` — much shallower elevation |

The cells are still tiles, just demoted elevation. No more "ghost," no more "broken-looking 0.45 opacity."

### 2.7 Event chips — premium pills (not strips)

This is the most user-visible content in each cell. V2 treats them like proper UI elements.

| | v1 | v2 |
|---|---|---|
| Shape | rounded rect with 2px **left-border** only (3px radius) | **rounded pill** (`border-radius: 999px`) with **full 1px border** in type color, internal padding 2px 8px |
| Background | tinted type-color at 8% opacity | **type-color linear-gradient** at 22%→18% top-to-bottom — gentle inside gradient reads as physical plastic pill |
| Color | type-color hex (warning for apt, success for canon — v1 bugfix) | same, kept |
| Padding | 1px 5px | **2px 8px** — proper breathing room, room for the text to breathe inside the pill |
| Font weight | 400 / inheriting | **`font-weight:600`** in Rajdhani — pill text reads as a label, not paragraph |
| Letter-spacing | none | 0.02em — slight tracking reads as premium |
| Truncation | `-webkit-line-clamp:1` + ellipsis | single line `text-overflow:ellipsis` + `white-space:nowrap` (pills don't wrap) |
| Max-width | 100% implicit | explicit `max-width:100%` for safety |
| Line clamp | -webkit-line-clamp:1 (works) | stays for safety |
| Type-color | `--warning` for apt, `--success` for canon (bugfix from v1) | same — kept consistent with type-bar |

CSS:
```css
.sao-cal-events{
  flex:1!important;
  margin-top:2px!important;
  display:flex!important;
  flex-direction:column!important;
  gap:3px!important;
  overflow:hidden!important;
}
.sao-cal-event-text{
  font-family:"Rajdhani","Noto Sans SC",sans-serif!important;
  font-size:0.68em!important;
  font-weight:600!important;
  line-height:1!important;
  background:linear-gradient(180deg,rgba(255,255,255,0.05) 0%,rgba(255,255,255,0.025) 100%)!important;
  border:1px solid rgba(255,255,255,0.08)!important;
  border-radius:999px!important;
  padding:2px 8px!important;
  color:var(--text-secondary)!important;
  letter-spacing:0.02em!important;
  white-space:nowrap!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  max-width:100%!important;
  display:block!important;
}
.sao-cal-event-text.sao-cal-event-apt{
  background:linear-gradient(180deg,rgba(255,184,0,0.22) 0%,rgba(255,140,0,0.18) 100%)!important;
  border-color:rgba(255,184,0,0.55)!important;
  color:var(--warning)!important;
}
.sao-cal-event-text.sao-cal-event-canon{
  background:linear-gradient(180deg,rgba(0,214,138,0.22) 0%,rgba(0,180,114,0.18) 100%)!important;
  border-color:rgba(0,214,138,0.55)!important;
  color:var(--success)!important;
}
```

### 2.8 Type-bar at top — replaces the dot row (with hidden dots)

The `.sao-cal-dots` markup is preserved (required for `:has(.sao-cal-dot-*)` selector logic) but **`display:none`** because the type-bar carries the same information more legibly.

| Dots (v1) | Type-bar (v2) |
|---|---|
| 3× 6-7px circles at the bottom of the cell | **3px tall horizontal sliver at the top edge** of the cell, segmented by type |
| Gold/green/cyan dots | Same three colors but as gradient bar |
| Easy to miss at distance | Scannable from across the room |
| Sits inline with day number | Top edge — reads like a "tab indicator" |

CSS:
```css
.sao-cal-dots{display:none!important;}

.sao-cal-has-event::before{
  content:""!important;
  position:absolute!important;
  top:-1px!important;
  left:-1px!important;
  right:-1px!important;
  height:3px!important;
  border-radius:14px 14px 0 0!important;
  pointer-events:none!important;
  z-index:2!important;
  background:var(--primary)!important;
  box-shadow:0 1px 6px rgba(0,210,255,0.45)!important;
}
.sao-cal-has-event:has(.sao-cal-dot-apt):has(.sao-cal-dot-canon)::before{
  background:linear-gradient(90deg,var(--warning) 0 50%,var(--success) 50% 100%)!important;
  box-shadow:0 1px 6px rgba(255,184,0,0.5)!important;
}
.sao-cal-has-event:has(.sao-cal-dot-apt):not(:has(.sao-cal-dot-canon))::before{
  background:linear-gradient(90deg,var(--warning) 0%,rgba(255,140,0,1) 100%)!important;
  box-shadow:0 1px 6px rgba(255,184,0,0.6)!important;
}
.sao-cal-has-event:has(.sao-cal-dot-canon):not(:has(.sao-cal-dot-apt))::before{
  background:linear-gradient(90deg,var(--success) 0%,rgba(0,170,114,1) 100%)!important;
  box-shadow:0 1px 6px rgba(0,214,138,0.6)!important;
}
.sao-cal-has-event:not(:has(.sao-cal-dot-apt)):not(:has(.sao-cal-dot-canon))::before{
  background:linear-gradient(90deg,var(--primary) 0%,var(--primary-dim) 100%)!important;
  box-shadow:0 1px 6px rgba(0,210,255,0.6)!important;
}
```

`:has()` matches DOM presence regardless of `display:none`, so the dot div can be hidden without breaking the type-bar.

### 2.9 Day number typography — confident focal point

| | v1 | v2 |
|---|---|---|
| Size | 1.05em | **1.2em** (idle), **1.3em** (today) — measurably bigger |
| Weight | 700 | **900** |
| Tracking | 0.5px | **0.04em** (slight, reads as calibration) |
| Default color | `--text-primary` | `--text-primary` + `text-shadow: 0 1px 2px rgba(0,0,0,0.5)` for legibility drop |
| Today color | `--success` (green) on green cell | **`--bg-base`** (dark color) on bright cell + **`text-shadow: 0 0 14px rgba(255,255,255,0.55)`** for white halo glow — dramatic dark-on-light focal point |
| Selected color | `--primary` + halo | `--primary-bright` + brighter halo `rgba(0,210,255,0.65)` |

CSS:
```css
.sao-cal-day-num{
  font-family:"Orbitron","Noto Sans SC",sans-serif!important;
  font-size:1.2em!important;
  font-weight:900!important;
  color:var(--text-primary)!important;
  letter-spacing:0.04em!important;
  line-height:1!important;
  text-shadow:0 1px 2px rgba(0,0,0,0.5)!important;
}
.sao-cal-today .sao-cal-day-num{
  color:var(--bg-base)!important;
  font-size:1.3em!important;
  text-shadow:0 0 14px rgba(255,255,255,0.55),0 1px 0 rgba(255,255,255,0.4)!important;
}
.sao-cal-selected .sao-cal-day-num{
  color:var(--primary-bright)!important;
  text-shadow:0 0 10px rgba(0,210,255,0.65)!important;
}
.sao-cal-other-month .sao-cal-day-num{color:var(--text-tertiary)!important;text-shadow:none!important;}
```

Day number on today is intentionally a **bold black number on bright cell**, with white halo — that's how SAO's UI calls out the active indicator, and it's a strong design idiom (event cards in modern apps often do this).

### 2.10 Mobile breakpoints

| | v1 | v2 |
|---|---|---|
| Cell min-height | 56px | 68px |
| Cell padding | 5px | 6px 5px 5px |
| Cell radius | 8px | 12px |
| Day-num size | 0.85em (down from 1.05 = -0.2) | 0.95em (down from 1.2 = -0.25, but still readable) |
| Type-bar height | 1.5px | 2px (still visible at mobile) |
| Pills | 0.65em | 0.62em |
| Corner brackets | n/a | **disable** to save space — drop `::before` rule via media query |
| Top bar | same | same height |

---

## 3. Color & material palette

### Tokens reused (no new variables)

| Token | Value | Role in v2 |
|---|---|---|
| `--bg-base` | `#080c14` | Today day number color (dark on bright cell) |
| `--bg-elevated` | `#0f1522` | Tray gradient lower stop |
| `--bg-panel` | `#161e2e` | Tile gradient lower stop |
| `--bg-glass` | `rgba(20,28,44,0.72)` | Inspiration for tray tint (lighter override applied) |
| `--primary` | `#00d2ff` | Selected ring, dot-apt→cheapest (custom-only), idle tint halo |
| `--primary-bright` | `#66e8ff` | Selected day-text color |
| `--primary-dim` | `#0094b4` | Custom-only type-bar second stop |
| `--success` | `#00d68a` | Canon chip border/bg/text, today border base, mixed-gradient stops |
| `--warning` | `#ffb800` | Apt chip border/bg/text |
| `--danger` | `#ff2e4a` | (reserved, not used) |
| `--text-primary` | `#eaf2ff` | Default day number |
| `--text-secondary` | `#9fb0cc` | Weekday caps, default chip text |
| `--text-tertiary` | `#5c6b85` | Other-month day number |
| `--border-subtle` | `rgba(255,255,255,0.08)` | Cell border (very subtle) |
| `--border-accent` | `rgba(0,210,255,0.35)` | Hover border |
| `--shadow-glow` | `0 0 18px rgba(0,210,255,0.25)` | Inspiration for tile hover/selected halos |
| `--shadow-soft` | `0 8px 32px rgba(0,0,0,0.45)` | Inspiration for tile ambient shadows (slightly stronger in v2) |

### New alpha-derived rgba (no new hex values, only alpha variants of existing hexes)

These are needed because premium layering requires more halo/glide stops. V2 mixes alpha in place, never new color values:

| Value | Derivation | Role |
|---|---|---|
| `rgba(15,21,34,0.55)` | `--bg-elevated` × 0.55 alpha | Tray gradient upper |
| `rgba(11,17,30,0.55)` | `--bg-base` × 0.55 alpha | Tray gradient lower |
| `rgba(255,255,255,0.05)` | white × 0.05 | Tray border |
| `rgba(36,48,72,0.92)` | mid-tone, derived from `--bg-panel` lifted | Tile gradient upper |
| `rgba(22,30,46,0.88)` | `--bg-panel` × 0.88 | Tile gradient lower |
| `rgba(42,56,84,0.95)` | hover state mid-tone | Tile hover gradient upper |
| `rgba(26,36,56,0.92)` | hover state mid-tone | Tile hover gradient lower |
| `rgba(0,200,130,0.95)` | `--success` *lifted* | Today gradient upper (more vivid) |
| `rgba(0,165,110,0.92)` | `--success` darkened | Today gradient mid |
| `rgba(0,135,90,0.88)` | `--success` darkened further | Today gradient lower |
| `rgba(80,240,170,0.7)` | `--success` brightened | Today cell border |
| `rgba(180,255,220,0.95)` | `--success` brightened dramatically | Today corner brackets |
| `rgba(0,255,180,0.22)` | `--success` *+blue mix* | Today outer ring |
| `rgba(0,220,160,0.55)` | `--success` glow | Today bloom halo |
| `rgba(0,220,180,0.5)` | mixed cyan-green | Today+selected hybrid bloom |
| `rgba(255,200,80,0.95)` | `--warning` brightened | Today top-bar gold stop |
| `rgba(0,210,255,0.95)` | `--primary` | Today top-bar cyan stop |
| `rgba(0,160,200,0.18)` | `--primary-dim` × 0.18 | Selected gradient lower |
| `rgba(0,210,255,0.32–0.65)` | `--primary` glow alphas | Selected halo, day-num halo |
| `rgba(255,184,0,0.18–0.6)` | `--warning` alphas | Apt chip + type-bar apt stops |
| `rgba(255,140,0,1)` | `--warning` darker | Apt gradient lower |
| `rgba(0,214,138,0.18–0.6)` | `--success` alphas | Canon chip + type-bar canon stops |
| `rgba(0,180,114,1)` | `--success` darker | Canon chip gradient lower |

**No new hex colors introduced — everything derives from the 9 base hex tokens via alpha and a few brightness shifts toward white (tints) or black (shades) of the same hue.** This keeps the system coherent — the same green family lives across today-bg, today-glow, canon-chip, today-corner-brackets (all relate to `--success`).

### Material depth model (specification)

Three elevation tiers, used consistently:
- **Tier 0 — Tray**: `box-shadow: none`, 1px subtle border, gradient bg, optional blur. Used by `.sao-cal-grid`.
- **Tier 1 — Tile (idle)**: contact + ambient + 2 inset shadows (4 total). Used by `.sao-cal-cell`.
- **Tier 1.5 — Tile (today)**: tier 1 + outer ring + outer bloom (6 shadows total). Used by `.sao-cal-today`. Actually rises higher than neighbors due to bloom.
- **Tier 2 — Tile (selected)**: tier 1 + stronger halo + cyan inset. Used by `.sao-cal-selected`.
- **Tier 0.5 — Tile (other-month)**: shallow shadows, low alpha. Recessed from idle.

---

## 4. CSS figures

### Selector count

| Category | Selectors | Note |
|---|---|---|
| Grid + tray | 1 (`.sao-cal-grid`) | edit |
| Weekday | 1 (`.sao-cal-header`) | edit |
| Cell base / hover / state-suppress | 4 | edit: cell + hover + selected:hover/today:hover suppressor |
| Today | 4 | edit: today + today::before brackets + today::after top-bar + today:hover lift-suppress |
| Selected | 1 | edit |
| Today+selected hybrid | 1 | new — merges both |
| Other-month | 1 | edit |
| Has-event + type-bar `::before` (5 selectors with `:has()` variants) | 5 | new |
| Dot-row hide | 1 (`.sao-cal-dots`) | edit (display:none) |
| Events list | 1 | edit |
| Event text + 2 variants | 3 | edit |
| Day-num + 3 variants | 4 | edit |
| Other rules preserved | 7 (event-item, meta, actions, event-apt, event-canon, event-done, empty) | unchanged |

**Selector total:** ~30 calendar selectors on line 29 (`@media` mobile adds ~5 more).

### Approximate line / byte counts

- **If kept compressed on line 29 (same style as current):** ~8–9 KB on that single line, replacing current ~7 KB calendar block. (Increase ~1–1.5 KB, mostly from the corner-bracket `::before` gradients stack and the multi-shadow stacks.)
- **If reformatted multi-line for human readability:** ~140–170 lines.

Either format accepted. Compressed keeps diff noise low; multiline keeps review easier. V1 was compressed; V2 suggested compressed to match the existing panel.html style.

### New keyframe definition (kept on its own line)

`@keyframes sao-pulse-today` already shipped in v1 — V2 only updates step values:

```css
@keyframes sao-pulse-today{
  0%,100%{
    box-shadow:
      0 0 0 1px rgba(0,255,180,0.22),
      0 4px 16px rgba(0,0,0,0.35),
      0 0 28px rgba(0,220,160,0.5),
      inset 0 1px 0 rgba(255,255,255,0.28),
      inset 0 -1px 0 rgba(0,0,0,0.15),
      inset 0 0 0 1px rgba(255,255,255,0.12)!important;
  }
  50%{
    box-shadow:
      0 0 0 1px rgba(0,255,180,0.32),
      0 4px 16px rgba(0,0,0,0.35),
      0 0 40px rgba(0,220,160,0.75),
      inset 0 1px 0 rgba(255,255,255,0.36),
      inset 0 -1px 0 rgba(0,0,0,0.15),
      inset 0 0 0 1px rgba(255,255,255,0.2)!important;
  }
}
```

(Pulse animation runs slightly faster `2.4s` instead of v1's `2.6s` — feels more "alive" against the otherwise static surface.)

---

## 5. Specific premium CSS examples (the strongest moves)

### Example A — Idle cell with true elevation (drop-shadow stack + top inner highlight ridge + bottom shade)

```css
.sao-cal-cell{
  /* Background: gradient that "looks like" a tile under top-down light */
  background:linear-gradient(180deg,
    rgba(36,48,72,0.92) 0%,    /* slightly lifted, lit */
    rgba(22,30,46,0.88) 100%   /* darkened as it recedes */
  )!important;
  border:1px solid rgba(255,255,255,0.07)!important;
  border-radius:14px!important;
  box-shadow:
    0 1px 2px rgba(0,0,0,0.5),                          /* contact shadow — tile "touches" the tray */
    0 6px 14px rgba(0,0,0,0.3),                         /* ambient shadow — tile floats above */
    inset 0 1px 0 rgba(255,255,255,0.08),               /* top inner highlight — top edge "catches light" */
    inset 0 -1px 0 rgba(0,0,0,0.3)!important;           /* bottom inner shade — bottom edge "rolls under" */
}
```

### Example B — Today as capsule + HUD corner brackets + molten top-bar

```css
.sao-cal-today{
  background:linear-gradient(155deg,
    rgba(0,200,130,0.95) 0%,    /* vivid green-cyan, top-left lit */
    rgba(0,165,110,0.92) 55%,
    rgba(0,135,90,0.88) 100%    /* darker bottom-right shade */
  )!important;
  border:1px solid rgba(80,240,170,0.7)!important;
  border-radius:14px!important;
  box-shadow:
    0 0 0 1px rgba(0,255,180,0.22),                         /* glow ring leaking outside border */
    0 4px 16px rgba(0,0,0,0.35),                            /* contact ambient */
    0 0 32px rgba(0,220,160,0.55),                          /* bloom halo */
    inset 0 1px 0 rgba(255,255,255,0.28),                   /* top ridge — brighter than idle */
    inset 0 -1px 0 rgba(0,0,0,0.15),                        /* bottom shade */
    inset 0 0 0 1px rgba(255,255,255,0.12)!important;       /* inner white outline */
  animation:sao-pulse-today 2.4s ease-in-out infinite!important;
}

.sao-cal-today::before{
  /* 4 corner L-brackets */
  content:""!important;
  position:absolute!important;
  inset:5px!important;
  pointer-events:none!important;
  z-index:3!important;
  background-image:
    linear-gradient(to right,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to bottom,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to left,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to bottom,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to right,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to top,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to left,rgba(180,255,220,0.95) 0 12px,transparent 12px),
    linear-gradient(to top,rgba(180,255,220,0.95) 0 12px,transparent 12px)!important;
  background-size:
    12px 2px,2px 12px,
    12px 2px,2px 12px,
    12px 2px,2px 12px,
    12px 2px,2px 12px!important;
  background-position:
    0 0,0 0,
    100% 0,100% 0,
    0 100%,0 100%,
    100% 100%,100% 100%!important;
  background-repeat:no-repeat!important;
}
```

### Example C — Premium pill chip

```css
.sao-cal-event-text{
  font-family:"Rajdhani","Noto Sans SC",sans-serif!important;
  font-size:0.68em!important;
  font-weight:600!important;
  background:linear-gradient(180deg,
    rgba(255,255,255,0.05) 0%,
    rgba(255,255,255,0.025) 100%
  )!important;
  border:1px solid rgba(255,255,255,0.08)!important;
  border-radius:999px!important;                /* full pill */
  padding:2px 8px!important;
  color:var(--text-secondary)!important;
  letter-spacing:0.02em!important;
  white-space:nowrap!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  max-width:100%!important;
  display:block!important;
}
.sao-cal-event-text.sao-cal-event-apt{
  background:linear-gradient(180deg,
    rgba(255,184,0,0.22) 0%,
    rgba(255,140,0,0.18) 100%
  )!important;
  border-color:rgba(255,184,0,0.55)!important;
  color:var(--warning)!important;
  font-weight:600!important;
}
```

### Example D — Top type-bar (segmented by event type)

```css
.sao-cal-has-event::before{
  content:""!important;
  position:absolute!important;
  top:-1px!important;
  left:-1px!important;
  right:-1px!important;
  height:3px!important;
  border-radius:14px 14px 0 0!important;       /* match cell radius */
  pointer-events:none!important;
  z-index:2!important;
  background:var(--primary)!important;
  box-shadow:0 1px 6px rgba(0,210,255,0.45)!important;
}
/* Mixed apt+canon → 50/50 split gold/green */
.sao-cal-has-event:has(.sao-cal-dot-apt):has(.sao-cal-dot-canon)::before{
  background:linear-gradient(90deg,var(--warning) 0 50%,var(--success) 50% 100%)!important;
}
/* Apt alone → gold */
.sao-cal-has-event:has(.sao-cal-dot-apt):not(:has(.sao-cal-dot-canon))::before{
  background:linear-gradient(90deg,var(--warning) 0%,rgba(255,140,0,1) 100%)!important;
}
/* Canon alone → green */
.sao-cal-has-event:has(.sao-cal-dot-canon):not(:has(.sao-cal-dot-apt))::before{
  background:linear-gradient(90deg,var(--success) 0%,rgba(0,170,114,1) 100%)!important;
}
/* Custom-only → cyan */
.sao-cal-has-event:not(:has(.sao-cal-dot-apt)):not(:has(.sao-cal-dot-canon))::before{
  background:linear-gradient(90deg,var(--primary) 0%,var(--primary-dim) 100%)!important;
}
```

### Example E — Selected with doubled-stroke effect (border + inset ring + halo)

```css
.sao-cal-selected{
  background:linear-gradient(180deg,rgba(0,210,255,0.22) 0%,rgba(0,160,200,0.18) 100%)!important;
  border:1px solid var(--primary)!important;
  box-shadow:
    inset 0 0 0 1px var(--primary),                    /* doubled stroke (border + inner ring) */
    0 6px 14px rgba(0,0,0,0.3),                       /* ambient */
    0 0 24px rgba(0,210,255,0.4)!important;            /* halo */
  transform:none!important;
}
```

### Example F — Grid as glass tray

```css
.sao-cal-grid{
  background:linear-gradient(180deg,
    rgba(15,21,34,0.55) 0%,
    rgba(11,17,30,0.55) 100%
  )!important;
  border:1px solid rgba(255,255,255,0.05)!important;
  border-radius:16px!important;
  padding:8px!important;
  backdrop-filter:blur(6px) saturate(120%)!important;
  -webkit-backdrop-filter:blur(6px) saturate(120%)!important;
  gap:4px!important;
}
```

---

## 6. Open questions for reviewer

Pick defaults if silent; otherwise reply with overrides before implementation.

1. **Day number on today — dark on bright (`--bg-base`) or light on bright (kept `--text-primary`)?** V2 specifies `--bg-base` (dark text, white halo) for a dramatic focal point. Some reviewers prefer consistency with all-day text styling. **Default proposed: dark.** Tradeoff: more dramatic vs more uniform.

2. **Today cell hue — green or blue?** V2 uses a green-cyan capsule (`rgba(0,200,130,0.95)` based on `--success`). Alternative is to lean cyan-blue (`rgba(0,180,220,0.95)` based on `--primary`), more SAO-blue, but then today and canon chip config become visually redundant. **Default proposed: green.** Tradeoff: more distinctive vs more consistent with SAO blue scheme.

3. **4 corner brackets vs 2 (top-only) on today.** V2 specifies 4 brackets via 8 stacked linear-gradients on `::before`. Implementation complexity is moderate. Alternative is 2 (top-left + top-right only) — cleaner. **Default proposed: 4 corners** for full SAO HUD chrome feel.

4. **Tray backdrop-filter on — adds depth but adds render cost.** `backdrop-filter: blur(6px) saturate(120%)` paints blurred content under the grid, which means the grid container area must reblur when scrolling/re-rendering. **Default proposed: ON**, but keep an eye on calendar re-render perf during month change.

5. **Type-bar height: 3px or 2px?** V2 specifies 3px (more visible). v1 had 2px. **Default proposed: 3px** for v2's premium emphasis.

6. **Pulse animation speed: 2.4s (V2) vs 2.6s (V1)?** Slightly faster reads as more "alive" but maybe more distracting. **Default proposed: 2.4s.** (Tradeoff only — feel free to override.)

That's 6 — pick 5 max focus. Please mark any you'd like changed; otherwise the defaults get applied on implementation.

---

## Appendix A — Implementation checklist (when approved)

1. Replace the `.sao-cal-*` segment of `panel.html` line 29 only.
2. Update `@keyframes sao-pulse-today` step values (kept on its own line).
3. Edit the calendar portion of `@media(max-width:640px)`.
4. No JS changes. No HTML structure changes. No new files.

(Earlier v1 ran into the same constraints — V2 fulfills them cleanly.)
