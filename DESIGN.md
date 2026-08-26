---
name: fitr
description: Your wardrobe, and what belongs in it next — garments as tagged pieces on a repair worker's bench.
colors:
  paper: "#e9e2cf"
  surface: "#f5efdf"
  surface-sunk: "#dcd3ba"
  ink: "#27304a"
  ink-muted: "#6d6757"
  ink-faint: "#99927e"
  line: "#d0c6aa"
  line-strong: "#b4a98b"
  indigo: "#2e3d5c"
  indigo-deep: "#25324c"
  btn: "#2e3d5c"
  btn-ink: "#f2ecda"
  btn-hover: "#3a4b70"
  copper: "#ad5527"
  danger: "#99351f"
typography:
  display:
    fontFamily: "Big Shoulders, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 0.96
    letterSpacing: "0.01em"
  body:
    fontFamily: "Archivo, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "Courier Prime, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    letterSpacing: "0.08em"
  data:
    fontFamily: "Courier Prime, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
rounded:
  card: "12px"
  control: "10px"
components:
  button-primary:
    backgroundColor: "{colors.btn}"
    textColor: "{colors.btn-ink}"
    typography: "500 0.875rem Archivo, sans-serif"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.btn-hover}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "400 0.875rem Archivo, sans-serif"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-ghost:
    textColor: "{colors.ink-muted}"
    typography: "400 0.875rem Archivo, sans-serif"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "400 0.875rem Archivo, sans-serif"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  pill:
    backgroundColor: "{colors.surface-sunk}"
    textColor: "{colors.ink-muted}"
    typography: "400 0.75rem Archivo, sans-serif"
    padding: "4px 10px"
  pill-active:
    backgroundColor: "{colors.btn}"
    textColor: "{colors.btn-ink}"
---

# Design System: fitr

## Overview

**Creative North Star: "The Repair Bench"**

fitr is a garment worker's bench, not a wardrobe app. Every piece is a cutout
hung on a kraft tag; outfits are collages laid out on indigo canvas; a missing
piece in an outfit is a repair waiting to happen. The category-default
arrangement it refuses is the neutral white-grid wardrobe app. Light theme is
the unbleached workshirt in daylight; dark theme is the same bench at night,
and both schemes are first-class — neither is derived from the other.

Density is calm and phone-first. The daily screen answers one question with
one ticket and two riveted buttons; everything else waits quietly in panels of
kraft card stock separated from the woven canvas ground by hairlines. The
world speaks through materials rather than ornament: punched eyelets, strung
cords, chain-stitch rules, typed shipping labels. Copper thread appears only
where attention is earned — focus, selection, active state, a falling price.

All controls come from one shared vocabulary (`src/lib/ui.ts`); all icons from
one hand-drawn construction (`src/components/icons.tsx`). New screens compose
from these; they don't restyle them.

**Key Characteristics:**
- Woven canvas ground under everything (two hairline threads at the edge of perception)
- Kraft tag cards (`--surface`, 12px radius) that are never the same color as the ground
- Copper as the single highlight voice: selection, caret, focus ring, active ticks, price drops
- Shipping-tag typography: Big Shoulders caps for display, Archivo for UI, Courier Prime for typed data
- Soft two-step shadow vocabulary (rest / lift); depth mostly comes from sunk wells and hairlines
- Dashed hairline borders mean "waiting" — drop zones, outfit gaps, empty states

## Colors

A warm paper-and-indigo palette with one metal accent: unbleached grounds,
navy ink, and copper thread, restated at night as a dark bench with chalk
ink. Values below are the daylight scheme (the default `:root`); the night
scheme remaps the same token names, listed in parens.

### Primary
- **Workshirt Indigo** (`#2e3d5c`, night `#8fa3cc`): the brand's working
  color — primary button fills by day, and the navigation rail, which is the
  one surface painted deep indigo (`#25324c` / `#10141f`) in *both* themes.

### Secondary
- **Copper Thread** (`#ad5527`, night `#dd8b57`): the world's highlight.
  Selection background, text carets, focus-visible outlines, active pills and
  nav ticks, the "needs review" badge, falling-price lines, canvas handles.
  Small marks only — never a large field.

