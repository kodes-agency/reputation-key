// The Monthly portal goal's page, `/goals/portals` (ADR 0068; copy deck P-1…P-15,
// M-1). Before a goal it is the card's own state, as on the Goals page. With a
// goal: what it counts and from where, the tiles, the month so far with its
// first and last day under the bar, what each Portal brought in and the quiet
// ones, each month (of this goal and the ones it took over from), what
// changed, and how the goal counts; once a month has closed, the way to every
// month's result. Under it all, the other Portal goals and the way to add one,
// which the route hands in (a component imports no routes). Its actions
// ("Change number" and the menu) come with the change and the stop.
import { useId, type ReactNode } from 'react'
import type { PortalGoalPageView } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import type { PortalGoalOfCard } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
import { InlineLink } from '#/components/ui/inline-link'
import { SectionTitle } from '#/components/ui/section-title'
import { PortalGoalCard } from './portal-goal-card'
import { PortalGoalMonthSoFar } from './portal-goal-card-goal'
import type { PortalGoalCommands } from './portal-goal-card-ready'
import { PortalGoalChanges } from './portal-goal-changes'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'
import { PortalGoalFromPortals } from './portal-goal-from-portals'
import { PortalGoalHowItCounts } from './portal-goal-how-it-counts'
import { PortalGoalMonthStrip } from './portal-goal-month-strip'
import {
  allResultsLink,
  fromPortalsWords,
  monthAxis,
  monthSoFarHeading,
  pageBodyLine,
  portalGoalTiles,
  stripChips,
} from './portal-goal-page-view'
import { stoppedWords } from './portal-goal-running-view'
import { PortalGoalTiles } from './portal-goal-tiles'
import { shownMeasure } from './portal-goal-words'

type Props = Readonly<{
  propertyId: string
  propertyName: string
  page: PortalGoalPageView
  canCreatePortal: boolean
  /** "All monthly results" is for someone who may see every month's result. */
  canSeeResults: boolean
  commands: PortalGoalCommands
  personName: (userId: string) => string | null
  /** The other Portal goals' rows, under "More portal goals". */
  extras?: ReactNode
  /** The way to add one, for someone who may. */
  addLink?: ReactNode
}>

/** P-5: the month so far, with its first and last day, and a stop. */
function MonthSoFarSection({ goal }: Readonly<{ goal: PortalGoalOfCard }>) {
  const headingId = useId()
  const { month, stopped } = goal
  if (month === null) return null
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <SectionTitle id={headingId}>{monthSoFarHeading(month.key)}</SectionTitle>
      <PortalGoalMonthSoFar month={month} axis={monthAxis(month)} />
      {stopped === null ? null : (
        <p className="text-sm text-muted-foreground">
          {stoppedWords(stopped, month.key)}
        </p>
      )}
    </section>
  )
}

function GoalBody({
  goal,
  today,
  ...props
}: Omit<Props, 'commands' | 'canCreatePortal' | 'extras' | 'addLink'> &
  Readonly<{ goal: PortalGoalOfCard; today: string }>) {
  const { page, propertyId, propertyName } = props
  const measure = shownMeasure(goal)
  const foot = props.canSeeResults ? allResultsLink(page.anyMonthClosed) : null
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {pageBodyLine(
          measure,
          page.portals.map(({ name }) => name),
          propertyName,
        )}
      </p>
      {page.tiles === null ? null : (
        <PortalGoalTiles tiles={portalGoalTiles(goal, page.tiles, today)} />
      )}
      <MonthSoFarSection goal={goal} />
      <PortalGoalFromPortals
        propertyId={propertyId}
        words={fromPortalsWords(page.rows, page.facts, page.portals)}
      />
      <PortalGoalMonthStrip chips={stripChips(page.months, today)} />
      <PortalGoalChanges changes={page.changes} personName={props.personName} />
      <PortalGoalHowItCounts measure={measure} timezone={page.timezone} />
      {foot === null ? null : (
        // Every month's result, on the Goals page until it has a page of its own.
        <InlineLink
          to="/properties/$propertyId/goals"
          params={{ propertyId }}
          className="self-start text-sm"
        >
          {foot}
        </InlineLink>
      )}
    </div>
  )
}

/** M-1: the other Portal goals, and the way to add one. */
function MorePortalGoals({ extras, addLink }: Pick<Props, 'extras' | 'addLink'>) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SectionTitle id={headingId}>More portal goals</SectionTitle>
        <p className="text-sm text-muted-foreground">
          Want a number for one portal as well? Most properties don’t need one.
        </p>
      </div>
      {extras}
      {addLink}
    </section>
  )
}

export function PortalGoalPage(props: Props) {
  const { page, propertyId, propertyName, canCreatePortal, commands } = props
  const { card } = page
  return (
    <PageShell>
      <PageHeader
        title={PORTAL_GOAL_NAME}
        breadcrumbs={trailCrumbs('goals', { propertyId, propertyName }, PORTAL_GOAL_NAME)}
      />
      {card.state === 'goal' ? (
        <GoalBody {...props} goal={card.goal} today={card.today} />
      ) : (
        <PortalGoalCard
          card={card}
          propertyId={propertyId}
          canCreatePortal={canCreatePortal}
          commands={commands}
          titleAs="h2"
        />
      )}
      <MorePortalGoals extras={props.extras} addLink={props.addLink} />
    </PageShell>
  )
}
