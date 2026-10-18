// Reporting — the Monthly portal goal's line on a Portal's Results tab (ADR
// 0068, PLAN PG-16; copy deck R-1, R-2).
//
// One composed read, asked for `goal.create` like the card (whoever sees the
// line is whoever may set the goal), over what the card reads: the Programs the
// actor may see and the recommendation, at one instant. For the Portal it
// names, this month: what it brought in toward the Monthly portal goal while
// that goal counts the month (active, or stopped with the month still
// counting), from the recommendation's one set read and only when every
// Portal's count adds up to the goal's governed figure, as the card's rows are;
// and the goal for this Portal alone, when one runs, with its own governed
// figure against the month's number. A draft Portal (no line on its tab),
// a Portal the read does not list, a Portal neither goal counts this month, and
// one with nothing yet toward the Monthly portal goal and no goal of its own
// have none. It writes nothing.
import type { PortalFacts } from '../../domain/goal-recommendation-types'
import type {
  MonthlyPortalGoalLineRequest,
  PortalGoalLineView,
} from '../dto/monthly-portal-goal.types'
import {
  isPortalGoalMeasure,
  type PropertyCountGoal,
} from '../monthly-portal-goal-identity'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import { progressOf } from './goal-progress'
import type { GoalActor, GoalExecutionPolicy } from './goal-programs'
import {
  gatherMonthlyPortalGoal,
  type MonthlyPortalGoalCardDeps,
} from './monthly-portal-goal-card'
import {
  countingNow,
  monthCountsOf,
  type MonthlyPortalGoalOnCardContext,
} from './monthly-portal-goal-running'

export type MonthlyPortalGoalLineDeps = Pick<
  MonthlyPortalGoalCardDeps,
  'policy' | 'reads' | 'metrics' | 'recommendation' | 'now'
>

/** The Program's subjects as it names them now. */
const currentSubjects = (bundle: GoalProgramBundle) =>
  bundle.assignments
    .filter(({ programVersionId }) => programVersionId === bundle.version.id)
    .map(({ subject }) => subject)

/** The earliest-set count goal that runs for this Portal alone, if one does. */
function ownGoalOf(
  programs: readonly GoalProgramBundle[],
  portalId: string,
): GoalProgramBundle | null {
  const [own] = programs
    .filter((bundle) => {
      const { program, version } = bundle
      if (program.status !== 'active' || !isPortalGoalMeasure(version.metric)) {
        return false
      }
      const [only, ...others] = currentSubjects(bundle)
      return others.length === 0 && only?.kind === 'portal' && only.portalId === portalId
    })
    .sort(
      (a, b) =>
        a.program.createdAt.getTime() - b.program.createdAt.getTime() ||
        a.program.id.localeCompare(b.program.id),
    )
  return own ?? null
}

/**
 * The Portal's count of the month the Monthly portal goal counts now, in that
 * month's measure, when the Portals' counts add up to its governed figure. A
 * Portal that has brought nothing in this month (every Portal, on the 1st) has
 * nothing to say toward the goal: no count.
 */
async function monthlyGoalCountOf(
  deps: MonthlyPortalGoalLineDeps,
  goal: PropertyCountGoal,
  portal: PortalFacts,
  context: MonthlyPortalGoalOnCardContext,
): Promise<PortalGoalLineView['monthlyGoal']> {
  const { status } = goal.program
  if (status !== 'active' && status !== 'ended') return null
  const counting = await countingNow(deps, goal, context)
  if (counting === null) return null
  const { month } = counting
  if (monthCountsOf(context.recommendation, month) === null) return null
  const count = portal.monthToDate[month.measure]
  return count > 0 ? { measure: month.measure, count } : null
}

/** The Portal's own goal this month, when its governed figure can be read. */
async function ownGoalMonthOf(
  deps: MonthlyPortalGoalLineDeps,
  own: GoalProgramBundle,
  portalId: string,
  context: MonthlyPortalGoalOnCardContext,
): Promise<PortalGoalLineView['ownGoal']> {
  const progress = await progressOf(
    deps,
    own,
    { kind: 'portal', portalId },
    'active',
    context.now,
    context.actor,
  )
  if (
    progress === null ||
    progress.reading.kind !== 'live' ||
    !isPortalGoalMeasure(progress.metric)
  ) {
    return null
  }
  return {
    programId: own.program.id,
    measure: progress.metric,
    value: progress.reading.value,
    target: progress.targetValue,
  }
}

export async function readMonthlyPortalGoalLine(
  deps: MonthlyPortalGoalLineDeps,
  input: MonthlyPortalGoalLineRequest,
  actor: GoalActor,
): Promise<PortalGoalLineView | null> {
  const { now, programs, recommendation, goal } = await gatherMonthlyPortalGoal(
    deps,
    input,
    actor,
  )
  // Published and disabled Portals only: a draft has no line.
  const portal = recommendation.portals.find(
    ({ portalId }) => portalId === input.portalId,
  )
  if (portal === undefined) return null
  const own = ownGoalOf(programs, input.portalId)
  const context = { recommendation, now, actor }
  const [monthlyGoal, ownGoal] = await Promise.all([
    goal === null ? null : monthlyGoalCountOf(deps, goal, portal, context),
    own === null ? null : ownGoalMonthOf(deps, own, input.portalId, context),
  ])
  if (monthlyGoal === null && ownGoal === null) return null
  return { month: recommendation.months.current.key, monthlyGoal, ownGoal }
}

/** Request-facing: each invocation receives its scoped policy, like the Program reads. */
export type MonthlyPortalGoalLineRequestApi = Readonly<{
  line: (
    policy: GoalExecutionPolicy,
    input: MonthlyPortalGoalLineRequest,
    actor: GoalActor,
  ) => Promise<PortalGoalLineView | null>
}>