### Tertiary
- **Rust Warning** (`#99351f`, night `#e08573`): errors and destructive intent
  only (error banners, dismiss hovers, failure text). Adjacent to copper in
  hue but reserved.

### Neutral
- **Bench Canvas** (`--paper` `#e9e2cf`, night `#151b29`): the page ground,
  carrying the canvas-weave texture. Nothing sits directly on it except rails
  and cards.
- **Kraft Tag** (`--surface` `#f5efdf`, night `#202a40`): card stock. Deliberately lighter than `--paper`.
- **Sunk Well** (`--surface-sunk` `#dcd3ba`, night `#0f1420`): image wells,
  toggle tracks, empty slots — surfaces pressed *into* the bench.
- **Ink** (`--ink` `#27304a`, night `#ece5d1`): primary text.
- **Faded Ink** (`--ink-muted` `#6d6757`, night `#a09a88`): secondary text,
  placeholders-that-are-labels, quiet buttons.
- **Ghost Ink** (`--ink-faint` `#99927e`, night `#6e6959`): footnotes, fine print, timestamps.
- **Hairline** (`--line` `#d0c6aa`, night `#303b56`): default card and control borders.
- **Seam Line** (`--line-strong` `#b4a98b`, night `#45526e`): attention borders
  (items needing review, dashed waiting-states), stitches, eyelets, cords.
- Action pair: **Action Fill** `--btn` / **Action Text** `--btn-ink`
  (`#f2ecda` / night-inverted `#1d2537`) with **Action Hover** `--btn-hover`.

### Named Rules
**The Two Cloths Rule.** `--surface` is never the same as `--paper`. Cards are
tags lying *on* the canvas; if they matched the ground the bench would disappear.

**The Never-Bare-Ground Rule.** Garment cutouts never sit on the page ground
or on bare `--paper`; images live in sunk wells (`--surface-sunk`), the dark
well (`#14130f`), or the QA checker (`ground-check`). White garments vanish
otherwise — this is functional, not taste.

**The Copper Thread Rule.** Copper marks attention exactly once per moment and
in small doses: a focus ring, a caret, a tick, a badge, a falling line. It is
never a background field, never body text, never two competing marks in one view.

**The Indigo-Day-Chalk-Night Rule.** The primary button inverts across
schemes: indigo fill with cream text by day, chalk fill with navy text by
night. Both read as "the pressed stamp" on their ground.

## Typography

**Display Font:** Big Shoulders (`--font-display`, with sans-serif fallback)
**Body Font:** Archivo (`--font-sans`)
**Label/Data Font:** Courier Prime (`--font-mono`, 400/700)

**Character:** shipping-tag typography. Big Shoulders' condensed workwear caps
stamp the big words; Archivo does the reading; Courier Prime types the data —
every label, price, date, and status looks typed on a tag, not rendered.

### Hierarchy
- **Display** (Big Shoulders 600, 2.25rem `text-4xl`, lh 0.96, tracking 0.01em, uppercase): the wordmark and page titles only, via the `.display` class. Larger stamps exist (1.75rem rail wordmark, xl mobile); smaller uses (lg, 2xl) appear only in narrow/error contexts.
- **Title** (Archivo 500, 0.875rem): card headings, control labels ("Account", "Your wardrobe").
- **Body** (Archivo 400, 0.875rem–1rem): sentences, descriptions, empty states.
- **Label** (Courier Prime 400, 0.6875rem, tracking 0.08em, uppercase, `--ink-muted`): the `.label` class — metadata keys, dates, counts, statuses. Pairs with `.nums` (tabular numerals) wherever figures sit in columns.
- **Data** (Courier Prime 400, 0.75rem–0.9375rem, sentence case): typed content — the suggestion reason, results, fine print. The reason sentence gets the larger 0.9375rem; footnotes sit at xs in `--ink-faint`.

### Named Rules
**The Shipping-Tag Rule.** Anything typed — labels, prices, dates, counts,
statuses, machine output — sets in Courier Prime, usually with tabular
numerals. Archivo carries prose; Courier carries data. They don't swap jobs.

**The Quiet-Caps Rule.** Uppercase belongs to two voices only: Big Shoulders
display stamps, and tracked Courier micro-labels. Body copy never shouts.

## Layout

Phone-first single-column screens over a persistent navigation shell.

