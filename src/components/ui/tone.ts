import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

// The tones a notice or a status pill can take. Alert, Badge and StatusBadge draw
// every tinted surface from this table, and a colour is never the only thing that
// says so: each tone has one icon, and a pill prints its words.
//
//   positive  healthy, saved, connected          --positive on --success-muted
//   warn      needs a person, may break          --warn on --warn-muted
//   negative  failed, blocked                    --negative on --destructive-muted
//   info      worth knowing, nothing to do       --link on the accent tint
//   neutral   quiet: off, archived, no change    --muted-foreground on --muted
//
// `token-contrast.test.ts` holds every ink/tint pair to 4.5:1 in both themes. The
// tinted edge is atmosphere, not a boundary anyone relies on.

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
 * The one icon each tone wears, wherever it is drawn. `CircleAlert` is the product's
 * error glyph and `TriangleAlert` the warning glyph. `neutral` has none, so a
 * status pill in that tone draws a quiet ring.
 */
export const TONE_ICON: Readonly<Record<Exclude<Tone, 'neutral'>, LucideIcon>> = {
  positive: CircleCheck,
  warn: TriangleAlert,
  negative: CircleAlert,
  info: Info,
}
