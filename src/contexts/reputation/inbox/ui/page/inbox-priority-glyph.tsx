import type { SVGProps } from 'react'
import { TONE_ICON } from '#/components/ui/tone'
import type { InboxPriority } from '#/contexts/inbox/application/public-api'

/**
 * Signal bars, low to high: x, y and height of each in a 24 px box. The shape
 * says the level (owner decision P-2, 2026-10-28: V1), so colour never carries
 * it alone — Low, Medium and High are 1, 2 and 3 filled bars of three.
 */
const BARS = [
  { x: 3, y: 14, height: 6 },
  { x: 9.75, y: 10, height: 10 },
  { x: 16.5, y: 5, height: 15 },
] as const

const FILLED: Readonly<Record<Exclude<InboxPriority, 'urgent'>, number>> = {
  low: 1,
  medium: 2,
  high: 3,
}

/** An unfilled bar is the same ink, faint: the box stays legible at 12 px. */
const DIM_OPACITY = 0.28

type Props = Omit<SVGProps<SVGSVGElement>, 'children'> &
  Readonly<{
    /** The level shown; `null` is "Not set", three dim bars. */
    level: InboxPriority | null
  }>

/**
 * The priority's glyph, in the ink of whatever holds it (`currentColor`), so a
 * caller sets the tone with its own token class. Urgent is not a fourth bar: it
 * is the negative tone's one icon (`TONE_ICON.negative`), the same alert glyph
 * #857 put on an urgent list row, so a set Urgent and a suggested one look the
 * same and Escalate keeps its flag. Decorative: the level's word is always in
 * the accessible name beside it.
 */
export function InboxPriorityGlyph({ level, ...props }: Props) {
  if (level === 'urgent') {
    const Urgent = TONE_ICON.negative
    return <Urgent aria-hidden="true" {...props} />
  }
  const filled = level === null ? 0 : FILLED[level]
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      data-priority-glyph={level ?? 'none'}
      {...props}
    >
      {BARS.map((bar, index) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width={4.5}
          height={bar.height}
          rx={1}
          fillOpacity={index < filled ? undefined : DIM_OPACITY}
        />
      ))}
    </svg>
  )
}

/** The High level's bars, as a list row's signal glyph (`inbox-list-row-tone.ts`). */
export function HighPriorityGlyph(props: Omit<Props, 'level'>) {
  return <InboxPriorityGlyph level="high" {...props} />
}
