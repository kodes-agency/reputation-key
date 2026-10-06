// PROTOTYPE — how a row's tone is drawn: the status line in its ink with its one icon,
// and the disc behind a tile's glyph. Ok is quiet on purpose, so the tiles that need
// something are the ones the eye lands on.
import { Lock, PenLine, type LucideIcon } from 'lucide-react'
import { TONE_FILL, TONE_ICON, TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import type { RowTone } from '../../settings-prototype-types'

type ToneLook = Readonly<{
  ink: string
  disc: string
  icon: LucideIcon | null
  /** Said to a screen reader, because colour and an icon alone are not words. */
  spoken: string
}>

export const ROW_TONE: Readonly<Record<RowTone, ToneLook>> = {
  ok: {
    ink: 'text-muted-foreground',
    disc: 'bg-muted text-foreground',
    icon: null,
    spoken: '',
  },
  needs: {
    ink: TONE_INK.warn,
    disc: `${TONE_FILL.warn} ${TONE_INK.warn}`,
    icon: TONE_ICON.warn,
    spoken: 'Needs attention: ',
  },
  draft: {
    ink: TONE_INK.info,
    disc: `${TONE_FILL.info} ${TONE_INK.info}`,
    icon: PenLine,
    spoken: 'Unpublished changes: ',
  },
  locked: {
    ink: 'text-muted-foreground',
    disc: 'bg-muted text-muted-foreground',
    icon: Lock,
    spoken: 'Read only: ',
  },
}

/** The one-line status of a row: icon when it has one, then the words. */
export function ToneLine({
  tone,
  text,
  className,
}: Readonly<{ tone: RowTone; text: string; className?: string }>) {
  if (text === '') return null
  const look = ROW_TONE[tone]
  const Icon = look.icon
  return (
    <span
      className={cn('flex min-w-0 items-center gap-1.5 text-sm', look.ink, className)}
    >
      {Icon === null ? null : <Icon aria-hidden className="size-3.5 shrink-0" />}
      <span className="min-w-0 truncate">
        <span className="sr-only">{look.spoken}</span>
        {text}
      </span>
    </span>
  )
}

/** The icon alone, for a menu item that has no room for the words. */
export function ToneMark({ tone }: Readonly<{ tone: RowTone }>) {
  const look = ROW_TONE[tone]
  const Icon = look.icon
  if (Icon === null) return null
  return (
    <>
      <Icon aria-hidden className={cn('size-3.5 shrink-0', look.ink)} />
      <span className="sr-only">{look.spoken.replace(/: $/, '')}</span>
    </>
  )
}
