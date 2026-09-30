// The mark for whoever holds a thing: a 20 px disc with a person's initials, or
// a person glyph when there is nothing to draw. Hoisted from the inbox owner
// control (plan v2.1 row 4) so the portal's responsible managers wear the same
// mark. Initials come from `personInitials` (`inbox/person-initials.ts`), which
// returns `null` — never a placeholder letter — when a name has none.
import { UserRound, UserRoundCheck } from 'lucide-react'
import { cn } from '#/lib/utils'
import type { ReactNode } from 'react'

/**
 * `accent` is a control's disc: the strong `--accent` ink, read straight from
 * the token (no utility maps it, and `text-primary` diverges from `--accent` in
 * the dark theme), on `bg-accent`, which `styles.css` maps to the accent-MUTED
 * ground. Purple is interactive-only, so only a control wears it. `neutral` is
 * a fact's: ink on `--border` (0.9 / 0.28 lightness) — `--muted` is 0.96 against
 * a 0.98 background in the light theme, a disc too faint to read as a shape once
 * the fact lost its own box, and an accent disc on a fact would tell a viewer it
 * can be pressed.
 */
const DISC_TONE = {
  accent: 'bg-accent text-(--accent)',
  neutral: 'bg-border text-foreground',
} as const

export type OwnerDiscTone = keyof typeof DISC_TONE

type Props = Readonly<{
  /** The person's initials, or `null` when their name has none to draw. */
  initials: string | null
  tone: OwnerDiscTone
  /**
   * Whether someone holds it at all. Read only when `initials` is `null`: the
   * glyph says WHETHER someone holds the item even when no name can be found
   * for them, so a holder the directory cannot name is not drawn as "free".
   */
  isAssigned?: boolean
  /** Extra classes for the disc. The fallback glyph takes none. */
  className?: string
}>

/**
 * The disc, or the glyph. Initials are a picture of the name and the name is
 * always in the label or the `aria-label` beside it, so the mark is
 * `aria-hidden` either way. A neutral glyph is drawn at 14 px to sit beside a
 * fact's 13 px words; an accent glyph takes its size from the button around it.
 */
export function OwnerDisc({
  initials,
  tone,
  isAssigned = false,
  className,
}: Props): ReactNode {
  if (initials === null) {
    const Glyph = isAssigned ? UserRoundCheck : UserRound
    return (
      <Glyph aria-hidden="true" className={tone === 'neutral' ? 'size-3.5' : undefined} />
    )
  }
  return (
    <span
      aria-hidden="true"
      data-slot="owner-disc"
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] leading-none font-semibold',
        DISC_TONE[tone],
        className,
      )}
    >
      {initials}
    </span>
  )
}
