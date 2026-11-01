// The Monthly portal goal's page, `/goals/portals` (ADR 0068, amended 2026-11-01). Before
// a goal it is the card's own state, as on the Goals page, under the page's title (the
// card draws none). With a goal: the pace as the pill in the page's header; a stopped
// goal's notice; where the goal stands (what is left, the days left and the ruler with
// a steady month's stop on it); then three questions in the bands Guest voice, Portal
// Results and the Google rating goal's page use: where they are coming from (plain
// counts in name order, no ranking, P-1), how the month compares (each month against
// its own number) and what to do this week. What changed and how the goal counts are
// closed until asked; once a month has closed, the way to every month's result. A
// stopped goal whose last month has closed is no goal any more, so its months and
// changes sit under the card before a goal. Under it all, the other Portal goals and
// the way to add one, which the route hands in (a component imports no routes). Its
// actions (P-3: "Change number", and the menu with the other measure and Stop) are in
// the header while the goal can change; the Stop dialog is held here, outside the menu
// and the header, so a refusal that reads the page again keeps it.
//
// A goal for one Portal or one Portal Group has this page too, on `$goalId`
// (PLAN PG-21): titled for its subject ("Reception · portal goal"), counting
// from it and saying so in "How this goal counts", with the same actions (no
// other measure when its subject already holds a goal for it) and no Portals'
// rows or other goals.
import { useId, type ReactNode } from 'react'
import type { PortalGoalPageView } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import type { PortalGoalOfCard } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
import { InlineLink } from '#/components/ui/inline-link'
import { SectionTitle } from '#/components/ui/section-title'
import { StatusBadge } from '#/components/ui/status-badge'
import { GoalDetailLayout, GoalWhere } from './goal-detail-layout'
import {
  PortalGoalCompareBand,
  PortalGoalTodoBand,
  PortalGoalWhereBand,
} from './portal-goal-bands'
import { PortalGoalCard } from './portal-goal-card'
import { PortalGoalStopped } from './portal-goal-card-goal'
import type { PortalGoalCommands } from './portal-goal-card-ready'
import { PortalGoalChanges } from './portal-goal-changes'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'
import { PortalGoalHowItCounts } from './portal-goal-how-it-counts'
import {
  PortalGoalMonthHeadline,
  PortalGoalMonthRuler,
  PortalGoalMonthUnreadable,
} from './portal-goal-month-meter'
import { PortalGoalMonthStrip } from './portal-goal-month-strip'
import { stripChips } from './portal-goal-page-view'
import { usePortalGoalPageActions } from './portal-goal-page-actions'
import { allResultsLink } from './portal-goal-results-foot'
import type { PortalGoalStopCommands } from './portal-goal-stop-dialog'
import { portalGoalPace } from './portal-goal-status-view'
import { goalLines, shownMeasure } from './portal-goal-words'

type Props = Readonly<{
  propertyId: string
  propertyName: string
  page: PortalGoalPageView
  canCreatePortal: boolean
  /** "All monthly results" is for someone who may see every month's result. */
  canSeeResults: boolean
  /** `goal.update`: "Change number" and the other measure. */
  canChange: boolean
  /** `goal.cancel`: "Stop this goal". */
  canStop: boolean
  commands: PortalGoalCommands
  stop: PortalGoalStopCommands
  personName: (userId: string) => string | null
  /** The other Portal goals' rows, under "More portal goals"; null with none. */
  extras?: ReactNode
  /** The way to add one, when "Add a portal goal" offers something; else null. */
  addLink?: ReactNode
  /**
   * A goal for one Portal or one group: its page's title, whom it counts, where
   * its ratings count ("Reception"), and whether the other measure is offered.
   */
  single?: Readonly<{ title: string; name: string; where: string; canSwitch: boolean }>
}>

type HistoryProps = Pick<Props, 'page' | 'propertyId' | 'canSeeResults' | 'personName'>

/** P-15: every month's result, once a month has closed. */
function AllResultsLink({ page, propertyId, canSeeResults }: HistoryProps) {
  const foot = canSeeResults ? allResultsLink(page.anyMonthClosed) : null
  if (foot === null) return null
  return (
    // Every month's result, on its own page.
    <InlineLink
      to="/properties/$propertyId/goals/portal-results"
      params={{ propertyId }}
      className="self-start text-sm"
    >
      {foot}
    </InlineLink>
  )
}

/** P-8 to P-12: each month, and what changed. */
function MonthsAndChanges({ page, personName }: HistoryProps) {
  return (
    <>
      <PortalGoalMonthStrip chips={stripChips(page.months, page.today)} />
      <PortalGoalChanges
        changes={page.changes}
        personName={personName}
        today={page.today}
      />
    </>
  )
}

/** Where the goal stands: what is left and the ruler, or the month and number it waits for. */
function Where({ goal, today }: Readonly<{ goal: PortalGoalOfCard; today: string }>) {
  const { month } = goal
  if (month !== null) {
    return (
      <GoalWhere>
        <PortalGoalMonthHeadline month={month} />
        <PortalGoalMonthUnreadable month={month} />
        <PortalGoalMonthRuler month={month} />
      </GoalWhere>
    )
  }
  const [headline, ...rest] = goalLines(goal, today)
  return (
    <GoalWhere>
      <p className="text-base font-medium tabular-nums">{headline}</p>
      {rest.map((line) => (
        <p key={line} className="text-sm text-muted-foreground tabular-nums">
          {line}
        </p>
      ))}
    </GoalWhere>
  )
}

