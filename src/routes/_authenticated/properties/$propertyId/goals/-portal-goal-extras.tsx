// The Portal goals other than the Monthly portal goal's card, under it, as
// compact rows (PLAN PG-21): whom each counts and what, a link to its own page
// ("Reception · Private ratings", the average by its measure alone), and, while
// a month runs, the month so far (`GoalLiveLine`: its words, and for a count
// with one subject whose pace was judged the same pace pill as the card's). The
// goals not ended only, on both of the Google section's views; the ended ones
// are on the Portal goal results page. The Goals page lists the first few, then
// the way to see them all on the Monthly portal goal's page, which lists every
// one. The card above is the Portal goals' first state, so no goals draw
// nothing here, and the goal the card shows is not listed again.
import { Link } from '@tanstack/react-router'
import type {
  GoalListProgress,
  GoalSubject,
} from '#/contexts/reporting/application/public-api'
import type { listGoalPrograms } from '#/contexts/reporting/server/goal-programs'
import { InlineLink } from '#/components/ui/inline-link'
import { ROW_NAME_LINK } from '#/components/ui/row-link'
import { SectionTitle } from '#/components/ui/section-title'
import { GoalLiveLine, GoalLiveLinePending } from '#/components/goals/goal-live-line'
import { goalLiveShape } from '#/components/goals/goal-live-view'
import { cn } from '#/lib/utils'
import { extrasRows, type PortalGoalExtraRow } from './-portal-goal-extras-view'

type ListedGoal = Awaited<ReturnType<typeof listGoalPrograms>>['programs'][number]

type Props = Readonly<{
  propertyId: string
  /** The goals not ended. */
  goals: readonly ListedGoal[]
  /** The Program the card shows as the Monthly portal goal; null when it shows none. */
  monthlyGoalId: string | null
  /** The month so far of the active goals, read apart from the list. */
  live: Readonly<{
    byProgram: ReadonlyMap<string, GoalListProgress>
    loading: boolean
    failed: boolean
  }>
  subjectName: (subject: GoalSubject) => string
  /**
   * How many rows the Goals page lists before "See all on the goal page"; the
   * Monthly portal goal's page lists every one.
   */
  limit?: number
  /**
   * Its own "More portal goals" title; off where the page titles the part it
   * sits in (the Monthly portal goal's page).
   */
  titled?: boolean
}>

function GoalRow({
  row: { goal, name, subjects },
  propertyId,
  live,
}: Readonly<{ row: PortalGoalExtraRow<ListedGoal> }> &
  Pick<Props, 'propertyId' | 'live'>) {
  const { program, version } = goal
  const liveGoal = live.byProgram.get(program.id)
  // While the month is first being read, keep the room its line will take, so
  // the rows below do not jump when it arrives.
  const pendingShape = live.loading
    ? goalLiveShape({
        status: program.status,
        metric: version.metric,
        subjectCount: subjects.length,
      })
    : null
  return (
    <li className="min-w-0 py-3">
      <Link
        className={cn('font-medium', ROW_NAME_LINK)}
        to="/properties/$propertyId/goals/$goalId"
        params={{ propertyId, goalId: program.id }}
      >
        {name}
      </Link>
      {liveGoal !== undefined ? (
        <GoalLiveLine goal={liveGoal} />
      ) : pendingShape !== null ? (
        <GoalLiveLinePending shape={pendingShape} />
      ) : null}
    </li>
  )
}

export function PortalGoalExtras({
  goals,
  monthlyGoalId,
  limit,
  titled = true,
  subjectName,
  propertyId,
  live,
}: Props) {
  const { rows, more } = extrasRows(goals, { monthlyGoalId, subjectName, limit })
  // The card is the Portal goals' state when there are no others.
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      {titled ? <SectionTitle level={3}>More portal goals</SectionTitle> : null}
      {live.failed ? (
        <p className="text-sm text-muted-foreground">
          This month’s figures can’t be read right now.
        </p>
      ) : null}
      <ul aria-label="Active goals" className="divide-y">
        {rows.map((row) => (
          <GoalRow
            key={row.goal.program.id}
            row={row}
            propertyId={propertyId}
            live={live}
          />
        ))}
      </ul>
      {more ? (
        <InlineLink
          to="/properties/$propertyId/goals/portals"
          params={{ propertyId }}
          className="self-start text-sm"
        >
          See all on the goal page
        </InlineLink>
      ) : null}
    </div>
  )
}
