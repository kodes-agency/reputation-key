import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

// The tones a notice or a status pill can take (UI consistency scan: SURF-05,
// COLL-05). Alert, Badge and StatusBadge draw every tinted surface from this one
// table, so "warning" is the same amber box and the same triangle wherever it
// appears, and a colour is never the only thing that says so: each tone has one
// icon, and a pill prints its words.
//
//   positive  healthy, saved, connected          --positive on --success-muted
//   warn      needs a person, may break          --warn on --warn-muted
//   negative  failed, blocked                    --negative on --destructive-muted
//   info      worth knowing, nothing to do       --link on the accent tint
//   neutral   quiet: off, archived, no change    --muted-foreground on --muted
//
// Each ink is the text-grade value of its colour and each tint is the quietest
// surface it was measured on; `token-contrast.test.ts` reads both from the
// variants that use them and holds every pair to 4.5:1 in the light and the
// dark theme. The tinted edge is atmosphere, not a boundary anyone relies on.

export type Tone = 'positive' | 'warn' | 'negative' | 'info' | 'neutral'

/** The tint alone, for a disc or a swatch that draws no edge. */
export const TONE_FILL: Readonly<Record<Tone, string>> = {
  positive: 'bg-positive-muted',
  warn: 'bg-warn-muted',
  negative: 'bg-negative-muted',
  info: 'bg-accent',
  neutral: 'bg-muted',
}

const TONE_EDGE: Readonly<Record<Tone, string>> = {
  positive: 'border-positive/30',
  warn: 'border-warn-line',
  negative: 'border-negative/30',
  info: 'border-link/25',
  neutral: 'border-border',
}

/** The tint and its edge. */
export const TONE_SURFACE: Readonly<Record<Tone, string>> = {
  positive: `${TONE_EDGE.positive} ${TONE_FILL.positive}`,
  warn: `${TONE_EDGE.warn} ${TONE_FILL.warn}`,
  negative: `${TONE_EDGE.negative} ${TONE_FILL.negative}`,
  info: `${TONE_EDGE.info} ${TONE_FILL.info}`,
  neutral: `${TONE_EDGE.neutral} ${TONE_FILL.neutral}`,
}

/** The ink for the words and the icon that sit on the tint. */
export const TONE_INK: Readonly<Record<Tone, string>> = {
  positive: 'text-positive',
  warn: 'text-warn',
  negative: 'text-negative',
  info: 'text-link',
  neutral: 'text-muted-foreground',
}

/**
 * The one icon each tone wears, wherever it is drawn. `CircleAlert` is the
 * product's error glyph (FormErrorBanner, the router's error boundary) and
 * `TriangleAlert` the warning glyph; the older `AlertCircle`, `AlertTriangle`,
 * `CheckCircle2` and `OctagonAlert` are the same shapes under other names and
 * are not used for a tone. `neutral` has none to speak of, so a status pill in
 * that tone draws a quiet ring.
 */
export const TONE_ICON: Readonly<Record<Exclude<Tone, 'neutral'>, LucideIcon>> = {
  positive: CircleCheck,
  warn: TriangleAlert,
  negative: CircleAlert,
  info: Info,
}