function GoalBody({
  goal,
  ...props
}: Omit<Props, 'canCreatePortal' | 'extras' | 'addLink'> &
  Readonly<{ goal: PortalGoalOfCard }>) {
  const { page, propertyId, commands, single, canChange } = props
  const { openSheet } = commands
  const measure = shownMeasure(goal)
  const running = goal.status !== 'ended' && goal.stopped === null
  return (
    <GoalDetailLayout slot="portal-goal-detail">
      {goal.month === null ? null : (
        <PortalGoalStopped
          goal={goal}
          monthKey={goal.month.key}
          openSheet={openSheet}
          notice
        />
      )}
      <Where goal={goal} today={page.today} />
      {single ? null : <PortalGoalWhereBand page={page} propertyId={propertyId} />}
      <PortalGoalCompareBand goal={goal} page={page} measure={measure} />
      {running ? (
        <PortalGoalTodoBand
          page={page}
          propertyId={propertyId}
          measure={measure}
          month={goal.month}
          single={single !== undefined}
          onChangeNumber={
            canChange && openSheet !== undefined
              ? () => openSheet({ mode: 'change', measure: goal.measure })
              : undefined
          }
        />
      ) : null}
      <PortalGoalChanges
        changes={page.changes}
        personName={props.personName}
        today={page.today}
      />
      <PortalGoalHowItCounts
        measure={measure}
        timezone={page.timezone}
        where={single?.where}
      />
      <AllResultsLink {...props} />
    </GoalDetailLayout>
  )
}

/**
 * Before a goal: the card's own state; after a stopped goal's last month has
 * closed, its months and changes under it.
 */
function BeforeGoal(props: Omit<Props, 'extras' | 'addLink'>) {
  const { page, propertyId, canCreatePortal, commands } = props
  const card = (
    <PortalGoalCard
      card={page.card}
      propertyId={propertyId}
      canCreatePortal={canCreatePortal}
      commands={{
        ...commands,
        // Use is gone with the card once the page draws the goal in its
        // place: the page's title takes the focus.
        onSet: async () => {
          await commands.onSet()
          focusPortalGoalPageTitle()
        },
      }}
      titleAs={null}
    />
  )
  if (page.months.length === 0 && page.changes.length === 0) return card
  return (
    <div className="flex flex-col gap-6">
      {card}
      <MonthsAndChanges {...props} />
      <AllResultsLink {...props} />
    </div>
  )
}

/** The page header's id: the header outlives the card, so its title takes the focus. */
export const PAGE_HEADER_ID = 'portal-goal-page-header'

/**
 * The page's h1, made focusable for the moment it takes the focus: after Use,
 * and when the set sheet closes with its door gone (the card has no title here).
 */
export function focusPortalGoalPageTitle(): void {
  const title = document
    .getElementById(PAGE_HEADER_ID)
    ?.querySelector<HTMLHeadingElement>('h1')
  if (!title) return
  title.tabIndex = -1
  title.classList.add('outline-none')
  title.focus()
}

/**
 * M-1: the other Portal goals, and the way to add one. The way, and the line
 * that asks, show only when "Add a portal goal" offers something (the M-rule);
 * with neither a goal nor a way, there is no block.
 */
function MorePortalGoals({ extras, addLink }: Pick<Props, 'extras' | 'addLink'>) {
  const headingId = useId()
  const hasAdd = addLink !== null && addLink !== undefined
  if (!hasAdd && (extras === null || extras === undefined)) return null
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SectionTitle id={headingId}>More portal goals</SectionTitle>
        {hasAdd ? (
          <p className="text-sm text-muted-foreground">
            Want a number for one portal as well? Most properties don’t need one.
          </p>
        ) : null}
      </div>
      {extras}
      {addLink}
    </section>
  )
}

/** P-3: the page's actions while its goal can change, and the Stop dialog they open. */
function usePageActions(props: Props) {
  const { card } = props.page
  const { openSheet } = props.commands
  return usePortalGoalPageActions({
    goal: card.state === 'goal' && openSheet !== undefined ? card.goal : null,
    name: props.single?.title,
    kind: props.single ? 'single' : 'monthly',
    propertyId: props.propertyId,
    canChange: props.canChange,
    canStop: props.canStop,
    openSheet,
    canSwitch:
      props.single?.canSwitch ??
      (card.state !== 'goal' ||
        card.goal.measure !== 'qualified_scans' ||
        card.sheet.ratingsAvailable !== false),
    stop: props.stop,
    focusTitle: focusPortalGoalPageTitle,
  })
}

export function PortalGoalPage(props: Props) {
  const { page, propertyId, propertyName } = props
  const { card } = page
  const { actions, dialog } = usePageActions(props)
  const title = props.single?.title ?? PORTAL_GOAL_NAME
  // The pace the card wears in its corner, where the Google rating goal's page wears its own.
  const pace = card.state === 'goal' ? portalGoalPace(card.goal.month) : null
  return (
    <PageShell>
      <div id={PAGE_HEADER_ID}>
        <PageHeader
          title={title}
          meta={pace === null ? undefined : [<StatusBadge key="pace" {...pace} />]}
          breadcrumbs={trailCrumbs('goals', { propertyId, propertyName }, title)}
          actions={actions}
        />
      </div>
      {card.state === 'goal' ? (
        <GoalBody {...props} goal={card.goal} />
      ) : (
        <BeforeGoal {...props} />
      )}
      <MorePortalGoals extras={props.extras} addLink={props.addLink} />
      {dialog}
    </PageShell>
  )
}