- **Desktop (≥1024px, `lg`):** fixed left rail, `w-56`, painted deep indigo in
  both themes; content flows beside it in centered measure — `max-w-lg`
  (Today), `max-w-2xl` (Settings), `max-w-3xl` (Watch). The outfit editor is a
  two-column grid: `lg:grid-cols-[19rem_minmax(0,1fr)]` (tools left, canvas right).
- **Phone (<1024px):** sticky indigo top bar plus a five-slot bottom bar
  (safe-area padded, backdrop-blurred). The outfit canvas drops its editor and
  shows the read-only renderer — arranging is a laptop job.
- **Spacing rhythm:** Tailwind's scale throughout; cards pad `p-3` (grid rows),
  `p-4` (list rows), `p-5` (panels), `p-7` (hero ticket); headers breathe
  `mb-6`–`mb-8`; list items separate `space-y-3`; pill clusters gap `gap-1`–`gap-1.5`.
- **Entrances:** content rises onto the bench (`animate-rise`) with per-item
  stagger of 60ms, capped near 300–360ms; route changes take one 280ms breath
  (`animate-page`).

## Elevation & Depth

Hybrid, biased flat. Hairline borders and tonal sinks do most of the
separating; shadows are a two-token vocabulary of soft, low-opacity ambient
washes in ink (black at night):

### Shadow Vocabulary
- **Resting card** (`--shadow-card`: `0 1px 2px rgb(39 48 74 / 0.06), 0 10px 24px -16px rgb(39 48 74 / 0.35)`): the default lie of card stock on canvas.
- **Lifted card** (`--shadow-lift`: `0 2px 4px rgb(39 48 74 / 0.07), 0 18px 32px -18px rgb(39 48 74 / 0.42)`): hero tickets, modals-of-one, and the hover state of interactive cards.
- **Eyelet inset** (`inset 0 1px 1px rgb(39 48 74 / 0.15)`): the one recessive shadow, reinforcing the punched hole.

### Named Rules
**The Rest-and-Lift Rule.** Surfaces rest at `--shadow-card` and rise to
`--shadow-lift` only as a response — hover on a match/watch row, or genuine
hero status. Nothing floats at rest; nothing uses hard offset shadows.

Depth otherwise reads through material state: raised (`--surface`), sunk
(`--surface-sunk`), and woven ground (`--paper`).

## Shapes

Two working radii and a full stop: cards curve at 12px (`--radius-card`),
controls at 10px (`--radius-control`), inner image wells tighten to 4px
(`rounded`), and pills/eyelets/formality dots go fully round. Borders are
1px hairlines in `--line`, escalating to `--line-strong` when a card demands
attention.

**The Dashed-Means-Waiting Rule.** A dashed border in this app always marks a
hole to be filled: photo drop zones, outfit gap specs, empty-state panels.
Solid borders mean finished things; dashed means "not yet".

Recurring silhouettes: the **chain-stitch rule** (`.stitch`, a run of 2px
radial-gradient stitches) replaces any `<hr>`; the **eyelet** (`.eyelet`, a
14px reinforced ring with paper center and inset shadow) punches card corners;
hang-tags are strung with a 2px curved cord sweeping off-canvas.

## Components

### Buttons
One source of truth: `src/lib/ui.ts`. Plain class strings so server and client
files share them without a boundary crossing.
- **Shape:** gently curved controls (10px radius), inline-flex, gap-2.
- **Primary** (`btnPrimary`): Action Fill/Text (indigo/cream by day, chalk/navy by night), `px-4 py-2`, `text-sm font-medium`, resting `shadow-card`. Hover fills `--btn-hover` and lifts to `shadow-lift`; press nudges down 1px and settles back to `shadow-card`. Disabled: opacity 50%, pointer-events none.
- **Outline** (`btnOutline`): kraft chip — `--surface` fill, hairline `--line` border; hover strengthens the border to `--line-strong`. No shadow.
- **Ghost** (`btnGhost`) / **Tag** (`btnTag`): text-only, `--ink-muted` shifting to `--ink` on hover; Tag is the xs sibling for quiet paths and destructive-text links (`hover:text-danger`).
- **Focus:** global `:focus-visible` — 2px copper outline, 2px offset, 4px radius.

