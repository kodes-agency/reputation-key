// The small lines of the Monthly portal goal's card body, shared by the card's
// running month and its waiting arm: a door to the sheet inside a line, the
// month before (G-30, G-31), the recommended number the month keeps (K-7), and
// the way on to the goal's page (G-28).
import { Link } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import type { PortalGoalOfCard } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { Button } from '#/components/ui/button'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import { GoalCardActions } from './goal-card-frame'
import { sameNumberWords } from './portal-goal-check-in-view'
import type { lastMonthWords } from './portal-goal-running-view'
import type { PortalGoalSheetIntent } from './portal-goal-sheet-intent'

type OpenSheet = (intent: PortalGoalSheetIntent) => void

/** A door to the sheet, in the card's line. */
export function SheetLink({
  label,
  onClick,
}: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <Button variant="link" size="inline" touch className="self-start" onClick={onClick}>
      {label}
    </Button>
  )
}

/** G-30 and G-31: the month before, met with a check, otherwise in neutral words. */
export function LastMonthLine({
  words,
}: Readonly<{ words: NonNullable<ReturnType<typeof lastMonthWords>> }>) {
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 border-t pt-4 text-sm tabular-nums',
        words.met ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {words.met ? (
        <Check className={cn('size-4 shrink-0', TONE_INK.positive)} aria-hidden="true" />
      ) : null}
      <span>{words.text}</span>
    </p>
  )
}

/** K-7: December keeps the recommended number it has, and "Change" to the sheet. */
export function SameNumberLine({
  goal,
  openSheet,
}: Readonly<{ goal: PortalGoalOfCard; openSheet?: OpenSheet }>) {
  if (goal.checkIn?.kind !== 'same') return null
  const words = sameNumberWords(goal.checkIn)
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
      <span>{words.text}</span>
      {openSheet === undefined ? null : (
        <SheetLink
          label={words.change}
          onClick={() => openSheet({ mode: 'change', measure: goal.measure })}
        />
      )}
    </p>
  )
}

/** G-28: the goal's page, as a tap target like the first goal's. */
export function Details({ propertyId }: Readonly<{ propertyId: string }>) {
  return (
    <GoalCardActions>
      <Button asChild variant="outline">
        <Link to="/properties/$propertyId/goals/portals" params={{ propertyId }}>
          View details
        </Link>
      </Button>
    </GoalCardActions>
  )
}
