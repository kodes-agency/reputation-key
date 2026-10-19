// The Monthly portal goal on the Property Overview (PLAN PG-16; copy deck
// O-1…O-6): its own slot after "How you are doing" and above "Guest voice",
// never beside the Google rating goal. One line when the number is ready, with
// "See it" to the Goals page's card and "Not now"; the running month as the
// Goals page draws its card (ADR 0068, amended 2026-10-19: the same card, which
// goes compact by its own width: the Portals' counts in one line in a narrow
// slot); or, on the month's first seven days, the month-start check-in. Nothing
// otherwise (`overviewPortalGoalView`, which the host works out).
// Presentational: the host hands it the view, Not now and the check-in's
// commands.
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Target } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { InlineLink } from '#/components/ui/inline-link'
import { PortalGoalCardGoal } from './portal-goal-card-goal'
import { PortalGoalCheckIn, type PortalGoalCheckInCommands } from './portal-goal-check-in'
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

/** O-1: one line, one door to the card and "Not now". */
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

/** The slot while the check-in asks: the goal's name, what the check-in says, and "View details" (G-28). */
function CheckInFrame({
  propertyId,
  children,
}: Readonly<{ propertyId: string; children: ReactNode }>) {
  return (
    <Card data-slot="portal-goal-overview" className="gap-4">
      <CardHeader>
        <CardTitle
          as="h2"
          id={PORTAL_GOAL_OVERVIEW_TITLE_ID}
          tabIndex={-1}
          className="outline-none"
        >
          {PORTAL_GOAL_NAME}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {children}
        <InlineLink
          to="/properties/$propertyId/goals/portals"
          params={{ propertyId }}
          className="self-start text-sm"
        >
          View details
        </InlineLink>
      </CardContent>
    </Card>
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
      // O-2: the card the Goals page draws, in this slot.
      return (
        <PortalGoalCardGoal
          goal={view.goal}
          today={view.today}
          propertyId={propertyId}
          slot="portal-goal-overview"
          titleId={PORTAL_GOAL_OVERVIEW_TITLE_ID}
          titleAs="h2"
          openSheet={openSheet}
        />
      )
    case 'check_in':
      // O-3…O-6: the card's check-in, under the goal's name.
      return (
        <CheckInFrame propertyId={propertyId}>
          <PortalGoalCheckIn
            goal={view.goal}
            checkIn={view.checkIn}
            propertyId={propertyId}
            commands={checkIn.commands}
            onAnswered={checkIn.onAnswered}
            openSheet={openSheet}
            headingAs="h3"
          />
        </CheckInFrame>
      )
  }
}