### Chips / Pills
- **Style:** fully rounded, `--surface-sunk` fill, `--ink-muted` text, `px-2.5 py-1`, `text-xs` (`pillClass`).
- **State:** active styling lives in one global rule keyed off `aria-pressed="true"` / `aria-current="page"` — fill flips to `--btn`/`--btn-ink`. Components never redeclare it. Category/formality/season pickers, occasion switcher, and filters are all this pill; toggles commit on click, no menus.

### Cards / Containers
- **Corner Style:** 12px radius.
- **Background:** Kraft Tag `--surface`; wells and empty slots Sunk Well.
- **Shadow Strategy:** `shadow-card` at rest, `shadow-lift` for heroes and hovers.
- **Border:** hairline `--line`; `--line-strong` when flagged (needs review); dashed when waiting.
- **Internal Padding:** `p-3`–`p-7` by prominence.
- **Signature — the hang-tag:** hero tickets (sign-in, Today's suggestion) are punched (`eyelet` at the shoulder) and strung (an SVG cord curving up toward the rail), with the display voice stamped on top and typed matter below a stitch rule.

### Inputs / Fields
- **Style:** full-width, 10px radius, `--surface` fill, hairline border, `text-sm`, copper caret (`inputClass`).
- **Borderless variant:** inside dense edit cards, inputs start transparent with the placeholder acting as the label at full `--ink-muted` (never faded to decoration); hover reveals a hairline; focus adds copper border + `--surface` fill.
- **Labels:** visible fields wear a `.label` Courier caption above; placeholder-as-label only where the card layout replaces captions.
- **Error / Disabled:** errors render as typed Courier text in Rust; disabled controls drop to 50%.

### Navigation
- **Desktop rail:** fixed indigo column; Big Shoulders wordmark (cream, hovering to night-copper) over a Courier tagline; items are 10px-radius rows with 16px stroke icons, inactive `#a9b1c4` → hover washes of white at 4–6% opacity, active marked by `aria-current`, a faint white fill, and a 3×16px copper tick on the left edge (a nav-local detail, not a portable pattern). Footer holds Settings/Sign-out above a `white/10` seam.
- **Mobile:** bottom bar mirrors the same five destinations — copper icon + cream Courier micro-label when active, slate-grey otherwise; sticky top bar carries the wordmark and Settings.

### Sparkline
Inline SVG, 100×20 viewBox, 1.5 non-scaling stroke, normalized to its own min/max;
draws itself left-to-right once (`animate-draw`, `pathLength=1`), terminal dot at
the last reading; copper when falling, Faded Ink otherwise. No chart library.

## Do's and Don'ts

### Do:
- **Do** compose controls from `src/lib/ui.ts` (`btnPrimary`, `btnOutline`, `btnGhost`, `btnTag`, `inputClass`, `pillClass`) — never restyle a button ad hoc.
- **Do** put every garment cutout in a sunk well, the dark well, or `ground-check` — never on `--paper` or `--page` ground.
- **Do** use `.display`, `.label`, `.nums`, `.stitch`, `.eyelet` before writing bespoke type or divider styles.
- **Do** mark active states with `aria-pressed` / `aria-current` so the single global pill rule applies.
- **Do** enter with `animate-rise` (stagger 60ms, cap ~360ms) and route-change with `animate-page`; reduced-motion is handled globally and must stay that way.
- **Do** draw any new icon in the house construction: 24px box, 1.5 stroke, round caps and joins, no fill, `currentColor`, defaulting to `size-4`.
- **Do** check every screen in both schemes — the button inversion and rail constancy are load-bearing.

### Don't:
- **Don't** invent colors outside the token set; the rail's literal hexes are grandfathered to that one surface.
- **Don't** let copper become a field, a heading color, or more than one competing mark in a view.
- **Don't** use emoji or icon-font glyphs; they break the single icon construction.
- **Don't** introduce new radii beyond 12px, 10px, 4px, and full-round.
- **Don't** draw solid `<hr>` dividers where a stitch rule belongs, and never use dashed borders for finished things.
- **Don't** add hard offset shadows, gradient text, kicker/eyebrow labels, or system display faces — none are part of this system.
- **Don't** pull in a chart library for sparklines or a component library for controls.
