import { Link } from '@tanstack/react-router'
import { Target } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { PortalGoalCardGoal } from './portal-goal-card-goal'
import type { PortalGoalCheckInCommands } from './portal-goal-check-in'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'
import type { OverviewPortalGoalView } from './portal-goal-overview-view'
import type { PortalGoalSheetIntent } from './portal-goal-sheet-intent'

/** The slot's title: the focus goes back to it once the check-in is answered. */
export const PORTAL_GOAL_OVERVIEW_TITLE_ID = 'portal-goal-overview-title'

type Props = Readonly<{
  view: OverviewPortalGoalView
  propertyId: string
  /** "Not now" for the month the prompt named. */
  onNotNow: (month: string) => void
  notNowPending: boolean
  /** The check-in's Use and Keep, and what reads the goal again once it is answered. */
  checkIn: Readonly<{
    commands: PortalGoalCheckInCommands
    onAnswered: () => Promise<void>
  }>
  /** The change sheet, for the check-in's "Other number"; left out, it is not offered. */
  openSheet?: (intent: PortalGoalSheetIntent) => void
}>

/** One line, one door to the card and "Not now". */
function Prompt({
  text,
  month,
  propertyId,
  onNotNow,
  notNowPending,
}: Readonly<{ text: string; month: string }> &
  Pick<Props, 'propertyId' | 'onNotNow' | 'notNowPending'>) {
  return (
    <section
      aria-label={PORTAL_GOAL_NAME}
      data-slot="portal-goal-prompt"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm"
    >
      <Target aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1">{text}</p>
      <div className="flex items-center gap-3">
        <Button asChild size="sm">
          <Link
            to="/properties/$propertyId/goals"
            params={{ propertyId }}
            hash="portal-goals"
            // The Portal goals hand their title the focus once they are drawn.
            state={{ focusPortalGoals: true }}
          >
            See it
          </Link>
        </Button>
        <Button
          variant="link"
          size="inline"
          touch
          disabled={notNowPending}
          onClick={() => onNotNow(month)}
        >
          Not now
        </Button>
      </div>
    </section>
  )
}

export function PortalGoalOverview({
  view,
  propertyId,
  onNotNow,
  notNowPending,
  checkIn,
  openSheet,
}: Props) {
  switch (view.kind) {
    case 'nothing':
      return null
    case 'prompt':
      return (
        <Prompt
          text={view.text}
          month={view.month}
          propertyId={propertyId}
          onNotNow={onNotNow}
          notNowPending={notNowPending}
        />
      )
    case 'card':
      // the card the Goals page draws, in this slot, with the
      // check-in above it while one asks.
      return (
        <PortalGoalCardGoal
          goal={view.goal}
          today={view.today}
          propertyId={propertyId}
          slot="portal-goal-overview"
          titleId={PORTAL_GOAL_OVERVIEW_TITLE_ID}
          titleAs="h2"
          openSheet={openSheet}
          checkIn={view.checkIn === null ? undefined : checkIn}
        />
      )
  }
}
