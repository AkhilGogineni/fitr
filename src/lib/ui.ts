/**
 * The shared control vocabulary.
 *
 * One place for the class strings every screen reuses, so a button or an
 * input can't drift between the gallery and utility registers. Plain strings,
 * not components: they compose inside both server and client files without a
 * boundary crossing.
 */

/** Primary action. Indigo by day, chalk by night — reads pressed when active. */
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-control bg-btn px-4 py-2 text-sm font-medium text-btn-ink " +
  "shadow-card transition-[background-color,box-shadow,transform] duration-150 " +
  "hover:bg-btn-hover hover:shadow-lift active:translate-y-px active:shadow-card " +
  "disabled:pointer-events-none disabled:opacity-50";

/** Secondary action: a kraft chip with a hairline edge. */
export const btnOutline =
  "inline-flex items-center justify-center gap-2 rounded-control border border-line bg-surface px-4 py-2 text-sm text-ink " +
  "transition-colors duration-150 hover:border-line-strong disabled:pointer-events-none disabled:opacity-50";

/** Quiet action: text only, for the paths that should never compete. */
export const btnGhost =
  "text-sm text-ink-muted underline-offset-4 transition-colors hover:text-ink disabled:opacity-50";

/** Small quiet action, tag-sized. */
export const btnTag =
  "text-xs text-ink-muted underline-offset-4 transition-colors hover:text-ink disabled:opacity-50";

export const inputClass =
  "w-full rounded-control border border-line bg-surface px-3 py-2 text-sm outline-none transition-colors " +
  "placeholder:text-ink-faint focus:border-copper";

/** Toggle pill. Active state comes from aria-pressed, styled globally below. */
export const pillClass =
  "pill rounded-full px-2.5 py-1 text-xs transition-colors duration-150 bg-surface-sunk text-ink-muted hover:text-ink";
